# Kindred Paws

Pet end-of-life planning and remembrance platform: a personalised wishes
booklet (€19), a memorial page builder (€29 one-off), and the supporting
Netlify Functions for checkout, save/publish, guestbook, candles, and
sign-in links.

This is the **single canonical site** — the repository previously contained
three overlapping copies (`/`, `kp-site/`, `pay/kp-site/`); those have been
consolidated here, with the old versions kept in `/archive` for reference
only. Do not develop against `/archive`.

## Structure

```
index.html, memorial.html, builder.html,
remember.html, manage.html, contact.html,
privacy.html, success.html          — site pages
images/                             — hero photos etc.
netlify/functions/                  — serverless functions (Stripe, memorial CRUD, email)
netlify/lib/memorial-store.mjs      — shared storage layer (Netlify Blobs)
scripts/archive-memorials.mjs       — manual wind-down / archive export
netlify.toml                        — publish = ".", functions in netlify/functions
```

## Environment variables required

Set these in Netlify → Site configuration → Environment variables.
None are currently set with real values in this repo — every one of these
must be added before the corresponding feature will work in production.

| Variable | Used by | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | `create-checkout.mjs`, `create-memorial-checkout.mjs`, `get-booklet.mjs`, `verify-memorial-access.mjs` | Stripe API access. Use `sk_test_...` until go-live, then `sk_live_...`. |
| `STRIPE_PRICE_ID` | `create-checkout.mjs` | Price ID for the €19 wishes booklet. |
| `STRIPE_MEMORIAL_PRICE_ID` | `create-memorial-checkout.mjs` | Price ID for the €29 memorial page. **Currently not cross-checked at verification time — see Phase 2 fix.** |
| `RESEND_API_KEY` | `request-link.mjs`, `send-contact.mjs` | Transactional email (sign-in links, contact form). From resend.com. |
| `MAIL_FROM` | `request-link.mjs`, `send-contact.mjs` | Verified sending address, e.g. `Kindred Paws <hello@yourdomain>`. Domain must be verified in Resend. |
| `CONTACT_TO` | `send-contact.mjs` | Inbox that receives contact-form submissions. |
| `NETLIFY_SITE_ID` | `scripts/archive-memorials.mjs` | Site configuration → General → Site ID. Only needed to run the manual archive script. |
| `NETLIFY_API_TOKEN` | `scripts/archive-memorials.mjs` | Personal access token with Blobs read access. Only needed to run the manual archive script. |
| `CLOSURE_DATE` | `scripts/archive-memorials.mjs` | Optional. Text shown on archived pages if the site winds down; defaults to the current month/year at run time. |

Also required, not an env var: **Netlify Blobs** must be enabled for the
site (it's the storage layer `memorial-store.mjs` depends on — no extra
setup beyond having the site on a plan that supports Blobs and the
`@netlify/blobs` dependency, which is already in `package.json`).

See `STRIPE-SETUP.md` for the original step-by-step on the booklet Stripe
flow (product creation, test cards, going live). The same pattern applies
to setting up the memorial product's price ID.

## Known launch blockers

See `kindred-paws-launch-review.md` for the full list. Do not accept public
payments until at minimum Phase 1–3 there are complete — most urgently, the
Stripe product-verification gap (a booklet purchase currently also unlocks
a memorial page and vice versa).

## Local development

```
npm install
netlify dev
```

Requires the [Netlify CLI](https://docs.netlify.com/cli/get-started/) and
the environment variables above set locally (`netlify env:pull` after
linking the site, or a `.env` file — see `.gitignore`, `.env` is already
excluded from version control).
