// netlify/functions/save-memorial.mjs
//
// Creates or updates a memorial draft. Called by the builder as someone works,
// so nothing is lost when they close the tab and come back another day.
//
// The first save verifies the Stripe reference is genuinely paid; later saves
// just match it against the stored record, so ordinary typing doesn't wait on
// a round trip to Stripe.
//
// Photos are NOT part of this payload — they're uploaded separately via
// upload-photo.mjs and referenced here only by id (see memorial-store.mjs).
// That's what keeps this endpoint small and fast even on a page with a full
// gallery: a story edit no longer re-sends eight photos to re-save one
// sentence.

import {
  putMemorial, ensureRecordForReference, indexMemorial, isValidPhotoId, json,
} from "../lib/memorial-store.mjs";

// Text-only now that photos live elsewhere — this is generous headroom for
// the longest legitimate story plus every other field, not a limit anyone
// should ever bump into honestly.
const MAX_BYTES = 300_000;

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

function cleanInput(body) {
  return {
    name: str(body.name, 60),
    species: str(body.species, 40),
    born: str(body.born, 20),
    died: str(body.died, 20),
    lovedBy: str(body.lovedBy, 80),
    photo: isValidPhotoId(body.photo) ? body.photo : null,
    story: str(body.story, 20_000),
    memories: Array.isArray(body.memories)
      ? body.memories.filter(isValidPhotoId).slice(0, 8)
      : [],
    privacy: ["public", "unlisted", "private"].includes(body.privacy)
      ? body.privacy
      : "unlisted",
    guestbookOn: body.guestbookOn !== false,
    // Defaults to true: moderation stays on unless deliberately turned off.
    moderationOn: body.moderationOn !== false,
    closeAfter: ["never", "8w", "6m", "1y"].includes(body.closeAfter)
      ? body.closeAfter
      : "never",
    celebEnabled: !!body.celebEnabled,
    celebTitle: str(body.celebTitle, 120),
    celebDate: str(body.celebDate, 20),
    celebLoc: str(body.celebLoc, 160),
    celebKids: !!body.celebKids,
    celebMemory: !!body.celebMemory,
    celebDonations: !!body.celebDonations,
  };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const raw = await req.text();
  if (raw.length > MAX_BYTES) {
    return json({ error: "That's too much data to save at once." }, 413);
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  const reference = typeof body.reference === "string" ? body.reference : "";
  const { record, error, status } = await ensureRecordForReference(reference, "memorial");
  if (error) return json({ error }, status);

  Object.assign(record, cleanInput(body));
  await putMemorial(record);
  await indexMemorial(record);

  return json({
    ok: true,
    id: record.id,
    published: record.published,
    slug: record.slug,
    updatedAt: record.updatedAt,
  });
};
