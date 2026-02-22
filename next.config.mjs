/** @type {import('next').NextConfig} */
const basePath = process.env.BASE_PATH ?? "";

const nextConfig = {
  reactStrictMode: true,
  output: "export",
  images: {
    unoptimized: true
  },
  ...(basePath ? { basePath, assetPrefix: basePath } : {})
};

export default nextConfig;
