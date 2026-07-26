// scripts/restore-memorial.mjs
//
// Restores one memorial (and its guestbook, if present) from a backup
// produced by scripts/backup-memorials.mjs, writing it back into the live
// "memorials" Blobs store.
//
// This exists so backups can be PROVEN to work, not just assumed to —
// a backup nobody has ever restored from is a hope, not a safeguard. Run
// this periodically against a throwaway id (or a disposable test site) to
// confirm the whole path — take a backup, restore it, check the data came
// back intact — still works.
//
// By default this refuses to overwrite an existing record, so a routine
// restore test can't accidentally clobber live data. Pass --force to
// override that (e.g. for a genuine recovery).
//
// USAGE
//   NETLIFY_SITE_ID=xxx NETLIFY_API_TOKEN=yyy \
//     node scripts/restore-memorial.mjs ./backup-output <memorial-id> [--force]
//
//   List available ids in a backup with:
//     ls ./backup-output/memorials

import { getStore } from "@netlify/blobs";
import fs from "node:fs/promises";
import path from "node:path";

const BACKUP_DIR = process.argv[2];
const MEMORIAL_ID = process.argv[3];
const FORCE = process.argv.includes("--force");

async function main() {
  if (!BACKUP_DIR || !MEMORIAL_ID) {
    console.error("Usage: node scripts/restore-memorial.mjs <backup-dir> <memorial-id> [--force]");
    process.exit(1);
  }
  if (!process.env.NETLIFY_SITE_ID || !process.env.NETLIFY_API_TOKEN) {
    console.error("Set NETLIFY_SITE_ID and NETLIFY_API_TOKEN first.");
    process.exit(1);
  }

  const recordPath = path.join(BACKUP_DIR, "memorials", `${MEMORIAL_ID}.json`);
  const guestbookPath = path.join(BACKUP_DIR, "guestbooks", `${MEMORIAL_ID}.json`);

  let record;
  try {
    record = JSON.parse(await fs.readFile(recordPath, "utf8"));
  } catch {
    console.error(`No backed-up record found at ${recordPath}`);
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

  const existing = await store.get(`memorial/${MEMORIAL_ID}`, { type: "json" });
  if (existing && !FORCE) {
    console.error(
      `A record already exists for ${MEMORIAL_ID}. Refusing to overwrite it.\n` +
      `Pass --force if this is a genuine recovery, not a restore test.`
    );
    process.exit(1);
  }

  await store.setJSON(`memorial/${MEMORIAL_ID}`, record);
  if (record.slug) {
    await store.setJSON(`slug/${record.slug}`, { id: record.id });
  }
  if (record.reference) {
    await store.setJSON(`ref/${record.reference}`, { id: record.id });
  }

  const photoIds = [record.photo, ...(record.memories || [])].filter(Boolean);
  let photosRestored = 0;
  for (const id of photoIds) {
    try {
      const bytes = await fs.readFile(path.join(BACKUP_DIR, "photos", `${id}.bin`));
      const meta = JSON.parse(await fs.readFile(path.join(BACKUP_DIR, "photos", `${id}.json`), "utf8"));
      await photos.set(`photo/${id}`, bytes, { metadata: { contentType: meta.contentType } });
      photosRestored++;
    } catch {
      console.warn(`  ! Could not restore photo ${id} — missing from backup.`);
    }
  }

  let guestbookRestored = false;
  try {
    const guestbook = JSON.parse(await fs.readFile(guestbookPath, "utf8"));
    await store.setJSON(`guestbook/${MEMORIAL_ID}`, guestbook);
    guestbookRestored = true;
  } catch {
    // No guestbook in this backup — fine, not every memorial has one yet.
  }

  console.log(`Restored memorial ${MEMORIAL_ID} (${record.name || "unnamed"}).`);
  console.log(`Photos: ${photosRestored}/${photoIds.length} restored.`);
  console.log(`Guestbook: ${guestbookRestored ? "restored" : "none in backup"}.`);
  console.log(`Slug/reference lookups re-indexed.`);
  console.log(`\nNote: this does not re-add the owner/{email} index entry —`);
  console.log(`that's intentional for a restore test (it shouldn't silently`);
  console.log(`take over someone's real sign-in routing). For a genuine`);
  console.log(`recovery, re-run indexMemorial() for this record separately.`);
}

main().catch((err) => {
  console.error("Restore failed:", err);
  process.exit(1);
});
