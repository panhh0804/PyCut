import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
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
