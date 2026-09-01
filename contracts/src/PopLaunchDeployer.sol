// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

import {PopLaunchToken} from "./PopLaunchToken.sol";
import {PopRewardToken} from "./PopRewardToken.sol";
import {PopRewardTokenDeployer} from "./PopRewardTokenDeployer.sol";
import {CashbackConfig, CashbackMode} from "./interfaces/IPop.sol";

/// @dev The factory getters this deployer reads to assemble a reward
/// token's permanently excluded set. All are immutable or one-time-wired on
/// the factory, so the set (and therefore the token's CREATE2 address) is
/// stable for a given launch.
interface IPopFactoryRefs {
    function hook() external view returns (address);
    function locker() external view returns (address);
    function poolManager() external view returns (address);
}

/**
 * @notice Every input PopLaunchFactory hands the deployer to stand up one
 * launch token. Grouped into a single calldata struct rather than a flat
 * parameter list so the deployer stays inside the EVM's 16-slot stack window
 * when compiled without the IR pipeline, which is the mode `forge coverage`
 * uses.
 */
struct LaunchDeployment {
    // The bond quote the launch will convert into at bonding; the reward
    // asset of the HolderRewards token variant.
    address quoteToken;
    address originalDeployer;
    CashbackConfig cashback;
    uint256 supply;
    // Creator-chosen CREATE2 salt, forwarded from TokenParams. The factory
    // authenticates `originalDeployer`, which gives each initiating account
    // its own salt space even when it names a separate fee recipient.
    bytes32 salt;
    string name;
    string symbol;
    string logo;
    string description;
    PopLaunchToken.Socials socials;
}

/**
 * @title PopLaunchDeployer
 * @notice Deploys the launch token for one $POP launch on PopLaunchFactory's
 * behalf. Split out into its own contract purely so the factory's own
 * bytecode stays under EIP-170's 24576-byte deployed-code limit: embedding a
 * full contract's creation code via `new` inside the factory itself is the
 * single largest contributor to its size. The token still records the real
 * factory's address explicitly (never this deployer's) and mints its supply
 * to the factory, which lays it into the launch's live V4 curve pool in the
 * same transaction. Adapted from the verified PonsV2LaunchDeployer.
 */
contract PopLaunchDeployer {
    // Metadata is stored on the token and read back by unbounded-return view
    // functions, so an unbounded write here becomes a permanently unreadable
    // token: `socials()` returns all five strings at once and would run out
    // of gas or time out an RPC node. Bounding the write is the only place
    // the limit can be enforced, since the strings are immutable afterwards.
    uint256 private constant MAX_NAME_LENGTH = 64;
    uint256 private constant MAX_SYMBOL_LENGTH = 16;
    uint256 private constant MAX_LOGO_LENGTH = 512;
    uint256 private constant MAX_DESCRIPTION_LENGTH = 2048;
    uint256 private constant MAX_SOCIAL_LENGTH = 256;

    error NotFactory();
    error MetadataTooLong();

    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;

    address public immutable factory;
    /// @notice Deploys the HolderRewards token variant; see that contract
    /// for why it is not inlined here.
    PopRewardTokenDeployer public immutable rewardTokenDeployer;

    modifier onlyFactory() {
        if (msg.sender != factory) revert NotFactory();
        _;
    }

    constructor(address factory_, PopRewardTokenDeployer rewardTokenDeployer_) {
        if (factory_ == address(0)) revert NotFactory();
        factory = factory_;
        rewardTokenDeployer = rewardTokenDeployer_;
    }

    /**
     * @notice Deploys a fresh launch token and returns its address. The
     * token is told `factory` (not this deployer) is its factory, and mints
     * its whole supply to the factory.
     *
     * @dev Deployed with CREATE2 rather than CREATE so the address does not
     * depend on this deployer's nonce, and therefore on the order launches
     * happen to land in. Under CREATE2 the address is a function of the salt
     * and the creation code, and the creation code carries every constructor
     * argument, so an address can only ever hold the exact launch it was
     * computed from.
     *
     * Reverts through `Create2` with `FailedDeployment` when the token
     * already exists, which is the same creator reusing a salt on otherwise
     * identical terms. Callers can test for it in advance with
     * `predictLaunchAddress`.
     */
    function deployLaunch(LaunchDeployment calldata params) external onlyFactory returns (address token) {
        _requireMetadataWithinLimits(params);

        bytes32 salt = _launchSalt(params);
        if (params.cashback.mode == CashbackMode.HolderRewards) {
            token = rewardTokenDeployer.deploy(salt, _rewardTokenCreationCode(params));
        } else {
            token = Create2.deploy(0, salt, _tokenCreationCode(params));
        }
    }

    /**
     * @notice Returns the address `deployLaunch` would produce for `params`,
     * without deploying anything.
     * @dev Lets a caller confirm a launch will land where it expects (this
     * is what the create page's vanity miner verifies against), and lets the
     * launch path be checked for a salt the creator has already used.
     */
    function predictLaunchAddress(LaunchDeployment calldata params) external view returns (address token) {
        bytes32 salt = _launchSalt(params);
        token = params.cashback.mode == CashbackMode.HolderRewards
            ? rewardTokenDeployer.predict(salt, _rewardTokenCreationCode(params))
            : Create2.computeAddress(salt, keccak256(_tokenCreationCode(params)));
    }

    /**
     * @dev Creation code for the HolderRewards token variant, including the
     * permanently excluded set: the contracts that structurally hold supply
     * and could never claim, so rewards routed to them would be stranded.
     */
    function _rewardTokenCreationCode(LaunchDeployment calldata params) private view returns (bytes memory) {
        address[] memory excludedSet = new address[](5);
        excludedSet[0] = factory;
        excludedSet[1] = IPopFactoryRefs(factory).hook();
        excludedSet[2] = IPopFactoryRefs(factory).locker();
        excludedSet[3] = IPopFactoryRefs(factory).poolManager();
        excludedSet[4] = DEAD;

        return rewardTokenDeployer.creationCodeFor(
            params.name,
            params.symbol,
            params.logo,
            params.description,
            PopRewardToken.Socials({
                twitter: params.socials.twitter,
                telegram: params.socials.telegram,
                discord: params.socials.discord,
                website: params.socials.website,
                farcaster: params.socials.farcaster
            }),
            params.originalDeployer,
            factory,
            factory,
            params.quoteToken,
            params.supply,
            excludedSet
        );
    }

    /**
     * @dev CREATE2 salt for one launch: the creator's chosen salt namespaced
     * by the factory-authenticated initiating account. The creator fee
     * recipient is intentionally not the namespace because any caller may
     * name an arbitrary payout address and could otherwise squat another
     * creator's deployment.
     */
    function _launchSalt(LaunchDeployment calldata params) private pure returns (bytes32) {
        return keccak256(abi.encode(params.originalDeployer, params.salt));
    }

    /**
     * @dev Creation code for the launch's token, minting to the factory.
     * Shared by the deploy and predict paths so the two can never derive
     * different addresses.
     */
    function _tokenCreationCode(LaunchDeployment calldata params) private view returns (bytes memory) {
        return abi.encodePacked(
            type(PopLaunchToken).creationCode,
            abi.encode(
                params.name,
                params.symbol,
                params.logo,
                params.description,
                params.socials,
                params.originalDeployer,
                factory,
                factory,
                params.supply
            )
        );
    }

    /**
     * @notice Reverts unless every metadata string fits its length cap.
     * @dev The factory already rejects an empty name or symbol, so only the
     * upper bound is checked here.
     */
    function _requireMetadataWithinLimits(LaunchDeployment calldata params) private pure {
        if (
            bytes(params.name).length > MAX_NAME_LENGTH || bytes(params.symbol).length > MAX_SYMBOL_LENGTH
                || bytes(params.logo).length > MAX_LOGO_LENGTH
                || bytes(params.description).length > MAX_DESCRIPTION_LENGTH
        ) {
            revert MetadataTooLong();
        }
        if (
            bytes(params.socials.twitter).length > MAX_SOCIAL_LENGTH
                || bytes(params.socials.telegram).length > MAX_SOCIAL_LENGTH
                || bytes(params.socials.discord).length > MAX_SOCIAL_LENGTH
                || bytes(params.socials.website).length > MAX_SOCIAL_LENGTH
                || bytes(params.socials.farcaster).length > MAX_SOCIAL_LENGTH
        ) {
            revert MetadataTooLong();
        }
    }
}
