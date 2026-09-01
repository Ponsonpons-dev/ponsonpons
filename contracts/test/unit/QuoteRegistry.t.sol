// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PopQuoteRegistry} from "../../src/PopQuoteRegistry.sol";
import {CashbackConfig, CashbackMode} from "../../src/interfaces/IPop.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockQuoteAdapter} from "../mocks/MockQuoteAdapter.sol";
import {PopFixture} from "../utils/PopFixture.sol";

contract QuoteRegistryTest is PopFixture {
    // Quote-denominated legacy economics (4.2 ETH target at the mock TWAP).
    uint256 internal constant EXPECTED_THRESHOLD = 420_000 ether;
    uint256 internal constant EXPECTED_PHANTOM = 168_000 ether;

    function test_listing_isPermissionlessButRuleBound() public {
        MockERC20 candidate = new MockERC20("Hmm", "HMM", 18);

        // Unknown to the adapter → not graduated.
        vm.prank(alice);
        vm.expectRevert(PopQuoteRegistry.NotGraduated.selector);
        registry.listQuote(address(candidate), 0);

        // Graduated but under the liquidity floor.
        adapter.set(address(candidate), true, 24 ether, QUOTE_PER_ETH);
        vm.expectRevert(
            abi.encodeWithSelector(PopQuoteRegistry.InsufficientLockedLiquidity.selector, 24 ether, 25 ether)
        );
        registry.listQuote(address(candidate), 0);

        // Qualified: anyone can list.
        adapter.set(address(candidate), true, 26 ether, QUOTE_PER_ETH);
        vm.prank(alice);
        registry.listQuote(address(candidate), 0);
        assertTrue(registry.isListed(address(candidate)));

        (uint256 phantom, uint256 threshold, uint8 decimals) = registry.getLaunchEconomics(address(candidate));
        assertEq(threshold, EXPECTED_THRESHOLD); // 4.2 ETH * 100k/ETH
        assertEq(phantom, EXPECTED_PHANTOM); // 2/5 ratio
        assertEq(decimals, 18);

        // Double listing refused.
        vm.expectRevert(PopQuoteRegistry.AlreadyListed.selector);
        registry.listQuote(address(candidate), 0);
    }

    function test_decimalBounds() public {
        MockERC20 coarse = new MockERC20("Coarse", "C", 5);
        adapter.set(address(coarse), true, 100 ether, QUOTE_PER_ETH);
        vm.expectRevert(abi.encodeWithSelector(PopQuoteRegistry.UnsupportedDecimals.selector, 5));
        registry.listQuote(address(coarse), 0);

        MockERC20 sixDec = new MockERC20("USDish", "USD6", 6);
        adapter.set(address(sixDec), true, 100 ether, 4200e6); // 4200 units per ETH
        registry.listQuote(address(sixDec), 0);
        (, uint256 threshold,) = registry.getLaunchEconomics(address(sixDec));
        assertEq(threshold, 42 * 4200e6 / 10); // 4.2 ETH * 4200e6
    }

    function test_liquidityFloor_enforcedLiveAtLaunch() public {
        // The pre-listed fixture quote collapses below the floor.
        adapter.set(address(quote), true, 1 ether, QUOTE_PER_ETH);

        vm.expectRevert(
            abi.encodeWithSelector(PopQuoteRegistry.InsufficientLockedLiquidity.selector, 1 ether, 25 ether)
        );
        registry.getLaunchEconomics(address(quote));

        // And therefore launching on it fails, with no admin involved.
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(PopQuoteRegistry.InsufficientLockedLiquidity.selector, 1 ether, 25 ether)
        );
        factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("X", CashbackConfig(CashbackMode.None, 0), 0), 0, address(quote), 0
        );

        // Liquidity recovers, launches resume, permissionlessly.
        adapter.set(address(quote), true, 400 ether, QUOTE_PER_ETH);
        vm.prank(creator);
        factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("X", CashbackConfig(CashbackMode.None, 0), 0), 0, address(quote), 0
        );
    }

    function test_repeg_cooldownAndClamp() public {
        // Fresh listing carries today's peg; cooldown blocks instant repeg.
        vm.expectRevert();
        registry.repegQuote(address(quote));

        vm.warp(block.timestamp + 1 days + 1);

        // Price 10x's, but the clamp bounds the move to 2x per repeg.
        adapter.set(address(quote), true, 400 ether, QUOTE_PER_ETH * 10);
        registry.repegQuote(address(quote));
        (, uint256 threshold,) = registry.getLaunchEconomics(address(quote));
        assertEq(threshold, EXPECTED_THRESHOLD * 2);

        // Ratio is preserved by the clamp path too.
        (uint256 phantom,,) = registry.getLaunchEconomics(address(quote));
        assertEq(phantom, EXPECTED_THRESHOLD * 2 * 2 / 5);
    }

    function test_pause_blocksNewLaunchesOnly() public {
        vm.prank(timelock);
        registry.setQuotePaused(address(quote), true);

        vm.expectRevert(PopQuoteRegistry.QuotePaused.selector);
        registry.getLaunchEconomics(address(quote));

        vm.prank(timelock);
        registry.setQuotePaused(address(quote), false);
        registry.getLaunchEconomics(address(quote));
    }

    function test_ownerSurface_isTimelockedAndBounded() public {
        // Non-owner can't touch any knob.
        vm.expectRevert();
        registry.setMinEthTvl(1);
        vm.expectRevert();
        registry.setGraduationTargetEth(1);
        vm.expectRevert();
        registry.setQuotePaused(address(quote), true);
        vm.expectRevert();
        registry.addAdapter(adapter);
        vm.expectRevert();
        registry.renounceOwnership();

        // Owner can't renounce either. and there is no delist function at
        // all, by construction.
        vm.prank(timelock);
        vm.expectRevert(PopQuoteRegistry.OwnershipCannotBeRenounced.selector);
        registry.renounceOwnership();

        // Adapters append; ids are stable.
        MockQuoteAdapter second = new MockQuoteAdapter(address(weth));
        vm.prank(timelock);
        uint256 id = registry.addAdapter(second);
        assertEq(id, 1);
        assertEq(registry.adapterCount(), 2);
        assertEq(address(registry.adapters(0)), address(adapter));
    }

    function test_decimalsDrift_blocksLaunch() public {
        // An upgradeable quote that changes reported decimals after listing
        // must stop hosting launches rather than misprice them. Simulate by
        // etching different code? Simpler: mock via a second token listed
        // at 18 then mockCall decimals to 6.
        vm.mockCall(address(quote), abi.encodeWithSignature("decimals()"), abi.encode(uint8(6)));
        vm.expectRevert(abi.encodeWithSelector(PopQuoteRegistry.UnsupportedDecimals.selector, 6));
        registry.getLaunchEconomics(address(quote));
        vm.clearMockedCalls();
    }
}
