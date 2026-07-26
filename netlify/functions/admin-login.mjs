// netlify/functions/admin-login.mjs
//
// The only unauthenticated admin endpoint — everything else requires the
// session token this returns.

import { verifyAdminPassword, createAdminSession } from "../lib/admin-auth.mjs";
import { checkRateLimit, clientIp, json } from "../lib/memorial-store.mjs";

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Deliberately tight — this guards the one password protecting every
  // customer's data, not a normal login form.
  const allowed = await checkRateLimit("admin-login", clientIp(req, context), {
    max: 5,
    windowMs: 15 * 60 * 1000,
  });
  if (!allowed) return json({ error: "Too many attempts. Please wait a while." }, 429);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  const valid = await verifyAdminPassword(body.password);
  if (!valid) return json({ error: "Incorrect password." }, 401);

  const token = await createAdminSession();
  return json({ ok: true, token });
};
