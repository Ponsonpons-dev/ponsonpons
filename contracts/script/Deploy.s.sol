// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {HookMiner} from "@uniswap/v4-periphery/test/shared/HookMiner.sol";
import {Script, console} from "forge-std/Script.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {RobinhoodChainAddresses as A} from "../src/Addresses.sol";
import {PopFeeEscrow} from "../src/PopFeeEscrow.sol";
import {PopGraduationExecutor} from "../src/PopGraduationExecutor.sol";
import {PopHook} from "../src/PopHook.sol";
import {PopLaunchDeployer} from "../src/PopLaunchDeployer.sol";
import {PopLaunchFactory} from "../src/PopLaunchFactory.sol";
import {PopLocker} from "../src/PopLocker.sol";
import {PopQuoteRegistry} from "../src/PopQuoteRegistry.sol";
import {PopRewardTokenDeployer} from "../src/PopRewardTokenDeployer.sol";
import {IPonsV1LaunchFactory, IUniswapV3FactoryLike, PonsV1QuoteAdapter} from "../src/adapters/PonsV1QuoteAdapter.sol";
import {IPopFeeEscrow, IPopQuoteRegistry} from "../src/interfaces/IPop.sol";

/**
 * @notice Deploys the full $POP stack on Robinhood Chain and writes the
 * addresses to deployments/<chainId>.json.
 *
 * Required env:
 *   PROTOCOL_OWNER    , receives protocol fees, and owns the four ownable
 *                        contracts (directly, or via the timelock).
 * Optional env (defaults shown):
 *   USE_TIMELOCK=true                 (false deploys without a timelock)
 *   LAUNCH_FEE_WEI=500000000000000    (0.0005 ETH)
 *   MIN_ETH_TVL_WEI=25e18
 *   GRADUATION_TARGET_ETH_WEI=4.2e18
 *
 * Ownership, two supported models. Both are honest; pick one and make sure
 * the site says which:
 *
 *   USE_TIMELOCK=true  (default) , a 48h TimelockController owns the four
 *     ownable contracts and PROTOCOL_OWNER proposes and executes on it.
 *     Every parameter change is visible on-chain 48h before it can land.
 *     PROTOCOL_OWNER must execute `acceptOwnership()` on factory, hook,
 *     locker and registry THROUGH THE TIMELOCK to finish the handover.
 *
 *   USE_TIMELOCK=false , PROTOCOL_OWNER owns the four contracts directly and
 *     its changes take effect immediately, with no delay and no warning.
 *     It must still call `acceptOwnership()` on all four. Anything the site
 *     claims about a timelock becomes false under this model.
 *
 * Either way the deployment is not done until the four accepts land, and the
 * proof page should link all four transactions.
 *
 * Verification: run with `--verify --verifier sourcify` (Sourcify supports
 * chain 4663; the Blockscout UI imports from it).
 */
contract Deploy is Script {
    // CREATE2 proxy used by forge scripts, needed to mine the hook address.
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint256 internal constant TIMELOCK_DELAY = 48 hours;
    uint16 internal constant PROTOCOL_FEE_SHARE_BPS = 5_000; // 50% of the 1% base fee, the hook's hard cap
    uint256 internal constant HOOK_FEE_BPS = 100; // 1%
    uint256 internal constant MAX_INTERNAL_PRICE_IMPACT_BPS = 300; // 3%
    uint256 internal constant CURVE_FEE_BPS = 100; // 1%
    uint256 internal constant LAUNCH_SUPPLY = 1_000_000_000 ether;
    int24 internal constant TICK_SPACING = 200;

    /// @dev Held here rather than in run()'s frame, which is at the stack
    /// limit even with via_ir. Zero means ownership is direct, no timelock.
    address private _timelock;

    function run() external {
        require(block.chainid == A.CHAIN_ID, "wrong chain");
        address protocolOwner = vm.envAddress("PROTOCOL_OWNER");
        bool useTimelock = vm.envOr("USE_TIMELOCK", true);
        uint256 launchFee = vm.envOr("LAUNCH_FEE_WEI", uint256(0.0005 ether));
        uint256 minEthTvl = vm.envOr("MIN_ETH_TVL_WEI", uint256(25 ether));
        uint256 targetEth = vm.envOr("GRADUATION_TARGET_ETH_WEI", uint256(4.2 ether));

        vm.startBroadcast();
        address deployer = msg.sender;

        // 1. Governance. Built in a helper so its locals do not sit in this
        //    frame for the rest of the script; run() is already at the stack
        //    limit even with via_ir.
        address governor = _governance(protocolOwner, useTimelock);

        // 2. Ownerless plumbing.
        PopFeeEscrow escrow = new PopFeeEscrow();

        // 3. Locker (owner = deployer for wiring, then timelock).
        PopLocker locker = new PopLocker(deployer, A.UNISWAP_V4_POSITION_MANAGER);

        // 4. Hook at a mined address carrying its permission bits.
        uint160 flags =
            uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG);
        bytes memory hookArgs = abi.encode(
            IPoolManager(A.UNISWAP_V4_POOL_MANAGER),
            IPopFeeEscrow(address(escrow)),
            protocolOwner,
            deployer,
            uint256(PROTOCOL_FEE_SHARE_BPS),
            HOOK_FEE_BPS,
            MAX_INTERNAL_PRICE_IMPACT_BPS
        );
        (address hookAddress, bytes32 hookSalt) =
            HookMiner.find(CREATE2_DEPLOYER, flags, type(PopHook).creationCode, hookArgs);
        PopHook hook = new PopHook{salt: hookSalt}(
            IPoolManager(A.UNISWAP_V4_POOL_MANAGER),
            IPopFeeEscrow(address(escrow)),
            protocolOwner,
            deployer,
            uint256(PROTOCOL_FEE_SHARE_BPS),
            HOOK_FEE_BPS,
            MAX_INTERNAL_PRICE_IMPACT_BPS
        );
        require(address(hook) == hookAddress, "hook address mismatch");

        // 5. Quote registry + the Pons v1 origin adapter.
        PonsV1QuoteAdapter adapter = new PonsV1QuoteAdapter(
            IPonsV1LaunchFactory(A.PONS_V1_FACTORY),
            IPonsV1LaunchFactory(A.PONS_V1_LEGACY_FACTORY),
            IUniswapV3FactoryLike(A.UNISWAP_V3_FACTORY),
            A.WETH
        );
        PopQuoteRegistry registry = new PopQuoteRegistry(deployer, minEthTvl, targetEth);
        registry.addAdapter(adapter);

        // 6. Factory + helpers.
        PopLaunchFactory factory = new PopLaunchFactory(
            deployer,
            IPoolManager(A.UNISWAP_V4_POOL_MANAGER),
            IPositionManager(A.UNISWAP_V4_POSITION_MANAGER),
            IAllowanceTransfer(A.PERMIT2),
            locker,
            hook,
            IPopFeeEscrow(address(escrow)),
            IPopQuoteRegistry(address(registry)),
            launchFee
        );
        PopGraduationExecutor executor = new PopGraduationExecutor(
            IPositionManager(A.UNISWAP_V4_POSITION_MANAGER), IAllowanceTransfer(A.PERMIT2), locker, address(factory)
        );
        // The reward-token deployer authorizes through the factory's
        // `launchDeployer`, so it is inert until the wiring below lands.
        PopRewardTokenDeployer rewardTokenDeployer = new PopRewardTokenDeployer(address(factory));
        PopLaunchDeployer launchDeployer = new PopLaunchDeployer(address(factory), rewardTokenDeployer);

        // 7. One-time wiring.
        factory.setGraduationExecutor(executor);
        factory.setLaunchDeployer(launchDeployer);
        factory.addLaunchConfig(
            PopLaunchFactory.LaunchConfig({
                supply: LAUNCH_SUPPLY, curveFeeBps: CURVE_FEE_BPS, poolFee: 0, tickSpacing: TICK_SPACING, enabled: true
            })
        );
        hook.setFactory(address(factory));
        locker.setFactory(address(factory));

        // 8. List the flagship quote. Permissionless, done here only for
        //    convenience; anyone could.
        registry.listQuote(A.PONS, 0);

        // 9. Hand governance over (two-step: the new owner must call
        //    acceptOwnership on all four to finish, through the timelock if
        //    one was deployed).
        factory.transferOwnership(governor);
        hook.transferOwnership(governor);
        locker.transferOwnership(governor);
        registry.transferOwnership(governor);

        vm.stopBroadcast();

        // 10. Record the deployment.
        string memory json = "deployment";
        // Recorded so the site can describe the governance that actually
        // shipped rather than the one it was designed for. A zero timelock
        // means ownership is direct.
        vm.serializeAddress(json, "timelock", _timelock);
        vm.serializeAddress(json, "protocolOwner", protocolOwner);
        vm.serializeString(json, "governance", useTimelock ? "timelock" : "direct");
        vm.serializeAddress(json, "feeEscrow", address(escrow));
        vm.serializeAddress(json, "locker", address(locker));
        vm.serializeAddress(json, "hook", address(hook));
        vm.serializeAddress(json, "quoteRegistry", address(registry));
        vm.serializeAddress(json, "ponsV1Adapter", address(adapter));
        vm.serializeAddress(json, "launchFactory", address(factory));
        vm.serializeAddress(json, "graduationExecutor", address(executor));
        vm.serializeAddress(json, "launchDeployer", address(launchDeployer));
        vm.serializeAddress(json, "rewardTokenDeployer", address(rewardTokenDeployer));
        vm.serializeAddress(json, "graduationGuard", address(factory.graduationGuard()));
        vm.serializeAddress(json, "poolManager", A.UNISWAP_V4_POOL_MANAGER);
        vm.serializeAddress(json, "positionManager", A.UNISWAP_V4_POSITION_MANAGER);
        string memory out = vm.serializeAddress(json, "permit2", A.PERMIT2);
        vm.writeJson(out, string.concat("deployments/", vm.toString(block.chainid), ".json"));

        console.log("POP deployed. Factory:", address(factory));
        console.log("Pending owner of all four (must acceptOwnership):", governor);
        if (!useTimelock) {
            console.log("NOTE: deployed WITHOUT a timelock. Owner changes take effect immediately.");
            console.log("Set NEXT_PUBLIC_GOVERNANCE=direct on the frontend so the site does not claim otherwise.");
        }
    }

    /**
     * @dev Deploys the 48h timelock and returns it as the governor, or
     * returns `owner` itself when USE_TIMELOCK=false. A zero timelock address
     * in the deployment record means ownership is direct.
     */
    function _governance(address owner, bool useTimelock) private returns (address governor) {
        if (!useTimelock) return owner;
        address[] memory proposers = new address[](1);
        proposers[0] = owner;
        _timelock = address(new TimelockController(TIMELOCK_DELAY, proposers, proposers, address(0)));
        return _timelock;
    }
}
