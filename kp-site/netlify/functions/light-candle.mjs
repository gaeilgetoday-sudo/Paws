// netlify/functions/light-candle.mjs
//
// Lights a candle. Deliberately carries no text of any kind — no name, no
// message, nothing a visitor can type. That's the whole point: a gesture with
// no input surface can't be used to write something cruel on a memorial page.
//
// One per browser per visit is enforced in the page itself. That's honest about
// what it is — a courtesy, not a security control. Nobody gains anything from
// inflating a candle count, and the alternative (tracking visitors properly)
// would mean collecting data from mourners to solve a problem nobody has.

import { getMemorialBySlug, putMemorial, isDeleted, json } from "../lib/memorial-store.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  const record = await getMemorialBySlug(body.slug);
  if (!record || isDeleted(record) || !record.published || record.privacy === "private") {
    return json({ error: "not_found" }, 404);
  }

  record.candles = (record.candles || 0) + 1;
  await putMemorial(record);

  return json({ ok: true, candles: record.candles });
};
