// netlify/functions/get-photo.mjs
//
// Serves a single photo by id. Ids are content-derived and scoped to their
// memorial (see memorial-store.mjs), so the bytes behind a given id can
// never change — safe to cache aggressively rather than re-fetching on
// every page view.
//
// No authorization check here, deliberately: this is the same trust level
// as the old inline-Base64 approach, where a photo was already visible to
// anyone who could see the memorial's public JSON. Private memorials never
// reach this — get-memorial.mjs already returns 404 for the whole record
// before a photo id would ever be exposed.

import { getPhoto, isValidPhotoId } from "../lib/memorial-store.mjs";

export default async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!isValidPhotoId(id)) {
    return new Response("Not found.", { status: 404 });
  }

  const photo = await getPhoto(id);
  if (!photo) {
    return new Response("Not found.", { status: 404 });
  }

  return new Response(photo.data, {
    status: 200,
    headers: {
      "Content-Type": photo.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
