// netlify/lib/admin-auth.mjs
//
// A small, separate authentication layer for the internal admin tool.
// Deliberately not built on the customer-facing login-token system in
// memorial-store.mjs — that's designed around 30-minute, single-use,
// per-memorial links; admin access needs a longer-lived session covering
// every record, which is a different enough trust boundary to keep apart
// rather than stretch the existing system to cover both.
//
// One shared password (ADMIN_PASSWORD env var), one operator. If this ever
// needs more than one person, replace this with real per-person accounts
// before adding anyone — a shared password doesn't scale to "who did this."

import { getStore } from "@netlify/blobs";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

const sessionStore = () => getStore({ name: "admin-sessions", consistency: "strong" });

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password) {
  const enc = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time-ish comparison — avoids leaking length/prefix via timing. */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyAdminPassword(password) {
  if (!process.env.ADMIN_PASSWORD) return false;
  if (typeof password !== "string" || !password) return false;
  const givenHash = await hashPassword(password);
  const realHash = await hashPassword(process.env.ADMIN_PASSWORD);
  return safeEqual(givenHash, realHash);
}

export async function createAdminSession() {
  const token = newToken();
  await sessionStore().setJSON(`session/${token}`, { expires: Date.now() + SESSION_TTL_MS });
  return token;
}

export async function revokeAdminSession(token) {
  if (!token) return;
  await sessionStore().delete(`session/${token}`);
}

/**
 * Checks the Authorization: Bearer <token> header. Returns { ok: true } or
 * { error, status } to hand straight back to the caller.
 */
export async function requireAdmin(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return { error: "Not signed in.", status: 401 };

  const s = sessionStore();
  const session = await s.get(`session/${token}`, { type: "json" });
  if (!session || session.expires < Date.now()) {
    if (session) await s.delete(`session/${token}`); // tidy up an expired one while we're here
    return { error: "Session expired. Please sign in again.", status: 401 };
  }
  return { ok: true };
}
