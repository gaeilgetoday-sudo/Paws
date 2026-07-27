// netlify/functions/redeem-link.mjs
//
// Exchanges a single-use link token for the reference that unlocks the
// builder and the manage page. The token is consumed the moment it's looked
// up, so a forwarded email can't be used twice.

import { redeemLoginToken, getGuestbook, json } from "../lib/memorial-store.mjs";

export default async (req) => {
  const token = new URL(req.url).searchParams.get("token");
  const record = await redeemLoginToken(token);

  if (!record) {
    return json({ ok: false, reason: "expired" }, 401);
  }

  const guestbook = await getGuestbook(record.id);

  return json({
    ok: true,
    reference: record.reference,
    email: record.ownerEmail,
    name: record.name,
    published: record.published,
    slug: record.slug,
    pendingCount: guestbook.filter((m) => m.status === "pending").length,
  });
};
