import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function uploadImageFromUrl(
  imageUrl: string,
  folder: string,
  publicId?: string
): Promise<string> {
  try {
    const result = await cloudinary.uploader.upload(imageUrl, {
      folder: `manga/${folder}`,
      public_id: publicId,
      overwrite: false,
      resource_type: 'image',
      // Fetch directly from URL
      fetch_format: 'auto',
      quality: 'auto',
    });
    return result.secure_url;
  } catch (err: any) {
    // If already exists, build the URL from public_id
    if (err?.error?.http_code === 400 && publicId) {
      return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/manga/${folder}/${publicId}`;
    }
    console.error('Cloudinary upload error:', err.message);
    // Return original URL as fallback
    return imageUrl;
  }
}

export async function uploadImageBuffer(
  buffer: Buffer,
  folder: string,
  publicId: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `manga/${folder}`,
        public_id: publicId,
        overwrite: false,
        resource_type: 'image',
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result!.secure_url);
        }
      }
    );
    stream.end(buffer);
  });
}

export { cloudinary };
