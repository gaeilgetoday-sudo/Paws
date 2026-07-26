// netlify/functions/purge-expired.mjs
//
// Runs daily. Permanently removes memorials whose 30-day grace period has run
// out.
//
// This exists because without it the promise would be a lie: a deleted page
// nobody happens to visit would sit in storage indefinitely, and "deleted
// after 30 days" would mean "hidden, and kept forever". A scheduled job is the
// only way the deletion actually happens on its own.

import { store, purgeMemorial } from "../lib/memorial-store.mjs";

export default async () => {
  const s = store();
  const { blobs } = await s.list({ prefix: "memorial/" });

  const now = Date.now();
  let purged = 0;
  let waiting = 0;

  for (const b of blobs) {
    const rec = await s.get(b.key, { type: "json" });
    if (!rec?.purgeAfter) continue;
    if (rec.purgeAfter > now) { waiting++; continue; }
    await purgeMemorial(rec);
    purged++;
    console.log(`Purged memorial ${rec.id} (deleted ${rec.deletedAt})`);
  }

  console.log(`Purge sweep complete: ${purged} removed, ${waiting} still inside grace period.`);
  return new Response(JSON.stringify({ purged, waiting }), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config = {
  schedule: "@daily",
};
