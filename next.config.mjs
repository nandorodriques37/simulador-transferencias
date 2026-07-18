/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // xlsx is only used in server route handlers
    serverComponentsExternalPackages: ["xlsx"],
  },
};

export default nextConfig;
