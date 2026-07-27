// netlify/functions/request-link.mjs
//
// Emails a single-use link back to someone's memorial page.
//
// Two things this deliberately does not do:
//
//  1. It never reveals whether an address has a page. The response is identical
//     either way, so this can't be used to find out who has lost a pet — that's
//     nobody's business, and the people using this are grieving.
//
//  2. It doesn't put anything sensitive in the email beyond the link itself.
//
// Required environment variables:
//   RESEND_API_KEY   from resend.com
//   MAIL_FROM        e.g. "Kindred Paws <hello@legacyofeire.ie>"
//                    (the domain must be verified in Resend)

import { findByEmail, createLoginToken, checkAndMarkSend, json } from "../lib/memorial-store.mjs";

const GENERIC = {
  ok: true,
  message: "If there's a page linked to that address, a sign-in link is on its way.",
};

// A pet's name is owner-supplied text landing in an HTML email. Escaping it
// costs nothing and stops a stray angle bracket mangling the message.
const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function emailBody(link, petName) {
  const who = petName ? `${esc(petName)}'s page` : "your memorial page";
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#2B241C;">
    <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#B96F28;font-weight:700;margin:0 0 8px;">Kindred Paws</p>
    <h1 style="font-family:Georgia,serif;font-size:22px;font-weight:600;margin:0 0 16px;">Here's your link back to ${who}.</h1>
    <p style="font-size:15px;line-height:1.6;color:#4a4033;margin:0 0 24px;">
      Click below to pick up where you left off. The link works once and lasts for 30 minutes.
    </p>
    <p style="margin:0 0 28px;">
      <a href="${link}" style="display:inline-block;background:#D98A3D;color:#241505;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:999px;">Open ${who}</a>
    </p>
    <p style="font-size:13px;line-height:1.6;color:#8A7F6D;margin:0;">
      If you didn't ask for this, you can ignore it — nothing has changed, and the link
      will expire on its own.
    </p>
  </div>`;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: "Please enter a valid email address." }, 400);
  }

  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) {
    console.error("Missing RESEND_API_KEY or MAIL_FROM");
    return json({ error: "Sign-in links aren't set up yet." }, 500);
  }

  // Cooldown applies whether or not a page exists, so timing can't be used to
  // tell the two apart either.
  const allowed = await checkAndMarkSend(email);
  if (!allowed) return json(GENERIC);

  const record = await findByEmail(email);
  if (!record) return json(GENERIC);

  const token = await createLoginToken(record.id);
  const origin = new URL(req.url).origin;
  const link = `${origin}/manage.html?token=${token}`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: [email],
        subject: record.name ? `Your link back to ${record.name}'s page` : "Your Kindred Paws sign-in link",
        html: emailBody(link, record.name),
      }),
    });
    if (!res.ok) {
      console.error("Resend rejected the send:", res.status, await res.text());
    }
  } catch (err) {
    console.error("Could not send login email:", err?.message);
  }

  // Still generic: a mail failure shouldn't confirm the address exists either.
  return json(GENERIC);
};
