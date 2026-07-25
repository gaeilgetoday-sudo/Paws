// netlify/functions/publish-memorial.mjs
//
// Publishes a memorial and allocates its permanent URL. The slug is assigned
// once and never changes afterwards — a link someone has shared with family
// must not break because a detail was edited later.
//
// Unpublishing is supported and is deliberately non-destructive: the page goes
// private, nothing is deleted, and the same link works again if republished.

import { authorise, putMemorial, allocateSlug, store, isDeleted, json } from "../lib/memorial-store.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  const { record, error, status } = await authorise(body.reference);
  if (error) return json({ error }, status);

  if (isDeleted(record)) {
    return json({ error: "This page is deleted. Restore it before publishing." }, 409);
  }

  const wantPublished = body.published !== false;

  if (wantPublished && !record.name?.trim()) {
    return json({ error: "Add their name before publishing." }, 400);
  }

  if (wantPublished && !record.slug) {
    const slug = await allocateSlug(record.name);
    await store().setJSON(`slug/${slug}`, { id: record.id });
    record.slug = slug;
  }

  record.published = wantPublished;
  if (wantPublished && !record.publishedAt) {
    record.publishedAt = new Date().toISOString();
  }
  await putMemorial(record);

  return json({
    ok: true,
    published: record.published,
    slug: record.slug,
    url: record.slug ? `/remember.html?p=${record.slug}` : null,
  });
};
