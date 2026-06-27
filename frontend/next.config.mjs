/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    return [{ source: "/api/:path*", destination: `${backendUrl}/:path*` }];
  }
};

export default nextConfig;
