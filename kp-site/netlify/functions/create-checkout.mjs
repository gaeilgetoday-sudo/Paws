// netlify/functions/create-checkout.mjs
//
// Creates a Stripe Checkout Session for the wishes booklet. Stripe's own
// hosted page collects payment plus two custom fields (pet's name, owner's
// name) so we never have to handle card details ourselves.
//
// Required environment variables (set in Netlify: Site settings > Environment
// variables):
//   STRIPE_SECRET_KEY   e.g. sk_live_... (use sk_test_... while testing)
//   STRIPE_PRICE_ID     the Price ID of the booklet product in your Stripe
//                        dashboard, e.g. price_1AbCdEfGhIjKlM
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
      custom_fields: [
        {
          key: "pet_name",
          label: { type: "custom", custom: "Your pet's name" },
          type: "text",
          text: { maximum_length: 40 },
        },
        {
          key: "owner_name",
          label: { type: "custom", custom: "Your name (or family name)" },
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
