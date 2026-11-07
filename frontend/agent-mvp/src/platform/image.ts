import { VISION_IMAGE } from '../agent/skills/report-vision';

/**
 * Read a photo the person chose, downscale it and re-encode as a small JPEG data URL so it is
 * cheap to send to the on-device model and over the Flutter bridge. The original file never
 * leaves the page. Throws when the file is not a usable image.
 */
const MAX_EDGE = 1280;
const QUALITY = 0.72;

export async function pickReportPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('NOT_AN_IMAGE');
  // 20 MB guard before decoding; the re-encoded output is far smaller and checked again below.
  if (file.size > 20 * 1024 * 1024) throw new Error('IMAGE_TOO_LARGE');
  const url = URL.createObjectURL(file);
  try {
    const image = await load(url);
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('CANVAS_UNAVAILABLE');
    context.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
    if (!VISION_IMAGE.pattern.test(dataUrl) || dataUrl.length > VISION_IMAGE.maxDataUrlLength)
      throw new Error('IMAGE_ENCODE_FAILED');
    return dataUrl;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('IMAGE_DECODE_FAILED'));
    image.src = url;
  });
}
