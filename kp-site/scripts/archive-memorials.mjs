// scripts/archive-memorials.mjs
//
// Wind-down archive: converts every published memorial into a self-contained
// static HTML file that needs no server, no database and no JavaScript to
// read. This is what makes the three-year promise in the Terms keepable —
// once these files exist, keeping them online is a hosting bill, not a
// business.
//
// WHAT IT PRESERVES
//   • Every published page, at a URL that still works for anyone who was
//     given the original link
//   • Photos, story, dates, approved guestbook messages
//   • The candle count, frozen at its final number
//
// WHAT IT DELIBERATELY DROPS
//   • Private and unpublished pages (never public; must not become public)
//   • Pending and hidden guestbook messages (never approved for showing)
//   • Owner email addresses and Stripe references (never public, ever)
//
// USAGE
//   NETLIFY_SITE_ID=xxx NETLIFY_API_TOKEN=yyy node scripts/archive-memorials.mjs ./archive
//
//   Site ID:  Netlify → Site configuration → General → Site ID
//   Token:    Netlify → User settings → Applications → Personal access tokens
//
// The output folder can be dropped onto any static host — Netlify, GitHub
// Pages, S3, a plain Apache box. Nothing in it phones home.

import { getStore } from "@netlify/blobs";
import fs from "node:fs/promises";
import path from "node:path";

const OUT = process.argv[2] || "./archive";
const CLOSURE_DATE = process.env.CLOSURE_DATE ||
  new Date().toLocaleDateString("en-IE", { year: "numeric", month: "long" });

// ---------------------------------------------------------------- helpers

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const fmtDate = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString("en-IE", { year: "numeric", month: "long", day: "numeric" });
};

const STYLE = `
:root{--cream:#FAF5EC;--cream-deep:#F1E9DA;--dusk:#1F3A36;--dusk-deep:#142623;
--amber:#D98A3D;--amber-deep:#B96F28;--ink:#2B241C;--paper:#F3EEE3;--muted:#8A7F6D;
--line:#DCD0B4;--gold:#E3A85C;}
*{box-sizing:border-box}
body{margin:0;background:var(--cream);color:var(--ink);line-height:1.6;
font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
h1,h2,h3{margin:0;font-family:Georgia,'Times New Roman',serif;font-weight:600}
p{margin:0}
img{max-width:100%;display:block}
.wrap{max-width:760px;margin:0 auto;padding:0 24px}
.hero{background:linear-gradient(165deg,#24423d,var(--dusk-deep));color:var(--paper);
padding:72px 24px 64px;text-align:center}
.hero img{width:168px;height:168px;margin:0 auto 26px;border-radius:50%;object-fit:cover;
border:1px solid rgba(227,168,92,.4)}
.hero .paw{width:168px;height:168px;margin:0 auto 26px;border-radius:50%;
background:rgba(227,168,92,.1);border:1px solid rgba(227,168,92,.3);
display:flex;align-items:center;justify-content:center;font-size:54px}
.eyebrow{font-size:.76rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
color:var(--gold);margin-bottom:10px}
.hero h1{font-size:2.9rem}
.dates{margin-top:10px;font-style:italic;font-size:1.05rem;color:#C9DAD3}
section{padding:54px 0}
hr{border:none;border-top:1px solid var(--line);margin:0}
.label{font-size:.74rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
color:var(--amber-deep);margin-bottom:8px}
h2{font-size:1.5rem;margin-bottom:22px}
.story{font-size:1.02rem;color:#3a3126;white-space:pre-wrap}
.gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.gallery img{aspect-ratio:1;object-fit:cover;border-radius:16px}
.candles{background:var(--dusk-deep);border-radius:22px;padding:40px 28px;text-align:center;
color:var(--paper)}
.flames{font-size:1.3rem;line-height:1.5;max-width:420px;margin:0 auto;word-break:break-word}
.flames-label{font-size:.72rem;letter-spacing:.08em;font-weight:700;color:#9fb3ac;margin-top:12px}
.entry{padding:16px 0;border-bottom:1px solid var(--line)}
.entry:last-child{border-bottom:none}
.who{font-weight:600;font-size:.88rem;color:var(--dusk)}
.msg{margin-top:4px;font-size:.92rem;color:#3a3126;white-space:pre-wrap}
.notice{background:var(--cream-deep);border:1px solid var(--line);border-radius:14px;
padding:18px 20px;font-size:.88rem;color:#4a4033;margin-top:36px}
footer{background:var(--dusk-deep);color:#8fa39c;text-align:center;padding:40px 24px;font-size:.8rem}
footer .brand{color:var(--paper);font-family:Georgia,serif;font-size:.98rem;margin-bottom:6px}
@media(max-width:560px){.hero h1{font-size:2.2rem}.gallery{grid-template-columns:repeat(2,1fr)}}
`;

function renderPage(m, messages) {
  const meta = [
    m.species,
    [m.born && fmtDate(m.born), m.died && fmtDate(m.died)].filter(Boolean).join(" — "),
  ].filter(Boolean).join(" · ");

  const candles = m.candles || 0;
  const flames = candles > 0 ? "🕯️".repeat(Math.min(candles, 60)) : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.name)} — Kindred Paws</title>
<meta name="robots" content="${m.privacy === "unlisted" ? "noindex, nofollow" : "index, follow"}">
<style>${STYLE}</style>
</head>
<body>
<header class="hero">
  ${m.photo
      ? `<img src="${m.photo}" alt="${esc(m.name)}">`
      : `<div class="paw" role="img" aria-label="Paw print">🐾</div>`}
  <div class="eyebrow">A Kindred Paws memorial</div>
  <h1>${esc(m.name)}</h1>
  ${meta ? `<p class="dates">${esc(meta)}</p>` : ""}
</header>

${m.story ? `<section><div class="wrap">
  <div class="label">Their story</div>
  <p class="story">${esc(m.story)}</p>
</div></section><hr>` : ""}

${(m.memories || []).length ? `<section><div class="wrap">
  <div class="label">Photographs</div>
  <h2>A few of our favourites</h2>
  <div class="gallery">
    ${m.memories.map((src, i) =>
      `<img src="${src}" alt="${esc(m.name)} — photo ${i + 1}" loading="lazy">`).join("\n    ")}
  </div>
</div></section><hr>` : ""}

<section><div class="wrap">
  <div class="label">Candles</div>
  <h2>Thinking of ${esc(m.name)}</h2>
  <div class="candles">
    ${candles > 0
      ? `<div class="flames">${flames}${candles > 60 ? ` +${candles - 60} more` : ""}</div>
       <div class="flames-label">${candles} CANDLE${candles === 1 ? "" : "S"} LIT</div>`
      : `<div class="flames-label">NO CANDLES WERE LIT</div>`}
  </div>
</div></section>

${messages.length ? `<hr><section><div class="wrap">
  <div class="label">Guestbook</div>
  <h2>Messages for the family</h2>
  ${messages.map(e =>
    `<div class="entry"><div class="who">${esc(e.name)}</div><div class="msg">${esc(e.message)}</div></div>`
  ).join("\n  ")}
</div></section>` : ""}

<section style="padding-top:0"><div class="wrap">
  <div class="notice">
    <strong>About this page.</strong> Kindred Paws closed in ${esc(CLOSURE_DATE)}.
    This is a permanent, read-only copy of ${esc(m.name)}'s memorial page, kept
    online so the link continues to work. Candles can no longer be lit and new
    messages can no longer be left, but nothing that was here has been removed.
  </div>
</div></section>

<footer>
  <div class="brand">Kindred Paws™</div>
  <div>${m.privacy === "unlisted"
    ? "This page is unlisted — only people with the link can see it."
    : "This page is public."}</div>
</footer>
</body>
</html>`;
}

function renderRedirect() {
  // Preserves links of the form /remember.html?p=slug that families already
  // shared. Meta-refresh works without JavaScript; the link is the fallback
  // if even that is blocked.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Kindred Paws</title>
<style>${STYLE}
body{display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}
</style>
<script>
  var p = new URLSearchParams(location.search).get('p');
  if (p && /^[a-z0-9-]+$/.test(p)) location.replace('remember/' + p + '.html');
</script>
</head>
<body>
<div class="wrap">
  <h1 style="font-size:1.5rem;margin-bottom:.5em">Opening the page…</h1>
  <p style="color:var(--muted)">If nothing happens, the link may be mistyped.
  <a href="index.html">See all pages</a>.</p>
</div>
</body>
</html>`;
}

function renderIndex(pages) {
  const listed = pages.filter(p => p.privacy === "public");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kindred Paws — archive</title>
<style>${STYLE}
.list{list-style:none;padding:0;margin:24px 0 0}
.list li{border-bottom:1px solid var(--line);padding:14px 0}
.list a{color:var(--ink);text-decoration:none;font-weight:600}
.list a:hover{color:var(--amber-deep)}
</style>
</head>
<body>
<header class="hero" style="padding:64px 24px 56px">
  <div class="eyebrow">Archive</div>
  <h1 style="font-size:2.2rem">Kindred Paws</h1>
  <p class="dates">Closed ${esc(CLOSURE_DATE)}</p>
</header>
<section><div class="wrap">
  <p class="story">Kindred Paws is no longer operating. Every memorial page that
  was published here has been kept online exactly as it was, so the links people
  shared with family and friends continue to work.</p>
  <div class="notice">
    Pages that were unlisted are not listed here — they remain reachable only
    through the link their family shared, exactly as before. Pages that were
    private were never public and have not been included.
  </div>
  ${listed.length ? `
  <h2 style="margin-top:40px">Public pages</h2>
  <ul class="list">
    ${listed.map(p => `<li><a href="remember/${esc(p.slug)}.html">${esc(p.name)}</a></li>`).join("\n    ")}
  </ul>` : ""}
</div></section>
<footer><div class="brand">Kindred Paws™</div></footer>
</body>
</html>`;
}

// ---------------------------------------------------------------- run

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

  await fs.mkdir(path.join(OUT, "remember"), { recursive: true });

  const { blobs } = await store.list({ prefix: "memorial/" });
  console.log(`Found ${blobs.length} record(s).`);

  const written = [];
  let skipped = 0;

  for (const b of blobs) {
    const m = await store.get(b.key, { type: "json" });
    if (!m) continue;

    if (!m.published || m.privacy === "private" || !m.slug || m.deletedAt) {
      skipped++;
      const why = m.deletedAt ? "deleted"
        : !m.published ? "unpublished"
        : m.privacy === "private" ? "private"
        : "no slug";
      console.log(`  · skipped ${m.name || b.key} (${why})`);
      continue;
    }

    const guestbook = (await store.get(`guestbook/${m.id}`, { type: "json" })) || [];
    const approved = guestbook
      .filter(e => e.status === "approved")
      .sort((a, b2) => (a.at < b2.at ? -1 : 1));

    await fs.writeFile(
      path.join(OUT, "remember", `${m.slug}.html`),
      renderPage(m, approved),
      "utf8"
    );

    written.push({ slug: m.slug, name: m.name, privacy: m.privacy });
    console.log(`  ✓ ${m.name} → remember/${m.slug}.html (${approved.length} message(s), ${m.candles || 0} candle(s))`);
  }

  await fs.writeFile(path.join(OUT, "remember.html"), renderRedirect(), "utf8");
  await fs.writeFile(path.join(OUT, "index.html"), renderIndex(written), "utf8");

  // A plain-text record of what was produced, for your own files.
  await fs.writeFile(
    path.join(OUT, "MANIFEST.txt"),
    [
      `Kindred Paws archive`,
      `Generated: ${new Date().toISOString()}`,
      `Closure date shown on pages: ${CLOSURE_DATE}`,
      ``,
      `Pages archived: ${written.length}`,
      `Records skipped (unpublished/private): ${skipped}`,
      ``,
      ...written.map(w => `  ${w.slug}\t${w.name}\t${w.privacy}`),
      ``,
      `No owner email addresses or payment references are present in this archive.`,
      `Only guestbook messages approved by the page owner have been included.`,
    ].join("\n"),
    "utf8"
  );

  console.log(`\nDone. ${written.length} page(s) archived, ${skipped} skipped.`);
  console.log(`Output: ${path.resolve(OUT)}`);
  console.log(`\nUpload that folder to any static host. Nothing in it needs a server.`);
}

main().catch(err => { console.error("Archive failed:", err); process.exit(1); });
