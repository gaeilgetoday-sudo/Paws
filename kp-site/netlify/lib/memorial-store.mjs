// netlify/lib/memorial-store.mjs
//
// Shared storage helpers for memorial pages, built on Netlify Blobs.
//
// Layout inside the "memorials" store:
//   memorial/{id}   -> the full record (draft or published)
//   slug/{slug}     -> { id }        lookup index for public URLs
//   guestbook/{id}  -> [ entries ]   kept separate so a busy guestbook
//                                     never rewrites the whole memorial
//
// Strong consistency is used throughout: someone publishes and immediately
// opens their own link, so a stale read would look like the page failed.

import { getStore } from "@netlify/blobs";
import Stripe from "stripe";

export const store = () => getStore({ name: "memorials", consistency: "strong" });

// ---------------------------------------------------------------- ids & slugs

export function newId() {
  // Unguessable — this is what makes an "unlisted" page genuinely unlisted.
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function slugify(name) {
  const base = (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  return base || "their-story";
}

/**
 * Random suffix for slugs. Uses crypto rather than Math.random() because on an
 * unlisted page the URL *is* the access control — a predictable suffix would
 * make "only people with the link" untrue.
 */
function randomSuffix(len = 8) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export async function allocateSlug(name) {
  const s = store();
  const base = slugify(name);
  // Always suffix: keeps URLs unguessable, and sidesteps two pets sharing a name.
  for (let attempt = 0; attempt < 6; attempt++) {
    const suffix = randomSuffix();
    const candidate = `${base}-${suffix}`;
    const existing = await s.get(`slug/${candidate}`, { type: "json" });
    if (!existing) return candidate;
  }
  return `${base}-${newId().slice(0, 8)}`;
}

// ---------------------------------------------------------------- records

export async function getMemorial(id) {
  if (!id || !/^[a-f0-9]{24}$/.test(id)) return null;
  return await store().get(`memorial/${id}`, { type: "json" });
}

export async function putMemorial(record) {
  record.updatedAt = new Date().toISOString();
  await store().setJSON(`memorial/${record.id}`, record);
  return record;
}

export async function getMemorialBySlug(slug) {
  if (!slug || !/^[a-z0-9-]{1,60}$/.test(slug)) return null;
  const pointer = await store().get(`slug/${slug}`, { type: "json" });
  if (!pointer?.id) return null;
  return await getMemorial(pointer.id);
}

export async function findByReference(reference) {
  if (!reference) return null;
  const s = store();
  // Index first — a scan is the fallback for records written before the index
  // existed, and it heals them on the way past.
  const pointer = await s.get(`ref/${reference}`, { type: "json" });
  if (pointer?.id) {
    const rec = await getMemorial(pointer.id);
    if (rec) return rec;
  }
  const { blobs } = await s.list({ prefix: "memorial/" });
  for (const b of blobs) {
    const rec = await s.get(b.key, { type: "json" });
    if (rec?.reference === reference) {
      await s.setJSON(`ref/${reference}`, { id: rec.id });
      return rec;
    }
  }
  return null;
}

/** Records the lookup indexes for a memorial. Safe to call repeatedly. */
export async function indexMemorial(record) {
  const s = store();
  await s.setJSON(`ref/${record.reference}`, { id: record.id });
  if (record.ownerEmail) {
    await s.setJSON(`owner/${emailKey(record.ownerEmail)}`, { id: record.id });
  }
}

export function emailKey(email) {
  return (email || "").trim().toLowerCase().replace(/[^a-z0-9@._+-]/g, "");
}

export async function findByEmail(email) {
  const key = emailKey(email);
  if (!key) return null;
  const pointer = await store().get(`owner/${key}`, { type: "json" });
  if (!pointer?.id) return null;
  return await getMemorial(pointer.id);
}

// ---------------------------------------------------------------- login links
//
// Single-use tokens rather than signed cookies: nothing to configure, and a
// used or expired token is genuinely gone rather than merely disbelieved.

const LINK_TTL_MS = 30 * 60 * 1000;   // 30 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // one email a minute per address

export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createLoginToken(memorialId) {
  const token = newToken();
  await store().setJSON(`login/${token}`, {
    id: memorialId,
    expires: Date.now() + LINK_TTL_MS,
  });
  return token;
}

export async function redeemLoginToken(token) {
  if (!token || !/^[a-f0-9]{48}$/.test(token)) return null;
  const s = store();
  const entry = await s.get(`login/${token}`, { type: "json" });
  if (!entry) return null;
  await s.delete(`login/${token}`); // single use, spent on sight
  if (Date.now() > entry.expires) return null;
  return await getMemorial(entry.id);
}

/** Returns false if this address was emailed within the cooldown window. */
export async function checkAndMarkSend(email) {
  const s = store();
  const key = `sendlog/${emailKey(email)}`;
  const last = await s.get(key, { type: "json" });
  if (last?.at && Date.now() - last.at < RESEND_COOLDOWN_MS) return false;
  await s.setJSON(key, { at: Date.now() });
  return true;
}

// ---------------------------------------------------------------- guestbook

export async function getGuestbook(id) {
  return (await store().get(`guestbook/${id}`, { type: "json" })) || [];
}

export async function putGuestbook(id, entries) {
  await store().setJSON(`guestbook/${id}`, entries);
}

// ---------------------------------------------------------------- auth
//
// The Stripe session id is the owner's bearer token — long, random, and only
// ever given to the person who paid. It's verified against Stripe once, when
// the memorial is first created; after that we just check it matches the
// reference stored on the record, so ordinary saves don't wait on Stripe.

export async function verifyPaidReference(reference) {
  if (!reference || typeof reference !== "string") return false;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(reference);
    return session?.payment_status === "paid";
  } catch (err) {
    console.error("Stripe verification failed:", err?.message);
    return false;
  }
}

/**
 * Resolves the memorial a request is authorised to touch.
 * Returns { record } on success, or { error, status } to hand straight back.
 */
export async function authorise(reference) {
  if (!reference) return { error: "Missing reference.", status: 401 };
  const record = await findByReference(reference);
  if (!record) return { error: "No memorial found for this reference.", status: 404 };
  return { record };
}

// ---------------------------------------------------------------- deletion
//
// Two speeds, deliberately. Grief is volatile, and a page holding the only
// copies of certain photos plus messages from a vet and grandparents is not
// something to lose to a decision made at 3am. So the ordinary path hides the
// page instantly (which is what someone actually wants) but keeps the data
// recoverable for a while. The immediate path exists because some people
// genuinely mean now, and making them wait would be its own kind of unkind.

export const GRACE_DAYS = 30;

/** Marks a page for deletion: invisible at once, recoverable for 30 days. */
export async function softDelete(record) {
  record.deletedAt = new Date().toISOString();
  record.purgeAfter = Date.now() + GRACE_DAYS * 86400000;
  // Deliberately does NOT touch `published`. Every public endpoint already
  // refuses a deleted record, so clearing it here bought nothing — and it
  // silently broke restore, because undoing a deletion had no way of knowing
  // whether the page had been live beforehand.
  await putMemorial(record);
  return record;
}

export async function undoDelete(record) {
  delete record.deletedAt;
  delete record.purgeAfter;
  await putMemorial(record);
  return record;
}

/**
 * Removes a memorial and everything attached to it. The slug pointer goes too,
 * so an old link resolves to nothing rather than to someone else's page later.
 */
export async function purgeMemorial(record) {
  const s = store();
  await s.delete(`guestbook/${record.id}`);
  if (record.slug) await s.delete(`slug/${record.slug}`);
  if (record.reference) await s.delete(`ref/${record.reference}`);
  if (record.ownerEmail) await s.delete(`owner/${emailKey(record.ownerEmail)}`);
  await s.delete(`memorial/${record.id}`);
}

/** True once a page is deleted — even inside the grace period. */
export function isDeleted(record) {
  return !!record?.deletedAt;
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Strips anything that should never reach a public visitor. */
export function publicView(record, guestbook) {
  return {
    name: record.name,
    species: record.species,
    born: record.born,
    died: record.died,
    lovedBy: record.lovedBy,
    photo: record.photo,
    story: record.story,
    memories: record.memories || [],
    privacy: record.privacy,
    guestbookOn: record.guestbookOn,
    closeAfter: record.closeAfter,
    celebration: record.celebEnabled
      ? {
          title: record.celebTitle,
          date: record.celebDate,
          location: record.celebLoc,
          kids: record.celebKids,
          memory: record.celebMemory,
          donations: record.celebDonations,
        }
      : null,
    candles: record.candles || 0,
    // Approved messages only — pending ones are invisible until the owner says so.
    messages: (guestbook || [])
      .filter((m) => m.status === "approved")
      .map((m) => ({ name: m.name, message: m.message, at: m.at })),
    // Deliberately absent: ownerEmail, reference, id, pending messages.
  };
}
