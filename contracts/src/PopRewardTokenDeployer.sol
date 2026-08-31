// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

import {PopRewardToken} from "./PopRewardToken.sol";

/// @dev The factory getter used to authorize the caller.
interface IPopLaunchDeployerRef {
    function launchDeployer() external view returns (address);
}

/**
 * @title PopRewardTokenDeployer
 * @notice Deploys the `PopRewardToken` variant for launches that chose the
 * HolderRewards cashback mode. It exists as its own contract for the same
 * reason `PopLaunchDeployer` does: embedding a second full token's creation
 * code alongside the first would push that contract past EIP-170's
 * deployed-size limit. It holds no funds, has no owner, and only
 * `PopLaunchDeployer` may call it.
 */
contract PopRewardTokenDeployer {
    error NotLaunchDeployer();

    /// @dev Authorization is read through the factory rather than stored
    /// here: the launch deployer needs this contract's address in its own
    /// constructor, so binding the pair directly would be circular. The
    /// factory's `launchDeployer` is one-time-settable and reads as the zero
    /// address until it is wired, so nothing can call in before then.
    address public immutable factory;

    constructor(address factory_) {
        if (factory_ == address(0)) revert NotLaunchDeployer();
        factory = factory_;
    }

    function launchDeployer() public view returns (address) {
        return IPopLaunchDeployerRef(factory).launchDeployer();
    }

    /**
     * @notice Deploys a reward token at the CREATE2 address `predict` reports
     * for the same inputs.
     */
    function deploy(bytes32 salt, bytes memory creationCode) external returns (address token) {
        address authorized = launchDeployer();
        if (authorized == address(0) || msg.sender != authorized) revert NotLaunchDeployer();
        return Create2.deploy(0, salt, creationCode);
    }

    /**
     * @notice Builds the reward token's creation code. Shared by the deploy
     * and predict paths in `PopLaunchDeployer` so the two can never derive
     * different addresses.
     */
    function creationCodeFor(
        string calldata name_,
        string calldata symbol_,
        string calldata logo_,
        string calldata description_,
        PopRewardToken.Socials calldata socials_,
        address deployer_,
        address curve_,
        address factory_,
        address rewardAsset_,
        uint256 supply_,
        address[] calldata excluded_
    ) external pure returns (bytes memory) {
        return abi.encodePacked(
            type(PopRewardToken).creationCode,
            abi.encode(
                name_,
                symbol_,
                logo_,
                description_,
                socials_,
                deployer_,
                curve_,
                factory_,
                rewardAsset_,
                supply_,
                excluded_
            )
        );
    }

    /**
     * @notice Address `deploy` would produce for `salt` and `creationCode`,
     * derived against this contract as the deploying account.
     */
    function predict(bytes32 salt, bytes memory creationCode) external view returns (address) {
        return Create2.computeAddress(salt, keccak256(creationCode));
    }
}
