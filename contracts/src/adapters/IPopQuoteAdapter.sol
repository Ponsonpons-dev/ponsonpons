// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @notice Origin adapter for one generation of Pons launchpad. The registry
 * consults an adapter to prove, on-chain, that a candidate quote token is a
 * graduated Pons token and to measure the permanently locked ETH-side
 * liquidity backing it. Adapters are stateless verifiers: they hold no
 * funds, have no owner, and are appended to the registry behind the protocol
 * timelock, adding one can never affect quotes already listed or launches
 * already live, which is what makes new origins (Pons v2 pools, stock-token
 * quotes) an additive change rather than a rewrite.
 */
interface IPopQuoteAdapter {
    /**
     * @notice Verifies `token` against this adapter's origin.
     * @return graduated True when the origin considers the token graduated.
     * @return ethPrincipal ETH-side principal locked in the origin's
     * permanent position for this token, in wei. Locked liquidity only:
     * removable liquidity and donations must not count.
     */
    function verify(address token) external view returns (bool graduated, uint256 ethPrincipal);

    /**
     * @notice Time-weighted price of `token` against ETH over `twapWindow`
     * seconds, read from the origin's canonical locked pool.
     * @return quotePerEth Token base units per 1e18 wei of ETH.
     */
    function quotePerEth(address token, uint32 twapWindow) external view returns (uint256);

    /**
     * @notice The origin's canonical WETH-paired pool for `token`, used by
     * the factory to convert a bonded launch's raised WETH into the quote.
     * @return pool The Uniswap V3 pool address.
     * @return quoteIsToken0 True when `token` sorts below WETH in the pool.
     */
    function conversionPool(address token) external view returns (address pool, bool quoteIsToken0);
}
