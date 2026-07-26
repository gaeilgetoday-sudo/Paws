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

import { getMemorialBySlug, putMemorial, isDeleted, checkRateLimit, clientIp, json } from "../lib/memorial-store.mjs";

export default async (req, context) => {
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

  // Generous enough for a shared household connection to light more than
  // one candle over a visit, tight enough to stop a script from inflating
  // a single page's count.
  const allowed = await checkRateLimit(`candle:${record.id}`, clientIp(req, context), {
    max: 5,
    windowMs: 10 * 60 * 1000,
  });
  if (!allowed) return json({ error: "Please wait a little before lighting another." }, 429);

  record.candles = (record.candles || 0) + 1;
  await putMemorial(record);

  return json({ ok: true, candles: record.candles });
};
