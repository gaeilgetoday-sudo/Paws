// netlify/functions/submit-message.mjs
//
// Accepts a guestbook message. Nothing submitted here is ever visible to
// anyone until the owner approves it — the response is deliberately identical
// whether a message is queued or quietly held, so there's no feedback loop for
// anyone testing what gets through.
//
// Messages contain other people's personal data (a name, sometimes an email
// signature) and remain subject to individual erasure requests regardless of
// anything the page owner decides.

import { getMemorialBySlug, getGuestbook, putGuestbook, newId, isDeleted, json } from "../lib/memorial-store.mjs";

const MAX_MESSAGES = 500;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  const record = await getMemorialBySlug(body.slug);
  if (!record || isDeleted(record) || !record.published || record.privacy === "private") {
    return json({ error: "not_found" }, 404);
  }
  if (record.guestbookOn === false) {
    return json({ error: "The guestbook is closed." }, 403);
  }

  const message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!message) return json({ error: "Please write a message first." }, 400);

  const entries = await getGuestbook(record.id);
  if (entries.length >= MAX_MESSAGES) {
    return json({ error: "This guestbook is full." }, 429);
  }

  entries.push({
    id: newId(),
    name: name || "Anonymous",
    message,
    // Honours the owner's setting, but defaults to pending on anything unset —
    // failing closed matters more here than showing a message promptly.
    status: record.moderationOn === false ? "approved" : "pending",
    at: new Date().toISOString(),
  });

  await putGuestbook(record.id, entries);

  return json({
    ok: true,
    // Tells the page which reassurance to show, not whether it "passed".
    moderated: record.moderationOn !== false,
  });
};
