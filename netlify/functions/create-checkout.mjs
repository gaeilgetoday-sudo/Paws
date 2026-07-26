// netlify/functions/create-checkout.mjs
//
// Creates a Stripe Checkout Session for "Just In Case, With Love". Stripe's
// own hosted page collects payment plus two custom fields (pet's name,
// owner's name) so we never have to handle card details ourselves.
//
// This references a Price you create in the Stripe dashboard (rather than
// building one inline) specifically so the product image you upload there
// actually shows up on the checkout page. See STRIPE-SETUP.md for the
// dashboard steps.
//
// Required environment variables (set in Netlify: Site settings > Environment
// variables):
//   STRIPE_SECRET_KEY   e.g. sk_live_... (use sk_test_... while testing)
//   STRIPE_PRICE_ID      the Price ID from your "Just In Case, With Love"
//                         product in Stripe, e.g. price_1AbCdEfGhIjKlM
//
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) {
    console.error("Missing STRIPE_SECRET_KEY or STRIPE_PRICE_ID env vars");
    return new Response(
      JSON.stringify({ error: "Checkout isn't configured yet." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const origin = new URL(req.url).origin;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      // Tags this session so downstream verification (get-booklet.mjs) can
      // confirm someone actually bought the booklet, not just that *some*
      // Stripe session was paid — without this, any paid session (including
      // a memorial purchase) could unlock a booklet download.
      metadata: { product: "booklet" },
      // New Stripe accounts default to Managed Payments, which requires an
      // eligible tax code on every product or the session creation fails.
      // Opting out here keeps things simple and predictable for now — this
      // is a real decision to revisit deliberately before going live, not
      // something to leave switched off by accident. See
      // https://docs.stripe.com/payments/managed-payments/how-it-works
      managed_payments: { enabled: false },
      custom_fields: [
        {
          key: "pet_name",
          label: { type: "custom", custom: "Your pet's name" },
          type: "text",
          text: { maximum_length: 40 },
        },
        {
          key: "owner_name",
          label: { type: "custom", custom: "Your name, or your family's name" },
          type: "text",
          text: { maximum_length: 60 },
        },
      ],
      submit_type: "pay",
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#booklet`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Stripe checkout creation failed:", err);
    return new Response(
      JSON.stringify({ error: "Could not start checkout. Please try again." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
