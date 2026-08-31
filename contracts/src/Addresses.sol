// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title RobinhoodChainAddresses
 * @notice Canonical addresses on Robinhood Chain mainnet (chain id 4663),
 * verified against live chain state and the Uniswap deployment registry
 * during Phase 0 discovery (docs/ARCHITECTURE.md). This is the single
 * source of truth the deploy scripts and fork tests read.
 */
library RobinhoodChainAddresses {
    uint256 internal constant CHAIN_ID = 4663;

    // --- Uniswap (canonical deployments) ---
    address internal constant UNISWAP_V4_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant UNISWAP_V4_POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant UNISWAP_V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;

    // --- Chain basics ---
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    // --- Pons v1 (origin of the graduated quote tokens) ---
    address internal constant PONS_V1_FACTORY = 0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB;
    address internal constant PONS_V1_LEGACY_FACTORY = 0x0c37a24F5D23A486FA692d1500881d698B1F77a4;

    // --- Reference quote tokens (graduated Pons v1 tokens) ---
    address internal constant PONS = 0x39dBED3a2bd333467115dE45665cC57F813C4571;
    address internal constant HMM = 0x7FE995a80075dF3Dc8Ae11A9b82c7FE4202CD87f;
    address internal constant DELTA = 0xe8ffd7e24187F72afB08d75B1bb13088A989a791;
}
