// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {PopBondingCurve} from "../../src/PopBondingCurve.sol";
import {PopBuybackBurner} from "../../src/PopBuybackBurner.sol";
import {PopLaunchFactory} from "../../src/PopLaunchFactory.sol";
import {PopLaunchToken} from "../../src/PopLaunchToken.sol";
import {PopRevenueSplitter} from "../../src/PopRevenueSplitter.sol";
import {PopRewardToken} from "../../src/PopRewardToken.sol";
import {CashbackConfig, CashbackMode, GraduationPhase, IPopFeeEscrow} from "../../src/interfaces/IPop.sol";

import {MockERC20} from "../mocks/MockERC20.sol";
import {PopFixture} from "../utils/PopFixture.sol";

/**
 * @notice Tests for the two revenue periphery contracts: the platform-wide
 * splitter that pays $POP holders a share of protocol fees, and the buyback
 * burner that turns a fixed slice of $POP's creator fees into burned $POP.
 *
 * These exist because both contracts stand between revenue and its
 * destinations: the assertions pin down that the split ratios hold, that
 * nothing is splittable twice, and that no caller other than the intended
 * ones can move a single unit anywhere unintended.
 */
contract RevenueAndBuybackTest is PopFixture {
    address internal wallet = makeAddr("ownerWallet");
    address internal dead = 0x000000000000000000000000000000000000dEaD;

    PopRevenueSplitter internal splitter;
    PopBuybackBurner internal burner;

    function setUp() public override {
        super.setUp();
        splitter = new PopRevenueSplitter(wallet, IPopFeeEscrow(address(escrow)), IERC20(address(quote)), 1_500);
        burner = new PopBuybackBurner(
            wallet, poolManager, IPopFeeEscrow(address(escrow)), IERC20(address(quote)), keeper, 2_500
        );
    }

    /// @dev Launches the HolderRewards variant (what $POP itself will use)
    /// with a holder as of the buy, so distributions have someone to reach.
    function _popLikeToken() internal returns (PopRewardToken token) {
        address[] memory noExemptions;
        vm.prank(creator);
        (address t,) = factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("POP", CashbackConfig(CashbackMode.HolderRewards, 0), 0),
            0,
            address(quote),
            0,
            0,
            noExemptions
        );
        token = PopRewardToken(t);
        skipSnipeWindow();
        buyAs(alice, PopBondingCurve(token.curve()), 1_000 ether);
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

    function test_splitter_beforePopTokenSet_everythingToOwner() public {
        _creditSplitter(40 ether);
        splitter.distribute(IERC20(address(quote)));
        assertEq(quote.balanceOf(wallet), 40 ether);
    }

    function test_splitter_nonRewardAssetAllToOwner() public {
        PopRewardToken pop = _popLikeToken();
        vm.prank(wallet);
        splitter.setPopToken(address(pop));

        MockERC20 other = new MockERC20("Other", "OTH", 18);
        other.mint(address(this), 10 ether);
        other.approve(address(escrow), 10 ether);
        escrow.creditToken(address(splitter), address(other), 10 ether);

        splitter.distribute(IERC20(address(other)));
        assertEq(other.balanceOf(wallet), 10 ether);
        assertEq(pop.claimable(alice), 0);
    }

    function test_splitter_shareIsAdjustableWithinBounds() public {
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

    /// @dev Launches a token whose creator fees flow to the burner, trades to
    /// generate fees, and graduates it so the pool exists.
    function _burnerToken() internal returns (PopLaunchToken token, PoolKey memory key) {
        address[] memory noExemptions;
        PopLaunchFactory.TokenParams memory params = defaultParams("BRN", CashbackConfig(CashbackMode.None, 0), 200);
        params.creatorFeeRecipient = address(burner);
        vm.prank(creator);
        (address t,) = factory.launchToken{value: LAUNCH_FEE}(params, 0, address(quote), 0, 0, noExemptions);
        token = PopLaunchToken(t);
        buyOut(alice, PopBondingCurve(token.curve()));
        assertEq(uint8(factory.getLaunchedToken(t).phase), uint8(GraduationPhase.Swept));
        vm.prank(bob); // permissionless
        factory.createGraduatedPool(t);
        key = poolKeyFor(t);
    }

    function test_burner_distributeSplits75_25() public {
        (PopLaunchToken token,) = _burnerToken();
        uint256 accrued = escrow.balanceOfToken(address(burner), address(quote));
        assertGt(accrued, 0, "trading accrued creator fees to the burner");

        burner.distribute();
        assertEq(quote.balanceOf(wallet), (accrued * 7_500) / 10_000, "75% to owner");
        assertEq(burner.buybackBudget(), accrued - (accrued * 7_500) / 10_000, "25% retained");
        assertEq(address(token).code.length > 0, true);

        // Nothing new accrued: a second distribute has nothing to split and
        // must not re-split the retained budget.
        vm.expectRevert(PopBuybackBurner.NothingToDistribute.selector);
        burner.distribute();
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

        // Not the keeper.
        vm.expectRevert(PopBuybackBurner.NotKeeper.selector);
        vm.prank(alice);
        burner.buyAndBurn(budget, 0, block.timestamp);

        // Pool not set yet.
        vm.expectRevert(PopBuybackBurner.PoolNotSet.selector);
        vm.prank(keeper);
        burner.buyAndBurn(budget, 0, block.timestamp);

        vm.prank(wallet);
        burner.setPool(key);

        // Stale deadline.
        vm.expectRevert(PopBuybackBurner.DeadlineExpired.selector);
        vm.prank(keeper);
        burner.buyAndBurn(budget, 0, block.timestamp - 1);

        // Over budget.
        vm.expectRevert(abi.encodeWithSelector(PopBuybackBurner.InsufficientBudget.selector, budget, budget + 1));
        vm.prank(keeper);
        burner.buyAndBurn(budget + 1, 0, block.timestamp);

        // minOut enforced.
        vm.expectRevert();
        vm.prank(keeper);
        burner.buyAndBurn(budget, type(uint256).max, block.timestamp);
    }

    function test_burner_setPoolValidatesQuoteAndSetsOnce() public {
        (, PoolKey memory key) = _burnerToken();

        MockERC20 a = new MockERC20("A", "A", 18);
        MockERC20 b = new MockERC20("B", "B", 18);
        (Currency c0, Currency c1) = address(a) < address(b)
            ? (Currency.wrap(address(a)), Currency.wrap(address(b)))
            : (Currency.wrap(address(b)), Currency.wrap(address(a)));
        PoolKey memory bogus =
            PoolKey({currency0: c0, currency1: c1, fee: 0, tickSpacing: 200, hooks: IHooks(address(hook))});

        vm.startPrank(wallet);
        vm.expectRevert(PopBuybackBurner.QuoteNotInPool.selector);
        burner.setPool(bogus);

        burner.setPool(key);
        vm.expectRevert(PopBuybackBurner.AlreadySet.selector);
        burner.setPool(key);
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        burner.setKeeper(alice);
    }
}
