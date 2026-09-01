// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title PopLaunchToken
 * @notice Fixed-supply ERC-20 deployed by PopLaunchFactory for a $POP launch.
 * The entire supply mints directly to the factory, which immediately lays it
 * into the launch's live Uniswap V4 curve pool (and reserves the bonded
 * pool's seed). Anyone, the deployer included, may buy any amount from the
 * pool at any time; the curve's own price impact is the only limit on a
 * large buy.
 *
 * Deliberately nothing else: no owner, no mint, no burn hooks, no pause, no
 * blacklist, no fee-on-transfer, no transfer restrictions of any kind.
 * `deployer` is carried as immutable reference data for off-chain attribution
 * only, and confers no privileges over the token. Anti-snipe protection lives
 * on the hook as a decaying launch-window tax, so the token itself never
 * needs transfer logic.
 */
contract PopLaunchToken is ERC20 {
    struct Socials {
        string twitter;
        string telegram;
        string discord;
        string website;
        string farcaster;
    }

    error ZeroAddress();

    address public immutable deployer;
    address public immutable launchFactory;
    address public immutable supplyRecipient;

    string public logo;
    string public description;

    Socials private _socials;

    /**
     * @notice Creates a launch token and mints its entire supply to the
     * factory, which seeds the curve pool in the same transaction.
     */
    constructor(
        string memory name_,
        string memory symbol_,
        string memory logo_,
        string memory description_,
        Socials memory socials_,
        address deployer_,
        address supplyRecipient_,
        address launchFactory_,
        uint256 supply_
    ) ERC20(name_, symbol_) {
        if (deployer_ == address(0) || supplyRecipient_ == address(0) || launchFactory_ == address(0)) {
            revert ZeroAddress();
        }

        deployer = deployer_;
        // Passed explicitly rather than read from msg.sender: PopLaunchFactory
        // deploys this token indirectly through PopLaunchDeployer to keep its
        // own bytecode under EIP-170's size limit, so msg.sender at
        // construction time would otherwise resolve to that helper.
        launchFactory = launchFactory_;
        supplyRecipient = supplyRecipient_;
        logo = logo_;
        description = description_;
        _socials = socials_;

        _mint(supplyRecipient_, supply_);
    }

    /**
     * @notice Returns the launch token's five social metadata fields.
     */
    function socials()
        external
        view
        returns (
            string memory twitter,
            string memory telegram,
            string memory discord,
            string memory website,
            string memory farcaster
        )
    {
        Socials memory values = _socials;
        return (values.twitter, values.telegram, values.discord, values.website, values.farcaster);
    }

    /**
     * @notice Returns creator and metadata in one launcher-compatible tuple.
     */
    function getTokenInfo()
        external
        view
        returns (
            address tokenDeployer,
            string memory tokenLogo,
            string memory tokenDescription,
            Socials memory tokenSocials
        )
    {
        return (deployer, logo, description, _socials);
    }
}
