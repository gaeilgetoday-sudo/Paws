// netlify/functions/save-memorial.mjs
//
// Creates or updates a memorial draft. Called by the builder as someone works,
// so nothing is lost when they close the tab and come back another day.
//
// The first save verifies the Stripe reference is genuinely paid; later saves
// just match it against the stored record, so ordinary typing doesn't wait on
// a round trip to Stripe.

import {
  getMemorial, putMemorial, findByReference, verifyPaidReference,
  indexMemorial, newId, json,
} from "../lib/memorial-store.mjs";

// Guards against a runaway payload — photos are resized in the browser first,
// so a legitimate memorial lands well under this.
const MAX_BYTES = 12 * 1024 * 1024;

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

function cleanInput(body) {
  return {
    name: str(body.name, 60),
    species: str(body.species, 40),
    born: str(body.born, 20),
    died: str(body.died, 20),
    lovedBy: str(body.lovedBy, 80),
    photo: str(body.photo, 4_000_000) || null,
    story: str(body.story, 20_000),
    memories: Array.isArray(body.memories)
      ? body.memories.filter((m) => typeof m === "string").slice(0, 8)
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
  if (!reference) return json({ error: "Missing reference." }, 401);

  let record = await findByReference(reference);

  if (!record) {
    // First save for this purchase — this is the one time we ask Stripe.
    const paid = await verifyPaidReference(reference);
    if (!paid) return json({ error: "This purchase couldn't be verified." }, 402);

    record = {
      id: newId(),
      reference,
      ownerEmail: typeof body.email === "string" ? body.email.slice(0, 160) : null,
      createdAt: new Date().toISOString(),
      published: false,
      slug: null,
      candles: 0,
    };
  }

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
