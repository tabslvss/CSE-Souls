import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const AVATAR_DIR = '/data/avatars';
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'gif']);
const AVATAR_SIZE = 256;
// Refuses decompression bombs: small files that expand to huge images in memory.
const MAX_INPUT_PIXELS = 16_000_000;
const MAX_JPEG_SCANS = 100;
const MAX_DECODES_WAITING = 8;
// Cropping a very long, thin image to a square first enlarges it hugely, using gigabytes.
const MAX_ASPECT_RATIO = 8;

/** Checks the file's first bytes, so any other format never even reaches the image decoder. */
function looksLikeAllowedImage(data: Buffer): boolean {
  const isJpeg = data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const isPng = data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isGif = data.length > 6 && ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('latin1'));
  return isJpeg || isPng || isGif;
}

/**
 * A progressive JPEG can hold thousands of scans, each one making the decoder redo its work, so
 * a small file can take minutes. Normal encoders use about 10. This byte pair only ever marks a
 * scan, because the format can't contain it inside image data.
 */
function hasTooManyJpegScans(data: Buffer): boolean {
  if (data[0] !== 0xff || data[1] !== 0xd8) return false;
  let scans = 0;
  for (let i = data.indexOf(0xff); i !== -1 && i < data.length - 1; i = data.indexOf(0xff, i + 1)) {
    if (data[i + 1] === 0xda) {
      scans += 1;
      if (scans > MAX_JPEG_SCANS) return true;
    }
  }
  return false;
}

export class InvalidImageError extends Error {}
/** The server is working through other uploads. Worth trying again shortly. */
export class AvatarBusyError extends Error {}

// Decoding can use hundreds of megabytes, so images are processed strictly one at a time, and
// the line is kept short so waiting uploads can't pile up in memory.
let decodeQueue: Promise<unknown> = Promise.resolve();
let decodesWaiting = 0;

function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  if (decodesWaiting >= MAX_DECODES_WAITING) throw new AvatarBusyError();
  decodesWaiting += 1;
  const result = decodeQueue.then(work, work).finally(() => {
    decodesWaiting -= 1;
  });
  decodeQueue = result.catch(() => undefined);
  return result;
}

/**
 * Trusts the file's actual bytes, not its name or claimed type. Everything is decoded
 * and re-encoded as a fresh PNG, which drops metadata and anything hidden in the file.
 * The image is center-cropped to a square, so it is never stretched.
 */
export async function saveAvatar(upload: Buffer): Promise<string> {
  if (!looksLikeAllowedImage(upload) || hasTooManyJpegScans(upload)) {
    throw new InvalidImageError('Upload a JPG, PNG or GIF image.');
  }
  let png: Buffer;
  try {
    png = await oneAtATime(async () => {
      const image = sharp(upload, { limitInputPixels: MAX_INPUT_PIXELS });
      const { format, width, height } = await image.metadata();
      if (!format || !ALLOWED_FORMATS.has(format)) {
        throw new InvalidImageError('Upload a JPG, PNG or GIF image.');
      }
      if (!width || !height || Math.max(width, height) > MAX_ASPECT_RATIO * Math.min(width, height)) {
        throw new InvalidImageError('That image is too wide or too tall. Use one closer to a square.');
      }
      return image
        .rotate()
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'attention' })
        .png({ compressionLevel: 9 })
        .toBuffer();
    });
  } catch (err) {
    if (err instanceof InvalidImageError || err instanceof AvatarBusyError) throw err;
    throw new InvalidImageError("That file couldn't be read as an image.");
  }

  // A new name for every upload means browsers never show a stale cached picture.
  const filename = `${randomUUID()}.png`;
  await writeFile(path.join(AVATAR_DIR, filename), png, { mode: 0o644 });
  return filename;
}

export async function deleteAvatarFile(filename: string | null | undefined): Promise<void> {
  if (!filename) return;
  // basename is a safeguard. Filenames only ever come from saveAvatar above.
  await unlink(path.join(AVATAR_DIR, path.basename(filename))).catch(() => undefined);
}

export function avatarUrl(filename: string | null | undefined): string | null {
  return filename ? `/avatars/${filename}` : null;
}
