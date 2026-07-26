// netlify/functions/create-memorial-checkout.mjs
//
// Creates a Stripe Checkout Session for a memorial page (€29, one-time).
// Same shape as create-checkout.mjs for the booklet: a single deliberate
// payment, no saved card, no subscription, nothing to renew.
//
// Unlike the booklet, no custom fields are collected here — the pet's name,
// story and photos are all gathered in the builder afterwards, where there's
// room to do it gently rather than on a payment form.
//
// Stripe Checkout collects the buyer's email address by default (for its own
// receipt). That address is what later lets them return to their page via a
// login link, so it must never be rendered on the public memorial page.
//
// Required environment variables (Netlify: Site settings > Environment
// variables):
//   STRIPE_SECRET_KEY           sk_live_... (or sk_test_... while testing)
//   STRIPE_MEMORIAL_PRICE_ID    price_... for the €29 memorial product
//
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_MEMORIAL_PRICE_ID) {
    console.error("Missing STRIPE_SECRET_KEY or STRIPE_MEMORIAL_PRICE_ID env vars");
    return new Response(
      JSON.stringify({ error: "Checkout isn't configured yet." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const origin = new URL(req.url).origin;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        { price: process.env.STRIPE_MEMORIAL_PRICE_ID, quantity: 1 },
      ],
      // Tags this session so downstream verification (verify-memorial-access.mjs,
      // save-memorial.mjs) can confirm someone actually bought the memorial
      // page, not just that *some* Stripe session was paid — without this, a
      // booklet purchase would also unlock the memorial builder.
      metadata: { product: "memorial" },
      submit_type: "pay",
      // Land straight in the builder, carrying the session so the builder can
      // verify the payment server-side before unlocking itself.
      success_url: `${origin}/builder.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/memorial.html`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Stripe memorial checkout creation failed:", err);
    return new Response(
      JSON.stringify({ error: "Could not start checkout. Please try again." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
