import { NextResponse } from "next/server";

import { IMAGE_LIMITS, imageRejection, parseImageMeta } from "@/lib/imageMeta";

/**
 * Pins a launch image to IPFS via Pinata and returns its ipfs:// URI.
 *
 * The Pinata key lives in PINATA_JWT, server-side only: shipping a pinning key
 * to the browser would let anyone pin junk against our account. Without the
 * variable set this route refuses loudly instead of pretending, the same
 * no-mocks rule the rest of the site follows.
 *
 * Validation runs before the configuration check so a user on an unconfigured
 * deployment still learns whether their image would be accepted.
 */

export const runtime = "nodejs";

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: Request) {
  let file: unknown;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return fail(400, "Expected multipart form data with a `file` field.");
  }
  if (!(file instanceof File)) return fail(400, "Expected multipart form data with a `file` field.");
  if (file.size > IMAGE_LIMITS.maxBytes) return fail(413, "Image is over 1 MB.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const meta = parseImageMeta(bytes);
  const rejection = imageRejection(meta, bytes.byteLength);
  if (rejection) return fail(meta ? 400 : 415, rejection);

  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    return fail(503, "Image uploads are not configured on this deployment (PINATA_JWT is unset).");
  }

  const body = new FormData();
  body.append("file", new File([bytes], file.name || "launch-image", { type: file.type }));
  body.append(
    "pinataMetadata",
    JSON.stringify({ name: `pop-launch-${meta!.width}x${meta!.height}` }),
  );

  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body,
  });
  if (!res.ok) {
    return fail(502, `The pinning service rejected the upload (HTTP ${res.status}).`);
  }

  const { IpfsHash } = (await res.json()) as { IpfsHash?: string };
  if (!IpfsHash) return fail(502, "The pinning service returned no content hash.");

  return NextResponse.json({
    uri: `ipfs://${IpfsHash}`,
    width: meta!.width,
    height: meta!.height,
    format: meta!.format,
  });
}
