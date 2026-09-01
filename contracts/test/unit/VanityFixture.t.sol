// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LaunchDeployment} from "../../src/PopLaunchDeployer.sol";
import {PopLaunchToken} from "../../src/PopLaunchToken.sol";
import {CashbackConfig, CashbackMode} from "../../src/interfaces/IPop.sol";

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
            originalDeployer: creator,
            cashback: CashbackConfig(mode, mode == CashbackMode.None ? 0 : 5_000),
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
        address plainToken = launchDeployer.predictLaunchAddress(_deployment(CashbackMode.None, salt));
        address rewardToken = launchDeployer.predictLaunchAddress(_deployment(CashbackMode.HolderRewards, salt));

        string memory json = "vanity";
        vm.serializeAddress(json, "launchDeployer", address(launchDeployer));
        vm.serializeAddress(json, "rewardTokenDeployer", address(launchDeployer.rewardTokenDeployer()));
        vm.serializeAddress(json, "factory", address(factory));
        vm.serializeAddress(json, "hook", address(hook));
        vm.serializeAddress(json, "locker", address(locker));
        vm.serializeAddress(json, "poolManager", address(poolManager));
        vm.serializeAddress(json, "quote", address(quote));
        vm.serializeAddress(json, "creator", creator);
        vm.serializeUint(json, "supply", SUPPLY);
        vm.serializeBytes32(json, "salt", salt);
        vm.serializeAddress(json, "expectedPlainToken", plainToken);
        string memory out = vm.serializeAddress(json, "expectedRewardToken", rewardToken);
        vm.writeJson(out, "test/fixtures/vanity.json");

        // The two variants never collide.
        assertTrue(plainToken != rewardToken);
    }
}
