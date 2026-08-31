// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {PopLocker} from "./PopLocker.sol";

/**
 * @title PopGraduationExecutor
 * @notice Mints the full-range Uniswap V4 position for a graduating $POP
 * launch on PopLaunchFactory's behalf. Split out into its own contract
 * purely so the factory's own bytecode stays under EIP-170's 24576-byte
 * deployed-code limit: the Permit2 approval dance, PositionManager action
 * encoding, and post-mint dust sweep account for a large share of that size
 * on their own. The factory transfers exactly the assets a mint needs here
 * immediately before calling in, so this contract never holds a balance
 * between transactions. Both sides of every $POP pool are ERC-20s, so there
 * is no native-currency branch anywhere. Adapted from the verified
 * PonsV2GraduationExecutor.
 */
contract PopGraduationExecutor {
    using SafeERC20 for IERC20;

    uint256 private constant MINT_DEADLINE_WINDOW = 300;

    error NotFactory();
    error ZeroAddress();
    error MintAmountOverflow();

    event GraduationDustSwept(address indexed launchToken, address indexed currency, uint256 amount);
    event GraduationDustRetained(address indexed launchToken, address indexed currency, uint256 amount);

    IPositionManager public immutable positionManager;
    IAllowanceTransfer public immutable permit2;
    PopLocker public immutable locker;
    address public immutable factory;

    modifier onlyFactory() {
        if (msg.sender != factory) revert NotFactory();
        _;
    }

    constructor(IPositionManager positionManager_, IAllowanceTransfer permit2_, PopLocker locker_, address factory_) {
        if (address(positionManager_) == address(0) || address(permit2_) == address(0)) {
            revert ZeroAddress();
        }
        if (address(locker_) == address(0) || factory_ == address(0)) revert ZeroAddress();
        positionManager = positionManager_;
        permit2 = permit2_;
        locker = locker_;
        factory = factory_;
    }

    /**
     * @notice Mints a full-range position directly to the locker from
     * balances the factory just transferred here, then forwards any
     * post-mint rounding dust on either leg to `protocolFeeRecipient`.
     * @dev Full-range liquidity is derived here from the pool's starting
     * price and the target amounts, rather than by the factory, because the
     * tick and liquidity math inlines a large amount of code that the
     * factory has no room for. The exact amounts SETTLE_PAIR ends up pulling
     * almost always round down slightly against those targets, so the
     * post-mint sweep prevents dust piling up here.
     */
    function mintFullRangePosition(
        address launchToken,
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        uint160 sqrtPriceX96,
        uint256 amount0Max,
        uint256 amount1Max,
        Currency currency0,
        Currency currency1,
        address protocolFeeRecipient
    ) external onlyFactory {
        // MINT_POSITION takes both maxima as uint128, so a larger amount
        // would truncate and settle a position that does not match the
        // reserves the curve was drained of. The factory's preflight already
        // rejects these, but silent truncation is not a property worth
        // delegating to a caller.
        if (amount0Max > type(uint128).max || amount1Max > type(uint128).max) revert MintAmountOverflow();

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            amount0Max,
            amount1Max
        );

        _approvePermit2(Currency.unwrap(currency0), amount0Max);
        _approvePermit2(Currency.unwrap(currency1), amount1Max);

        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            key,
            tickLower,
            tickUpper,
            uint256(liquidity),
            // forge-lint: disable-next-line(unsafe-typecast)
            uint128(amount0Max),
            // forge-lint: disable-next-line(unsafe-typecast)
            uint128(amount1Max),
            address(locker),
            bytes("")
        );
        params[1] = abi.encode(currency0, currency1);

        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp + MINT_DEADLINE_WINDOW);

        _sweepResidualBalance(launchToken, Currency.unwrap(currency0), protocolFeeRecipient);
        _sweepResidualBalance(launchToken, Currency.unwrap(currency1), protocolFeeRecipient);
    }

    /**
     * @dev Grants Permit2 a standard ERC-20 approval, then records a
     * matching Permit2 allowance for the PositionManager: the two-step
     * approval Permit2-based transfers always require from the token owner.
     */
    function _approvePermit2(address token, uint256 amount) private {
        IERC20(token).forceApprove(address(permit2), amount);
        // Amount is a real token balance the factory just transferred here, always far below uint160's range.
        // forge-lint: disable-next-line(unsafe-typecast)
        permit2.approve(
            token, address(positionManager), uint160(amount), uint48(block.timestamp + MINT_DEADLINE_WINDOW)
        );
    }

    /**
     * @dev Sends any leftover balance of `currency` held by this contract to
     * the protocol treasury, or to the locker when the currency is the
     * launch token itself. Routing the launch-token leg to the locker keeps
     * the guarantee that supply which did not reach the pool never enters
     * circulation.
     *
     * A failed sweep is reported rather than thrown. Disposing of rounding
     * dust is incidental to seeding the pool, and letting it revert would
     * leave a launch that has already surrendered its reserves unable to
     * ever complete. Whatever cannot be sent stays here and is carried out
     * by the next graduation that sweeps the same currency.
     */
    function _sweepResidualBalance(address launchToken, address currency, address recipient) private {
        uint256 amount = IERC20(currency).balanceOf(address(this));
        if (amount == 0) return;

        if (currency == launchToken) recipient = address(locker);

        // A low-level call rather than try/catch around IERC20.transfer.
        // `catch` covers a revert inside the callee, but not a failure to
        // decode what it returned, and that decode happens in this frame and
        // propagates. A token that transfers successfully while returning no
        // data would therefore revert the whole graduation, which is
        // precisely the token class the non-throwing design here exists to
        // tolerate.
        (bool ok, bytes memory ret) = currency.call(abi.encodeCall(IERC20.transfer, (recipient, amount)));
        bool swept = ok && (ret.length == 0 || (ret.length == 32 && abi.decode(ret, (bool))));

        if (swept) {
            emit GraduationDustSwept(launchToken, currency, amount);
        } else {
            emit GraduationDustRetained(launchToken, currency, amount);
        }
    }
}
