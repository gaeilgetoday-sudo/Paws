// netlify/functions/admin-moderate-message.mjs
//
// The same approve/hide/delete actions as moderate-messages.mjs, but for
// when an owner has emailed you directly asking for help rather than
// signing in themselves — same rules apply (hide is reversible, delete
// isn't).

import { getMemorial, getGuestbook, putGuestbook, json } from "../lib/memorial-store.mjs";
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

  const action = body.action;
  if (!["approve", "hide", "delete"].includes(action)) {
    return json({ error: "Unknown action." }, 400);
  }

  const entries = await getGuestbook(record.id);
  const idx = entries.findIndex((m) => m.id === body.messageId);
  if (idx === -1) return json({ error: "Message not found." }, 404);

  if (action === "delete") {
    entries.splice(idx, 1);
  } else {
    entries[idx].status = action === "approve" ? "approved" : "hidden";
  }

  await putGuestbook(record.id, entries);
  return json({ ok: true });
};
