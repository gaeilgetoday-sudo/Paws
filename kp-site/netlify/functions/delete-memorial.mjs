// netlify/functions/delete-memorial.mjs
//
// Removing a memorial page. Three actions:
//
//   delete     hides the page immediately, keeps the data for 30 days
//   undo       brings it back, any time inside those 30 days
//   purge      removes everything now, permanently, no waiting
//
// "purge" requires the pet's name typed back exactly. Not to make it hard —
// to make it deliberate. It's the difference between a mis-click and a
// decision.
//
// Deleting frees the original purchase to make a new page. Someone who set up
// the wrong pet, or wants to start again, shouldn't have to pay twice.

import {
  authorise, softDelete, undoDelete, purgeMemorial, isDeleted,
  GRACE_DAYS, json,
} from "../lib/memorial-store.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  const { record, error, status } = await authorise(body.reference);
  if (error) return json({ error }, status);

  const action = body.action;

  if (action === "delete") {
    if (isDeleted(record)) {
      return json({ ok: true, deletedAt: record.deletedAt, purgeAfter: record.purgeAfter });
    }
    await softDelete(record);
    return json({
      ok: true,
      deletedAt: record.deletedAt,
      purgeAfter: record.purgeAfter,
      graceDays: GRACE_DAYS,
    });
  }

  if (action === "undo") {
    if (!isDeleted(record)) return json({ ok: true, restored: true });
    await undoDelete(record);
    return json({ ok: true, restored: true });
  }

  if (action === "purge") {
    // Compared loosely — a trailing space or different capitalisation is not
    // a reason to refuse someone who has clearly made up their mind.
    const typed = String(body.confirmName || "").trim().toLowerCase();
    const actual = String(record.name || "").trim().toLowerCase();
    if (!actual) {
      // An unnamed draft has nothing to type back; nothing meaningful is lost.
      await purgeMemorial(record);
      return json({ ok: true, purged: true });
    }
    if (typed !== actual) {
      return json({ error: "That name doesn't match." }, 400);
    }
    await purgeMemorial(record);
    return json({ ok: true, purged: true });
  }

  return json({ error: "Unknown action." }, 400);
};
