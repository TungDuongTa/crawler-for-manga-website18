/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "**.damconuong.lol" },
    ],
  },
  // Allow large payloads for crawler API
  api: {
    bodyParser: { sizeLimit: "10mb" },
    responseLimit: false,
  },
  experimental: {
    serverComponentsExternalPackages: [
      "playwright",
      "playwright-extra",
      "puppeteer-extra-plugin-stealth",
      "clone-deep",
      "merge-deep",
    ],
  },
};

export default nextConfig;
