// netlify/functions/load-memorial.mjs
//
// Loads a saved draft back into the builder, so someone can pick up where they
// left off — possibly days later, in a different sitting.

import { authorise, getGuestbook, json } from "../lib/memorial-store.mjs";

export default async (req) => {
  const reference = new URL(req.url).searchParams.get("reference");
  const { record, error, status } = await authorise(reference);

  // Not an error worth surfacing: they've paid but haven't started yet.
  if (status === 404) return json({ ok: true, memorial: null });
  if (error) return json({ error }, status);

  const guestbook = await getGuestbook(record.id);
  const pendingCount = guestbook.filter((m) => m.status === "pending").length;

  return json({
    ok: true,
    memorial: {
      id: record.id,
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
      moderationOn: record.moderationOn,
      closeAfter: record.closeAfter,
      celebEnabled: record.celebEnabled,
      celebTitle: record.celebTitle,
      celebDate: record.celebDate,
      celebLoc: record.celebLoc,
      celebKids: record.celebKids,
      celebMemory: record.celebMemory,
      celebDonations: record.celebDonations,
      published: record.published,
      slug: record.slug,
      deletedAt: record.deletedAt || null,
      purgeAfter: record.purgeAfter || null,
      candles: record.candles || 0,
      pendingCount,
      updatedAt: record.updatedAt,
    },
  });
};
