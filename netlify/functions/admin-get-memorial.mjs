// netlify/functions/admin-get-memorial.mjs
//
// Full detail for one memorial — everything the owner themselves would see
// in manage.html, including messages still pending approval, which nobody
// but the owner can normally see at all.

import { getMemorial, getGuestbook, isDeleted } from "../lib/memorial-store.mjs";
import { json } from "../lib/memorial-store.mjs";
import { requireAdmin } from "../lib/admin-auth.mjs";

export default async (req) => {
  const auth = await requireAdmin(req);
  if (auth.error) return json({ error: auth.error }, auth.status);

  const id = new URL(req.url).searchParams.get("id");
  const record = await getMemorial(id);
  if (!record) return json({ error: "Not found." }, 404);

  const messages = await getGuestbook(record.id);

  return json({
    ok: true,
    memorial: { ...record, deleted: isDeleted(record) },
    messages,
  });
};
