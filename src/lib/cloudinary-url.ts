const AUTO_ECO_TRANSFORM = "f_auto,q_auto:eco";
const CLOUDINARY_HOST = "res.cloudinary.com";
const UPLOAD_MARKER = "/image/upload/";

export function toCloudinaryAutoEcoUrl(url: string): string {
  if (!url || !url.includes(CLOUDINARY_HOST)) return url;
  if (!url.includes(UPLOAD_MARKER)) return url;
  if (url.includes(`${UPLOAD_MARKER}${AUTO_ECO_TRANSFORM}/`)) return url;

  return url.replace(
    UPLOAD_MARKER,
    `${UPLOAD_MARKER}${AUTO_ECO_TRANSFORM}/`,
  );
}

