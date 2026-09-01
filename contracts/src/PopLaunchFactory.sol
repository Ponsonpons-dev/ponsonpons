// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {PopGraduationExecutor} from "./PopGraduationExecutor.sol";
import {PopGraduationGuard} from "./PopGraduationGuard.sol";
import {PopHook} from "./PopHook.sol";
import {LaunchDeployment, PopLaunchDeployer} from "./PopLaunchDeployer.sol";
import {PopLaunchToken} from "./PopLaunchToken.sol";
import {PopLocker} from "./PopLocker.sol";
import {
    CashbackConfig,
    CashbackMode,
    FeePolicySnapshot,
    IPopFeeEscrow,
    IPopLaunchFactory,
    IPopQuoteRegistry,
    LaunchPhase,
    SnipeTaxTerms
} from "./interfaces/IPop.sol";
import {PopGraduationMath} from "./libraries/PopGraduationMath.sol";

interface IWETHMinimal {
    function deposit() external payable;
}

interface IUniswapV3PoolMinimal {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

/**
 * @title PopLaunchFactory
 * @notice Launches every $POP token straight into a live Uniswap V4 pool
 * quoted in WETH: the bonding curve is a single-sided concentrated liquidity
 * position this factory lays over the curve's price range in the launch
 * transaction itself. Anyone with ETH, and any V4-capable router or trading
 * bot, can buy from the first block; there is no custom trading contract to
 * integrate.
 *
 * When the curve range fills (the launch has raised its ETH bond threshold),
 * anyone may `bond` the launch: the position is withdrawn, the raised WETH
 * market-buys the launch's chosen graduated Pons quote token in one swap
 * (bounded by the origin pool's TWAP), and the token/quote pool is seeded at
 * the curve's terminal price with its full-range position locked in
 * PopLocker forever. Every bond is therefore a public market buy of the
 * quote token with the entire raise.
 *
 * Trust model, unchanged from v1 and stated on /proof:
 * - Pre-bond, this factory holds the curve position and has exactly two
 *   things it can do with it: bond it into the locked pool, or, after a
 *   14-day stuck-bond window that anyone can end by bonding, release the
 *   proceeds to the launch's own creator fee recipient. There is no
 *   withdraw-to-anyone function.
 * - No creator-fee-recipient override exists. Creators rotate their own
 *   recipient; lost keys mean lost future creator fees, by design.
 * - The owner (a timelocked key) configures future launches only.
 */
contract PopLaunchFactory is Ownable2Step, ReentrancyGuard, IPopLaunchFactory, IUnlockCallback {
    using SafeERC20 for IERC20;

    uint256 private constant BASIS_POINTS = 10_000;
    uint256 private constant MAX_CREATOR_FEE_BPS = 200; // 2%
    uint256 private constant MAX_TOTAL_TRADE_FEE_BPS = 2_000; // 20%
    // Ceiling on the launch-second snipe tax. Held below 100% so a taxed buy
    // always nets the buyer something.
    uint256 private constant MAX_SNIPE_TAX_START_BPS = 9_900; // 99%
    uint256 private constant MAX_SNIPE_TAX_SECONDS = 60;
    uint256 private constant MIN_LAUNCH_SUPPLY = 1 ether;
    int24 private constant MIN_USABLE_TICK = -887272;
    int24 private constant MAX_USABLE_TICK = 887272;
    int24 private constant MAX_TICK_SPACING = 32767;
    // Largest amount either side of a seed may carry: V4 settles pool
    // balance changes through a BalanceDelta of two int128 halves, so the
    // signed maximum binds even though the PositionManager's ABI accepts a
    // uint128. Mirrors PopGraduationGuard's own ceiling.
    uint256 private constant MAX_SEED_AMOUNT = uint256(uint128(type(int128).max));
    // Worst execution the bond conversion accepts against the quote's
    // 30-minute TWAP. The conversion is permissionless and retryable, so a
    // manipulated origin pool delays a bond rather than repricing it.
    uint256 private constant MAX_BOND_SLIPPAGE_BPS = 500; // 5%
    // How long a launch must sit bond-ready before its proceeds may be
    // released to its creator fee recipient. Bonding is permissionless and
    // retryable, so this window is what separates a genuinely unbondable
    // launch from one that merely hit a transient failure.
    uint256 public constant BOND_RESCUE_DELAY = 14 days;

    struct TokenParams {
        string name;
        string symbol;
        string logo;
        string description;
        PopLaunchToken.Socials socials;
        address creatorFeeRecipient;
        // Additional trade fee the creator charges on top of the hook's base
        // fee, capped at 2%. Paid to the creator (minus their own cashback
        // carve-out), never split with the protocol.
        uint16 creatorFeeBps;
        // Creator-chosen cashback routing, immutable for the launch's life.
        // TraderRebate is retired in v2 and rejected.
        CashbackConfig cashback;
        // Optional guard on the economics this launch will lock in. Zero
        // waives the check. Call previewLaunchEconomics(configId, quote) to
        // obtain it, so an owner retune or registry re-peg landing before
        // the launch reverts it instead of silently repricing it.
        bytes32 expectedEconomics;
        // CREATE2 salt for the launch's token, namespaced per initiating
        // account. Mining it is how a creator picks a vanity address;
        // PopLaunchDeployer.predictLaunchAddress checks in advance.
        bytes32 salt;
    }

    /**
     * @notice Launch shape shared by every bond quote. The ETH-denominated
     * phantom reserve and bond threshold come from the quote registry.
     */
    struct LaunchConfig {
        uint256 supply;
        uint24 poolFee;
        int24 tickSpacing;
        bool enabled;
    }

    /// @dev Tags for the V4 unlock round-trips this factory performs.
    enum UnlockAction {
        SeedCurve,
        CurveSwap,
        BurnCurve
    }

    error InvalidLaunchConfigId();
    error LaunchConfigDisabled();
    error ExemptionListTooLong();
    error InvalidSnipeTaxWindow();
    error CreatorFeeTooHigh();
    error CombinedFeeTooHigh();
    error SupplyTooLow();
    error SupplyTooHigh();
    error InvalidTickSpacing();
    error LaunchFeeNotPaid();
    error NotWhitelisted();
    error FeeTransferFailed();
    error ZeroAddress();
    error OwnershipCannotBeRenounced();
    error InvalidTokenParams();
    error TokenNotFound();
    error WrongLaunchPhase();
    error NotBondReady();
    error SqrtPriceOutOfBounds();
    error LaunchDependenciesNotWired();
    error NotCreatorFeeRecipient();
    error CoreLpFeeMustBeZero();
    error LaunchEconomicsMismatch(bytes32 expected, bytes32 actual);
    error InexactTransfer(address token, uint256 expected, uint256 received);
    error CurveGeometryNotViable();
    error BondSeedNotViable();
    error BondRescueTooEarly(uint256 availableAt);
    error BondConversionSlippage(uint256 actual, uint256 minimum);
    error InvalidCashback();
    error NotPoolManager();
    error NotConversionPool();
    error DevBuySlippage(uint256 actual, uint256 minimum);

    event TokenLaunched(
        address indexed token,
        address indexed deployer,
        address quoteToken,
        uint256 launchConfigId,
        uint256 bondThresholdEth
    );
    event CreatorFeeRecipientUpdated(
        address indexed token, address indexed previousRecipient, address indexed newRecipient
    );
    event LaunchBonded(
        address indexed token, uint256 positionId, uint256 ethConverted, uint256 quoteBought, uint256 tokenAmount
    );
    event BondCashbackSettled(address indexed token, uint8 mode, uint256 quoteAmount);
    event LaunchConfigAdded(uint256 indexed id);
    event LaunchConfigUpdated(uint256 indexed id);
    event LaunchFeeUpdated(uint256 launchFee);
    event LaunchEnabledUpdated(bool enabled);
    event WhitelistedLauncherUpdated(address indexed launcher, bool enabled);
    event SnipeTaxStartBpsUpdated(uint256 bps);
    event SnipeTaxSecondsUpdated(uint256 secondsWindow);
    event GraduationExecutorSet(address executor);
    event LaunchDeployerSet(address deployer);
    event BondTokensPermanentlyLocked(address indexed token, uint256 amount);
    event LaunchBondRescued(address indexed token, address indexed recipient, uint256 wethAmount, uint256 tokenAmount);
    event DevBuyExecuted(address indexed token, address indexed deployer, uint256 ethIn, uint256 tokensOut);

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    IAllowanceTransfer public immutable permit2;
    PopLocker public immutable locker;
    PopHook public immutable hook;
    IPopFeeEscrow public immutable feeEscrow;
    IPopQuoteRegistry public immutable quoteRegistry;
    PopGraduationGuard public immutable graduationGuard;
    address public immutable weth;

    // Not immutable: each helper's constructor needs this factory's
    // already-deployed address, so they are deployed afterward and wired
    // once.
    PopGraduationExecutor public graduationExecutor;
    PopLaunchDeployer public launchDeployer;

    // Anti-snipe tax terms every new launch snapshots at creation.
    // Snapshotted rather than read live so a retune here (behind the
    // timelock) governs launches from that moment on while a launch already
    // trading keeps the terms it launched under.
    uint256 public snipeTaxStartBps = 9_900; // 99%
    uint256 public snipeTaxSeconds = 3;

    uint256 public launchFee;
    bool public launchEnabled;

    mapping(address launcher => bool enabled) public whitelistedLaunchers;
    mapping(address token => FeePolicySnapshot policy) private _launchFeePolicies;
    mapping(address token => LaunchedToken launched) private _launchedTokens;
    LaunchConfig[] private _launchConfigs;

    // The one V3 pool allowed to invoke the swap callback, set only for the
    // duration of a bond's conversion swap.
    address private _conversionPoolInFlight;

    constructor(
        address initialOwner,
        IPoolManager poolManager_,
        IPositionManager positionManager_,
        IAllowanceTransfer permit2_,
        PopLocker locker_,
        PopHook hook_,
        IPopFeeEscrow feeEscrow_,
        IPopQuoteRegistry quoteRegistry_,
        address weth_,
        uint256 initialLaunchFee
    ) Ownable(initialOwner) {
        if (address(poolManager_) == address(0) || address(positionManager_) == address(0)) {
            revert ZeroAddress();
        }
        if (address(permit2_) == address(0) || address(locker_) == address(0)) revert ZeroAddress();
        if (address(hook_) == address(0) || address(feeEscrow_) == address(0)) revert ZeroAddress();
        if (address(quoteRegistry_) == address(0) || weth_ == address(0)) revert ZeroAddress();
        // The factory initializes pools on `poolManager_` but mints the
        // bonded position through `positionManager_`. If the two point at
        // different singletons every bond reverts, so the mismatch is caught
        // here rather than once per launch.
        if (address(positionManager_.poolManager()) != address(poolManager_)) {
            revert LaunchDependenciesNotWired();
        }

        poolManager = poolManager_;
        positionManager = positionManager_;
        permit2 = permit2_;
        locker = locker_;
        hook = hook_;
        feeEscrow = feeEscrow_;
        quoteRegistry = quoteRegistry_;
        weth = weth_;
        graduationGuard = new PopGraduationGuard();
        launchFee = initialLaunchFee;
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function launchConfigCount() external view returns (uint256) {
        return _launchConfigs.length;
    }

    function getLaunchConfig(uint256 id) external view returns (LaunchConfig memory) {
        if (id >= _launchConfigs.length) revert InvalidLaunchConfigId();
        return _launchConfigs[id];
    }

    function getLaunchedToken(address token) external view override returns (LaunchedToken memory) {
        LaunchedToken memory launch = _launchedTokens[token];
        if (!launch.exists) revert TokenNotFound();
        return launch;
    }

    function getLaunchFeePolicy(address token) external view returns (FeePolicySnapshot memory) {
        if (!_launchedTokens[token].exists) revert TokenNotFound();
        return _launchFeePolicies[token];
    }

    /**
     * @notice The launch's WETH curve pool, live from the launch block.
     */
    function curvePoolKey(address token) public view returns (PoolKey memory key) {
        LaunchedToken storage launch = _launchedTokens[token];
        if (!launch.exists) revert TokenNotFound();
        return _buildKey(token, weth, launch.poolFee, launch.tickSpacing);
    }

    /**
     * @notice The launch's bonded token/quote pool key. Exists on-chain only
     * once the launch has bonded.
     */
    function bondedPoolKey(address token) public view returns (PoolKey memory key) {
        LaunchedToken storage launch = _launchedTokens[token];
        if (!launch.exists) revert TokenNotFound();
        return _buildKey(token, launch.quoteToken, launch.poolFee, launch.tickSpacing);
    }

    /**
     * @notice True when `launcher` may launch right now: for everyone when
     * the gate is open, and true for whitelisted addresses while it is
     * closed.
     */
    function canLaunch(address launcher) public view returns (bool) {
        return launchEnabled || whitelistedLaunchers[launcher];
    }

    /**
     * @notice Digest of every protocol-controlled term a launch with
     * `launchConfigId` and `quoteToken` would lock in, for TokenParams'
     * `expectedEconomics`.
     */
    function previewLaunchEconomics(uint256 launchConfigId, address quoteToken) external view returns (bytes32) {
        if (launchConfigId >= _launchConfigs.length) revert InvalidLaunchConfigId();
        (uint256 phantomEth, uint256 bondThresholdEth) = quoteRegistry.ethLaunchEconomics(quoteToken);
        return _economicsDigest(_launchConfigs[launchConfigId], hook.currentFeePolicy(), phantomEth, bondThresholdEth);
    }

    /**
     * @notice True once the launch's curve range has filled and `bond` can
     * run.
     */
    function isBondReady(address token) public view returns (bool) {
        LaunchedToken storage launch = _launchedTokens[token];
        if (!launch.exists || launch.phase != LaunchPhase.Trading) return false;
        PoolId poolId = curvePoolKey(token).toId();
        (, int24 tick,,) = StateLibrary.getSlot0(poolManager, poolId);
        bool tokenIsCurrency0 = token < weth;
        return tokenIsCurrency0 ? tick >= launch.curveTickUpper : tick <= launch.curveTickLower;
    }

    // ---------------------------------------------------------------------
    // Owner configuration (timelocked; affects future launches only)
    // ---------------------------------------------------------------------

    function addLaunchConfig(LaunchConfig calldata config) external onlyOwner returns (uint256 id) {
        _validateLaunchConfig(config);
        id = _launchConfigs.length;
        _launchConfigs.push(config);
        emit LaunchConfigAdded(id);
    }

    function updateLaunchConfig(uint256 id, LaunchConfig calldata config) external onlyOwner {
        if (id >= _launchConfigs.length) revert InvalidLaunchConfigId();
        _validateLaunchConfig(config);
        _launchConfigs[id] = config;
        emit LaunchConfigUpdated(id);
    }

    function setLaunchFee(uint256 newLaunchFee) external onlyOwner {
        launchFee = newLaunchFee;
        emit LaunchFeeUpdated(newLaunchFee);
    }

    function setLaunchEnabled(bool enabled) external onlyOwner {
        launchEnabled = enabled;
        emit LaunchEnabledUpdated(enabled);
    }

    function setWhitelistedLauncher(address launcher, bool enabled) external onlyOwner {
        if (launcher == address(0)) revert ZeroAddress();
        whitelistedLaunchers[launcher] = enabled;
        emit WhitelistedLauncherUpdated(launcher, enabled);
    }

    function setSnipeTaxStartBps(uint256 bps) external onlyOwner {
        if (bps > MAX_SNIPE_TAX_START_BPS) revert InvalidSnipeTaxWindow();
        snipeTaxStartBps = bps;
        emit SnipeTaxStartBpsUpdated(bps);
    }

    function setSnipeTaxSeconds(uint256 secondsWindow) external onlyOwner {
        if (secondsWindow == 0 || secondsWindow > MAX_SNIPE_TAX_SECONDS) revert InvalidSnipeTaxWindow();
        snipeTaxSeconds = secondsWindow;
        emit SnipeTaxSecondsUpdated(secondsWindow);
    }

    function setGraduationExecutor(PopGraduationExecutor executor) external onlyOwner {
        if (address(executor) == address(0)) revert ZeroAddress();
        if (address(graduationExecutor) != address(0)) revert AlreadySetError();
        graduationExecutor = executor;
        emit GraduationExecutorSet(address(executor));
    }

    function setLaunchDeployer(PopLaunchDeployer deployer) external onlyOwner {
        if (address(deployer) == address(0)) revert ZeroAddress();
        if (address(launchDeployer) != address(0)) revert AlreadySetError();
        launchDeployer = deployer;
        emit LaunchDeployerSet(address(deployer));
    }

    error AlreadySetError();

    function renounceOwnership() public pure override {
        revert OwnershipCannotBeRenounced();
    }

    // ---------------------------------------------------------------------
    // Launch
    // ---------------------------------------------------------------------

    /**
     * @notice Deploys the launch token and its live WETH curve pool in one
     * transaction. The pool is a real Uniswap V4 pool on the canonical
     * PoolManager: any router can trade it immediately, and the whole curve
     * allocation sits in a single-sided position held by this factory whose
     * only exits are the bond and the delayed, fixed-recipient rescue.
     * @param quoteToken The graduated Pons token this launch bonds into,
     * chosen from the registry's listed quotes.
     * @param devBuyMinTokens Slippage floor for the optional dev buy, which
     * is every wei of `msg.value` above the launch fee.
     */
    function launchToken(TokenParams calldata params, uint256 launchConfigId, address quoteToken, uint256 devBuyMinTokens)
        external
        payable
        nonReentrant
        returns (address token)
    {
        _requireLaunchDependenciesWired();
        if (!canLaunch(msg.sender)) revert NotWhitelisted();
        if (msg.value < launchFee) revert LaunchFeeNotPaid();
        if (launchConfigId >= _launchConfigs.length) revert InvalidLaunchConfigId();
        if (bytes(params.name).length == 0 || bytes(params.symbol).length == 0) revert InvalidTokenParams();
        if (params.creatorFeeBps > MAX_CREATOR_FEE_BPS) revert CreatorFeeTooHigh();
        if (params.cashback.mode == CashbackMode.TraderRebate) revert InvalidCashback();
        if (params.cashback.shareBps > BASIS_POINTS) revert InvalidCashback();
        if (params.cashback.mode == CashbackMode.None && params.cashback.shareBps != 0) revert InvalidCashback();

        LaunchConfig memory config = _launchConfigs[launchConfigId];
        if (!config.enabled) revert LaunchConfigDisabled();
        FeePolicySnapshot memory policy = hook.currentFeePolicy();
        // The registry enforces the graduated-Pons rule and the locked
        // liquidity floor live, in this call.
        (uint256 phantomEth, uint256 bondThresholdEth) = quoteRegistry.ethLaunchEconomics(quoteToken);

        // Every term below is protocol-updatable (timelocked), so a creator
        // may pin the whole set they were quoted rather than accept whatever
        // is current when their transaction lands.
        bytes32 economics = _economicsDigest(config, policy, phantomEth, bondThresholdEth);
        if (params.expectedEconomics != bytes32(0) && params.expectedEconomics != economics) {
            revert LaunchEconomicsMismatch(params.expectedEconomics, economics);
        }
        if (policy.hookFeeBps + params.creatorFeeBps > MAX_TOTAL_TRADE_FEE_BPS) revert CombinedFeeTooHigh();

        address creatorFeeRecipient = params.creatorFeeRecipient == address(0) ? msg.sender : params.creatorFeeRecipient;

        token = launchDeployer.deployLaunch(
            LaunchDeployment({
                quoteToken: quoteToken,
                originalDeployer: msg.sender,
                cashback: params.cashback,
                supply: config.supply,
                salt: params.salt,
                name: params.name,
                symbol: params.symbol,
                logo: params.logo,
                description: params.description,
                socials: params.socials
            })
        );

        _recordAndSeedCurve(
            token, params, config, policy, phantomEth, bondThresholdEth, quoteToken, creatorFeeRecipient
        );
        _launchFeePolicies[token] = policy;

        _payLaunchFee();

        emit TokenLaunched(token, msg.sender, quoteToken, launchConfigId, _launchedTokens[token].bondThresholdEth);

        uint256 devBuyEth = msg.value - launchFee;
        if (devBuyEth != 0) {
            IWETHMinimal(weth).deposit{value: devBuyEth}();
            uint256 tokensOut = _curveSwapExactIn(token, devBuyEth, msg.sender);
            if (tokensOut < devBuyMinTokens) revert DevBuySlippage(tokensOut, devBuyMinTokens);
            emit DevBuyExecuted(token, msg.sender, devBuyEth, tokensOut);
        }
    }

    /**
     * @dev Computes the curve geometry, records the launch, initializes the
     * WETH pool, registers it (and its curve terms) with the hook, and mints
     * the single-sided curve position. Split from `launchToken` to stay
     * inside the EVM stack window.
     */
    function _recordAndSeedCurve(
        address token,
        TokenParams calldata params,
        LaunchConfig memory config,
        FeePolicySnapshot memory policy,
        uint256 phantomEth,
        uint256 bondThresholdEth,
        address quoteToken,
        address creatorFeeRecipient
    ) private {
        bool tokenIsCurrency0 = token < weth;

        // Reserved supply seeds the bonded pool at the curve's terminal
        // price; the rest is the curve allocation. Identical proportions to
        // the v1 virtual-reserve curve.
        uint256 reserved = FullMath.mulDiv(config.supply, phantomEth, phantomEth + bondThresholdEth);
        uint256 curveSupply = config.supply - reserved;
        if (curveSupply == 0 || reserved == 0) revert CurveGeometryNotViable();

        (int24 tickLower, int24 tickUpper, uint160 sqrtStart, uint128 liquidity, uint256 actualThresholdEth) =
            _curveGeometry(tokenIsCurrency0, config, phantomEth, bondThresholdEth, curveSupply);

        _launchedTokens[token] = LaunchedToken({
            token: token,
            deployer: msg.sender,
            creatorFeeRecipient: creatorFeeRecipient,
            quoteToken: quoteToken,
            poolFee: config.poolFee,
            tickSpacing: config.tickSpacing,
            creatorFeeBps: params.creatorFeeBps,
            cashback: params.cashback,
            phase: LaunchPhase.Trading,
            phantomEth: phantomEth,
            bondThresholdEth: actualThresholdEth,
            curveTickLower: tickLower,
            curveTickUpper: tickUpper,
            curveLiquidity: liquidity,
            reservedTokens: reserved,
            bondedAt: 0,
            exists: true
        });

        PoolKey memory key = _buildKey(token, weth, config.poolFee, config.tickSpacing);
        poolManager.initialize(key, sqrtStart);
        hook.registerPool(key, token, creatorFeeRecipient, params.creatorFeeBps, params.cashback, policy);
        hook.registerCurveTerms(
            key.toId(),
            SnipeTaxTerms({
                startBps: uint16(snipeTaxStartBps),
                windowSeconds: uint32(snipeTaxSeconds),
                launchedAt: uint64(block.timestamp)
            }),
            tokenIsCurrency0 ? tickUpper : tickLower,
            tokenIsCurrency0
        );

        poolManager.unlock(abi.encode(UnlockAction.SeedCurve, abi.encode(key, tickLower, tickUpper, liquidity, token)));

        // The position mint consumes marginally less than the nominal curve
        // allocation (liquidity rounds down), so the true bonded-seed
        // reserve is whatever actually remains here.
        _launchedTokens[token].reservedTokens = IERC20(token).balanceOf(address(this));
    }

    /**
     * @dev The curve's price range and liquidity from its ETH terms. The
     * launch price is `phantomEth / supply` WETH per token, the terminal
     * (bond) price is `(phantomEth + threshold)^2 / (phantomEth * supply)`,
     * both tick-rounded outward so the whole nominal raise fits inside the
     * range. Returns the raise the rounded range actually collects.
     */
    function _curveGeometry(
        bool tokenIsCurrency0,
        LaunchConfig memory config,
        uint256 phantomEth,
        uint256 bondThresholdEth,
        uint256 curveSupply
    )
        private
        pure
        returns (int24 tickLower, int24 tickUpper, uint160 sqrtStart, uint128 liquidity, uint256 actualThresholdEth)
    {
        uint256 virtualEth = phantomEth + bondThresholdEth;
        // sqrt prices for launch and terminal, oriented by currency order.
        uint160 sqrtLaunch;
        uint160 sqrtTerminal;
        if (tokenIsCurrency0) {
            // price = WETH per token, rises as the curve is bought.
            sqrtLaunch = PopGraduationMath.sqrtPriceX96FromAmounts(config.supply, phantomEth);
            sqrtTerminal =
                PopGraduationMath.sqrtPriceX96FromAmounts(FullMath.mulDiv(phantomEth, config.supply, 1), virtualEth * virtualEth);
        } else {
            // price = token per WETH, falls as the curve is bought.
            sqrtLaunch = PopGraduationMath.sqrtPriceX96FromAmounts(phantomEth, config.supply);
            sqrtTerminal =
                PopGraduationMath.sqrtPriceX96FromAmounts(virtualEth * virtualEth, FullMath.mulDiv(phantomEth, config.supply, 1));
        }

        int24 launchTick = TickMath.getTickAtSqrtPrice(sqrtLaunch);
        int24 terminalTick = TickMath.getTickAtSqrtPrice(sqrtTerminal);

        if (tokenIsCurrency0) {
            tickLower = _roundTick(launchTick, config.tickSpacing, true);
            tickUpper = _roundTick(terminalTick, config.tickSpacing, true);
            if (tickUpper <= tickLower) tickUpper = tickLower + config.tickSpacing;
            sqrtStart = TickMath.getSqrtPriceAtTick(tickLower);
            liquidity = LiquidityAmounts.getLiquidityForAmount0(
                sqrtStart, TickMath.getSqrtPriceAtTick(tickUpper), curveSupply
            );
            actualThresholdEth =
                _amount1For(sqrtStart, TickMath.getSqrtPriceAtTick(tickUpper), liquidity);
        } else {
            tickUpper = _roundTick(launchTick, config.tickSpacing, false);
            tickLower = _roundTick(terminalTick, config.tickSpacing, false);
            if (tickLower >= tickUpper) tickLower = tickUpper - config.tickSpacing;
            sqrtStart = TickMath.getSqrtPriceAtTick(tickUpper);
            liquidity = LiquidityAmounts.getLiquidityForAmount1(
                TickMath.getSqrtPriceAtTick(tickLower), sqrtStart, curveSupply
            );
            actualThresholdEth =
                _amount0For(TickMath.getSqrtPriceAtTick(tickLower), sqrtStart, liquidity);
        }
        if (
            liquidity == 0 || actualThresholdEth == 0 || tickLower < MIN_USABLE_TICK || tickUpper > MAX_USABLE_TICK
                || actualThresholdEth > MAX_SEED_AMOUNT
        ) {
            revert CurveGeometryNotViable();
        }
    }

    // ---------------------------------------------------------------------
    // Bond: convert the raise and seed the locked quote pool
    // ---------------------------------------------------------------------

    /**
     * @notice Bonds a fully-bought launch: withdraws the curve position,
     * market-buys the launch's quote token with the raised WETH (plus the
     * curve phase's accrued cashback carve-out), settles the cashback in the
     * quote, and seeds the token/quote pool at the curve's terminal price
     * with the position locked forever. Permissionless and atomic: a failed
     * conversion leaves the launch trading and the bond retryable.
     * @param minQuoteOut Caller's own floor on the conversion, enforced on
     * top of the TWAP bound. Zero accepts the TWAP bound alone.
     */
    function bond(address token, uint256 minQuoteOut) external nonReentrant returns (uint256 positionId) {
        LaunchedToken storage launch = _launchedTokens[token];
        if (!launch.exists) revert TokenNotFound();
        if (launch.phase != LaunchPhase.Trading) revert WrongLaunchPhase();
        if (!isBondReady(token)) revert NotBondReady();

        PoolKey memory curveKey = _buildKey(token, weth, launch.poolFee, launch.tickSpacing);
        uint256 cashbackWeth = hook.collectBondCashback(curveKey.toId());

        (uint256 wethOut, uint256 tokenDust) = _burnCurvePosition(token, launch, curveKey);
        uint256 conversionIn = wethOut + cashbackWeth;

        (uint256 quoteOut) = _convertWethToQuote(launch.quoteToken, conversionIn, minQuoteOut);

        // The cashback carve-out's share of the conversion settles now, in
        // the quote, exactly as disclosed at launch.
        uint256 cashbackQuote = conversionIn == 0 ? 0 : FullMath.mulDiv(quoteOut, cashbackWeth, conversionIn);
        _settleBondCashback(token, launch, cashbackQuote);
        uint256 seedQuote = quoteOut - cashbackQuote;

        uint256 tokenAmount = _bondSeedTokenAmount(token, launch, seedQuote, conversionIn, quoteOut);
        uint256 available = launch.reservedTokens + tokenDust;
        if (tokenAmount > available) tokenAmount = available;
        if (tokenAmount == 0 || seedQuote == 0) revert BondSeedNotViable();
        graduationGuard.assertSeedable(token, launch.quoteToken, launch.tickSpacing, seedQuote, tokenAmount);

        uint256 excess = available - tokenAmount;
        if (excess != 0) {
            IERC20(token).forceApprove(address(locker), excess);
            locker.lockTokenSupply(token, excess);
            emit BondTokensPermanentlyLocked(token, excess);
        }

        launch.phase = LaunchPhase.Bonded;
        launch.bondedAt = block.timestamp;
        launch.reservedTokens = 0;
        launch.curveLiquidity = 0;

        positionId = _createPoolAndMintPosition(token, launch, tokenAmount, seedQuote);
        emit LaunchBonded(token, positionId, conversionIn, quoteOut, tokenAmount);
    }

    /**
     * @notice Releases a stuck launch's proceeds to its own creator fee
     * recipient when the bond has been ready for 14 days and still cannot
     * complete (the quote asset stopped delivering exact transfers, or its
     * origin pool can no longer host the conversion). During the whole
     * window anyone can still end it permanently with one successful `bond`.
     * The owner chooses when this runs, never where the funds go.
     */
    function rescueBond(address token) external onlyOwner nonReentrant {
        LaunchedToken storage launch = _launchedTokens[token];
        if (!launch.exists) revert TokenNotFound();
        if (launch.phase != LaunchPhase.Trading) revert WrongLaunchPhase();

        PoolKey memory curveKey = _buildKey(token, weth, launch.poolFee, launch.tickSpacing);
        (,,,,,, uint64 bondReadyAt,) = hook.curveTerms(curveKey.toId());
        if (bondReadyAt == 0) revert NotBondReady();
        uint256 availableAt = bondReadyAt + BOND_RESCUE_DELAY;
        if (block.timestamp < availableAt) revert BondRescueTooEarly(availableAt);

        uint256 cashbackWeth = hook.collectBondCashback(curveKey.toId());
        (uint256 wethOut, uint256 tokenDust) = _burnCurvePosition(token, launch, curveKey);

        address recipient = launch.creatorFeeRecipient;
        uint256 tokenAmount = launch.reservedTokens + tokenDust;
        launch.phase = LaunchPhase.Rescued;
        launch.reservedTokens = 0;
        launch.curveLiquidity = 0;

        uint256 wethAmount = wethOut + cashbackWeth;
        if (wethAmount != 0) IERC20(weth).safeTransfer(recipient, wethAmount);
        if (tokenAmount != 0) IERC20(token).safeTransfer(recipient, tokenAmount);

        emit LaunchBondRescued(token, recipient, wethAmount, tokenAmount);
    }

    // ---------------------------------------------------------------------
    // Creator fee recipient (self-service only, no protocol override)
    // ---------------------------------------------------------------------

    /**
     * @notice Lets the current creator fee recipient hand off future creator
     * fees for `token` to a new address, on the curve pool and, once bonded,
     * on the bonded pool too.
     * @dev The only authority over a launch's fee routing is the current
     * recipient itself. There is deliberately no protocol override: lost
     * creator keys mean lost future fees. This is what lets the /proof page
     * state that nobody (the protocol included) can redirect anyone else's
     * revenue.
     */
    function transferCreatorFeeRecipient(address token, address newRecipient) external {
        LaunchedToken storage launch = _launchedTokens[token];
        if (!launch.exists) revert TokenNotFound();
        if (msg.sender != launch.creatorFeeRecipient) revert NotCreatorFeeRecipient();
        if (newRecipient == address(0)) revert ZeroAddress();

        address previousRecipient = launch.creatorFeeRecipient;
        launch.creatorFeeRecipient = newRecipient;

        hook.setCreatorFeeRecipient(_buildKey(token, weth, launch.poolFee, launch.tickSpacing).toId(), newRecipient);
        if (launch.phase == LaunchPhase.Bonded) {
            hook.setCreatorFeeRecipient(
                _buildKey(token, launch.quoteToken, launch.poolFee, launch.tickSpacing).toId(), newRecipient
            );
        }

        emit CreatorFeeRecipientUpdated(token, previousRecipient, newRecipient);
    }

    // ---------------------------------------------------------------------
    // V4 unlock callback: curve seeding, dev buys, curve withdrawal
    // ---------------------------------------------------------------------

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (UnlockAction action, bytes memory payload) = abi.decode(data, (UnlockAction, bytes));

        if (action == UnlockAction.SeedCurve) {
            (PoolKey memory key, int24 tickLower, int24 tickUpper, uint128 liquidity, address token) =
                abi.decode(payload, (PoolKey, int24, int24, uint128, address));
            poolManager.modifyLiquidity(
                key,
                ModifyLiquidityParams({
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    liquidityDelta: SafeCast.toInt256(uint256(liquidity)),
                    salt: bytes32(uint256(uint160(token)))
                }),
                ""
            );
            _settleAllDeltas(key);
            return "";
        }

        if (action == UnlockAction.CurveSwap) {
            (PoolKey memory key, address token, uint256 wethIn, address recipient) =
                abi.decode(payload, (PoolKey, address, uint256, address));
            bool zeroForOne = Currency.unwrap(key.currency0) == weth;
            BalanceDelta delta = poolManager.swap(
                key,
                SwapParams({
                    zeroForOne: zeroForOne,
                    amountSpecified: -SafeCast.toInt256(wethIn),
                    sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                }),
                // Non-empty hookData from this factory marks the swap snipe
                // tax exempt: the launch transaction's own dev buy.
                abi.encode(recipient)
            );
            int128 tokenDelta = zeroForOne ? delta.amount1() : delta.amount0();
            uint256 tokensOut = tokenDelta > 0 ? uint256(uint128(tokenDelta)) : 0;
            if (tokensOut != 0) {
                poolManager.take(zeroForOne ? key.currency1 : key.currency0, recipient, tokensOut);
            }
            _settleAllDeltas(key);
            token; // silences the unused warning; kept for symmetric payloads
            return abi.encode(tokensOut);
        }

        // BurnCurve
        (PoolKey memory key2, int24 lower, int24 upper, uint128 liq, address token2) =
            abi.decode(payload, (PoolKey, int24, int24, uint128, address));
        poolManager.modifyLiquidity(
            key2,
            ModifyLiquidityParams({
                tickLower: lower,
                tickUpper: upper,
                liquidityDelta: -SafeCast.toInt256(uint256(liq)),
                salt: bytes32(uint256(uint160(token2)))
            }),
            ""
        );
        _settleAllDeltas(key2);
        return "";
    }

    /**
     * @dev Settles every outstanding delta this factory holds on both of a
     * key's currencies: pays negatives with exact transfers, takes
     * positives.
     */
    function _settleAllDeltas(PoolKey memory key) private {
        _settleCurrency(key.currency0);
        _settleCurrency(key.currency1);
    }

    function _settleCurrency(Currency currency) private {
        int256 delta = TransientStateLibrary.currencyDelta(poolManager, address(this), currency);
        if (delta < 0) {
            uint256 owed = uint256(-delta);
            address tokenAddr = Currency.unwrap(currency);
            uint256 balanceBefore = IERC20(tokenAddr).balanceOf(address(poolManager));
            poolManager.sync(currency);
            IERC20(tokenAddr).safeTransfer(address(poolManager), owed);
            uint256 received = IERC20(tokenAddr).balanceOf(address(poolManager)) - balanceBefore;
            if (received != owed) revert InexactTransfer(tokenAddr, owed, received);
            poolManager.settle();
        } else if (delta > 0) {
            poolManager.take(currency, address(this), uint256(delta));
        }
    }

    // ---------------------------------------------------------------------
    // V3 conversion swap (bond only)
    // ---------------------------------------------------------------------

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        if (msg.sender != _conversionPoolInFlight) revert NotConversionPool();
        if (amount0Delta > 0) {
            IERC20(weth).safeTransfer(msg.sender, uint256(amount0Delta));
        } else if (amount1Delta > 0) {
            IERC20(weth).safeTransfer(msg.sender, uint256(amount1Delta));
        }
    }

    /**
     * @dev Market-buys `quoteToken` with `wethIn` on the quote's canonical
     * origin pool, bounded by the registry's 30-minute TWAP less the bond
     * slippage allowance, and by the caller's own floor.
     */
    function _convertWethToQuote(address quoteToken, uint256 wethIn, uint256 minQuoteOut)
        private
        returns (uint256 quoteOut)
    {
        if (wethIn == 0) revert BondSeedNotViable();
        (address pool, uint256 quotePerEthTwap) = quoteRegistry.bondConversion(quoteToken);
        uint256 twapFloor = FullMath.mulDiv(
            FullMath.mulDiv(wethIn, quotePerEthTwap, 1e18), BASIS_POINTS - MAX_BOND_SLIPPAGE_BPS, BASIS_POINTS
        );
        uint256 floor = minQuoteOut > twapFloor ? minQuoteOut : twapFloor;

        bool zeroForOne = weth < quoteToken;
        uint256 balanceBefore = IERC20(quoteToken).balanceOf(address(this));
        _conversionPoolInFlight = pool;
        IUniswapV3PoolMinimal(pool).swap(
            address(this),
            zeroForOne,
            SafeCast.toInt256(wethIn),
            zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1,
            ""
        );
        _conversionPoolInFlight = address(0);
        quoteOut = IERC20(quoteToken).balanceOf(address(this)) - balanceBefore;
        if (quoteOut < floor) revert BondConversionSlippage(quoteOut, floor);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _burnCurvePosition(address token, LaunchedToken storage launch, PoolKey memory curveKey)
        private
        returns (uint256 wethOut, uint256 tokenDust)
    {
        uint256 wethBefore = IERC20(weth).balanceOf(address(this));
        uint256 tokenBefore = IERC20(token).balanceOf(address(this));
        poolManager.unlock(
            abi.encode(
                UnlockAction.BurnCurve,
                abi.encode(curveKey, launch.curveTickLower, launch.curveTickUpper, launch.curveLiquidity, token)
            )
        );
        wethOut = IERC20(weth).balanceOf(address(this)) - wethBefore;
        tokenDust = IERC20(token).balanceOf(address(this)) - tokenBefore;
    }

    function _curveSwapExactIn(address token, uint256 wethIn, address recipient) private returns (uint256 tokensOut) {
        LaunchedToken storage launch = _launchedTokens[token];
        PoolKey memory key = _buildKey(token, weth, launch.poolFee, launch.tickSpacing);
        bytes memory result =
            poolManager.unlock(abi.encode(UnlockAction.CurveSwap, abi.encode(key, token, wethIn, recipient)));
        tokensOut = abi.decode(result, (uint256));
    }

    /**
     * @dev The launch-token side of the bonded seed, sized so the new pool
     * opens at the curve's terminal ETH price expressed in the quote at the
     * conversion's own execution rate. `conversionIn` WETH bought
     * `quoteOutTotal` quote, so the terminal price in quote units is the
     * terminal ETH price times that realized rate.
     */
    function _bondSeedTokenAmount(
        address token,
        LaunchedToken storage launch,
        uint256 seedQuote,
        uint256 conversionIn,
        uint256 quoteOutTotal
    ) private view returns (uint256 tokenAmount) {
        // seedQuote's value in WETH at the realized conversion rate.
        uint256 seedEth = FullMath.mulDiv(seedQuote, conversionIn, quoteOutTotal);
        bool tokenIsCurrency0 = token < weth;
        uint160 sqrtTerminal = TickMath.getSqrtPriceAtTick(
            tokenIsCurrency0 ? launch.curveTickUpper : launch.curveTickLower
        );
        uint256 ratioX192 = uint256(sqrtTerminal) * uint256(sqrtTerminal);
        if (tokenIsCurrency0) {
            // ratio = WETH per token in Q192; divide the ETH value by it.
            tokenAmount = FullMath.mulDiv(seedEth, 1 << 192, ratioX192);
        } else {
            // ratio = token per WETH in Q192; multiply the ETH value by it.
            tokenAmount = FullMath.mulDiv(seedEth, ratioX192, 1 << 192);
        }
    }

    function _settleBondCashback(address token, LaunchedToken storage launch, uint256 cashbackQuote) private {
        if (cashbackQuote == 0) return;
        if (launch.cashback.mode == CashbackMode.QuoteBurn) {
            IERC20(launch.quoteToken).safeTransfer(0x000000000000000000000000000000000000dEaD, cashbackQuote);
        } else if (launch.cashback.mode == CashbackMode.HolderRewards) {
            IERC20(launch.quoteToken).safeTransfer(token, cashbackQuote);
            // sync() credits the delta; a reverting sink must not block the
            // bond, the next permissionless sync picks the amount up.
            // solhint-disable-next-line no-empty-blocks
            try PopLaunchTokenSink(token).sync() {} catch {}
        } else {
            // None: no carve-out ever accrued; defensive fallback pays the
            // creator.
            IERC20(launch.quoteToken).safeTransfer(launch.creatorFeeRecipient, cashbackQuote);
        }
        emit BondCashbackSettled(token, uint8(launch.cashback.mode), cashbackQuote);
    }

    /**
     * @dev Covers every protocol-controlled term that fixes what a creator
     * is buying.
     */
    function _economicsDigest(
        LaunchConfig memory config,
        FeePolicySnapshot memory policy,
        uint256 phantomEth,
        uint256 bondThresholdEth
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                phantomEth,
                bondThresholdEth,
                config.supply,
                config.poolFee,
                config.tickSpacing,
                policy.protocolFeeShareBps,
                policy.hookFeeBps,
                policy.maxInternalPriceImpactBps
            )
        );
    }

    /**
     * @dev Prevents launches until every singleton and helper points back to
     * this factory and to the same core dependencies. A partially wired
     * stack could otherwise accept launches but later block sweeps or
     * bonding.
     */
    function _requireLaunchDependenciesWired() private view {
        if (address(graduationExecutor) == address(0) || address(launchDeployer) == address(0)) {
            revert LaunchDependenciesNotWired();
        }
        if (launchDeployer.factory() != address(this) || graduationExecutor.factory() != address(this)) {
            revert LaunchDependenciesNotWired();
        }
        if (hook.factory() != address(this) || locker.factory() != address(this)) {
            revert LaunchDependenciesNotWired();
        }
        if (address(hook.poolManager()) != address(poolManager) || address(hook.feeEscrow()) != address(feeEscrow)) {
            revert LaunchDependenciesNotWired();
        }
        if (locker.positionManager() != address(positionManager)) revert LaunchDependenciesNotWired();
        if (
            address(graduationExecutor.positionManager()) != address(positionManager)
                || address(graduationExecutor.permit2()) != address(permit2)
                || address(graduationExecutor.locker()) != address(locker)
        ) {
            revert LaunchDependenciesNotWired();
        }
    }

    /**
     * @dev Initializes the bonded V4 pool and registers it with the hook,
     * then hands the exact minted assets to PopGraduationExecutor to encode
     * the Permit2 approvals and PositionManager mint call.
     */
    function _createPoolAndMintPosition(
        address token,
        LaunchedToken storage launch,
        uint256 tokenAmount,
        uint256 quoteAmount
    ) private returns (uint256 positionId) {
        (Currency currency0, Currency currency1, bool memecoinIsCurrency0) = _sortCurrencies(token, launch.quoteToken);
        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: launch.poolFee,
            tickSpacing: launch.tickSpacing,
            hooks: IHooks(address(hook))
        });

        (uint256 amount0, uint256 amount1) =
            memecoinIsCurrency0 ? (tokenAmount, quoteAmount) : (quoteAmount, tokenAmount);
        if (amount0 > type(uint128).max || amount1 > type(uint128).max) revert BondSeedNotViable();
        uint160 sqrtPriceX96 = PopGraduationMath.sqrtPriceX96FromAmounts(amount0, amount1);
        if (sqrtPriceX96 <= TickMath.MIN_SQRT_PRICE || sqrtPriceX96 >= TickMath.MAX_SQRT_PRICE) {
            revert SqrtPriceOutOfBounds();
        }

        poolManager.initialize(key, sqrtPriceX96);
        FeePolicySnapshot memory policy = _launchFeePolicies[token];
        hook.registerPool(key, token, launch.creatorFeeRecipient, launch.creatorFeeBps, launch.cashback, policy);

        (int24 tickLower, int24 tickUpper) = _fullRangeTicks(launch.tickSpacing);
        positionId = positionManager.nextTokenId();

        _transferExact(Currency.unwrap(currency0), address(graduationExecutor), amount0);
        _transferExact(Currency.unwrap(currency1), address(graduationExecutor), amount1);
        graduationExecutor.mintFullRangePosition(
            token,
            key,
            tickLower,
            tickUpper,
            sqrtPriceX96,
            amount0,
            amount1,
            currency0,
            currency1,
            policy.protocolFeeRecipient
        );
        locker.lockPosition(token, positionId);
    }

    /**
     * @dev Rejects non-exact ERC-20 transfers before a V4 position can be
     * minted with a smaller balance than its accounting expects.
     */
    function _transferExact(address token, address recipient, uint256 amount) private {
        uint256 balanceBefore = IERC20(token).balanceOf(recipient);
        IERC20(token).safeTransfer(recipient, amount);
        uint256 received = IERC20(token).balanceOf(recipient) - balanceBefore;
        if (received != amount) revert InexactTransfer(token, amount, received);
    }

    function _payLaunchFee() private {
        if (launchFee == 0) return;
        address recipient = hook.protocolFeeRecipient();
        if (recipient == address(0)) revert ZeroAddress();
        (bool sent,) = payable(recipient).call{value: launchFee}("");
        if (!sent) revert FeeTransferFailed();
    }

    function _buildKey(address memecoin, address counterAsset, uint24 poolFee, int24 tickSpacing)
        private
        view
        returns (PoolKey memory key)
    {
        (Currency currency0, Currency currency1,) = _sortCurrencies(memecoin, counterAsset);
        key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: poolFee,
            tickSpacing: tickSpacing,
            hooks: IHooks(address(hook))
        });
    }

    function _sortCurrencies(address memecoin, address counterAsset)
        private
        pure
        returns (Currency currency0, Currency currency1, bool memecoinIsCurrency0)
    {
        if (counterAsset < memecoin) {
            return (Currency.wrap(counterAsset), Currency.wrap(memecoin), false);
        }
        return (Currency.wrap(memecoin), Currency.wrap(counterAsset), true);
    }

    function _fullRangeTicks(int24 tickSpacing) private pure returns (int24 tickLower, int24 tickUpper) {
        // Truncation toward zero is required to derive V4's usable boundary ticks.
        // forge-lint: disable-next-line(divide-before-multiply)
        tickLower = (MIN_USABLE_TICK / tickSpacing) * tickSpacing;
        // forge-lint: disable-next-line(divide-before-multiply)
        tickUpper = (MAX_USABLE_TICK / tickSpacing) * tickSpacing;
    }

    /// @dev WETH a fully-crossed range position [sqrtA, sqrtB] pays out when
    /// WETH is currency1 (the range's amount1) or currency0 (amount0).
    function _amount1For(uint160 sqrtA, uint160 sqrtB, uint128 liquidity) private pure returns (uint256) {
        return SqrtPriceMath.getAmount1Delta(sqrtA, sqrtB, liquidity, false);
    }

    function _amount0For(uint160 sqrtA, uint160 sqrtB, uint128 liquidity) private pure returns (uint256) {
        return SqrtPriceMath.getAmount0Delta(sqrtA, sqrtB, liquidity, false);
    }

    /// @dev Rounds toward positive infinity when `up`, negative otherwise,
    /// to a multiple of `spacing`.
    function _roundTick(int24 tick, int24 spacing, bool up) private pure returns (int24) {
        int24 quotient = tick / spacing;
        int24 rounded = quotient * spacing;
        if (up && rounded < tick) rounded += spacing;
        if (!up && rounded > tick) rounded -= spacing;
        return rounded;
    }

    function _validateLaunchConfig(LaunchConfig calldata config) private pure {
        if (config.supply < MIN_LAUNCH_SUPPLY) revert SupplyTooLow();
        // A supply above the seed ceiling could trade normally and then
        // revert forever at bonding.
        if (config.supply > MAX_SEED_AMOUNT) revert SupplyTooHigh();
        if (config.tickSpacing <= 0 || config.tickSpacing > MAX_TICK_SPACING) revert InvalidTickSpacing();
        // The hook charges the fee; a nonzero core LP fee would tax swaps a
        // second time into a position nobody can ever collect.
        if (config.poolFee != 0) revert CoreLpFeeMustBeZero();
    }
}

/// @dev Narrow sink surface for the HolderRewards settle at bond time.
interface PopLaunchTokenSink {
    function sync() external;
}
