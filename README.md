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
| `STRIPE_MEMORIAL_PRICE_ID` | `create-memorial-checkout.mjs` | Price ID for the €29 memorial page. |
| `RESEND_API_KEY` | `request-link.mjs`, `send-contact.mjs` | Transactional email (sign-in links, contact form). From resend.com. |
| `MAIL_FROM` | `request-link.mjs`, `send-contact.mjs` | Verified sending address, e.g. `Kindred Paws <hello@yourdomain>`. Domain must be verified in Resend — **a plain Gmail address won't work here**, Resend needs a domain you control with DNS records set up. |
| `CONTACT_TO` | `send-contact.mjs` | Inbox that receives contact-form submissions — this one can be any address, e.g. `silvercamlin@gmail.com` (used as the destination `contact.html` and `privacy.html` now display, current as of this pass). |
| `NETLIFY_SITE_ID` | `scripts/archive-memorials.mjs`, `scripts/backup-memorials.mjs`, `scripts/restore-memorial.mjs` | Site configuration → General → Site ID. Also needed as a GitHub Actions repo secret for the scheduled backup workflow. |
| `NETLIFY_API_TOKEN` | `scripts/archive-memorials.mjs`, `scripts/backup-memorials.mjs`, `scripts/restore-memorial.mjs` | Personal access token with Blobs read access. Also needed as a GitHub Actions repo secret for the scheduled backup workflow. |
| `CLOSURE_DATE` | `scripts/archive-memorials.mjs` | Optional. Text shown on archived pages if the site winds down; defaults to the current month/year at run time. |
| `ADMIN_PASSWORD` | `admin-*.mjs` functions | Password for `admin.html` — the internal support tool (search memorials, moderate messages, change settings, resend booklets/sign-in links). One shared password for one operator; if this ever needs more than one person, replace it with real per-person accounts before adding anyone. Pick something long and random, not a memorable phrase — this password protects every customer's data. |

Also required, not an env var: **Netlify Blobs** must be enabled for the
site (it's the storage layer `memorial-store.mjs` depends on — no extra
setup beyond having the site on a plan that supports Blobs and the
`@netlify/blobs` dependency, which is already in `package.json`).

See `STRIPE-SETUP.md` for the original step-by-step on the booklet Stripe
flow (product creation, test cards, going live). The same pattern applies
to setting up the memorial product's price ID.

## Known launch blockers

See `kindred-paws-launch-review.md` for the full list. Do not accept public
payments until at minimum Phase 1–3 there are complete.

**Fixed so far:**
- Repository consolidation (single canonical site at root, correct image paths, lockfile)
- Stripe product cross-check: both checkout sessions are now tagged with
  `metadata.product`, and every verification point (`get-booklet.mjs`,
  `verify-memorial-access.mjs`, `save-memorial.mjs`) confirms the session
  matches the expected product before granting access — a booklet purchase
  can no longer unlock a memorial page or vice versa
- Owner email is now taken from Stripe's verified `customer_details`, never
  from client-submitted request data — closes a related issue where a
  client could have claimed any address as a memorial's owner
- Multiple memorials per email address are now supported (an array of ids
  per owner, not a single overwritable pointer); a sign-in request now
  emails a link to every page linked to that address
- The QR code on the publish screen is now real and scannable (self-hosted
  `vendor/qrcode.min.js`, MIT-licensed, no external request from a
  visitor's browser)
- `remember.html`'s robots meta tag now reflects the actual privacy
  setting instead of a hardcoded blanket `noindex` (note: this is set via
  JS after the page loads, which search engines don't always honour as
  reliably as a server-rendered tag — a prerendered/edge-rendered version
  would be a stronger long-term fix)
- The published page now displays the "Loved by" field
- Guestbook wording (moderation note, submit button) now matches the
  owner's actual moderation setting instead of always claiming review
- Guestbook auto-closure (8 weeks / 6 months / 1 year) is now enforced
  server-side, and the public page hides the submission form once closed
- The builder's "Private" description no longer promises an invite
  mechanism that doesn't exist — matches the server's actual all-or-nothing
  behaviour
- The three-year closure guarantee is now framed as policy backed by the
  archive script, not an unconditional promise, across `index.html`,
  `memorial.html`, and `privacy.html`

**Fixed:** `privacy.html` and `contact.html` no longer have bracketed
placeholders — they now show sole-trader details (Donal O'HAonghuse,
Mosstown, Co. Meath, silvercamlin@gmail.com) provided as a stand-in.
`terms.html` now exists, covering both products' pricing, the 14-day
cancellation right and its immediate-performance exception, refunds,
content/guestbook responsibility, access and deletion, liability, and
governing law.

**Still needed:**
1. Confirm the details above are what you actually want published.
2. Get both `privacy.html` and `terms.html` reviewed by a solicitor before
   launch — Irish/EU consumer protection and distance-selling rules apply,
   and these were written to match the site's real behaviour but aren't
   legal advice.
3. **Important:** `terms.html`'s cancellation section explains that losing
   the EU 14-day cooling-off right (for the instantly-delivered booklet, and
   for the memorial builder once someone starts using it) requires
   collecting *explicit consent* from the buyer at the point of purchase —
   not just stating it in the terms. Neither checkout flow currently
   collects that consent, so this exception doesn't yet validly apply. A
   consent checkbox needs adding to `create-checkout.mjs`'s and
   `create-memorial-checkout.mjs`'s Stripe Checkout sessions (Stripe
   supports custom checkboxes via `consent_collection`) before this section
   is more than a description of what *should* happen.

**Fixed in this pass (Phase 4 — protecting customer content):**
- Server-side rate limiting on candle lighting, guestbook submissions,
  the contact form, and sign-in link requests. Privacy-preserving by
  design: the caller's address is hashed before it touches storage,
  buckets are short-lived, and it fails open (allows the request) if the
  address can't be read, rather than ever blocking a real visitor over an
  infrastructure quirk.
- Baseline security headers (`X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`) added to `netlify.toml`. A
  Content-Security-Policy is deliberately **not** included yet — this site
  uses inline `<script>` tags throughout, and a CSP strict enough to help
  would need nonces/hashes added everywhere plus live testing against
  Stripe, Google Fonts, and Resend before it's safe to ship untested.
- Routine, automated backups: `scripts/backup-memorials.mjs` takes a
  complete private snapshot (everything, including drafts and private
  pages — unlike the public wind-down archive), and
  `.github/workflows/backup.yml` runs it daily, storing the result as a
  private, auto-expiring GitHub Actions artifact rather than committing
  personal data into git history. **Requires setup**: add `NETLIFY_SITE_ID`
  and `NETLIFY_API_TOKEN` as repository secrets (Settings → Secrets and
  variables → Actions) before this will run.
- `scripts/restore-memorial.mjs` restores one record from a backup —
  added so the backup process can actually be *proven* to work via a
  periodic restore test, not just trusted on faith. Refuses to overwrite
  an existing record unless `--force` is passed.
- Resend's raw error response is no longer logged on failed sends (in
  `request-link.mjs` and `send-contact.mjs`) — it can echo back the
  recipient's email address, which doesn't belong in server logs.
- Contact page now shows a visible fallback support email (placeholder —
  same missing-info blocker as above) so the "email us directly instead"
  message in `send-contact.mjs` actually points somewhere.

**Still open otherwise:** autosave-failure wording still promises a retry
that isn't scheduled, and `saveNow()` can return before an in-flight save
finishes if Publish is pressed mid-save. See the review for the complete
list.

**Photos are now stored as separate Blob objects, not embedded in the
memorial JSON.** This was the last big item from Phase 4:
- New `photos` Blobs store, separate from `memorials`. Each photo gets a
  memorial-scoped, content-addressed id (`{memorialId}.{hash}`) — content
  hashing dedupes identical re-uploads during editing, and scoping by
  memorial means a permanent deletion can always clean up exactly its own
  photos with zero risk of touching another memorial.
- New endpoints: `upload-photo.mjs` (validates type/size, rate-limited by
  reference, called once per photo right after the browser resizes it) and
  `get-photo.mjs` (serves it back with aggressive immutable caching, since
  a given id's bytes can never change).
- `save-memorial.mjs` no longer carries any image data at all — just short
  id strings. Payload ceiling dropped from 12MB to 300KB accordingly. A
  story edit no longer re-sends every photo just to save one sentence.
- `purgeMemorial` now deletes a record's photo blobs on permanent
  deletion — previously they'd have silently survived, which didn't match
  what `privacy.html`/`terms.html` promise ("everything on it" removed).
- `archive-memorials.mjs`, `backup-memorials.mjs`, and
  `restore-memorial.mjs` all updated to fetch/write/restore actual photo
  bytes — without this they'd have silently broken (archive) or stopped
  containing any photos at all (backup/restore) the moment this shipped.
- `builder.html`: photo selection now shows an instant local preview while
  uploading in the background; `saveNow()` waits for any in-flight uploads
  before saving, so a fast typist can't save a photo id that doesn't exist
  yet. `remember.html` now builds `get-photo` URLs from ids instead of
  using the field directly as an `<img src>`.

**How this was verified**, since it touched 10+ interconnected files and
I can't test against live Netlify Blobs from here: built an in-memory mock
of `@netlify/blobs` and Stripe, then ran the *actual* handler modules
(`upload-photo.mjs`, `get-photo.mjs`, `save-memorial.mjs`,
`delete-memorial.mjs`) against them directly — 20 checks covering upload,
content-hash dedup, product-mismatch rejection, malformed-input rejection,
byte-perfect round-trip through `get-photo`, and cleanup on permanent
deletion, all passing. Then went a level further and drove the real
`builder.html` and `remember.html` through an actual headless browser
against the same mocked backend end-to-end: uploaded a real photo through
the file input, watched it save, published the page, loaded the public
`remember.html` URL, and confirmed the browser actually decoded the image
bytes served back (`naturalWidth` non-zero). This isn't a substitute for
testing against a real Netlify deploy before launch, but it's a real
functional test of the actual code paths, not just a syntax check.

## Admin tool

`admin.html` (password-gated via `ADMIN_PASSWORD`) is an internal support
tool — not linked from anywhere on the public site. It covers:

- Search memorials by name, owner email, slug, or Stripe reference
- View full detail for one, **including messages still pending
  moderation** — normally only the owner can see these at all
- Approve / hide / delete guestbook messages on an owner's behalf
- Change privacy, guestbook, moderation, and closure settings on an
  owner's behalf
- Resend a sign-in link to a specific memorial's owner
- **Regenerate & resend the wishes booklet** with corrected names — there's
  no stored booklet record to edit (the names live only in the completed
  Stripe Checkout Session, which can't be edited after the fact), so this
  regenerates the PDF from scratch and emails it; the original Stripe order
  is untouched

Sessions last 12 hours. Login attempts are rate-limited (5 per 15 minutes
per address) against brute-forcing the password. This is one shared
password for one operator — if this project ever needs more than one
admin, replace this with real per-person accounts rather than sharing the
password further.

## Local development

```
npm install
netlify dev
```

Requires the [Netlify CLI](https://docs.netlify.com/cli/get-started/) and
the environment variables above set locally (`netlify env:pull` after
linking the site, or a `.env` file — see `.gitignore`, `.env` is already
excluded from version control).
