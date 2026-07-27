// netlify/functions/verify-memorial-access.mjs
//
// Called by builder.html on load, with the session_id Stripe appended to the
// success URL. Confirms with Stripe that the payment actually completed before
// the builder unlocks itself.
//
// Why this exists: it means the builder can be gated *without* a database.
// The booklet download uses the same approach — never trust the URL, always
// ask Stripe. Persistent storage is only needed once someone starts *saving*
// a memorial, which is the next piece of work, not this one.
//
// Returns the buyer's email so the builder can show whose page this is and,
// later, send a login link back to it. That address is deliberately never
// rendered on the public memorial page.
//
// Required environment variable:
//   STRIPE_SECRET_KEY
//
import Stripe from "stripe";
import {
  findByReference, putMemorial, indexMemorial, newId,
} from "../lib/memorial-store.mjs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export default async (req) => {
  const sessionId = new URL(req.url).searchParams.get("session_id");
  if (!sessionId) {
    return json({ paid: false, reason: "missing_session" }, 400);
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error("Missing STRIPE_SECRET_KEY env var");
    return json({ paid: false, reason: "not_configured" }, 500);
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    console.error("Could not retrieve Stripe session:", err);
    return json({ paid: false, reason: "unverifiable" }, 400);
  }

  if (session.payment_status !== "paid") {
    return json({ paid: false, reason: "unpaid" }, 402);
  }

  const email = session.customer_details?.email || null;

  // Create the record now rather than waiting for the first save. Until it
  // exists there is no owner index, so "email me a link" finds nothing — and
  // someone who paid, closed the tab, then opened their laptop would have no
  // way back in at all.
  let record = await findByReference(session.id);
  if (!record) {
    record = {
      id: newId(),
      reference: session.id,
      ownerEmail: email,
      createdAt: new Date().toISOString(),
      published: false,
      slug: null,
      candles: 0,
      privacy: "unlisted",
      guestbookOn: true,
      moderationOn: true,
      name: "",
    };
    await putMemorial(record);
    await indexMemorial(record);
  }

  return json({
    paid: true,
    email,
    // Stable reference for tying a saved memorial to this purchase later.
    reference: session.id,
  });
};
