// netlify/functions/admin-resend-signin.mjs
//
// Emails a fresh sign-in link for one specific memorial — for when its
// owner has emailed you saying they've lost access. Deliberately scoped to
// the one record you're looking at, not every page under that email
// address (that's what the customer's own request-link.mjs flow is for);
// an admin acting on a specific complaint should only touch what the
// complaint was about.

import { getMemorial, createLoginToken, json } from "../lib/memorial-store.mjs";
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
  if (!record.ownerEmail) return json({ error: "This record has no owner email on file." }, 400);

  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) {
    return json({ error: "Email isn't configured yet (RESEND_API_KEY / MAIL_FROM)." }, 500);
  }

  const origin = new URL(req.url).origin;
  const token = await createLoginToken(record.id);
  const link = `${origin}/manage.html?token=${token}`;

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#2B241C;">
    <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#B96F28;font-weight:700;margin:0 0 8px;">Kindred Paws</p>
    <h1 style="font-family:Georgia,serif;font-size:22px;font-weight:600;margin:0 0 16px;">Here's your link back to ${escapeHtml(record.name || "your page")}'s page.</h1>
    <p style="font-size:15px;line-height:1.6;color:#4a4033;margin:0 0 24px;">
      Click below to get back in. The link works once and lasts 30 minutes.
    </p>
    <p style="margin:0 0 28px;">
      <a href="${link}" style="display:inline-block;background:#D98A3D;color:#241505;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:999px;">Open the page</a>
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
      subject: `Your link back to ${record.name || "your"} page`,
      html,
    }),
  });

  if (!res.ok) {
    console.error("Resend rejected the admin-triggered sign-in email:", res.status);
    return json({ error: "The email couldn't be sent. Check the function logs." }, 502);
  }

  return json({ ok: true });
};

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
