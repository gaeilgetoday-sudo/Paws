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

  // A paid session alone isn't enough — it must be a paid session for the
  // memorial product specifically. Without this check, a booklet purchase's
  // session_id would also unlock the memorial builder for free.
  if (session.metadata?.product !== "memorial") {
    return json({ paid: false, reason: "wrong_product" }, 402);
  }

  return json({
    paid: true,
    email: session.customer_details?.email || null,
    // Stable reference for tying a saved memorial to this purchase later.
    reference: session.id,
  });
};
