import { describe, it, expect } from 'vitest';
import { imageMime, readImageMeta } from './meta';

const u8 = (...bytes: number[]) => new Uint8Array(bytes);
const be32 = (n: number) => [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];

describe('imageMime', () => {
  it('maps extensions case-insensitively', () => {
    expect(imageMime('A.PNG')).toBe('image/png');
    expect(imageMime('photo.jpeg')).toBe('image/jpeg');
    expect(imageMime('notes.txt')).toBeNull();
  });
});

describe('readImageMeta', () => {
  it('parses PNG IHDR (RGBA 8-bit)', () => {
    const png = u8(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82,
      ...be32(800), ...be32(600), 8, 6, 0, 0, 0, 0);
    expect(readImageMeta(png, 'image/png')).toEqual({
      width: 800, height: 600, bitDepth: 8, channels: 4, bitsPerPixel: 32,
    });
  });

  it('parses GIF logical screen descriptor', () => {
    const gif = u8(71, 73, 70, 56, 57, 97, 0x40, 0x01, 0xf0, 0x00, 0x87, 0, 0);
    expect(readImageMeta(gif, 'image/gif')).toEqual({
      width: 320, height: 240, bitDepth: 8, channels: null, bitsPerPixel: 8,
    });
  });

  it('parses JPEG SOF0', () => {
    const jpeg = u8(0xff, 0xd8,
      0xff, 0xe0, 0, 4, 0, 0,
      0xff, 0xc0, 0, 17, 8, 0x01, 0x02, 0x02, 0x00, 3, 0, 0, 0, 0, 0, 0);
    expect(readImageMeta(jpeg, 'image/jpeg')).toEqual({
      width: 512, height: 258, bitDepth: 8, channels: 3, bitsPerPixel: 24,
    });
  });

  it('parses BMP info header', () => {
    const bmp = new Uint8Array(54);
    bmp[0] = 0x42; bmp[1] = 0x4d;
    bmp[18] = 0x20; bmp[19] = 0x03;
    bmp[22] = 0x58; bmp[23] = 0x02;
    bmp[28] = 24;
    expect(readImageMeta(bmp, 'image/bmp')).toEqual({
      width: 800, height: 600, bitDepth: 24, channels: 3, bitsPerPixel: 24,
    });
  });

  it('returns null for unsupported formats', () => {
    expect(readImageMeta(u8(1, 2, 3), 'image/webp')).toBeNull();
  });
});
