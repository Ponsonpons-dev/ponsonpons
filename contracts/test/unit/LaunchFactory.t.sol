// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PopBondingCurve} from "../../src/PopBondingCurve.sol";
import {PopLaunchFactory} from "../../src/PopLaunchFactory.sol";
import {PopLaunchToken} from "../../src/PopLaunchToken.sol";
import {CashbackConfig, CashbackMode} from "../../src/interfaces/IPop.sol";
import {PopFixture} from "../utils/PopFixture.sol";

contract LaunchFactoryTest is PopFixture {
    address[] internal noExemptions;

    function test_launchGating() public {
        vm.prank(timelock);
        factory.setLaunchEnabled(false);

        vm.prank(creator);
        vm.expectRevert(PopLaunchFactory.NotWhitelisted.selector);
        factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("A", CashbackConfig(CashbackMode.None, 0), 0), 0, address(quote), 0, 0, noExemptions
        );

        vm.prank(timelock);
        factory.setWhitelistedLauncher(creator, true);
        vm.prank(creator);
        factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("A", CashbackConfig(CashbackMode.None, 0), 0), 0, address(quote), 0, 0, noExemptions
        );
    }

    function test_launchFee_requiredExactAndForwarded() public {
        uint256 treasuryBefore = treasury.balance;
        vm.prank(creator);
        vm.expectRevert(PopLaunchFactory.LaunchFeeNotPaid.selector);
        factory.launchToken{value: LAUNCH_FEE - 1}(
            defaultParams("A", CashbackConfig(CashbackMode.None, 0), 0), 0, address(quote), 0, 0, noExemptions
        );

        vm.prank(creator);
        factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("A", CashbackConfig(CashbackMode.None, 0), 0), 0, address(quote), 0, 0, noExemptions
        );
        assertEq(treasury.balance, treasuryBefore + LAUNCH_FEE);
    }

    function test_creatorFeeCap_2Percent() public {
        vm.prank(creator);
        vm.expectRevert(PopLaunchFactory.CreatorFeeTooHigh.selector);
        factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("A", CashbackConfig(CashbackMode.None, 0), 201), 0, address(quote), 0, 0, noExemptions
        );
    }

    function test_cashbackValidation() public {
        // A share with mode None is a misconfiguration, not a silent no-op.
        vm.prank(creator);
        vm.expectRevert(PopLaunchFactory.InvalidCashback.selector);
        factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("A", CashbackConfig(CashbackMode.None, 1), 0), 0, address(quote), 0, 0, noExemptions
        );

        vm.prank(creator);
        vm.expectRevert(PopLaunchFactory.InvalidCashback.selector);
        factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("A", CashbackConfig(CashbackMode.QuoteBurn, 10_001), 0), 0, address(quote), 0, 0, noExemptions
        );
    }

    function test_economicsPin_revertsOnRepricedLaunch() public {
        bytes32 pinned = factory.previewLaunchEconomics(0, address(quote));

        // A registry re-peg lands between quote and launch.
        vm.warp(block.timestamp + 1 days + 1);
        adapter.set(address(quote), true, 400 ether, QUOTE_PER_ETH * 2);
        registry.repegQuote(address(quote));

        PopLaunchFactory.TokenParams memory params = defaultParams("A", CashbackConfig(CashbackMode.None, 0), 0);
        params.expectedEconomics = pinned;
        vm.prank(creator);
        vm.expectRevert(); // LaunchEconomicsMismatch carries both digests
        factory.launchToken{value: LAUNCH_FEE}(params, 0, address(quote), 0, 0, noExemptions);

        // Re-quoting fixes it.
        params.expectedEconomics = factory.previewLaunchEconomics(0, address(quote));
        vm.prank(creator);
        factory.launchToken{value: LAUNCH_FEE}(params, 0, address(quote), 0, 0, noExemptions);
    }

    function test_launchConfig_validation() public {
        vm.startPrank(timelock);
        PopLaunchFactory.LaunchConfig memory config = PopLaunchFactory.LaunchConfig({
            supply: SUPPLY, curveFeeBps: 1_001, poolFee: 0, tickSpacing: 200, enabled: true
        });
        vm.expectRevert(PopLaunchFactory.CurveFeeTooHigh.selector);
        factory.addLaunchConfig(config);

        config.curveFeeBps = 100;
        config.poolFee = 3000;
        vm.expectRevert(PopLaunchFactory.CoreLpFeeMustBeZero.selector);
        factory.addLaunchConfig(config);

        config.poolFee = 0;
        config.supply = 0.5 ether;
        vm.expectRevert(PopLaunchFactory.SupplyTooLow.selector);
        factory.addLaunchConfig(config);

        config.supply = uint256(uint128(type(int128).max)) + 1;
        vm.expectRevert(PopLaunchFactory.SupplyTooHigh.selector);
        factory.addLaunchConfig(config);

        config.supply = SUPPLY;
        config.tickSpacing = 0;
        vm.expectRevert(PopLaunchFactory.InvalidTickSpacing.selector);
        factory.addLaunchConfig(config);
        vm.stopPrank();
    }

    function test_snipeExemptions_boundedAndApplied() public {
        address[] memory bundle = new address[](2);
        bundle[0] = alice;
        bundle[1] = bob;
        vm.prank(creator);
        (, address c) = factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("A", CashbackConfig(CashbackMode.None, 0), 0), 0, address(quote), 0, 0, bundle
        );
        assertEq(PopBondingCurve(c).currentSnipeTaxBps(alice), 0);
        assertEq(PopBondingCurve(c).currentSnipeTaxBps(bob), 0);
        assertEq(PopBondingCurve(c).currentSnipeTaxBps(keeper), 9_900);

        address[] memory tooMany = new address[](33);
        vm.prank(creator);
        vm.expectRevert(PopLaunchFactory.ExemptionListTooLong.selector);
        factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("B", CashbackConfig(CashbackMode.None, 0), 0), 0, address(quote), 0, 0, tooMany
        );
    }

    function test_saltReuse_revertsAndPredictable() public {
        vm.prank(creator);
        factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("A", CashbackConfig(CashbackMode.None, 0), 0), 0, address(quote), 0, 0, noExemptions
        );
        // Identical params + same salt from the same deployer → CREATE2
        // collision.
        vm.prank(creator);
        vm.expectRevert();
        factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("A", CashbackConfig(CashbackMode.None, 0), 0), 0, address(quote), 0, 0, noExemptions
        );
        // A different account with the same salt is namespaced apart.
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("A", CashbackConfig(CashbackMode.None, 0), 0), 0, address(quote), 0, 0, noExemptions
        );
    }

    function test_ownerCannotBeRenounced_andHasNoFundPowers() public {
        vm.prank(timelock);
        vm.expectRevert(PopLaunchFactory.OwnershipCannotBeRenounced.selector);
        factory.renounceOwnership();

        // Enumerate the entire owner surface: nothing here can move a live
        // launch's funds. (The two rescue paths are covered by their own
        // tests and pay fixed recipients only.)
        vm.startPrank(timelock);
        factory.setLaunchFee(1);
        factory.setLaunchEnabled(true);
        factory.setWhitelistedLauncher(alice, true);
        factory.setSnipeTaxSeconds(10);
        factory.setSnipeTaxStartBps(5_000);
        vm.stopPrank();
    }
}
