// netlify/functions/admin-update-settings.mjs
//
// Lets you change privacy, guestbook, moderation, and closure settings on
// an owner's behalf — for when they've emailed asking for a change and
// can't (or would rather not) sign in and do it themselves. Deliberately
// scoped to just these settings, not the memorial's actual content (name,
// story, photos) — editing someone's words about their own pet on their
// behalf is a different, more sensitive thing than flipping a privacy
// toggle, and isn't covered here.

import { getMemorial, putMemorial, indexMemorial, json } from "../lib/memorial-store.mjs";
import { requireAdmin } from "../lib/admin-auth.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await requireAdmin(req);
  if (auth.error) return json({ error: auth.error }, auth.status);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  const record = await getMemorial(body.id);
  if (!record) return json({ error: "Not found." }, 404);

  if (body.privacy !== undefined) {
    if (!["public", "unlisted", "private"].includes(body.privacy)) {
      return json({ error: "Invalid privacy value." }, 400);
    }
    record.privacy = body.privacy;
  }
  if (body.guestbookOn !== undefined) record.guestbookOn = !!body.guestbookOn;
  if (body.moderationOn !== undefined) record.moderationOn = !!body.moderationOn;
  if (body.closeAfter !== undefined) {
    if (!["never", "8w", "6m", "1y"].includes(body.closeAfter)) {
      return json({ error: "Invalid closeAfter value." }, 400);
    }
    record.closeAfter = body.closeAfter;
  }

  await putMemorial(record);
  await indexMemorial(record);

  return json({ ok: true, memorial: record });
};
