import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['10.197.56.244', '10.197.56.199', 'localhost:3000', '127.0.0.1:3000'],
  async redirects() {
    return [
      {
        source: '/',
        destination: '/overview',
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: 'http://127.0.0.1:3001/api/v1/:path*',
      },
    ];
  },
};

export default nextConfig;
