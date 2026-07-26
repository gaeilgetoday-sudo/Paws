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

import { getMemorialBySlug, getGuestbook, putGuestbook, newId, isDeleted, isGuestbookClosed, checkRateLimit, clientIp, createLoginToken, json } from "../lib/memorial-store.mjs";

const MAX_MESSAGES = 500;

export default async (req, context) => {
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
  if (isGuestbookClosed(record)) {
    return json({ error: "The guestbook is closed." }, 403);
  }

  // Per page: stops one address from filling a single guestbook. Per
  // address overall: stops the same script from spraying many pages.
  const ip = clientIp(req, context);
  const [pageOk, globalOk] = await Promise.all([
    checkRateLimit(`guestbook:${record.id}`, ip, { max: 8, windowMs: 60 * 60 * 1000 }),
    checkRateLimit("guestbook-global", ip, { max: 20, windowMs: 60 * 60 * 1000 }),
  ]);
  if (!pageOk || !globalOk) {
    return json({ error: "Please wait a little before sending another message." }, 429);
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

  // Best-effort — a failed notification never blocks the message itself from
  // being saved. The guestbook submission has already succeeded above
  // regardless of what happens here.
  try {
    await notifyOwner(record, name || "Someone", new URL(req.url).origin);
  } catch (err) {
    console.error("Owner notification failed:", err?.message);
  }

  return json({
    ok: true,
    // Tells the page which reassurance to show, not whether it "passed".
    moderated: record.moderationOn !== false,
  });
};

/**
 * Emails the owner that a new message has arrived. Cooldown per record
 * (not per message) so a burst of messages in quick succession — several
 * family members writing within a few minutes of each other — sends one
 * nudge to go check manage.html rather than flooding an inbox during
 * what's often an emotionally raw moment, not one email per message.
 */
async function notifyOwner(record, visitorName, origin) {
  if (!record.ownerEmail) return;
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) return;

  const allowed = await checkRateLimit(`guestbook-notify:${record.id}`, record.id, {
    max: 1,
    windowMs: 5 * 60 * 1000,
  });
  if (!allowed) return;

  const needsApproval = record.moderationOn !== false;
  const token = await createLoginToken(record.id);
  const link = `${origin}/manage.html?token=${token}`;
  const petName = record.name || "your page";

  const subject = needsApproval
    ? `A message is waiting for your approval on ${petName}'s page`
    : `${visitorName} left a message on ${petName}'s page`;

  const bodyLine = needsApproval
    ? `${visitorName} left a message on ${petName}'s page. It won't show publicly until you approve it.`
    : `${visitorName} left a message on ${petName}'s page. Since moderation is off, it's already visible to visitors.`;

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#2B241C;">
    <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#B96F28;font-weight:700;margin:0 0 8px;">Kindred Paws</p>
    <h1 style="font-family:Georgia,serif;font-size:22px;font-weight:600;margin:0 0 16px;">${escapeHtml(bodyLine)}</h1>
    <p style="margin:0 0 24px;">
      <a href="${link}" style="display:inline-block;background:#D98A3D;color:#241505;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:999px;">${needsApproval ? "Review it" : "See the page"}</a>
    </p>
    <p style="font-size:13px;line-height:1.6;color:#8A7F6D;margin:0;">
      This link works once and lasts 30 minutes. If it's expired by the time you click it, you
      can always request a fresh one from the sign-in page — nothing about the message itself
      is affected either way.
    </p>
  </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to: [record.ownerEmail],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    // Not res.text() — Resend's error body can echo back the recipient's
    // address, which doesn't belong in server logs.
    console.error("Resend rejected the owner notification:", res.status);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
