export interface ImageMeta {
  width: number;
  height: number;
  bitDepth: number | null;
  channels: number | null;
  bitsPerPixel: number | null;
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
};

export function imageMime(name: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? null;
}

export function isImageName(name: string): boolean {
  return imageMime(name) !== null;
}

const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const le32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

function pngMeta(b: Uint8Array): ImageMeta | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 26 || !sig.every((v, i) => b[i] === v)) return null;
  const colorType = b[25];
  const bitDepth = b[24];
  const channels = colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : null;
  return {
    width: be32(b, 16),
    height: be32(b, 20),
    bitDepth,
    channels,
    bitsPerPixel: channels ? bitDepth * channels : bitDepth,
  };
}

function jpegMeta(b: Uint8Array): ImageMeta | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = be16(b, i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const bitDepth = b[i + 4];
      const channels = b[i + 9];
      return {
        width: be16(b, i + 7),
        height: be16(b, i + 5),
        bitDepth,
        channels,
        bitsPerPixel: bitDepth * channels,
      };
    }
    i += 2 + len;
  }
  return null;
}

function gifMeta(b: Uint8Array): ImageMeta | null {
  if (b.length < 13) return null;
  const sig = String.fromCharCode(b[0], b[1], b[2], b[3], b[4], b[5]);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;
  const bitDepth = (b[10] & 7) + 1;
  return {
    width: le16(b, 6),
    height: le16(b, 8),
    bitDepth,
    channels: null,
    bitsPerPixel: bitDepth,
  };
}

function bmpMeta(b: Uint8Array): ImageMeta | null {
  if (b.length < 30 || b[0] !== 0x42 || b[1] !== 0x4d) return null;
  const bitDepth = le16(b, 28);
  return {
    width: le32(b, 18),
    height: Math.abs(le32(b, 22) | 0),
    bitDepth,
    channels: bitDepth === 32 ? 4 : bitDepth === 24 ? 3 : null,
    bitsPerPixel: bitDepth,
  };
}

export function readImageMeta(bytes: Uint8Array, mime: string): ImageMeta | null {
  if (mime === 'image/png') return pngMeta(bytes);
  if (mime === 'image/jpeg') return jpegMeta(bytes);
  if (mime === 'image/gif') return gifMeta(bytes);
  if (mime === 'image/bmp') return bmpMeta(bytes);
  return null;
}
