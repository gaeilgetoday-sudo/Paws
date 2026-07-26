// scripts/backup-memorials.mjs
//
// Routine backup: a complete, private snapshot of everything in the
// "memorials" Blobs store, plus every photo those records reference from
// the "photos" store, written to local disk.
//
// This is deliberately different from scripts/archive-memorials.mjs:
//   archive-memorials.mjs  → a PUBLIC wind-down artifact. Drops private and
//                             unpublished pages, pending guestbook messages,
//                             owner emails. Meant to be published somewhere.
//   backup-memorials.mjs   → a PRIVATE disaster-recovery snapshot. Keeps
//                             everything, including drafts, private pages,
//                             pending messages, and owner emails, because
//                             the point is to be able to put the site back
//                             exactly as it was. This output must never be
//                             made public — see .github/workflows/backup.yml
//                             for how it's stored (a private, expiring
//                             GitHub Actions artifact, never committed to
//                             git history).
//
// USAGE
//   NETLIFY_SITE_ID=xxx NETLIFY_API_TOKEN=yyy node scripts/backup-memorials.mjs ./backup-output
//
//   Site ID:  Netlify → Site configuration → General
//   Token:    Netlify → User settings → Applications → Personal access tokens

import { getStore } from "@netlify/blobs";
import fs from "node:fs/promises";
import path from "node:path";

const OUT = process.argv[2] || "./backup-output";

async function main() {
  if (!process.env.NETLIFY_SITE_ID || !process.env.NETLIFY_API_TOKEN) {
    console.error("Set NETLIFY_SITE_ID and NETLIFY_API_TOKEN first.\n" +
      "  Site ID: Netlify → Site configuration → General\n" +
      "  Token:   Netlify → User settings → Applications → Personal access tokens");
    process.exit(1);
  }

  const store = getStore({
    name: "memorials",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_API_TOKEN,
    consistency: "strong",
  });
  const photos = getStore({
    name: "photos",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_API_TOKEN,
    consistency: "strong",
  });

  const takenAt = new Date().toISOString();
  await fs.mkdir(path.join(OUT, "memorials"), { recursive: true });
  await fs.mkdir(path.join(OUT, "guestbooks"), { recursive: true });
  await fs.mkdir(path.join(OUT, "photos"), { recursive: true });

  const { blobs } = await store.list({ prefix: "memorial/" });
  console.log(`Found ${blobs.length} memorial record(s).`);

  let count = 0;
  for (const b of blobs) {
    const record = await store.get(b.key, { type: "json" });
    if (!record) continue;

    await fs.writeFile(
      path.join(OUT, "memorials", `${record.id}.json`),
      JSON.stringify(record, null, 2),
      "utf8"
    );

    const guestbook = await store.get(`guestbook/${record.id}`, { type: "json" });
    if (guestbook) {
      await fs.writeFile(
        path.join(OUT, "guestbooks", `${record.id}.json`),
        JSON.stringify(guestbook, null, 2),
        "utf8"
      );
    }

    // Photos this specific record references — not a wholesale dump of the
    // photos store, so an orphaned blob from a since-deleted memorial
    // doesn't linger in every future backup forever.
    const photoIds = [record.photo, ...(record.memories || [])].filter(Boolean);
    for (const id of photoIds) {
      const result = await photos.getWithMetadata(`photo/${id}`, { type: "arrayBuffer" });
      if (!result) continue;
      await fs.writeFile(path.join(OUT, "photos", `${id}.bin`), Buffer.from(result.data));
      await fs.writeFile(
        path.join(OUT, "photos", `${id}.json`),
        JSON.stringify({ contentType: result.metadata?.contentType || "application/octet-stream" }),
        "utf8"
      );
    }

    count++;
  }

  await fs.writeFile(
    path.join(OUT, "MANIFEST.json"),
    JSON.stringify({ takenAt, recordCount: count }, null, 2),
    "utf8"
  );

  console.log(`Backed up ${count} record(s) to ${OUT}/`);
  console.log(`Snapshot taken at ${takenAt}.`);
}

main().catch((err) => {
  console.error("Backup failed:", err);
  process.exit(1);
});
