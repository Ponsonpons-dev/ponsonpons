"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

import { shortAddr } from "@/lib/format";

/**
 * RainbowKit's stock button is a different design system wearing our accent
 * colour. This renders the same behaviour with our own glass chrome, and
 * collapses to just the address on small screens.
 */
export function ConnectButtonSlot() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        return (
          <div
            aria-hidden={!ready}
            className={ready ? "flex items-center gap-2" : "pointer-events-none select-none opacity-0"}
          >
            {!connected ? (
              <button onClick={openConnectModal} className="btn-pop px-4 py-2 sm:px-5">
                Connect
              </button>
            ) : chain.unsupported ? (
              <button onClick={openChainModal} className="btn-ghost border-down/40 px-4 py-2 text-down">
                Wrong network
              </button>
            ) : (
              <>
                <button
                  onClick={openChainModal}
                  aria-label="Switch network"
                  className="hidden h-9 items-center gap-1.5 rounded-full border border-edge bg-ink/[0.04] px-3 text-[12.5px] text-dim transition-colors hover:text-ink sm:flex"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-pop shadow-[0_0_6px_rgb(20_216_44_/_0.8)]" />
                  {chain.name}
                </button>
                <button onClick={openAccountModal} className="btn-ghost px-3.5 py-2 font-mono text-[12.5px]">
                  {shortAddr(account.address)}
                </button>
              </>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
