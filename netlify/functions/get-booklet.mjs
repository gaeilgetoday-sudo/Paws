// netlify/functions/get-booklet.mjs
//
// Called from success.html once Stripe redirects back with a session_id.
// Verifies the payment actually went through (never trust the URL alone),
// pulls the pet's name and owner's name off the Checkout Session's custom
// fields, stamps them onto the cover of the pre-built booklet template, and
// streams the personalized PDF straight back as a download.
//
// See netlify/lib/booklet.mjs for the shared generation logic — also used
// by email-booklet.mjs to send an automatic backup copy to the buyer's inbox.
//
// Required environment variable:
//   STRIPE_SECRET_KEY   same as in create-checkout.mjs
//
import { verifyBookletSession, generateBookletPdf, bookletFilename } from "../lib/booklet.mjs";

export default async (req) => {
  const sessionId = new URL(req.url).searchParams.get("session_id");
  const { session, petName, ownerName, orderDate, error, status } = await verifyBookletSession(sessionId);
  if (error) return new Response(error, { status });

  let pdfBytes;
  try {
    pdfBytes = await generateBookletPdf(petName, ownerName, orderDate, session.id);
  } catch (err) {
    console.error("Could not generate booklet PDF:", err);
    return new Response("The booklet template is missing on the server.", { status: 500 });
  }

  return new Response(pdfBytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${bookletFilename(petName)}"`,
      "Cache-Control": "no-store",
    },
  });
};
