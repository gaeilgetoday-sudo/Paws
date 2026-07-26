// netlify/lib/booklet.mjs
//
// Shared booklet-generation logic — stamping the personalized cover onto
// the template PDF, and verifying + reading a Stripe session's booklet
// order details. Used by both get-booklet.mjs (the direct download) and
// email-booklet.mjs (the automatic backup copy sent to the buyer's inbox),
// so the two can never quietly drift out of sync with each other.

import Stripe from "stripe";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "fs";
import { fileURLToPath } from "url";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Not `const __dirname = path.dirname(fileURLToPath(import.meta.url))` —
// Netlify's esbuild bundling step injects its own __dirname for CommonJS
// compatibility, and a manually-declared one in the same scope collided
// with it at runtime ("Identifier '__dirname' has already been declared").
// Resolving the path straight from a relative URL sidesteps needing
// __dirname at all.
const TEMPLATE_PATH = fileURLToPath(new URL("../functions/assets/booklet-template.pdf", import.meta.url));

const AMBER = rgb(0xd9 / 255, 0x8a / 255, 0x3d / 255);
const PAPER_MUTED = rgb(0xa9 / 255, 0xc4 / 255, 0xbc / 255);
const FOOTER_MUTED = rgb(0x8a / 255, 0x7f / 255, 0x6d / 255); // matches the printed footer text colour

export function sanitize(str, fallback) {
  if (!str) return fallback;
  let cleaned = str.replace(/[\r\n\t]/g, " ").trim();
  // Belt-and-braces: if someone types "or Billy" or "and O'Flaherty" out of
  // habit (the old field label read "...(or family name)", which invited
  // exactly this), drop the stray leading word rather than print it.
  cleaned = cleaned.replace(/^(or|and)\s+/i, "").trim();
  cleaned = cleaned.slice(0, 60);
  return cleaned || fallback;
}

export async function stampBooklet(templateBytes, petName, ownerName, orderDate, orderRef) {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const pages = pdfDoc.getPages();
  const cover = pages[0];
  const { width } = cover.getSize();

  const italic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Coordinates measured against the actual cover layout (A4, 595.28 x
  // 841.89pt) — sits in the gap between the tagline and the trademark line.
  // Font sizes auto-shrink for unusually long names so the line never runs
  // off the page.
  const MAX_LINE_WIDTH = 500; // keeps a comfortable margin either side

  const line1 = `For ${petName}`;
  let size1 = 17;
  while (italic.widthOfTextAtSize(line1, size1) > MAX_LINE_WIDTH && size1 > 9) {
    size1 -= 0.5;
  }
  const w1 = italic.widthOfTextAtSize(line1, size1);
  cover.drawText(line1, {
    x: (width - w1) / 2,
    y: 362,
    size: size1,
    font: italic,
    color: AMBER,
  });

  const line2 = `Prepared with love by ${ownerName}`;
  let size2 = 10.5;
  while (helv.widthOfTextAtSize(line2, size2) > MAX_LINE_WIDTH && size2 > 7) {
    size2 -= 0.5;
  }
  const w2 = helv.widthOfTextAtSize(line2, size2);
  cover.drawText(line2, {
    x: (width - w2) / 2,
    y: 336,
    size: size2,
    font: helv,
    color: PAPER_MUTED,
  });

  // Order date — a soft ownership marker (turns the cover into "a specific
  // transaction record" rather than a generic template anyone could have)
  // and a helpful anchor for the person's own records.
  const line3 = `Ordered ${orderDate}`;
  const size3 = 8.5;
  const w3 = helv.widthOfTextAtSize(line3, size3);
  cover.drawText(line3, {
    x: (width - w3) / 2,
    y: 316,
    size: size3,
    font: helv,
    color: PAPER_MUTED,
  });

  pdfDoc.setTitle(`${petName}'s copy of Just In Case, With Love \u2014 Kindred Paws`);
  pdfDoc.setAuthor("Kindred Paws");
  pdfDoc.setSubject(`Personalized keepsake prepared for ${petName}`);
  // Hidden fingerprint — invisible in any normal viewer, only visible via
  // File > Properties. Not a copy-prevention measure, just traceability: if
  // a copy ever surfaces somewhere public, this ties it back to the order
  // it came from without affecting the reading experience at all.
  pdfDoc.setKeywords([`order-ref:${orderRef}`, `ordered:${orderDate}`]);

  // Stamp the pet's name into the footer of every interior page too (not
  // just the cover) — a light deterrent against photocopying or sharing a
  // page in isolation, since every page quietly says whose copy it is.
  // Skips page 1 (cover, already personalized above) and the last page
  // (dark closing page), matching exactly where the printed footer already
  // appears in the template.
  const footerText = `Personalized for ${petName}`;
  const FOOTER_MAX_WIDTH = 260; // fits comfortably in the gap between the
                                  // brand mark and the page number
  let footerSize = 8;
  while (
    helv.widthOfTextAtSize(footerText, footerSize) > FOOTER_MAX_WIDTH &&
    footerSize > 6
  ) {
    footerSize -= 0.5;
  }
  const footerWidth = helv.widthOfTextAtSize(footerText, footerSize);

  // Only the 29 numbered content pages carry a footer at all now (front
  // matter — cover, Contents — and the closing page are unnumbered), so
  // the personalization stamp only belongs on those same pages: physical
  // pages 3..31, i.e. indices 2..30.
  for (let i = 2; i < pages.length - 1; i++) {
    const page = pages[i];
    page.drawText(footerText, {
      x: (width - footerWidth) / 2,
      y: 31.2, // matches the printed footer baseline (BM - 13mm from the
                // Python template)
      size: footerSize,
      font: helv,
      color: FOOTER_MUTED,
    });
  }

  return pdfDoc.save();
}

/**
 * Verifies a Stripe session is a genuinely paid booklet purchase and
 * returns everything needed to generate its PDF. Returns { error, status }
 * on any failure, or { session, petName, ownerName, orderDate } on success.
 */
export async function verifyBookletSession(sessionId) {
  if (!sessionId) return { error: "Missing session_id.", status: 400 };

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    console.error("Could not retrieve Stripe session:", err);
    return { error: "Could not verify payment.", status: 400 };
  }

  if (session.payment_status !== "paid") {
    return { error: "Payment not completed.", status: 402 };
  }

  // A paid session alone isn't enough — it must be a paid session for *this*
  // product. Without this check, a memorial purchase's session_id would also
  // unlock a free booklet download.
  if (session.metadata?.product !== "booklet") {
    return { error: "This purchase isn't for the wishes booklet.", status: 402 };
  }

  const fields = Object.fromEntries(
    (session.custom_fields || []).map((f) => [f.key, f.text?.value])
  );
  const petName = sanitize(fields.pet_name, "your pet");
  const ownerName = sanitize(fields.owner_name, "you");
  const orderDate = new Date(session.created * 1000).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return { session, petName, ownerName, orderDate };
}

export async function generateBookletPdf(petName, ownerName, orderDate, orderRef) {
  const templateBytes = fs.readFileSync(TEMPLATE_PATH);
  return stampBooklet(templateBytes, petName, ownerName, orderDate, orderRef);
}

export function bookletFilename(petName) {
  const safe =
    petName.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-+|-+$/g, "") || "pet";
  return `just-in-case-with-love-${safe}.pdf`;
}
