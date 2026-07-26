# Kindred Paws — Private Beta Test Plan

This is Phase 5 from `kindred-paws-launch-review.md`: run the complete
customer journey with real people before accepting general public payments.
Nothing here should be skipped because a step "obviously works" — the
point of a beta is to find the things that don't.

**Do not open the site to public payments until every checklist below is
complete, in Stripe *live* mode, on the actual deployed Netlify site — not
`netlify dev`, not localhost.**

---

## 0. Before you invite anyone

Environment variables (see `README.md` for the full table) — confirm every
one of these is actually set in Netlify, not just planned:

- [ ] `STRIPE_SECRET_KEY` (test mode key, `sk_test_...`, for this whole beta)
- [ ] `STRIPE_PRICE_ID` (booklet)
- [ ] `STRIPE_MEMORIAL_PRICE_ID` (memorial)
- [ ] `RESEND_API_KEY`
- [ ] `MAIL_FROM` (a real verified domain — a Gmail address won't work here)
- [ ] `CONTACT_TO`
- [ ] Netlify Blobs enabled for the site

Stripe:
- [ ] Both products exist in **test mode** with the correct prices and the
  checkout functions are pointed at their test-mode Price IDs
- [ ] Test-mode webhook/redirect URLs resolve to the real deployed site,
  not a preview URL that will disappear

GitHub Actions backup:
- [ ] `NETLIFY_SITE_ID` and `NETLIFY_API_TOKEN` added as repo secrets
- [ ] Manually trigger the backup workflow once (Actions tab →
  "Backup memorials" → **Run workflow**) and confirm it succeeds and
  produces a downloadable artifact — don't wait for the 3:17am cron to
  find out it's broken

Recruit **at least 3–4 testers** who aren't you and aren't each other —
people who'll genuinely click the wrong thing, use a weird email address,
or try the site on their phone in a car park with bad signal. That's more
valuable than a careful walkthrough by someone who already knows how it's
supposed to work.

Test card for all Stripe test-mode payments: `4242 4242 4242 4242`, any
future expiry, any CVC, any postcode.

---

## 1. The wishes booklet (€19)

- [ ] Buy the booklet from the homepage with a real-looking pet name and
  owner name containing an apostrophe or accent (e.g. `O'Malley`, `Aoife`) —
  confirms text handling isn't broken by punctuation
- [ ] Confirm the PDF downloads immediately on the success page with both
  names correctly stamped on the cover
- [ ] Open the PDF on a phone, not just a laptop
- [ ] Re-visit the success page URL a second time (refresh, or reopen the
  link) — the download should still work, not error out
- [ ] Confirm the booklet's session_id **cannot** be reused to unlock a
  memorial page (this was a real bug that's since been fixed — worth
  deliberately re-checking): try pasting a booklet's `session_id` into a
  memorial builder URL (`builder.html?session_id=...`) and confirm it's
  rejected, not silently accepted

## 2. Buying and building a memorial page (€29)

- [ ] Buy a memorial page, land in the builder
- [ ] Close the tab immediately after payment, before typing anything —
  reopen the original success/builder link and confirm it still unlocks
  (tests that a draft record gets created even before the first explicit
  save)
- [ ] Fill in every field across all 10 steps, including an unusual
  species, a long story (paste a few paragraphs), and a "Loved by" field
- [ ] Upload a hero photo, confirm it appears in the live preview within a
  couple of seconds
- [ ] Upload the full 8 memory photos, confirm all 8 appear and the app
  stops you from adding a 9th
- [ ] Remove a memory photo, confirm it's actually gone from the preview
  and stays gone after a page refresh
- [ ] **Cross-device test:** start a page on a phone, don't publish, then
  request a sign-in link by email and continue editing on a laptop —
  confirm the draft (including photos) is there
- [ ] Publish the page, confirm the QR code on the publish screen actually
  scans (with a real phone camera, not just visually) and opens the
  correct link
- [ ] Visit the published link in a private/incognito window (i.e. as a
  stranger would) and confirm the photo, story, and "Loved by" field all
  display correctly

## 3. Privacy settings

- [ ] Publish one memorial as **Public** — confirm it's reachable, and
  check the page source (`Ctrl+U` / `View Source`) shows
  `<meta name="robots" content="index, follow">` rather than the default
  noindex (this is JS-applied, so also confirm it doesn't flash the wrong
  value for long before correcting itself)
- [ ] Publish one as **Unlisted** — confirm it's reachable by direct link
  and the robots tag stays `noindex, nofollow`
- [ ] Try to set a page to **Private**, then open its public link in an
  incognito window — confirm it returns "not found," not the page content
- [ ] Confirm the builder's description of each privacy option matches
  what actually happens (no promise of an invite system for Private —
  that's been removed, but double check the current wording still reads
  correctly)

## 4. Guestbook

- [ ] As a visitor, leave a message on a page with moderation **on** —
  confirm it does *not* appear publicly until approved
- [ ] As the owner, approve it from the manage page — confirm it now
  appears publicly
- [ ] As the owner, reject/hide a different message — confirm it never
  appears publicly
- [ ] Turn moderation **off** on a different page, leave a message as a
  visitor — confirm it appears immediately, and that the guestbook's
  wording on that page actually says messages appear right away (not the
  default "reviewed by the family" text)
- [ ] Try submitting more than ~8 guestbook messages from the same
  connection to one page in quick succession — confirm you eventually get
  a "please wait" rate-limit response rather than all of them going through
- [ ] **Guestbook closure** — the real setting is 8 weeks / 6 months / 1
  year, too long to wait during a beta. Test it directly instead:
  1. Publish a page with `closeAfter` set to `8w`.
  2. Open the Netlify Blobs UI (Netlify dashboard → your site → Blobs →
     `memorials` store → `memorial/{id}`) and manually edit that record's
     `publishedAt` field to a date more than 8 weeks in the past.
  3. Reload the public page — confirm the guestbook form is now hidden
     with a "this guestbook is now closed" message, and that submitting
     directly against `submit-message.mjs` (e.g. via a manual request)
     is rejected with a 403, not just hidden client-side.
  4. Repeat at least once for `6m` or `1y` to confirm the duration
     calculation itself is correct, not just the `8w` case.

## 5. Candles

- [ ] Light a candle as a visitor, confirm the count increases
- [ ] Refresh the page — confirm the button now shows "you've lit a
  candle" rather than inviting a second light (this is a courtesy via
  localStorage, not a hard rule — try it in a different browser or
  incognito window and confirm you *can* light a second one from there,
  which is expected)
- [ ] Try lighting more than 5 candles on one page within 10 minutes from
  the same connection (e.g. by clearing localStorage and reloading
  repeatedly) — confirm the rate limit eventually kicks in

## 6. Sign-in links and multiple memorials per email

- [ ] Request a sign-in link for an email with **no** memorial attached —
  confirm you get the same generic "if there's a page..." message as a
  real address would (i.e. it doesn't reveal whether the address has a
  page)
- [ ] Buy and build **two separate memorials with the same email address**
  — this was a real bug where the second purchase used to silently make
  the first one unreachable from sign-in. Confirm requesting a sign-in
  link now emails links to **both** pages, not just the most recent one
- [ ] Confirm a sign-in link actually expires after 30 minutes (or at
  least confirm it's rejected well after that window — waiting the full
  30 minutes is reasonable to actually do once)
- [ ] Confirm a sign-in link can't be used twice — click it, then try the
  same link again from the same email
- [ ] Request sign-in links repeatedly (10+ times in an hour) from the
  same connection for different addresses — confirm the per-connection
  rate limit eventually kicks in (still returns the generic message, just
  stops actually sending)

## 7. Deletion and recovery

- [ ] Delete a memorial page (the "hide, recoverable for 30 days" option)
  — confirm the public link immediately stops working
- [ ] Undo the deletion from the manage page — confirm the public link
  works again, unchanged
- [ ] Permanently delete a different memorial (type the pet's name to
  confirm) — confirm:
  - the public link is gone
  - the manage/sign-in link for it no longer works
  - (if you have Blobs dashboard access) the photo blobs referenced by
    that record are actually gone from the `photos` store, not just the
    JSON record
- [ ] Confirm deleting a memorial that shares an email with another
  memorial does **not** affect the other one's sign-in access

## 8. Contact form and refunds

- [ ] Submit the contact form with a real question — confirm it arrives
  at the configured `CONTACT_TO` inbox with a working reply-to address
- [ ] Submit it more than 5 times in an hour — confirm the rate limit
  eventually kicks in
- [ ] **Refund walkthrough** (test mode): buy a memorial, then in the
  Stripe test-mode dashboard issue a refund for that payment. Confirm:
  - the page itself isn't automatically taken down (nothing currently
    does this automatically — decide if that's the behaviour you want,
    or if a refund should also trigger deletion; this is a product
    decision, not something the code assumes for you)
  - you have a real, written process for what a support reply to a
    refund request actually says and does, since nothing automates it

## 9. Backups

- [ ] Manually trigger the GitHub Actions backup workflow, download the
  resulting artifact, and confirm it actually contains the memorials
  you've created in this beta (JSON records, guestbooks, and photo files)
- [ ] Run `scripts/restore-memorial.mjs` against a **throwaway test
  memorial id** (not a real one) from that backup, confirm it restores
  correctly including its photo, then permanently delete the test
  restoration afterwards
- [ ] Confirm you understand this needs repeating periodically once live —
  a backup that's never been restored from is a hope, not a safeguard

## 10. Legal and support

- [ ] Read `privacy.html` and `terms.html` end to end as if you were a
  customer, not the developer — do they actually make sense, and do the
  entity details (name, address, email) reflect what you actually want
  published?
- [ ] Have both reviewed by a solicitor before public launch — this still
  hasn't happened and shouldn't be skipped because the beta goes well
- [ ] Confirm the checkout consent-collection gap noted in `terms.html`'s
  cancellation section has either been fixed (a real consent checkbox
  added to both Stripe Checkout flows) or you've deliberately decided to
  accept that risk for the beta specifically — don't let it carry into
  public launch by default

---

## Sign-off

Beta is complete when every box above is checked, by more than one person,
on the real deployed site, with real (test-mode) payments — not when it
seems like it would probably work. Keep a copy of this file with the boxes
checked and dated; it's useful evidence of what was actually verified if
anything comes up later.

**Only after this is fully checked off:** swap `STRIPE_SECRET_KEY` and the
two Price IDs to live mode, and remove any remaining test/throwaway
memorials created during this beta from the live store before announcing
launch.
