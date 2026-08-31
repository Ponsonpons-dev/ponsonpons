// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";

import {PopBondingCurve} from "../../src/PopBondingCurve.sol";
import {PopLaunchToken} from "../../src/PopLaunchToken.sol";
import {CashbackConfig, CashbackMode} from "../../src/interfaces/IPop.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {PopFixture} from "../utils/PopFixture.sol";

/// @notice Random buys, sells, permissionless sweeps, and donations against
/// one live curve. Tracks ground-truth trader flows so the invariants can
/// compare the curve's accounting with what physically happened.
contract CurveHandler {
    PopBondingCurve public immutable curve;
    PopLaunchToken public immutable token;
    MockERC20 public immutable quote;
    Vm internal vm;

    uint256 public totalQuoteIn; // net trader spend (refunds and rebates netted out)
    uint256 public totalQuoteOut; // sell payouts to traders
    address[] public actors;

    constructor(PopBondingCurve curve_, MockERC20 quote_, Vm vm_) {
        curve = curve_;
        token = PopLaunchToken(curve_.token());
        quote = quote_;
        vm = vm_;
        actors.push(address(0xA11CE));
        actors.push(address(0xB0B));
        actors.push(address(0xCA7));
    }

    function buy(uint256 actorSeed, uint256 amount) external {
        if (curve.graduated()) return;
        address actor = actors[actorSeed % actors.length];
        amount = 1e6 + (amount % 50_000 ether);
        quote.mint(actor, amount);

        uint256 balBefore = quote.balanceOf(actor);
        vm.startPrank(actor);
        quote.approve(address(curve), amount);
        try curve.buy(amount, 0, actor, block.timestamp) {
            totalQuoteIn += balBefore - quote.balanceOf(actor);
        } catch {}
        vm.stopPrank();
    }

    function sell(uint256 actorSeed, uint256 fraction) external {
        if (curve.graduated()) return;
        address actor = actors[actorSeed % actors.length];
        uint256 held = token.balanceOf(actor);
        if (held == 0) return;
        uint256 amount = 1 + (fraction % held);

        uint256 balBefore = quote.balanceOf(actor);
        vm.startPrank(actor);
        token.approve(address(curve), amount);
        try curve.sell(amount, 0, actor, block.timestamp) {
            totalQuoteOut += quote.balanceOf(actor) - balBefore;
        } catch {}
        vm.stopPrank();
    }

    function sweep(uint256) external {
        if (curve.graduated()) return;
        try curve.sweepFees() {} catch {}
    }

    function donate(uint256 amount) external {
        // Donations must never affect pricing or solvency accounting.
        amount = amount % 1_000 ether;
        quote.mint(address(curve), amount);
    }
}

contract CurveInvariantTest is PopFixture {
    PopBondingCurve internal curve;
    PopLaunchToken internal token;
    CurveHandler internal handler;

    function setUp() public override {
        super.setUp();
        (PopLaunchToken t, PopBondingCurve c) = launch(CashbackConfig(CashbackMode.QuoteBurn, 5_000), 200);
        token = t;
        curve = c;
        skipSnipeWindow();
        handler = new CurveHandler(c, quote, vm);
        targetContract(address(handler));
    }

    /// @notice The curve can always pay what it owes: its physical quote
    /// balance covers the tracked reserve (donations only add slack), and
    /// the pending fee buckets are always a slice of the tracked reserve.
    function invariant_solvency() public view {
        assertGe(quote.balanceOf(address(curve)), curve.trackedQuote());
        assertGe(
            curve.trackedQuote(), curve.pendingProtocolFees() + curve.pendingCreatorFees() + curve.pendingCashback()
        );
        assertGe(token.balanceOf(address(curve)), curve.trackedTokens());
    }

    /// @notice Traders as a class can never extract more quote than they put
    /// in: the curve retains at least the fees charged.
    function invariant_noValueExtraction() public view {
        assertGe(handler.totalQuoteIn(), handler.totalQuoteOut());
    }

    /// @notice The reserved pool allocation is never sold through before
    /// graduation.
    function invariant_reservedNeverBreached() public view {
        if (!curve.graduated()) {
            assertGe(curve.trackedTokens(), curve.reservedTokens());
        }
    }
}
