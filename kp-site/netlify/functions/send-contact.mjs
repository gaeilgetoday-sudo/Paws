// netlify/functions/send-contact.mjs
//
// Delivers a contact form message to the inbox. Reuses the Resend setup that
// already sends sign-in links, so there's nothing extra to configure beyond
// where messages should land.
//
// Required environment variables:
//   RESEND_API_KEY   already set for sign-in links
//   MAIL_FROM        already set for sign-in links
//   CONTACT_TO       where contact messages should be delivered

import { json } from "../lib/memorial-store.mjs";

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const SUBJECTS = {
  general: "General question",
  booklet: "About the wishes booklet",
  memorial: "About a memorial page",
  access: "Can't get into my page",
  privacy: "Privacy or data request",
  partner: "Working together",
};

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  // A hidden field real people never fill in. Cheap, invisible, and doesn't
  // put a puzzle in front of someone who's grieving.
  if (body.website) return json({ ok: true });

  const name = String(body.name || "").trim().slice(0, 80);
  const email = String(body.email || "").trim().slice(0, 160);
  const topic = SUBJECTS[body.topic] ? body.topic : "general";
  const message = String(body.message || "").trim().slice(0, 5000);

  if (!message) return json({ error: "Please write a message first." }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: "Please enter an email address we can reply to." }, 400);
  }

  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM || !process.env.CONTACT_TO) {
    console.error("Missing RESEND_API_KEY, MAIL_FROM or CONTACT_TO");
    return json({ error: "The contact form isn't set up yet." }, 500);
  }

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;">
      <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#B96F28;font-weight:700;">
        ${esc(SUBJECTS[topic])}
      </p>
      <p style="margin:0 0 4px;"><strong>${esc(name || "No name given")}</strong></p>
      <p style="margin:0 0 18px;color:#8A7F6D;font-size:14px;">${esc(email)}</p>
      <div style="white-space:pre-wrap;font-size:15px;line-height:1.6;border-left:3px solid #DCD0B4;padding-left:16px;">
${esc(message)}
      </div>
    </div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: [process.env.CONTACT_TO],
        reply_to: email,
        subject: `${SUBJECTS[topic]} — ${name || email}`,
        html,
      }),
    });
    if (!res.ok) {
      console.error("Resend rejected contact send:", res.status, await res.text());
      return json({ error: "That didn't send. Please email us directly instead." }, 502);
    }
  } catch (err) {
    console.error("Contact send failed:", err?.message);
    return json({ error: "That didn't send. Please email us directly instead." }, 502);
  }

  return json({ ok: true });
};
