// netlify/functions/email-booklet.mjs
//
// Sends the buyer a copy of their booklet PDF by email — an automatic
// backup so the download isn't the only place it exists, since nothing
// preserves the success page's URL once someone closes the tab. Called by
// success.html right after payment, fire-and-forget: the download button
// still works regardless of whether this succeeds.
//
// Idempotent per Stripe session via a small marker in its own Blobs store,
// so reloading the success page doesn't send a duplicate email.
//
// Required environment variables (in addition to STRIPE_SECRET_KEY):
//   RESEND_API_KEY
//   MAIL_FROM   a verified sending domain — see README.md
//
import { getStore } from "@netlify/blobs";
import { verifyBookletSession, generateBookletPdf, bookletFilename } from "../lib/booklet.mjs";

const store = () => getStore({ name: "booklet-emails", consistency: "strong" });

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  const { session, petName, ownerName, orderDate, error, status } = await verifyBookletSession(sessionId);
  if (error) return json({ ok: false, error }, status);

  const email = session.customer_details?.email;
  if (!email) {
    // Shouldn't happen — Stripe Checkout collects this by default — but
    // there's nowhere to send a copy to if it's somehow missing.
    return json({ ok: false, reason: "no_email" });
  }

  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) {
    // Not configured yet. The download button on success.html still works
    // on its own — this is a nice-to-have backup, not the primary path —
    // so fail quietly rather than surface a scary error to the customer
    // over something that isn't their problem.
    return json({ ok: false, reason: "not_configured" });
  }

  const s = store();
  const alreadySent = await s.get(`sent/${sessionId}`, { type: "json" });
  if (alreadySent) {
    return json({ ok: true, reason: "already_sent" });
  }

  let pdfBytes;
  try {
    pdfBytes = await generateBookletPdf(petName, ownerName, orderDate, session.id);
  } catch (err) {
    console.error("Could not generate booklet PDF for email:", err);
    return json({ ok: false, reason: "generation_failed" });
  }

  const filename = bookletFilename(petName);
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#2B241C;">
    <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#B96F28;font-weight:700;margin:0 0 8px;">Kindred Paws</p>
    <h1 style="font-family:Georgia,serif;font-size:22px;font-weight:600;margin:0 0 16px;">Here's your copy of Just In Case, With Love.</h1>
    <p style="font-size:15px;line-height:1.6;color:#4a4033;margin:0 0 12px;">
      It's attached to this email, personalised for ${escapeHtml(petName)} — so it's never
      lost even if you close the browser tab it downloaded from.
    </p>
    <p style="font-size:13px;line-height:1.6;color:#8A7F6D;margin:0;">
      If you didn't make this purchase, you can ignore this email or get in touch and we'll look into it.
    </p>
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
        to: [email],
        subject: "Your copy of Just In Case, With Love",
        html,
        attachments: [
          {
            filename,
            content: Buffer.from(pdfBytes).toString("base64"),
          },
        ],
      }),
    });

    if (!res.ok) {
      // Not res.text() here — Resend's error body can echo back the
      // recipient's address, which doesn't belong in server logs.
      console.error("Resend rejected the booklet email:", res.status);
      return json({ ok: false, reason: "send_failed" });
    }
  } catch (err) {
    console.error("Booklet email send failed:", err?.message);
    return json({ ok: false, reason: "send_failed" });
  }

  // Mark this session as emailed so a page refresh doesn't resend it. No
  // real expiry needed — a stray marker costs nothing meaningful to keep.
  await s.setJSON(`sent/${sessionId}`, { at: new Date().toISOString() });

  return json({ ok: true });
};

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
