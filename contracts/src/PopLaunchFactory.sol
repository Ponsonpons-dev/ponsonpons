// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {PopBondingCurve} from "./PopBondingCurve.sol";
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
    GraduationPhase,
    IPopFeeEscrow,
    IPopLaunchFactory,
    IPopQuoteRegistry
} from "./interfaces/IPop.sol";
import {PopCurveMath} from "./libraries/PopCurveMath.sol";
import {PopGraduationMath} from "./libraries/PopGraduationMath.sol";

/**
 * @title PopLaunchFactory
 * @notice Deploys a bonding curve and its launch token for every $POP
 * launch, then graduates the curve into a permanently locked, full-range
 * Uniswap V4 position governed by the shared PopHook. Every launch is quoted
 * in a graduated Pons token approved by the permissionless PopQuoteRegistry.
 *
 * Each curve already trades in the quote asset its pool will use, so
 * graduation never converts between assets and therefore needs no router
 * and no price oracle. It stays split into two permissionless phases so a
 * failed pool seed cannot strand a curve's reserves:
 * - `graduate`: drains the curve's own reserves into this factory. Purely
 *   internal bookkeeping, safe to call automatically from within the
 *   crossing buy itself.
 * - `createGraduatedPool`: seeds the new V4 pool with those reserves, and
 *   stays retryable until it succeeds.
 *
 * Adapted from the verified PonsV2LaunchFactory, minus the owner powers
 * that could touch user value:
 * - No creator-fee-recipient override exists. Creators rotate their own
 *   recipient; lost keys mean lost future creator fees, by design.
 * - No force-sweep of a live curve exists.
 * - The stuck-graduation rescue pays only the launch's own creator fee
 *   recipient, and only after a 14-day window during which anyone could
 *   still have completed the graduation permissionlessly.
 * The owner (a 48h timelock) configures future launches only.
 */
contract PopLaunchFactory is Ownable2Step, ReentrancyGuard, IPopLaunchFactory {
    using SafeERC20 for IERC20;

    uint256 private constant BASIS_POINTS = 10_000;
    uint256 private constant MAX_CURVE_FEE_BPS = 1_000; // 10%
    uint256 private constant MAX_CREATOR_FEE_BPS = 200; // 2%
    uint256 private constant MAX_TOTAL_TRADE_FEE_BPS = 2_000; // 20%
    // Ceiling on the launch-second snipe tax. Held below 100% so a taxed buy
    // always nets the buyer something.
    uint256 private constant MAX_SNIPE_TAX_START_BPS = 9_900; // 99%
    uint256 private constant MAX_SNIPE_TAX_SECONDS = 60;
    // Bound on the creator-declared exemption list, so a launch cannot be
    // made unaffordable to itself by an unbounded loop of exemption writes.
    uint256 private constant MAX_SNIPE_TAX_EXEMPTIONS = 32;
    uint256 private constant MIN_LAUNCH_SUPPLY = 1 ether;
    // The quotability check prices a buy of one millionth of the phantom
    // reserve, so it stays meaningful across quote assets of different
    // decimals.
    uint256 private constant REFERENCE_BUY_DIVISOR = 1e6;
    int24 private constant MIN_USABLE_TICK = -887272;
    int24 private constant MAX_USABLE_TICK = 887272;
    int24 private constant MAX_TICK_SPACING = 32767;
    // Largest amount either side of a seed may carry: V4 settles pool
    // balance changes through a BalanceDelta of two int128 halves, so the
    // signed maximum binds even though the PositionManager's ABI accepts a
    // uint128. Mirrors PopGraduationGuard's own ceiling.
    uint256 private constant MAX_SEED_AMOUNT = uint256(uint128(type(int128).max));
    // How long a launch must sit in Swept before its reserves may be
    // released to its creator fee recipient. Seeding is permissionless and
    // retryable, so this window is what separates a genuinely unseedable
    // launch from one that merely hit a transient failure.
    uint256 public constant GRADUATION_RESCUE_DELAY = 14 days;

    struct TokenParams {
        string name;
        string symbol;
        string logo;
        string description;
        PopLaunchToken.Socials socials;
        address creatorFeeRecipient;
        // Additional trade fee the creator charges on top of the launch
        // config's base curveFeeBps, capped at 2%. Paid to the creator
        // (minus their own cashback carve-out), never split with the
        // protocol.
        uint16 creatorFeeBps;
        // Creator-chosen cashback routing, immutable for the launch's life.
        CashbackConfig cashback;
        // Optional guard on the economics this launch will lock in. Zero
        // waives the check. Call previewLaunchEconomics(configId, quote) to
        // obtain it, so an owner retune or registry re-peg landing before
        // the launch reverts it instead of silently repricing it.
        bytes32 expectedEconomics;
        // CREATE2 salt for the launch's curve and token, namespaced per
        // initiating account. Mining it is how a creator picks a vanity
        // address; PopLaunchDeployer.predictLaunchAddresses checks in
        // advance.
        bytes32 salt;
    }

    /**
     * @notice Launch shape shared by every quote asset. The phantom reserve
     * and graduation threshold come from the quote registry per quote token,
     * in that quote's own decimals.
     */
    struct LaunchConfig {
        uint256 supply;
        uint256 curveFeeBps;
        uint24 poolFee;
        int24 tickSpacing;
        bool enabled;
    }

    error InvalidLaunchConfigId();
    error LaunchConfigDisabled();
    error InvalidBasisPoints();
    error ExemptionListTooLong();
    error InvalidSnipeTaxWindow();
    error CurveFeeTooHigh();
    error CreatorFeeTooHigh();
    error CombinedFeeTooHigh();
    error SupplyTooLow();
    error SupplyTooHigh();
    error InvalidTickSpacing();
    error LaunchFeeNotPaid();
    error NotWhitelisted();
    error FeeTransferFailed();
    error ZeroAddress();
    error AlreadySet();
    error OwnershipCannotBeRenounced();
    error InvalidTokenParams();
    error TokenNotFound();
    error WrongGraduationPhase();
    error NothingToGraduate();
    error SqrtPriceOutOfBounds();
    error LaunchDependenciesNotWired();
    error NotCreatorFeeRecipient();
    error CoreLpFeeMustBeZero();
    error CurveNotQuotable();
    error LaunchEconomicsMismatch(bytes32 expected, bytes32 actual);
    error InexactTransfer(address token, uint256 expected, uint256 received);
    error GraduationSeedNotViable();
    error GraduationRescueTooEarly(uint256 availableAt);
    error InvalidCashback();

    event TokenLaunched(
        address indexed token,
        address indexed curve,
        address indexed deployer,
        address quoteToken,
        uint256 launchConfigId,
        uint256 graduationThreshold
    );
    event LaunchSwept(address indexed token, uint256 quoteOut, uint256 tokenOut);
    event CreatorFeeRecipientUpdated(
        address indexed token, address indexed previousRecipient, address indexed newRecipient
    );
    event PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 quoteAmount);
    event LaunchConfigAdded(uint256 indexed id);
    event LaunchConfigUpdated(uint256 indexed id);
    event LaunchFeeUpdated(uint256 launchFee);
    event LaunchEnabledUpdated(bool enabled);
    event WhitelistedLauncherUpdated(address indexed launcher, bool enabled);
    event SnipeTaxStartBpsUpdated(uint256 bps);
    event SnipeTaxSecondsUpdated(uint256 secondsWindow);
    event GraduationExecutorSet(address executor);
    event LaunchDeployerSet(address deployer);
    event GraduationTokensPermanentlyLocked(address indexed token, uint256 amount);
    event LaunchGraduationRescued(
        address indexed token, address indexed recipient, uint256 quoteAmount, uint256 tokenAmount
    );
    event DevBuyExecuted(address indexed token, address indexed deployer, uint256 quoteIn, uint256 tokensOut);

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    IAllowanceTransfer public immutable permit2;
    PopLocker public immutable locker;
    PopHook public immutable hook;
    IPopFeeEscrow public immutable feeEscrow;
    IPopQuoteRegistry public immutable quoteRegistry;
    PopGraduationGuard public immutable graduationGuard;

    // Not immutable: each helper's constructor needs this factory's
    // already-deployed address, so they are deployed afterward and wired
    // once.
    PopGraduationExecutor public graduationExecutor;
    PopLaunchDeployer public launchDeployer;

    // Anti-snipe tax terms every new launch snapshots at creation.
    // Snapshotted rather than read live so a retune here (behind the
    // timelock) governs launches from that moment on while a curve already
    // trading keeps the terms it launched under.
    uint256 public snipeTaxStartBps = 9_900; // 99%
    uint256 public snipeTaxSeconds = 3;

    uint256 public launchFee;
    bool public launchEnabled;

    mapping(address launcher => bool enabled) public whitelistedLaunchers;
    mapping(address token => FeePolicySnapshot policy) private _launchFeePolicies;
    mapping(address token => LaunchedToken launched) private _launchedTokens;
    LaunchConfig[] private _launchConfigs;

    constructor(
        address initialOwner,
        IPoolManager poolManager_,
        IPositionManager positionManager_,
        IAllowanceTransfer permit2_,
        PopLocker locker_,
        PopHook hook_,
        IPopFeeEscrow feeEscrow_,
        IPopQuoteRegistry quoteRegistry_,
        uint256 initialLaunchFee
    ) Ownable(initialOwner) {
        if (address(poolManager_) == address(0) || address(positionManager_) == address(0)) {
            revert ZeroAddress();
        }
        if (address(permit2_) == address(0) || address(locker_) == address(0)) revert ZeroAddress();
        if (address(hook_) == address(0) || address(feeEscrow_) == address(0)) revert ZeroAddress();
        if (address(quoteRegistry_) == address(0)) revert ZeroAddress();
        // The factory initializes pools on `poolManager_` but mints their
        // liquidity through `positionManager_`. If the two point at
        // different singletons every graduation reverts, so the mismatch is
        // caught here rather than once per launch.
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

    /// @inheritdoc IPopLaunchFactory
    function getLaunchedToken(address token) external view override returns (LaunchedToken memory) {
        return _launchedTokens[token];
    }

    /**
     * @notice Returns the fee policy frozen for a launch.
     */
    function getLaunchFeePolicy(address token) external view returns (FeePolicySnapshot memory) {
        return _launchFeePolicies[token];
    }

    /**
     * @notice Whether `launcher` may launch right now: true while the public
     * gate is open, and true for whitelisted addresses while it is closed.
     */
    function canLaunch(address launcher) public view returns (bool) {
        return launchEnabled || whitelistedLaunchers[launcher];
    }

    /**
     * @notice Returns the economics digest a launch of `launchConfigId`
     * quoted in `quoteToken` would produce right now, for a creator to pass
     * back as TokenParams.expectedEconomics.
     * @dev Covers every protocol-controlled term that fixes what a creator
     * is buying: the curve's shape and cost, the pool the launch graduates
     * into, and the fee split that follows it.
     */
    function previewLaunchEconomics(uint256 launchConfigId, address quoteToken) external view returns (bytes32) {
        if (launchConfigId >= _launchConfigs.length) revert InvalidLaunchConfigId();
        LaunchConfig memory config = _launchConfigs[launchConfigId];
        (uint256 phantomQuote, uint256 graduationThreshold,) = quoteRegistry.getLaunchEconomics(quoteToken);
        return _economicsDigest(config, hook.currentFeePolicy(), phantomQuote, graduationThreshold);
    }

    // ---------------------------------------------------------------------
    // Owner-only configuration (behind the 48h protocol timelock)
    // ---------------------------------------------------------------------

    function addLaunchConfig(LaunchConfig calldata config) external onlyOwner returns (uint256 id) {
        _validateLaunchConfig(config);
        id = _launchConfigs.length;
        _launchConfigs.push(config);
        emit LaunchConfigAdded(id);
    }

    /**
     * @notice Replaces an existing launch configuration. Already-launched
     * tokens are unaffected since their pool parameters were snapshotted.
     */
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

    /**
     * @notice Sets the launch-second snipe tax new launches snapshot at
     * creation. A nonzero figure must exceed the 20% combined base fee
     * ceiling, so the launch-window tax always dominates the ordinary fee
     * take, and stays below 100% so a taxed buy always nets something.
     */
    function setSnipeTaxStartBps(uint256 bps) external onlyOwner {
        if (bps != 0 && (bps <= MAX_TOTAL_TRADE_FEE_BPS || bps > MAX_SNIPE_TAX_START_BPS)) {
            revert InvalidBasisPoints();
        }
        snipeTaxStartBps = bps;
        emit SnipeTaxStartBpsUpdated(bps);
    }

    function setSnipeTaxSeconds(uint256 secondsWindow) external onlyOwner {
        if (secondsWindow == 0 || secondsWindow > MAX_SNIPE_TAX_SECONDS) revert InvalidSnipeTaxWindow();
        snipeTaxSeconds = secondsWindow;
        emit SnipeTaxSecondsUpdated(secondsWindow);
    }

    /**
     * @notice One-time wiring of the graduation executor, set after both are
     * deployed since the executor's constructor needs this factory's
     * already-known address.
     */
    function setGraduationExecutor(PopGraduationExecutor executor) external onlyOwner {
        if (address(graduationExecutor) != address(0)) revert AlreadySet();
        if (address(executor) == address(0)) revert ZeroAddress();
        graduationExecutor = executor;
        emit GraduationExecutorSet(address(executor));
    }

    /**
     * @notice One-time wiring of the launch deployer.
     */
    function setLaunchDeployer(PopLaunchDeployer deployer) external onlyOwner {
        if (address(launchDeployer) != address(0)) revert AlreadySet();
        if (address(deployer) == address(0)) revert ZeroAddress();
        launchDeployer = deployer;
        emit LaunchDeployerSet(address(deployer));
    }

    /**
     * @notice Permanently disabled. An ownerless factory could never add a
     * launch config or run the delayed, fixed-recipient rescue paths that
     * protect launches from hostile quote assets. Ownership can still be
     * handed to a new owner via the two-step transfer.
     */
    function renounceOwnership() public pure override {
        revert OwnershipCannotBeRenounced();
    }

    // ---------------------------------------------------------------------
    // Launch
    // ---------------------------------------------------------------------

    /**
     * @notice Deploys a bonding curve and its launch token, wires them
     * together, and records the launch. Trading starts immediately on the
     * curve; the graduation pool's quote token is fixed here, chosen by the
     * caller from the registry's listed quotes. The caller and their creator
     * fee recipient are exempted from the snipe tax automatically, plus any
     * declared bundle wallets.
     * @param devBuyQuote Optional atomic first buy, pulled from the caller
     * in the quote token (approve or permit the factory first). Zero skips
     * it.
     * @param devBuyMinTokens Slippage floor for the dev buy.
     */
    function launchToken(
        TokenParams calldata params,
        uint256 launchConfigId,
        address quoteToken,
        uint256 devBuyQuote,
        uint256 devBuyMinTokens,
        address[] calldata snipeTaxExemptions
    ) external payable nonReentrant returns (address token, address curve) {
        if (address(launchDeployer) == address(0)) {
            revert LaunchDependenciesNotWired();
        }
        _requireLaunchDependenciesWired();
        if (!canLaunch(msg.sender)) revert NotWhitelisted();
        if (msg.value != launchFee) revert LaunchFeeNotPaid();
        if (launchConfigId >= _launchConfigs.length) revert InvalidLaunchConfigId();
        if (bytes(params.name).length == 0 || bytes(params.symbol).length == 0) revert InvalidTokenParams();
        if (params.creatorFeeBps > MAX_CREATOR_FEE_BPS) revert CreatorFeeTooHigh();
        if (params.cashback.shareBps > BASIS_POINTS) revert InvalidCashback();
        if (params.cashback.mode == CashbackMode.None && params.cashback.shareBps != 0) revert InvalidCashback();

        LaunchConfig memory config = _launchConfigs[launchConfigId];
        if (!config.enabled) revert LaunchConfigDisabled();
        FeePolicySnapshot memory policy = hook.currentFeePolicy();
        // The registry enforces the graduated-Pons rule and the locked
        // liquidity floor live, in this call.
        (uint256 phantomQuote, uint256 graduationThreshold,) = quoteRegistry.getLaunchEconomics(quoteToken);

        // Every term below is protocol-updatable (timelocked) or moved by a
        // registry re-peg, so a creator may pin the whole set they were
        // quoted rather than accept whatever is current when their
        // transaction lands.
        bytes32 economics = _economicsDigest(config, policy, phantomQuote, graduationThreshold);
        if (params.expectedEconomics != bytes32(0) && params.expectedEconomics != economics) {
            revert LaunchEconomicsMismatch(params.expectedEconomics, economics);
        }
        if (config.curveFeeBps + params.creatorFeeBps > MAX_TOTAL_TRADE_FEE_BPS) revert CombinedFeeTooHigh();
        if (policy.hookFeeBps + params.creatorFeeBps > MAX_TOTAL_TRADE_FEE_BPS) revert CombinedFeeTooHigh();
        // A config and a quote asset are validated separately but graduate
        // as a pair, and it is the pair that fixes the seed. Terms that
        // imply a position V4 will not mint are refused here, while nothing
        // has been deployed.
        _requireQuotable(phantomQuote, config.supply, config.curveFeeBps);
        _requireSeedableTerms(config.supply, phantomQuote, graduationThreshold, config.tickSpacing);

        address creatorFeeRecipient = params.creatorFeeRecipient == address(0) ? msg.sender : params.creatorFeeRecipient;

        (token, curve) = launchDeployer.deployLaunch(
            LaunchDeployment({
                quoteToken: quoteToken,
                creatorFeeRecipient: creatorFeeRecipient,
                originalDeployer: msg.sender,
                protocolFeeRecipient: policy.protocolFeeRecipient,
                protocolFeeShareBps: policy.protocolFeeShareBps,
                cashback: params.cashback,
                feeEscrow: feeEscrow,
                phantomQuote: phantomQuote,
                curveFeeBps: config.curveFeeBps,
                creatorFeeBps: params.creatorFeeBps,
                graduationThreshold: graduationThreshold,
                supply: config.supply,
                salt: params.salt,
                name: params.name,
                symbol: params.symbol,
                logo: params.logo,
                description: params.description,
                socials: params.socials
            })
        );
        PopBondingCurve(curve).initialize(token);

        // The creator's own addresses never count as snipers on their own
        // launch: an atomic dev buy lands in the launch second, exactly when
        // the tax peaks, and would otherwise be consumed by it.
        PopBondingCurve(curve).exemptFromSnipeTax(msg.sender);
        if (creatorFeeRecipient != msg.sender) {
            PopBondingCurve(curve).exemptFromSnipeTax(creatorFeeRecipient);
        }
        if (snipeTaxExemptions.length > MAX_SNIPE_TAX_EXEMPTIONS) revert ExemptionListTooLong();
        for (uint256 i = 0; i < snipeTaxExemptions.length; ++i) {
            PopBondingCurve(curve).exemptFromSnipeTax(snipeTaxExemptions[i]);
        }

        _launchedTokens[token] = LaunchedToken({
            token: token,
            curve: curve,
            deployer: msg.sender,
            creatorFeeRecipient: creatorFeeRecipient,
            quoteToken: quoteToken,
            graduationThreshold: graduationThreshold,
            poolFee: config.poolFee,
            tickSpacing: config.tickSpacing,
            creatorFeeBps: params.creatorFeeBps,
            cashback: params.cashback,
            phase: GraduationPhase.NotGraduated,
            sweptQuote: 0,
            sweptTokens: 0,
            sweptAt: 0,
            exists: true
        });
        _launchFeePolicies[token] = policy;

        _payLaunchFee();

        emit TokenLaunched(token, curve, msg.sender, quoteToken, launchConfigId, graduationThreshold);

        if (devBuyQuote != 0) {
            IERC20 quote = IERC20(quoteToken);
            quote.safeTransferFrom(msg.sender, address(this), devBuyQuote);
            quote.forceApprove(curve, devBuyQuote);
            // The curve refunds a clamped final fill to its caller, this
            // factory during a dev buy. and the factory can legitimately
            // hold this same quote asset for other launches sitting between
            // graduation phases. Measure the delta and forward only what the
            // buy did not consume back to the creator.
            uint256 beforeBuy = quote.balanceOf(address(this));
            uint256 tokensOut = PopBondingCurve(curve).buy(devBuyQuote, devBuyMinTokens, msg.sender, block.timestamp);
            quote.forceApprove(curve, 0);
            uint256 leftover = quote.balanceOf(address(this)) + devBuyQuote - beforeBuy;
            if (leftover != 0) quote.safeTransfer(msg.sender, leftover);
            emit DevBuyExecuted(token, msg.sender, devBuyQuote - leftover, tokensOut);
        }
    }

    // ---------------------------------------------------------------------
    // Creator fee recipient (self-service only, no protocol override)
    // ---------------------------------------------------------------------

    /**
     * @notice Lets the current creator fee recipient hand off future creator
     * fees for `token` to a new address, whether the launch is still trading
     * on its bonding curve or has already graduated into its V4 pool.
     * @dev The only authority over a launch's fee routing is the current
     * recipient itself. There is deliberately no protocol override: lost
     * creator keys mean lost future creator fees. This is what lets the
     * /proof page state that nobody (the protocol included) can redirect
     * anyone else's revenue.
     */
    function transferCreatorFeeRecipient(address token, address newRecipient) external {
        LaunchedToken storage launch = _launchedTokens[token];
        if (!launch.exists) revert TokenNotFound();
        if (msg.sender != launch.creatorFeeRecipient) revert NotCreatorFeeRecipient();
        if (newRecipient == address(0)) revert ZeroAddress();

        address previousRecipient = launch.creatorFeeRecipient;
        launch.creatorFeeRecipient = newRecipient;

        if (launch.phase == GraduationPhase.PoolCreated) {
            hook.setCreatorFeeRecipient(_poolIdFor(token, launch), newRecipient);
        } else {
            PopBondingCurve(launch.curve).setCreatorFeeRecipient(newRecipient);
        }

        emit CreatorFeeRecipientUpdated(token, previousRecipient, newRecipient);
    }

    // ---------------------------------------------------------------------
    // Graduation, phase 1: drain the curve
    // ---------------------------------------------------------------------

    /**
     * @notice Sweeps the curve's remaining quote and token reserves into
     * this factory and halts curve trading. Permissionless, and called
     * automatically the instant a buy crosses the graduation threshold.
     */
    function graduate(address token) external nonReentrant {
        LaunchedToken storage launch = _launchedTokens[token];
        if (!launch.exists) revert TokenNotFound();
        if (launch.phase != GraduationPhase.NotGraduated) revert WrongGraduationPhase();
        PopBondingCurve curve = PopBondingCurve(launch.curve);
        if (!curve.readyToGraduate()) revert PopBondingCurve.NotReadyToGraduate();
        _assertGraduationSeedable(token, launch, curve.realQuoteReserve(), curve.tokenReserve());

        // Record what this factory actually received rather than what the
        // curve reported sending. A quote asset that does not deliver its
        // full nominal amount would otherwise leave the launch claiming a
        // balance it never got, and the shortfall would be drawn from other
        // launches holding the same asset here.
        uint256 quoteBefore = IERC20(launch.quoteToken).balanceOf(address(this));
        (, uint256 tokenOut) = curve.graduate(address(this));
        uint256 quoteOut = IERC20(launch.quoteToken).balanceOf(address(this)) - quoteBefore;
        if (quoteOut == 0) revert NothingToGraduate();

        launch.sweptQuote = quoteOut;
        launch.sweptTokens = tokenOut;
        launch.sweptAt = block.timestamp;
        launch.phase = GraduationPhase.Swept;

        emit LaunchSwept(token, quoteOut, tokenOut);
    }

    // ---------------------------------------------------------------------
    // Graduation, phase 2: seed the V4 pool
    // ---------------------------------------------------------------------

    /**
     * @notice Initializes the V4 pool with the swept reserves, mints a
     * full-range position directly to the locker, and registers the pool
     * with the hook. The curve already held the pool's quote asset, so this
     * seeds with exactly what it swept and needs no slippage bound.
     * Permissionless and retryable: a launch stays in Swept until a seed
     * succeeds, so a transient failure can never strand reserves.
     */
    function createGraduatedPool(address token) external nonReentrant returns (uint256 positionId) {
        LaunchedToken storage launch = _launchedTokens[token];
        if (!launch.exists) revert TokenNotFound();
        if (launch.phase != GraduationPhase.Swept) revert WrongGraduationPhase();

        uint256 sweptQuote = launch.sweptQuote;
        _assertGraduationSeedable(token, launch, sweptQuote, launch.sweptTokens);
        uint256 tokenAmount = _lockExcessGraduationTokens(token, launch, sweptQuote, launch.sweptTokens);

        launch.sweptQuote = 0;
        launch.sweptTokens = 0;
        launch.sweptAt = 0;
        launch.phase = GraduationPhase.PoolCreated;

        positionId = _createPoolAndMintPosition(token, launch, tokenAmount, sweptQuote);

        emit PoolGraduated(token, positionId, tokenAmount, sweptQuote);
    }

    // ---------------------------------------------------------------------
    // Constrained rescues for hostile quote assets (timelocked owner; fixed
    // recipients, time-delayed, the owner chooses when, never where)
    // ---------------------------------------------------------------------

    /**
     * @notice Pays a still-trading launch's pending curve fees directly to
     * the protocol and creator recipients, bypassing the escrow, when its
     * quote asset has stopped delivering there. Also the only way to
     * unwedge such a launch's graduation, since `graduate` sweeps fees
     * before handing over the reserves.
     */
    function rescueCurveFees(address token) external onlyOwner nonReentrant {
        LaunchedToken storage launch = _launchedTokens[token];
        if (!launch.exists) revert TokenNotFound();
        PopBondingCurve(launch.curve).rescueFees();
    }

    /**
     * @notice Releases a swept launch's reserves to the launch's own creator
     * fee recipient when its quote asset can no longer satisfy the seed
     * step. `graduate` accepts a quote asset that under-delivers, because it
     * credits the balance it actually received, but the seed leg funds the
     * executor through `_transferExact` and requires the full nominal
     * amount. An asset that becomes fee-on-transfer, rebasing, or
     * blocklisting after listing therefore leaves a launch that has already
     * halted its curve with a seed step that can never succeed.
     *
     * The recipient is fixed to the launch's creator fee recipient, the
     * owner decides when this runs, never where the funds go, and the
     * 14-day delay only starts once the launch is provably stuck, during
     * which anyone can still end the window permanently with one successful
     * `createGraduatedPool` call. Off-chain distribution to holders is the
     * creator's responsibility and the community's expectation; an asset in
     * this state has no reliable way to pay many holders on-chain when it
     * cannot pay one.
     */
    function rescueSweptGraduation(address token) external onlyOwner nonReentrant {
        LaunchedToken storage launch = _launchedTokens[token];
        if (!launch.exists) revert TokenNotFound();
        if (launch.phase != GraduationPhase.Swept) revert WrongGraduationPhase();

        uint256 availableAt = launch.sweptAt + GRADUATION_RESCUE_DELAY;
        if (block.timestamp < availableAt) revert GraduationRescueTooEarly(availableAt);

        address recipient = launch.creatorFeeRecipient;
        uint256 quoteAmount = launch.sweptQuote;
        uint256 tokenAmount = launch.sweptTokens;

        launch.sweptQuote = 0;
        launch.sweptTokens = 0;
        launch.sweptAt = 0;
        launch.phase = GraduationPhase.Rescued;

        if (quoteAmount != 0) IERC20(launch.quoteToken).safeTransfer(recipient, quoteAmount);
        if (tokenAmount != 0) IERC20(token).safeTransfer(recipient, tokenAmount);

        emit LaunchGraduationRescued(token, recipient, quoteAmount, tokenAmount);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /**
     * @dev Covers every protocol-controlled term that fixes what a creator
     * is buying. Narrowing this to the phantom reserve and threshold alone
     * would let the supply, the trade fee, or the pool's fee terms move
     * underneath a pinned launch.
     */
    function _economicsDigest(
        LaunchConfig memory config,
        FeePolicySnapshot memory policy,
        uint256 phantomQuote,
        uint256 graduationThreshold
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                phantomQuote,
                graduationThreshold,
                config.supply,
                config.curveFeeBps,
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
     * stack could otherwise accept buys but later block fee sweeps or
     * graduation.
     */
    function _requireLaunchDependenciesWired() private view {
        if (address(graduationExecutor) == address(0)) revert LaunchDependenciesNotWired();
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
     * @dev Reconstructs the pool ID for an already-graduated launch from its
     * snapshotted config, since the factory does not separately store it.
     */
    function _poolIdFor(address token, LaunchedToken storage launch) private view returns (PoolId) {
        (Currency currency0, Currency currency1,) = _sortCurrencies(token, launch.quoteToken);
        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: launch.poolFee,
            tickSpacing: launch.tickSpacing,
            hooks: IHooks(address(hook))
        });
        return key.toId();
    }

    /**
     * @dev Uses only the token amount that preserves the terminal curve
     * price against the physically held graduation quote asset. The
     * virtual-reserve remainder is permanently locked in the locker and
     * never enters circulation.
     */
    function _lockExcessGraduationTokens(
        address token,
        LaunchedToken storage launch,
        uint256 sweptQuote,
        uint256 totalTokenAmount
    ) private returns (uint256 poolTokenAmount) {
        poolTokenAmount = _poolTokenAmount(launch, sweptQuote, totalTokenAmount);

        uint256 excess = totalTokenAmount - poolTokenAmount;
        if (excess != 0) {
            IERC20(token).forceApprove(address(locker), excess);
            locker.lockTokenSupply(token, excess);
            emit GraduationTokensPermanentlyLocked(token, excess);
        }
    }

    /**
     * @dev Derives the reserve fraction that preserves the curve's terminal
     * price after the virtual quote reserve is removed from the pool seed.
     */
    function _poolTokenAmount(LaunchedToken storage launch, uint256 sweptQuote, uint256 totalTokenAmount)
        private
        view
        returns (uint256 poolTokenAmount)
    {
        if (sweptQuote == 0 || totalTokenAmount == 0) revert NothingToGraduate();
        uint256 virtualQuote = sweptQuote + PopBondingCurve(launch.curve).phantomQuote();
        poolTokenAmount = FullMath.mulDiv(totalTokenAmount, sweptQuote, virtualQuote);
        if (poolTokenAmount == 0) revert NothingToGraduate();
    }

    /**
     * @dev Runs the V4 mint preflight while the curve is still reversible,
     * so a launch can never reach the irreversible Swept phase with a seed
     * that would be rejected.
     */
    function _assertGraduationSeedable(
        address token,
        LaunchedToken storage launch,
        uint256 sweptQuote,
        uint256 sweptTokens
    ) private view {
        uint256 poolTokenAmount = _poolTokenAmount(launch, sweptQuote, sweptTokens);
        graduationGuard.assertSeedable(token, launch.quoteToken, launch.tickSpacing, sweptQuote, poolTokenAmount);
    }

    /**
     * @dev Initializes the V4 pool and registers it with the hook, then
     * hands the exact minted assets to PopGraduationExecutor to encode the
     * Permit2 approvals and PositionManager mint call.
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
        if (amount0 > type(uint128).max || amount1 > type(uint128).max) revert GraduationSeedNotViable();
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

    function _sortCurrencies(address memecoin, address quoteToken)
        private
        pure
        returns (Currency currency0, Currency currency1, bool memecoinIsCurrency0)
    {
        if (quoteToken < memecoin) {
            return (Currency.wrap(quoteToken), Currency.wrap(memecoin), false);
        }
        return (Currency.wrap(memecoin), Currency.wrap(quoteToken), true);
    }

    function _fullRangeTicks(int24 tickSpacing) private pure returns (int24 tickLower, int24 tickUpper) {
        // Truncation toward zero is required to derive V4's usable boundary ticks.
        // forge-lint: disable-next-line(divide-before-multiply)
        tickLower = (MIN_USABLE_TICK / tickSpacing) * tickSpacing;
        // forge-lint: disable-next-line(divide-before-multiply)
        tickUpper = (MAX_USABLE_TICK / tickSpacing) * tickSpacing;
    }

    function _validateLaunchConfig(LaunchConfig calldata config) private pure {
        if (config.curveFeeBps > MAX_CURVE_FEE_BPS) revert CurveFeeTooHigh();
        if (config.supply < MIN_LAUNCH_SUPPLY) revert SupplyTooLow();
        // A supply above the seed ceiling would deploy a curve and token
        // that trade normally, then revert forever at graduation with the
        // reserves already swept out of the curve.
        if (config.supply > MAX_SEED_AMOUNT) revert SupplyTooHigh();
        if (config.tickSpacing <= 0 || config.tickSpacing > MAX_TICK_SPACING) revert InvalidTickSpacing();
        // The hook charges the fee; a nonzero core LP fee would tax swaps a
        // second time into a position nobody can ever collect.
        if (config.poolFee != 0) revert CoreLpFeeMustBeZero();
    }

    /**
     * @notice Reverts unless a small reference buy against a fresh curve
     * with these terms would return a non-zero amount of tokens.
     * @dev A phantom reserve far too large against the supply prices every
     * realistic trade to zero, and the curve reverts on all of them. That
     * launch is dead on arrival but still deployable, so the terms are
     * rejected before any contract exists.
     */
    function _requireQuotable(uint256 phantomQuote, uint256 supply, uint256 curveFeeBps) private pure {
        uint256 referenceBuy = phantomQuote / REFERENCE_BUY_DIVISOR;
        if (PopCurveMath.quoteAmountOut(referenceBuy, phantomQuote, supply, curveFeeBps) == 0) {
            revert CurveNotQuotable();
        }
    }

    /**
     * @notice Reverts unless the seed these launch terms imply is one
     * Uniswap V4 would mint.
     * @dev Graduation drains a fixed share of supply against a quote reserve
     * the threshold fixes, so the seed is determined by the terms rather
     * than by how the curve is traded. Fees move the realised quote slightly
     * off the threshold, so this narrows the failure rather than removing
     * it, and the delayed rescue remains the backstop for whatever it does
     * not catch.
     */
    function _requireSeedableTerms(uint256 supply, uint256 phantomQuote, uint256 graduationThreshold, int24 tickSpacing)
        private
        view
    {
        uint256 virtualQuote = phantomQuote + graduationThreshold;
        uint256 reserved = FullMath.mulDiv(supply, phantomQuote, virtualQuote);
        uint256 poolTokenAmount = FullMath.mulDiv(reserved, graduationThreshold, virtualQuote);
        if (poolTokenAmount == 0) revert GraduationSeedNotViable();
        graduationGuard.assertSeedableEitherOrdering(tickSpacing, graduationThreshold, poolTokenAmount);
    }
}
