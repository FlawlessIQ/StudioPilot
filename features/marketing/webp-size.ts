/**
 * The pixel size of a WebP file, read from its header: the shot list writes it
 * into features/marketing/screens.json so every <img> on the site carries its
 * width and height (no layout shift), and tests/marketing-media-budget.test.ts
 * checks the two still agree.
 *
 * Covers the three WebP layouts ffmpeg's libwebp can write: lossy (VP8),
 * lossless (VP8L) and extended (VP8X).
 */
export function webpSize(file: Uint8Array): { width: number; height: number } {
  const ascii = (start: number, length: number) => String.fromCharCode(...file.subarray(start, start + length));
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP") throw new Error("not a WebP file");
  const chunk = ascii(12, 4);
  const u16 = (at: number) => file[at]! | (file[at + 1]! << 8);
  const u24 = (at: number) => file[at]! | (file[at + 1]! << 8) | (file[at + 2]! << 16);
  if (chunk === "VP8X") return { width: u24(24) + 1, height: u24(27) + 1 };
  if (chunk === "VP8 ") return { width: u16(26) & 0x3fff, height: u16(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = file[21]! | (file[22]! << 8) | (file[23]! << 16) | (file[24]! << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  throw new Error(`unknown WebP chunk ${chunk}`);
}
