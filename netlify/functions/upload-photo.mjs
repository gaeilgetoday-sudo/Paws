// netlify/functions/upload-photo.mjs
//
// Uploads one photo for a memorial, storing it as its own Blob object (see
// memorial-store.mjs) rather than embedding it in the memorial's JSON
// record. Called once per photo from the builder, right after the browser
// resizes it — not repeated on every autosave the way the old inline-Base64
// approach was.

import { ensureRecordForReference, putPhoto, checkRateLimit, json } from "../lib/memorial-store.mjs";

// Generous headroom over what the browser's own resize step produces
// (900px hero / 1200px memories, JPEG ~0.82-0.85 quality) — this is a
// backstop against a modified or malicious client, not the normal path.
const MAX_BYTES = 4_500_000;
const ALLOWED_TYPES = { "image/jpeg": true, "image/png": true, "image/webp": true };

function decodeDataUrl(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl || "");
  if (!match) return null;
  const [, contentType, b64] = match;
  let bytes;
  try {
    bytes = Buffer.from(b64, "base64");
  } catch {
    return null;
  }
  return { contentType, bytes };
}

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  const reference = typeof body.reference === "string" ? body.reference : "";
  const { record, error, status } = await ensureRecordForReference(reference, "memorial");
  if (error) return json({ error }, status);

  // Keyed by the memorial's reference, not IP — a reference is scarce (it
  // cost €29), so this mainly guards against a bug or a compromised session
  // hammering the endpoint, not casual abuse from a shared network.
  const allowed = await checkRateLimit(`upload-photo:${record.id}`, reference, {
    max: 40,
    windowMs: 60 * 60 * 1000,
  });
  if (!allowed) return json({ error: "Too many uploads — please wait a bit before adding more." }, 429);

  const decoded = decodeDataUrl(body.dataUrl);
  if (!decoded || !ALLOWED_TYPES[decoded.contentType]) {
    return json({ error: "That doesn't look like a supported image." }, 400);
  }
  if (decoded.bytes.length > MAX_BYTES) {
    return json({ error: "That photo is too large." }, 413);
  }

  const id = await putPhoto(record.id, decoded.bytes, decoded.contentType);
  return json({ ok: true, id });
};
