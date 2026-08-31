// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LaunchDeployment} from "../../src/PopLaunchDeployer.sol";
import {PopLaunchToken} from "../../src/PopLaunchToken.sol";
import {CashbackConfig, CashbackMode, IPopFeeEscrow} from "../../src/interfaces/IPop.sol";

import {PopFixture} from "../utils/PopFixture.sol";

/**
 * @notice Emits the cross-implementation fixture for the browser's ...909
 * vanity miner. The miner re-implements the deployer's CREATE2 derivation in
 * TypeScript; this test asks the deployer itself for the answers to a fixed
 * input set and writes them to test/fixtures/vanity.json, which is copied
 * into the frontend and replayed by vanity.test.ts. If the TypeScript math
 * ever drifts from the contract's, that test fails.
 *
 * Regenerate (and commit both copies) whenever the launch contracts change:
 *   forge test --match-test test_writeVanityFixture
 *   cp test/fixtures/vanity.json ../frontend/src/lib/vanity.fixture.json
 */
contract VanityFixtureTest is PopFixture {
    function _deployment(CashbackMode mode, bytes32 salt) internal view returns (LaunchDeployment memory) {
        return LaunchDeployment({
            quoteToken: address(quote),
            creatorFeeRecipient: creator,
            originalDeployer: creator,
            protocolFeeRecipient: treasury,
            protocolFeeShareBps: PROTOCOL_SHARE_BPS,
            cashback: CashbackConfig(mode, mode == CashbackMode.None ? 0 : 5_000),
            feeEscrow: IPopFeeEscrow(address(escrow)),
            phantomQuote: EXPECTED_PHANTOM,
            curveFeeBps: CURVE_FEE_BPS,
            creatorFeeBps: 200,
            graduationThreshold: EXPECTED_THRESHOLD,
            supply: SUPPLY,
            salt: salt,
            name: "Vanity Fixture",
            symbol: "VAN",
            logo: "ipfs://bafyfixture",
            description: "cross-implementation vanity fixture",
            socials: PopLaunchToken.Socials("x.com/pop", "", "", "ponsonpons.com", "")
        });
    }

    function test_writeVanityFixture() public {
        bytes32 salt = keccak256("vanity-fixture");
        (address plainToken, address plainCurve) =
            launchDeployer.predictLaunchAddresses(_deployment(CashbackMode.None, salt));
        (address rewardToken, address rewardCurve) =
            launchDeployer.predictLaunchAddresses(_deployment(CashbackMode.HolderRewards, salt));

        string memory json = "vanity";
        vm.serializeAddress(json, "launchDeployer", address(launchDeployer));
        vm.serializeAddress(json, "rewardTokenDeployer", address(launchDeployer.rewardTokenDeployer()));
        vm.serializeAddress(json, "factory", address(factory));
        vm.serializeAddress(json, "feeEscrow", address(escrow));
        vm.serializeAddress(json, "quote", address(quote));
        vm.serializeAddress(json, "creator", creator);
        vm.serializeAddress(json, "protocolFeeRecipient", treasury);
        vm.serializeAddress(json, "graduationExecutor", address(executor));
        vm.serializeAddress(json, "locker", address(locker));
        vm.serializeAddress(json, "poolManager", address(poolManager));
        vm.serializeUint(json, "protocolFeeShareBps", PROTOCOL_SHARE_BPS);
        vm.serializeUint(json, "curveFeeBps", CURVE_FEE_BPS);
        vm.serializeUint(json, "creatorFeeBps", 200);
        vm.serializeUint(json, "phantomQuote", EXPECTED_PHANTOM);
        vm.serializeUint(json, "graduationThreshold", EXPECTED_THRESHOLD);
        vm.serializeUint(json, "supply", SUPPLY);
        vm.serializeBytes32(json, "salt", salt);
        vm.serializeAddress(json, "expectedPlainToken", plainToken);
        vm.serializeAddress(json, "expectedPlainCurve", plainCurve);
        vm.serializeAddress(json, "expectedRewardToken", rewardToken);
        string memory out = vm.serializeAddress(json, "expectedRewardCurve", rewardCurve);
        vm.writeJson(out, "test/fixtures/vanity.json");

        // Distinct cashback terms mean distinct curves, and the two token
        // variants never collide.
        assertTrue(plainCurve != rewardCurve);
        assertTrue(plainToken != rewardToken);
    }
}
