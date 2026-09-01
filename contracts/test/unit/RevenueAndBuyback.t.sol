// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {PopBuybackBurner} from "../../src/PopBuybackBurner.sol";
import {PopLaunchFactory} from "../../src/PopLaunchFactory.sol";
import {PopLaunchToken} from "../../src/PopLaunchToken.sol";
import {PopRevenueSplitter} from "../../src/PopRevenueSplitter.sol";
import {PopRewardToken} from "../../src/PopRewardToken.sol";
import {CashbackConfig, CashbackMode, IPopFeeEscrow, IPopQuoteRegistry, LaunchPhase} from "../../src/interfaces/IPop.sol";

import {MockERC20} from "../mocks/MockERC20.sol";
import {PopFixture} from "../utils/PopFixture.sol";

/**
 * @notice Tests for the two revenue periphery contracts: the platform-wide
 * splitter that pays $POP holders a share of protocol fees, and the buyback
 * burner that turns a fixed slice of $POP's creator fees into burned $POP.
 * Both now also convert curve-phase WETH revenue into the reward asset
 * before splitting, so the promised ratios cover both phases.
 */
contract RevenueAndBuybackTest is PopFixture {
    address internal wallet = makeAddr("ownerWallet");
    address internal dead = 0x000000000000000000000000000000000000dEaD;

    PopRevenueSplitter internal splitter;
    PopBuybackBurner internal burner;

    function setUp() public override {
        super.setUp();
        splitter = new PopRevenueSplitter(
            wallet,
            IPopFeeEscrow(address(escrow)),
            IERC20(address(quote)),
            1_500,
            IPopQuoteRegistry(address(registry)),
            address(weth)
        );
        burner = new PopBuybackBurner(
            wallet,
            poolManager,
            IPopFeeEscrow(address(escrow)),
            IERC20(address(quote)),
            keeper,
            2_500,
            IPopQuoteRegistry(address(registry)),
            address(weth)
        );
    }

    /// @dev Launches the HolderRewards variant (what $POP itself will use)
    /// with a holder as of the buy, so distributions have someone to reach.
    function _popLikeToken() internal returns (PopRewardToken token) {
        vm.prank(creator);
        address t = factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("POP", CashbackConfig(CashbackMode.HolderRewards, 0), 0), 0, address(quote), 0
        );
        token = PopRewardToken(t);
        skipSnipeWindow();
        buyAs(alice, t, 0.5 ether);
    }

    function _creditSplitter(uint256 amount) internal {
        quote.mint(address(this), amount);
        quote.approve(address(escrow), amount);
        escrow.creditToken(address(splitter), address(quote), amount);
    }

    // ------------------------------------------------------------------
    // PopRevenueSplitter
    // ------------------------------------------------------------------

    function test_splitter_paysHoldersTheirShare() public {
        PopRewardToken pop = _popLikeToken();
        vm.prank(wallet);
        splitter.setPopToken(address(pop));

        _creditSplitter(100 ether);
        splitter.distribute(IERC20(address(quote)));

        assertEq(quote.balanceOf(wallet), 85 ether, "owner gets 85%");
        // Alice is essentially the only non-excluded holder, so ~all of the
        // 15 ether holder share becomes claimable by her.
        assertApproxEqRel(pop.claimable(alice), 15 ether, 0.001e18, "holders get 15%");
    }

    function test_splitter_convertsWethRevenueBeforeSplitting() public {
        PopRewardToken pop = _popLikeToken();
        vm.prank(wallet);
        splitter.setPopToken(address(pop));

        // Curve-phase protocol revenue arrives in WETH.
        vm.deal(address(this), 1 ether);
        weth.deposit{value: 1 ether}();
        weth.approve(address(escrow), 1 ether);
        escrow.creditToken(address(splitter), address(weth), 1 ether);

        splitter.convertAndDistribute(0);

        // 1 ETH converts to 100k quote at the mock rate; 85/15 applies.
        assertEq(quote.balanceOf(wallet), 85_000 ether, "owner gets 85% of converted");
        assertApproxEqRel(pop.claimable(alice), 15_000 ether, 0.001e18, "holders get 15% of converted");
    }

    function test_splitter_conversionBoundedByTwap() public {
        vm.deal(address(this), 1 ether);
        weth.deposit{value: 1 ether}();
        weth.approve(address(escrow), 1 ether);
        escrow.creditToken(address(splitter), address(weth), 1 ether);

        conversionPool.setRate((QUOTE_PER_ETH * 80) / 100);
        vm.expectRevert();
        splitter.convertAndDistribute(0);

        conversionPool.setRate(QUOTE_PER_ETH);
        splitter.convertAndDistribute(0);
    }

    function test_splitter_beforePopTokenSet_everythingToOwner() public {
        _creditSplitter(40 ether);
        splitter.distribute(IERC20(address(quote)));
        assertEq(quote.balanceOf(wallet), 40 ether);
    }

    function test_splitter_shareIsAdjustable() public {
        vm.prank(wallet);
        splitter.setHolderShareBps(0);
        _creditSplitter(10 ether);
        splitter.distribute(IERC20(address(quote)));
        assertEq(quote.balanceOf(wallet), 10 ether, "0% share sends everything to owner");

        vm.prank(wallet);
        vm.expectRevert(PopRevenueSplitter.InvalidBps.selector);
        splitter.setHolderShareBps(10_001);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        splitter.setHolderShareBps(1_500);
    }

    function test_splitter_popTokenSetOnce() public {
        PopRewardToken pop = _popLikeToken();
        vm.startPrank(wallet);
        splitter.setPopToken(address(pop));
        vm.expectRevert(PopRevenueSplitter.AlreadySet.selector);
        splitter.setPopToken(address(pop));
        vm.stopPrank();
    }

    function test_splitter_ethGoesToOwner() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(splitter).call{value: 0.3 ether}("");
        assertTrue(ok);
        splitter.distributeEth();
        assertEq(wallet.balance, 0.3 ether);

        vm.expectRevert(PopRevenueSplitter.NothingToDistribute.selector);
        splitter.distributeEth();
    }

    // ------------------------------------------------------------------
    // PopBuybackBurner
    // ------------------------------------------------------------------

    /// @dev Launches a token whose creator fees flow to the burner, bonds
    /// it, trades the bonded pool, and sweeps so quote fees reach the
    /// burner's escrow slot.
    function _burnerToken() internal returns (PopLaunchToken token, PoolKey memory key) {
        PopLaunchFactory.TokenParams memory params = defaultParams("BRN", CashbackConfig(CashbackMode.None, 0), 200);
        params.creatorFeeRecipient = address(burner);
        vm.prank(creator);
        address t = factory.launchToken{value: LAUNCH_FEE}(params, 0, address(quote), 0);
        token = PopLaunchToken(t);
        buyOutAndBond(alice, t);
        assertEq(uint8(factory.getLaunchedToken(t).phase), uint8(LaunchPhase.Bonded));
        key = bondedKeyFor(t);

        // Trade the bonded pool to accrue creator fees, then sweep them to
        // the escrow in quote.
        buyAs(bob, t, 1 ether);
        vm.prank(timelock);
        hook.setFeeSweepOperator(keeper);
        vm.prank(keeper);
        hook.sweepPoolFees(key.toId(), 1);
    }

    function test_burner_distributeSplits75_25() public {
        (PopLaunchToken token,) = _burnerToken();
        uint256 accrued = escrow.balanceOfToken(address(burner), address(quote));
        assertGt(accrued, 0, "trading accrued creator fees to the burner");

        burner.distribute();
        assertEq(quote.balanceOf(wallet), (accrued * 7_500) / 10_000, "75% to owner");
        assertEq(burner.buybackBudget(), accrued - (accrued * 7_500) / 10_000, "25% retained");
        assertEq(address(token).code.length > 0, true);

        vm.expectRevert(PopBuybackBurner.NothingToDistribute.selector);
        burner.distribute();
    }

    function test_burner_convertsWethCreatorFees() public {
        vm.deal(address(this), 1 ether);
        weth.deposit{value: 1 ether}();
        weth.approve(address(escrow), 1 ether);
        escrow.creditToken(address(burner), address(weth), 1 ether);

        burner.convertAndDistribute(0);
        assertEq(quote.balanceOf(wallet), 75_000 ether, "75% of converted to owner");
        assertEq(burner.buybackBudget(), 25_000 ether, "25% retained as budget");
    }

    function test_burner_buyAndBurnSendsEverythingToDead() public {
        (PopLaunchToken token, PoolKey memory key) = _burnerToken();
        vm.prank(wallet);
        burner.setPool(key);
        burner.distribute();

        uint256 budget = burner.buybackBudget();
        assertGt(budget, 0);
        uint256 deadBefore = token.balanceOf(dead);

        vm.prank(keeper);
        uint256 burned = burner.buyAndBurn(budget, 1, block.timestamp);

        assertGt(burned, 0, "bought a nonzero amount");
        assertEq(token.balanceOf(dead) - deadBefore, burned, "every token bought is burned");
        assertEq(burner.buybackBudget(), 0, "budget spent");
        assertEq(token.balanceOf(address(burner)), 0, "burner keeps nothing");
        assertEq(token.balanceOf(keeper), 0, "keeper gets nothing");
    }

    function test_burner_authAndBounds() public {
        (, PoolKey memory key) = _burnerToken();
        burner.distribute();
        uint256 budget = burner.buybackBudget();

        vm.expectRevert(PopBuybackBurner.NotKeeper.selector);
        vm.prank(alice);
        burner.buyAndBurn(budget, 0, block.timestamp);

        vm.expectRevert(PopBuybackBurner.PoolNotSet.selector);
        vm.prank(keeper);
        burner.buyAndBurn(budget, 0, block.timestamp);

        vm.prank(wallet);
        burner.setPool(key);

        vm.expectRevert(PopBuybackBurner.DeadlineExpired.selector);
        vm.prank(keeper);
        burner.buyAndBurn(budget, 0, block.timestamp - 1);

        vm.expectRevert(abi.encodeWithSelector(PopBuybackBurner.InsufficientBudget.selector, budget, budget + 1));
        vm.prank(keeper);
        burner.buyAndBurn(budget + 1, 0, block.timestamp);
    }
}
