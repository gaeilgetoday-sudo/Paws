// netlify/functions/moderate-messages.mjs
//
// The owner's side of the guestbook queue: list everything, approve, hide, or
// delete outright.
//
// "Hide" and "delete" are kept separate on purpose. Hiding is reversible and
// covers the ordinary case of something the owner would rather not show.
// Deleting removes the words permanently, which is what an erasure request
// from the person who wrote them actually requires.

import { authorise, getGuestbook, putGuestbook, json } from "../lib/memorial-store.mjs";

export default async (req) => {
  const url = new URL(req.url);

  // ---- list ----
  if (req.method === "GET") {
    const { record, error, status } = await authorise(url.searchParams.get("reference"));
    if (error) return json({ error }, status);

    const entries = await getGuestbook(record.id);
    return json({
      ok: true,
      moderationOn: record.moderationOn !== false,
      messages: entries
        .slice()
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .map((m) => ({ id: m.id, name: m.name, message: m.message, status: m.status, at: m.at })),
    });
  }

  // ---- act ----
  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Malformed request." }, 400);
    }

    const { record, error, status } = await authorise(body.reference);
    if (error) return json({ error }, status);

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
  }

  return json({ error: "Method not allowed" }, 405);
};
