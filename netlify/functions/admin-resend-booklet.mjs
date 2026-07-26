// netlify/functions/admin-resend-booklet.mjs
//
// There's no stored booklet "record" to edit — the pet's name and owner's
// name live only inside the completed Stripe Checkout Session, and Stripe
// doesn't allow editing a completed session's fields. So this isn't an
// edit: it regenerates the PDF from scratch (optionally with corrected
// names overriding what Stripe has on file) and emails the result. The
// original order in Stripe is untouched either way.

import { verifyBookletSession, generateBookletPdf, bookletFilename, sanitize } from "../lib/booklet.mjs";
import { json } from "../lib/memorial-store.mjs";
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

  const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
  const { session, petName, ownerName, orderDate, error, status } = await verifyBookletSession(sessionId);
  if (error) return json({ error }, status);

  // Overrides are optional — leave either blank to keep what's already on
  // the original order and just resend it as-is.
  const finalPetName = body.petName ? sanitize(body.petName, "your pet") : petName;
  const finalOwnerName = body.ownerName ? sanitize(body.ownerName, "you") : ownerName;

  const to = body.email || session.customer_details?.email;
  if (!to) return json({ error: "No email address to send to — the session has none on file." }, 400);

  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) {
    return json({ error: "Email isn't configured yet (RESEND_API_KEY / MAIL_FROM)." }, 500);
  }

  let pdfBytes;
  try {
    pdfBytes = await generateBookletPdf(finalPetName, finalOwnerName, orderDate, session.id);
  } catch (err) {
    console.error("Admin booklet regeneration failed:", err?.message);
    return json({ error: "Couldn't generate the PDF. Check the function logs." }, 500);
  }

  const corrected = finalPetName !== petName || finalOwnerName !== ownerName;
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#2B241C;">
    <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#B96F28;font-weight:700;margin:0 0 8px;">Kindred Paws</p>
    <h1 style="font-family:Georgia,serif;font-size:22px;font-weight:600;margin:0 0 16px;">
      ${corrected ? "Here's a corrected copy of Just In Case, With Love." : "Here's another copy of Just In Case, With Love."}
    </h1>
    <p style="font-size:15px;line-height:1.6;color:#4a4033;margin:0 0 12px;">
      It's attached to this email, personalised for ${escapeHtml(finalPetName)}.
    </p>
    <p style="font-size:13px;line-height:1.6;color:#8A7F6D;margin:0;">
      If anything's still not right, just reply to this email and we'll sort it.
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
      to: [to],
      subject: corrected ? "Your corrected copy of Just In Case, With Love" : "Your copy of Just In Case, With Love",
      html,
      attachments: [
        { filename: bookletFilename(finalPetName), content: Buffer.from(pdfBytes).toString("base64") },
      ],
    }),
  });

  if (!res.ok) {
    console.error("Resend rejected the admin booklet resend:", res.status);
    return json({ error: "The email couldn't be sent. Check the function logs." }, 502);
  }

  return json({ ok: true, sentTo: to, petName: finalPetName, ownerName: finalOwnerName });
};

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
