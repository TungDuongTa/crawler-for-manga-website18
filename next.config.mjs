/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'https', hostname: '**.damconuong.ceo' },
    ],
  },
  // Allow large payloads for crawler API
  api: {
    bodyParser: { sizeLimit: '10mb' },
    responseLimit: false,
  },
};

export default nextConfig;
