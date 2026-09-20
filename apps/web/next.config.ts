import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // packages/shared is consumed through its built `exports` map, exactly as
  // every other consumer does (§3.3). No transpilePackages: the source-only
  // model is the one §3.3 rejects.
};

export default nextConfig;
