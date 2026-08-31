import type { Metadata, Viewport } from "next";
import { Inter, Outfit } from "next/font/google";
import Image from "next/image";
import Link from "next/link";

import { Providers } from "./providers";
import { ConnectButtonSlot } from "@/components/ConnectButtonSlot";
import { NavLinks } from "@/components/NavLinks";
import { XLogo } from "@/components/icons";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap" });

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ponsonpons.fun";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "$POP · Pons on Pons",
    template: "%s · $POP",
  },
  description:
    "The launchpad where Pons coins are the liquidity. Launch a token priced in a graduated Pons token, and let every trade burn it, rebate it, or pay its holders.",
  openGraph: {
    title: "$POP · Pons on Pons",
    description: "The launchpad where Pons coins are the liquidity.",
    images: ["/og.jpg"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    site: "@ponsonpons",
    creator: "@ponsonpons",
    title: "$POP · Pons on Pons",
    description: "The launchpad where Pons coins are the liquidity.",
    images: ["/og.jpg"],
  },
  icons: { icon: "/icon.png", apple: "/apple-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#070E09",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <Providers>
          <header className="sticky top-0 z-40 border-b border-edge/70 bg-bg/70 backdrop-blur-xl">
            <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:h-16">
              <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="$POP home">
                <Image
                  src="/logo-mark.png"
                  alt=""
                  width={30}
                  height={30}
                  priority
                  className="h-[26px] w-[26px] sm:h-[30px] sm:w-[30px]"
                />
                <span className="font-display text-[18px] font-semibold tracking-[-0.03em] text-ink sm:text-[20px]">
                  $POP
                </span>
              </Link>

              <NavLinks className="mx-auto hidden sm:flex" />

              <div className="ml-auto flex items-center gap-2 sm:ml-0">
                <a
                  href="https://x.com/ponsonpons"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="$POP on X"
                  className="hidden h-9 w-9 items-center justify-center rounded-full border border-edge text-dim transition-colors hover:border-pop/40 hover:text-ink sm:flex"
                >
                  <XLogo className="h-3.5 w-3.5" />
                </a>
                <ConnectButtonSlot />
              </div>
            </div>

            {/* Mobile: the nav gets its own scrollable strip rather than a menu. */}
            <NavLinks
              className="flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none] sm:hidden [&::-webkit-scrollbar]:hidden"
              mobile
            />
          </header>

          <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">{children}</main>

          <footer className="mx-auto w-full max-w-6xl px-4 pb-12 pt-6">
            <hr className="rule mb-6" />
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
              <div className="flex items-center gap-2.5">
                <Image src="/logo-mark.png" alt="" width={22} height={22} className="opacity-70" />
                <span className="eyebrow">Pons on Pons</span>
              </div>
              <p className="order-last text-center text-[11.5px] text-dim/70 sm:order-none">
                Non-custodial · immutable · liquidity locked forever
              </p>
              <div className="flex items-center gap-1 text-[12px] text-dim">
                <Link href="/docs" className="px-2.5 py-2 transition-colors hover:text-ink">
                  Docs
                </Link>
                <Link href="/docs/proof" className="px-2.5 py-2 transition-colors hover:text-ink">
                  Proof
                </Link>
                <a
                  href="https://x.com/ponsonpons"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="$POP on X"
                  className="flex h-9 w-9 items-center justify-center transition-colors hover:text-ink"
                >
                  <XLogo className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
