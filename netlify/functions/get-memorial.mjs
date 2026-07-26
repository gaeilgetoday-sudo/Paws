// netlify/functions/get-memorial.mjs
//
// Public read for a published memorial page.
//
// Privacy is enforced here, on the server — a "private" page returns nothing at
// all, rather than being hidden in the browser where anyone could look past it.
//
//   public   — anyone with the link; may be listed publicly later
//   unlisted — anyone with the link, never listed or indexed
//   private  — nobody but the owner (served only through the builder)
//
// The owner's email and Stripe reference are never included in the response.

import { getMemorialBySlug, getGuestbook, publicView, isDeleted, json } from "../lib/memorial-store.mjs";

export default async (req) => {
  const slug = new URL(req.url).searchParams.get("p");
  if (!slug) return json({ error: "Missing page." }, 400);

  const record = await getMemorialBySlug(slug);

  // Same response for "never existed", "not published yet" and "private", so a
  // 404 can't be used to work out which pages exist.
  if (!record || isDeleted(record) || !record.published || record.privacy === "private") {
    return json({ error: "not_found" }, 404);
  }

  const guestbook = await getGuestbook(record.id);
  const view = publicView(record, guestbook);

  return new Response(JSON.stringify({ ok: true, memorial: view }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Unlisted pages must never end up in a search index.
      "X-Robots-Tag": record.privacy === "unlisted" ? "noindex, nofollow" : "index, follow",
      "Cache-Control": "no-store",
    },
  });
};
