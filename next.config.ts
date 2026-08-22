import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  serverExternalPackages: [
    '@remotion/bundler',
    '@remotion/renderer',
    '@earendil-works/pi-agent-core',
    '@earendil-works/pi-ai',
    'hyperframes',
  ],
};

export default nextConfig;
