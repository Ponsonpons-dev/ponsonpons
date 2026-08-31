/**
 * Tests for the launch-image header parser and the square/size rules.
 *
 * Two layers: hand-built headers exercise each format branch precisely, and
 * the repository's own brand assets (real files produced by real encoders)
 * catch the class of bug hand-built fixtures share with the parser.
 *
 * Runs on Node's built-in test runner with type stripping:  npm run test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { IMAGE_LIMITS, imageRejection, parseImageMeta } from "./imageMeta.ts";

function pngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(26);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  b.set([0, 0, 0, 13], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

function gifHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(13);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
  new DataView(b.buffer).setUint16(6, width, true);
  new DataView(b.buffer).setUint16(8, height, true);
  return b;
}

function jpegHeader(width: number, height: number): Uint8Array {
  // SOI, an APP0 to prove segment walking works, then SOF0.
  const b = new Uint8Array(2 + 4 + 14 + 11);
  let o = 0;
  b.set([0xff, 0xd8], o); o += 2;
  b.set([0xff, 0xe0, 0x00, 0x10], o); o += 4 + 14; // APP0, length 16
  b.set([0xff, 0xc0, 0x00, 0x09, 0x08], o);
  new DataView(b.buffer).setUint16(o + 5, height);
  new DataView(b.buffer).setUint16(o + 7, width);
  return b;
}

function webpLossyHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  b.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  b.set([0x56, 0x50, 0x38, 0x20], 12); // "VP8 "
  b.set([0x9d, 0x01, 0x2a], 23);
  new DataView(b.buffer).setUint16(26, width, true);
  new DataView(b.buffer).setUint16(28, height, true);
  return b;
}

function webpLosslessHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  b.set([0x56, 0x50, 0x38, 0x4c], 12); // "VP8L"
  b[20] = 0x2f;
  const bits = (width - 1) | ((height - 1) << 14);
  b[21] = bits & 0xff;
  b[22] = (bits >> 8) & 0xff;
  b[23] = (bits >> 16) & 0xff;
  b[24] = (bits >> 24) & 0xff;
  return b;
}

test("parses each format's dimensions from hand-built headers", () => {
  assert.deepEqual(parseImageMeta(pngHeader(500, 500)), { format: "png", width: 500, height: 500 });
  assert.deepEqual(parseImageMeta(gifHeader(200, 200)), { format: "gif", width: 200, height: 200 });
  assert.deepEqual(parseImageMeta(jpegHeader(512, 384)), {
    format: "jpeg",
    width: 512,
    height: 384,
  });
  assert.deepEqual(parseImageMeta(webpLossyHeader(100, 100)), {
    format: "webp",
    width: 100,
    height: 100,
  });
  assert.deepEqual(parseImageMeta(webpLosslessHeader(1024, 1024)), {
    format: "webp",
    width: 1024,
    height: 1024,
  });
});

test("parses the repository's real encoder output", () => {
  const asset = (name: string) =>
    parseImageMeta(new Uint8Array(readFileSync(join(import.meta.dirname, "../../public", name))));
  assert.deepEqual(asset("icon.png"), { format: "png", width: 64, height: 64 });
  assert.deepEqual(asset("logo-mark.png"), { format: "png", width: 420, height: 420 });
  // JPEGs from a real pipeline carry APP/quantization segments before the SOF.
  assert.deepEqual(asset("banner.jpg"), { format: "jpeg", width: 1600, height: 533 });
  assert.deepEqual(asset("og.jpg"), { format: "jpeg", width: 1200, height: 630 });
});

test("rejects what is not an image", () => {
  assert.equal(parseImageMeta(new Uint8Array(0)), null);
  assert.equal(parseImageMeta(new TextEncoder().encode("<svg></svg>")), null);
  assert.equal(parseImageMeta(new TextEncoder().encode("GIF89a")), null); // truncated
  const notPng = pngHeader(10, 10);
  notPng[13] = 0x58; // corrupt the IHDR tag
  assert.equal(parseImageMeta(notPng), null);
});

test("enforces square within 100 to 1024 px and 1 MB", () => {
  const ok = (w: number, h: number) =>
    imageRejection(parseImageMeta(pngHeader(w, h)), 1000);
  assert.equal(ok(500, 500), null);
  assert.equal(ok(IMAGE_LIMITS.minSide, IMAGE_LIMITS.minSide), null);
  assert.equal(ok(IMAGE_LIMITS.maxSide, IMAGE_LIMITS.maxSide), null);
  assert.match(ok(500, 501)!, /square/);
  assert.match(ok(99, 99)!, /minimum/);
  assert.match(ok(1025, 1025)!, /maximum/);
  assert.match(imageRejection(null, 10)!, /Not a PNG/);
  assert.match(imageRejection(parseImageMeta(pngHeader(500, 500)), IMAGE_LIMITS.maxBytes + 1)!, /1 MB/);
});
