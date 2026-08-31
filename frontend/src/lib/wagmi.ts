"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";

import { robinhoodChain } from "./chain";

export const wagmiConfig = getDefaultConfig({
  appName: "$POP · Pons on Pons",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_ID ?? "pop-dev",
  chains: [robinhoodChain],
  transports: { [robinhoodChain.id]: http() },
  ssr: true,
});
