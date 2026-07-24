# Getting the booklet checkout live

This adds a real "buy" flow to the site: someone clicks **Start their wishes
booklet**, pays via Stripe (which also collects the pet's name and their own
name), lands on a confirmation page, and downloads a PDF with those two names
already printed on the cover. No email step, no database, no server to run —
Stripe holds the payment, and a small Netlify Function stamps the PDF on
demand.

## 1. Add the files to your project

Unzip `kindred-paws-booklet-checkout.zip` and merge the `kp-site/` folder into
your existing site repo (the one connected to Netlify). It adds:

```
netlify/functions/create-checkout.mjs   -> starts a Stripe Checkout session
netlify/functions/get-booklet.mjs       -> verifies payment, stamps & serves the PDF
netlify/functions/assets/booklet-template.pdf
success.html                            -> the "your booklet is ready" page
netlify.toml                            -> tells Netlify where the functions live
package.json                            -> adds the `stripe` and `pdf-lib` packages
```

It also updates `index.html` — the **Start their wishes booklet** button in
the booklet section now triggers checkout instead of doing nothing.

## 2. Set up Stripe (about 10 minutes)

1. Create a free account at stripe.com if you don't have one.
2. In the Stripe Dashboard, go to **Product catalog > Add product**.
   - Name: `Kindred Paws — Wishes Booklet`
   - Price: whatever you want to charge (e.g. €19), one-time.
   - Save it, then open the price you just created and copy its **Price ID**
     (starts with `price_...`).
3. Go to **Developers > API keys** and copy your **Secret key** (starts with
   `sk_test_...` while you're testing, `sk_live_...` once you're ready to
   charge real cards).

You do **not** need to set up a webhook for this flow — the download page
verifies payment directly with Stripe when it loads, so there's nothing extra
to configure there.

## 3. Add the environment variables in Netlify

Site settings → **Environment variables** → add:

| Key | Value |
|---|---|
| `STRIPE_SECRET_KEY` | your Stripe secret key |
| `STRIPE_PRICE_ID` | the Price ID from step 2 |

Redeploy after adding these (Netlify only picks up new env vars on a fresh
build).

## 4. Test it

Stripe test mode uses fake cards, so nothing is actually charged:

1. Make sure `STRIPE_SECRET_KEY` is your **test** key (`sk_test_...`) and
   deploy.
2. Click **Start their wishes booklet** on the live site.
3. On Stripe's checkout page, fill in the pet's name and your name, and pay
   with the test card `4242 4242 4242 4242`, any future expiry date, any CVC.
4. You should land on `success.html` and get a download with those two names
   printed on the cover.

## 5. Go live

Swap `STRIPE_SECRET_KEY` for your **live** secret key (`sk_live_...`) and
redeploy. That's it — the same code handles real payments.

## Notes on how it works

- The PDF is **stamped on demand**, not stored anywhere. Every download hits
  Stripe to confirm payment, then writes the two names onto a copy of the
  existing 32-page template. Nothing about your original blank booklet
  changes.
- Long names are handled gracefully — the cover text automatically shrinks a
  little if a name is unusually long, so nothing ever runs off the page.
- If you'd rather also email the PDF (not just show a download button), that's
  a small addition on top of this — just say the word and I'll wire it in.
- If you want the personalized name to appear on further pages (not just the
  cover — e.g. a running header), that's also a straightforward extension of
  the same stamping function.
