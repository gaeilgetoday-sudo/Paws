// netlify/functions/get-booklet.mjs
//
// Called from success.html once Stripe redirects back with a session_id.
// Verifies the payment actually went through (never trust the URL alone),
// pulls the pet's name and owner's name off the Checkout Session's custom
// fields, stamps them onto the cover of the pre-built booklet template, and
// streams the personalized PDF straight back as a download.
//
// Required environment variable:
//   STRIPE_SECRET_KEY   same as in create-checkout.mjs
//
import Stripe from "stripe";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "assets", "booklet-template.pdf");

const AMBER = rgb(0xd9 / 255, 0x8a / 255, 0x3d / 255);
const PAPER_MUTED = rgb(0xa9 / 255, 0xc4 / 255, 0xbc / 255);

function sanitize(str, fallback) {
  if (!str) return fallback;
  const cleaned = str.replace(/[\r\n\t]/g, " ").trim().slice(0, 60);
  return cleaned || fallback;
}

async function stampCover(templateBytes, petName, ownerName) {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const cover = pdfDoc.getPages()[0];
  const { width } = cover.getSize();

  const italic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Coordinates measured against the actual cover layout (A4, 595.28 x
  // 841.89pt) — sits in the gap between the tagline and the trademark line.
  // Font sizes auto-shrink for unusually long names so the line never runs
  // off the page.
  const MAX_LINE_WIDTH = 500; // keeps a comfortable margin either side

  const line1 = `A wishes booklet for ${petName}`;
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

  pdfDoc.setTitle(`${petName}'s Wishes Booklet \u2014 Kindred Paws`);
  pdfDoc.setAuthor("Kindred Paws");
  pdfDoc.setSubject(`Personalized wishes booklet prepared for ${petName}`);

  return pdfDoc.save();
}

export default async (req) => {
  const sessionId = new URL(req.url).searchParams.get("session_id");
  if (!sessionId) {
    return new Response("Missing session_id.", { status: 400 });
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    console.error("Could not retrieve Stripe session:", err);
    return new Response("Could not verify payment.", { status: 400 });
  }

  if (session.payment_status !== "paid") {
    return new Response("Payment not completed.", { status: 402 });
  }

  const fields = Object.fromEntries(
    (session.custom_fields || []).map((f) => [f.key, f.text?.value])
  );
  const petName = sanitize(fields.pet_name, "your pet");
  const ownerName = sanitize(fields.owner_name, "you");

  let templateBytes;
  try {
    templateBytes = fs.readFileSync(TEMPLATE_PATH);
  } catch (err) {
    console.error("Could not read booklet template:", err);
    return new Response("The booklet template is missing on the server.", {
      status: 500,
    });
  }

  const pdfBytes = await stampCover(templateBytes, petName, ownerName);
  const filenameSafe =
    petName.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-+|-+$/g, "") ||
    "pet";

  return new Response(pdfBytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="kindred-paws-wishes-booklet-${filenameSafe}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
};
