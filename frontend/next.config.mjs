/**
 * @coinbase/cdp-sdk (pulled in transitively by wagmi's connectors, via
 * @base-org/account) declares the @x402/* payment packages as *optional* peer
 * dependencies, so npm correctly does not install them, but it still imports
 * them unconditionally from its x402 modules, which breaks a clean webpack
 * build. That code path is dead for us: this app never touches x402 payments.
 * Stubbing the imports is preferable to installing four unused packages just
 * to satisfy a resolver.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "ipfs.io" },
      { protocol: "https", hostname: "*.mypinata.cloud" },
      { protocol: "https", hostname: "w3s.link" },
    ],
  },
  // /proof moved under /docs; keep anything already linking to it working.
  async redirects() {
    return [{ source: "/proof", destination: "/docs/proof", permanent: true }];
  },
  // `webpack` comes from Next's bundled copy. it is not a direct dependency.
  webpack: (config, { webpack }) => {
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^@x402\// }));
    return config;
  },
};

export default nextConfig;
