/**
 * Minimal image header parser: format + pixel dimensions from raw bytes, no
 * dependencies. Used by the upload route to enforce "square, sane size" on the
 * server, where the client's word for what a file is counts for nothing.
 *
 * Reads only headers, never pixel data. Returns null for anything that is not
 * a well-formed PNG, JPEG, GIF or WebP.
 */

export type ImageMeta = {
  format: "png" | "jpeg" | "gif" | "webp";
  width: number;
  height: number;
};

function u32be(b: Uint8Array, o: number) {
  return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
}
function u16be(b: Uint8Array, o: number) {
  return (b[o] << 8) | b[o + 1];
}
function u16le(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8);
}
function u24le(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
}
function ascii(b: Uint8Array, o: number, n: number) {
  return String.fromCharCode(...b.subarray(o, o + n));
}

function png(b: Uint8Array): ImageMeta | null {
  // Signature, then the IHDR chunk is required to come first.
  if (b.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((v, i) => b[i] === v)) return null;
  if (ascii(b, 12, 4) !== "IHDR") return null;
  return { format: "png", width: u32be(b, 16), height: u32be(b, 20) };
}

function gif(b: Uint8Array): ImageMeta | null {
  if (b.length < 10) return null;
  const head = ascii(b, 0, 6);
  if (head !== "GIF87a" && head !== "GIF89a") return null;
  // Logical screen descriptor. For animated GIFs this is the canvas size.
  return { format: "gif", width: u16le(b, 6), height: u16le(b, 8) };
}

function jpeg(b: Uint8Array): ImageMeta | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  // Walk marker segments until a start-of-frame carries the dimensions.
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) return null;
    const marker = b[o + 1];
    if (marker === 0xff) {
      o++; // fill byte
      continue;
    }
    // Standalone markers with no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      o += 2;
      continue;
    }
    const len = u16be(b, o + 2);
    if (len < 2) return null;
    const isSOF =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      return { format: "jpeg", height: u16be(b, o + 5), width: u16be(b, o + 7) };
    }
    o += 2 + len;
  }
  return null;
}

function webp(b: Uint8Array): ImageMeta | null {
  if (b.length < 30) return null;
  if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8X") {
    // Extended: 24-bit width/height minus one, at fixed offsets.
    return { format: "webp", width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  if (chunk === "VP8 ") {
    // Lossy: frame header starts 3 bytes in, dimensions follow the 9D 01 2A
    // start code as 14-bit values.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { format: "webp", width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    // Lossless: signature byte then 14-bit width/height minus one, bit-packed.
    if (b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return {
      format: "webp",
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

export function parseImageMeta(bytes: Uint8Array): ImageMeta | null {
  const meta = png(bytes) ?? gif(bytes) ?? webp(bytes) ?? jpeg(bytes);
  if (!meta || meta.width <= 0 || meta.height <= 0) return null;
  return meta;
}

/** Shared by the upload route and the drop zone so the two never disagree. */
export const IMAGE_LIMITS = {
  maxBytes: 1024 * 1024,
  minSide: 100,
  maxSide: 1024,
} as const;

/** Returns a human-readable rejection, or null if the image is acceptable. */
export function imageRejection(meta: ImageMeta | null, byteLength: number): string | null {
  if (byteLength > IMAGE_LIMITS.maxBytes) return "Image is over 1 MB.";
  if (!meta) return "Not a PNG, JPEG, GIF or WebP image.";
  if (meta.width !== meta.height) {
    return `Image must be square: got ${meta.width}×${meta.height}. 500×500 is ideal.`;
  }
  if (meta.width < IMAGE_LIMITS.minSide) {
    return `Image is ${meta.width}×${meta.height}; the minimum is ${IMAGE_LIMITS.minSide}×${IMAGE_LIMITS.minSide}.`;
  }
  if (meta.width > IMAGE_LIMITS.maxSide) {
    return `Image is ${meta.width}×${meta.height}; the maximum is ${IMAGE_LIMITS.maxSide}×${IMAGE_LIMITS.maxSide}.`;
  }
  return null;
}
