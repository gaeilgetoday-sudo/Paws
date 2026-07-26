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

export async function allocateSlug(name) {
  const s = store();
  const base = slugify(name);
  // Always suffix: keeps URLs unguessable, and sidesteps two pets sharing a name.
  for (let attempt = 0; attempt < 6; attempt++) {
    const suffix = Math.random().toString(36).slice(2, 7);
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
    const key = `owner/${emailKey(record.ownerEmail)}`;
    const pointer = await s.get(key, { type: "json" });
    // One email can own several memorials (e.g. more than one pet over
    // time), so this is an array of ids rather than a single pointer —
    // otherwise a later purchase would silently make an earlier memorial
    // unreachable from sign-in.
    const ids = Array.isArray(pointer?.ids) ? pointer.ids : (pointer?.id ? [pointer.id] : []);
    if (!ids.includes(record.id)) ids.push(record.id);
    await s.setJSON(key, { ids });
  }
}

export function emailKey(email) {
  return (email || "").trim().toLowerCase().replace(/[^a-z0-9@._+-]/g, "");
}

/** Returns every memorial linked to this email address, newest first. */
export async function findAllByEmail(email) {
  const key = emailKey(email);
  if (!key) return [];
  const pointer = await store().get(`owner/${key}`, { type: "json" });
  const ids = Array.isArray(pointer?.ids) ? pointer.ids : (pointer?.id ? [pointer.id] : []);
  const records = await Promise.all(ids.map((id) => getMemorial(id)));
  return records
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

/** Removes one memorial id from an owner's index without touching the rest. */
export async function unindexOwner(email, id) {
  const key = emailKey(email);
  if (!key) return;
  const s = store();
  const storeKey = `owner/${key}`;
  const pointer = await s.get(storeKey, { type: "json" });
  const ids = Array.isArray(pointer?.ids) ? pointer.ids : (pointer?.id ? [pointer.id] : []);
  const remaining = ids.filter((existingId) => existingId !== id);
  if (remaining.length) {
    await s.setJSON(storeKey, { ids: remaining });
  } else {
    await s.delete(storeKey);
  }
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

// ---------------------------------------------------------------- rate limiting
//
// Deliberately not IP tracking in the way analytics tools do: the address is
// hashed before it ever touches storage, nothing links back to who someone
// is, and each bucket only exists to answer "has this address done this too
// many times, too fast" — not to build a picture of anyone. If we can't read
// an address at all, this fails open (allows the request) rather than
// blocking a real visitor over an infrastructure quirk.

async function hashIdentifier(raw) {
  const enc = new TextEncoder().encode(`kp-ratelimit:${raw}`);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/** Reads the caller's address from what Netlify Functions provide. */
export function clientIp(req, context) {
  return context?.ip || req.headers.get("x-nf-client-connection-ip") || null;
}

/**
 * True if this address is still within its limit for this bucket; also
 * records the attempt. `windowMs` buckets reset naturally on the next check
 * once they've expired, rather than needing a separate cleanup job.
 */
export async function checkRateLimit(bucket, address, { max, windowMs }) {
  if (!address) return true;
  const s = store();
  const key = `ratelimit/${bucket}/${await hashIdentifier(address)}`;
  const now = Date.now();
  const entry = await s.get(key, { type: "json" });
  if (!entry || now - entry.windowStart > windowMs) {
    await s.setJSON(key, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= max) return false;
  await s.setJSON(key, { windowStart: entry.windowStart, count: entry.count + 1 });
  return true;
}

// ---------------------------------------------------------------- guestbook

const CLOSE_AFTER_MS = {
  "8w": 8 * 7 * 86400000,
  "6m": Math.round(365.25 / 2) * 86400000,
  "1y": Math.round(365.25) * 86400000,
};

/** True once the owner's chosen closure window has elapsed since publish. */
export function isGuestbookClosed(record) {
  if (!record.closeAfter || record.closeAfter === "never") return false;
  if (!record.publishedAt) return false;
  const windowMs = CLOSE_AFTER_MS[record.closeAfter];
  if (!windowMs) return false;
  return Date.now() - new Date(record.publishedAt).getTime() > windowMs;
}

export async function getGuestbook(id) {
  return (await store().get(`guestbook/${id}`, { type: "json" })) || [];
}

export async function putGuestbook(id, entries) {
  await store().setJSON(`guestbook/${id}`, entries);
}

// ---------------------------------------------------------------- photos
//
// Photos live in their own Blobs store, one object per photo, referenced
// from a memorial record by a short id rather than embedded as Base64. That
// keeps every autosave lightweight (it's just text after this), and means a
// photo only crosses the wire once, on upload — not again on every
// keystroke-triggered save.
//
// Ids are scoped to their memorial (`{memorialId}.{contentHash}`) rather
// than purely content-addressed globally. Hashing still dedupes if the same
// file is uploaded twice while editing, but scoping by memorial means
// deleting a memorial can reliably delete exactly its own photos, with no
// risk of accidentally touching another memorial that happens to share the
// same bytes.

const photoStore = () => getStore({ name: "photos", consistency: "strong" });

const PHOTO_ID_RE = /^[a-f0-9]{24}\.[a-f0-9]{20}$/;

export function isValidPhotoId(id) {
  return typeof id === "string" && PHOTO_ID_RE.test(id);
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stores a photo's bytes under a memorial-scoped, content-derived id. */
export async function putPhoto(memorialId, bytes, contentType) {
  const hash = (await sha256Hex(bytes)).slice(0, 20);
  const id = `${memorialId}.${hash}`;
  await photoStore().set(`photo/${id}`, bytes, { metadata: { contentType } });
  return id;
}

/** Returns { data, contentType } or null. */
export async function getPhoto(id) {
  if (!isValidPhotoId(id)) return null;
  const result = await photoStore().getWithMetadata(`photo/${id}`, { type: "arrayBuffer" });
  if (!result) return null;
  return { data: result.data, contentType: result.metadata?.contentType || "application/octet-stream" };
}

export async function deletePhoto(id) {
  if (!isValidPhotoId(id)) return;
  await photoStore().delete(`photo/${id}`);
}

// ---------------------------------------------------------------- auth
//
// The Stripe session id is the owner's bearer token — long, random, and only
// ever given to the person who paid. It's verified against Stripe once, when
// the memorial is first created; after that we just check it matches the
// reference stored on the record, so ordinary saves don't wait on Stripe.

// Returns { paid: false } or { paid: true, email }. The email comes straight
// from Stripe's verified customer_details, never from anything the browser
// submitted — a client could otherwise claim any address as the owner and
// silently redirect that person's future sign-in links to a memorial that
// isn't theirs.
export async function verifyPaidReference(reference, expectedProduct = "memorial") {
  if (!reference || typeof reference !== "string") return { paid: false };
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(reference);
    if (session?.payment_status !== "paid") return { paid: false };
    if (session?.metadata?.product !== expectedProduct) return { paid: false };
    return { paid: true, email: session.customer_details?.email || null };
  } catch (err) {
    console.error("Stripe verification failed:", err?.message);
    return { paid: false };
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

/**
 * Returns the memorial for this reference, creating a fresh draft (after
 * verifying payment) if this is the first time it's been touched. Shared by
 * save-memorial.mjs and upload-photo.mjs, so a photo can be uploaded even
 * before the first text save has created the record — someone might pick a
 * photo before typing a name.
 */
export async function ensureRecordForReference(reference, expectedProduct = "memorial") {
  if (!reference || typeof reference !== "string") {
    return { error: "Missing reference.", status: 401 };
  }
  const existing = await findByReference(reference);
  if (existing) return { record: existing };

  const { paid, email } = await verifyPaidReference(reference, expectedProduct);
  if (!paid) return { error: "This purchase couldn't be verified.", status: 402 };

  const record = {
    id: newId(),
    reference,
    ownerEmail: email,
    createdAt: new Date().toISOString(),
    published: false,
    slug: null,
    candles: 0,
  };
  await putMemorial(record);
  await indexMemorial(record);
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
  record.published = false;
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
  // Only removes this memorial's id from the owner's index — a different
  // memorial under the same email must stay reachable.
  if (record.ownerEmail) await unindexOwner(record.ownerEmail, record.id);
  // Photos are memorial-scoped ids (see the photos section above), so this
  // can never touch another memorial's images.
  if (record.photo) await deletePhoto(record.photo);
  if (Array.isArray(record.memories)) {
    await Promise.all(record.memories.map((id) => deletePhoto(id)));
  }
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
    // Safe to expose — lets the public page's copy match the owner's actual
    // settings instead of always claiming messages are reviewed.
    moderationOn: record.moderationOn !== false,
    guestbookClosed: isGuestbookClosed(record),
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
