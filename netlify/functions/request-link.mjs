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

import { findAllByEmail, createLoginToken, checkAndMarkSend, checkRateLimit, clientIp, json } from "../lib/memorial-store.mjs";

const GENERIC = {
  ok: true,
  message: "If there's a page linked to that address, a sign-in link is on its way.",
};

function linkRow(link, petName) {
  const who = petName ? `${petName}'s page` : "a memorial page";
  return `
    <p style="margin:0 0 16px;">
      <a href="${link}" style="display:inline-block;background:#D98A3D;color:#241505;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:999px;">Open ${who}</a>
    </p>`;
}

// Handles both a single memorial (most people) and several under the same
// address (e.g. more than one pet over time) in one email, so nobody loses
// access to an earlier page just because they made a later purchase.
function emailBody(links) {
  const intro = links.length > 1
    ? "Here are your links back to your pages."
    : `Here's your link back to ${links[0].petName ? `${links[0].petName}'s page` : "your memorial page"}.`;
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#2B241C;">
    <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#B96F28;font-weight:700;margin:0 0 8px;">Kindred Paws</p>
    <h1 style="font-family:Georgia,serif;font-size:22px;font-weight:600;margin:0 0 16px;">${intro}</h1>
    <p style="font-size:15px;line-height:1.6;color:#4a4033;margin:0 0 24px;">
      Click below to pick up where you left off. Each link works once and lasts for 30 minutes.
    </p>
    ${links.map((l) => linkRow(l.link, l.petName)).join("")}
    <p style="font-size:13px;line-height:1.6;color:#8A7F6D;margin:0;">
      If you didn't ask for this, you can ignore it — nothing has changed, and the links
      will expire on their own.
    </p>
  </div>`;
}

export default async (req, context) => {
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

  // Per address: stops the same script from requesting links for many
  // different emails in a row. The existing per-email cooldown (below)
  // handles the other direction — repeatedly targeting one address.
  const ipAllowed = await checkRateLimit("request-link", clientIp(req, context), {
    max: 10,
    windowMs: 60 * 60 * 1000,
  });
  if (!ipAllowed) return json(GENERIC);

  // Cooldown applies whether or not a page exists, so timing can't be used to
  // tell the two apart either.
  const allowed = await checkAndMarkSend(email);
  if (!allowed) return json(GENERIC);

  const records = await findAllByEmail(email);
  if (!records.length) return json(GENERIC);

  const origin = new URL(req.url).origin;
  const links = await Promise.all(
    records.map(async (record) => ({
      link: `${origin}/manage.html?token=${await createLoginToken(record.id)}`,
      petName: record.name,
    }))
  );

  const subject = records.length > 1
    ? "Your links back to your Kindred Paws pages"
    : (records[0].name ? `Your link back to ${records[0].name}'s page` : "Your Kindred Paws sign-in link");

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
        subject,
        html: emailBody(links),
      }),
    });
    if (!res.ok) {
      // Not res.text() here — Resend's error body can echo back the
      // recipient's address, and that shouldn't end up in server logs.
      console.error("Resend rejected the send:", res.status);
    }
  } catch (err) {
    console.error("Could not send login email:", err?.message);
  }

  // Still generic: a mail failure shouldn't confirm the address exists either.
  return json(GENERIC);
};
