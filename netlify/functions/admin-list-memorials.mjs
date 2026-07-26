// netlify/functions/admin-list-memorials.mjs
//
// Lists memorials, optionally filtered by a search term matched against
// name, owner email, slug, and reference. Netlify Blobs has no built-in
// search, so this does a full scan-and-filter — completely fine at the
// scale this operates at (one operator, a beta's worth of records), worth
// revisiting only if that scale ever changes meaningfully.

import { store, getGuestbook, isDeleted, json } from "../lib/memorial-store.mjs";
import { requireAdmin } from "../lib/admin-auth.mjs";

export default async (req) => {
  const auth = await requireAdmin(req);
  if (auth.error) return json({ error: auth.error }, auth.status);

  const q = (new URL(req.url).searchParams.get("q") || "").trim().toLowerCase();

  const s = store();
  const { blobs } = await s.list({ prefix: "memorial/" });

  const records = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));

  const matching = records.filter((r) => {
    if (!r) return false;
    if (!q) return true;
    return [r.name, r.ownerEmail, r.slug, r.reference]
      .filter(Boolean)
      .some((field) => field.toLowerCase().includes(q));
  });

  // Pending-message counts need each record's guestbook — fine at this
  // scale, same reasoning as the full scan above.
  const withCounts = await Promise.all(
    matching.map(async (r) => {
      const guestbook = await getGuestbook(r.id);
      const pending = guestbook.filter((m) => m.status === "pending").length;
      return {
        id: r.id,
        name: r.name,
        ownerEmail: r.ownerEmail,
        slug: r.slug,
        reference: r.reference,
        privacy: r.privacy,
        published: !!r.published,
        deleted: isDeleted(r),
        candles: r.candles || 0,
        pendingMessages: pending,
        totalMessages: guestbook.length,
        createdAt: r.createdAt,
      };
    })
  );

  withCounts.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  return json({ ok: true, memorials: withCounts });
};
