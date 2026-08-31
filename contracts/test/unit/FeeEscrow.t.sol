// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PopFeeEscrow} from "../../src/PopFeeEscrow.sol";
import {FeeOnTransferERC20, MockERC20} from "../mocks/MockERC20.sol";
import {Test} from "forge-std/Test.sol";

contract FeeEscrowTest is Test {
    PopFeeEscrow internal escrow;
    MockERC20 internal token;
    address internal funder = makeAddr("funder");
    address internal recipient = makeAddr("recipient");

    function setUp() public {
        escrow = new PopFeeEscrow();
        token = new MockERC20("T", "T", 18);
        token.mint(funder, 1_000 ether);
        vm.prank(funder);
        token.approve(address(escrow), type(uint256).max);
    }

    function test_creditAndClaim() public {
        vm.prank(funder);
        escrow.creditToken(recipient, address(token), 100 ether);
        assertEq(escrow.balanceOfToken(recipient, address(token)), 100 ether);

        vm.prank(recipient);
        escrow.claimToken(address(token), 40 ether);
        assertEq(token.balanceOf(recipient), 40 ether);
        assertEq(escrow.balanceOfToken(recipient, address(token)), 60 ether);

        vm.prank(recipient);
        escrow.claimToken(address(token));
        assertEq(token.balanceOf(recipient), 100 ether);
    }

    function test_cannotOverClaim_orClaimOthers() public {
        vm.prank(funder);
        escrow.creditToken(recipient, address(token), 100 ether);

        vm.prank(recipient);
        vm.expectRevert();
        escrow.claimToken(address(token), 101 ether);

        // A stranger has nothing to claim, even with balances present.
        vm.prank(funder);
        vm.expectRevert(PopFeeEscrow.NothingToClaim.selector);
        escrow.claimToken(address(token));
    }

    function test_feeOnTransfer_creditsObservedDelta() public {
        FeeOnTransferERC20 feeToken = new FeeOnTransferERC20(1_000); // 10% skim
        feeToken.mint(funder, 100 ether);
        vm.startPrank(funder);
        feeToken.approve(address(escrow), type(uint256).max);
        uint256 credited = escrow.creditToken(recipient, address(feeToken), 100 ether);
        vm.stopPrank();

        assertEq(credited, 90 ether);
        assertEq(escrow.balanceOfToken(recipient, address(feeToken)), 90 ether);
    }
}
