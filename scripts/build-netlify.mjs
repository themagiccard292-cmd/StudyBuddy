// Assembles the static site Netlify publishes (dist/): the public files plus the libraries the pages load
// (fonts, math rendering, PDF reader) copied out of node_modules, so no visitor request ever leaves this site.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const dist = "dist";
rmSync(dist, { recursive: true, force: true });
cpSync("public", dist, { recursive: true });

// Fonts: only the weights the site uses.
const FONTS = {
  "bricolage-grotesque": [600, 700, 800],
  figtree: [400, 500, 600, 700],
  caveat: [600],
};
for (const [pkg, weights] of Object.entries(FONTS)) {
  const src = `node_modules/@fontsource/${pkg}`;
  const dst = `${dist}/vendor/fontsource/${pkg}`;
  mkdirSync(`${dst}/files`, { recursive: true });
  for (const w of weights) cpSync(`${src}/latin-${w}.css`, `${dst}/latin-${w}.css`);
  for (const f of readdirSync(`${src}/files`)) {
    if (weights.some((w) => f.includes(`-latin-${w}-normal.`))) cpSync(`${src}/files/${f}`, `${dst}/files/${f}`);
  }
}

// Math (KaTeX) and the PDF reader (pdf.js).
mkdirSync(`${dist}/vendor/katex`, { recursive: true });
for (const f of ["katex.min.css", "katex.mjs"]) cpSync(`node_modules/katex/dist/${f}`, `${dist}/vendor/katex/${f}`);
cpSync("node_modules/katex/dist/fonts", `${dist}/vendor/katex/fonts`, { recursive: true });
mkdirSync(`${dist}/vendor/pdfjs`, { recursive: true });
for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) cpSync(`node_modules/pdfjs-dist/build/${f}`, `${dist}/vendor/pdfjs/${f}`);

// Share previews need absolute URLs: Netlify tells the build its site address in URL.
const origin = (process.env.URL || process.env.DEPLOY_PRIME_URL || "").replace(/\/$/, "");
const indexPath = `${dist}/index.html`;
writeFileSync(indexPath, readFileSync(indexPath, "utf8").replaceAll("%ORIGIN%", origin));

// Fail the build loudly if something the pages need is missing.
const required = [
  "index.html", "css/app.css", "js/app.js", "js/icons.js", "robots.txt", "site.webmanifest", "og-image.png",
  "vendor/katex/katex.mjs", "vendor/katex/katex.min.css", "vendor/pdfjs/pdf.min.mjs", "vendor/pdfjs/pdf.worker.min.mjs",
  "vendor/fontsource/figtree/latin-400.css", "vendor/fontsource/bricolage-grotesque/latin-800.css", "vendor/fontsource/caveat/latin-600.css",
];
const missing = required.filter((f) => !existsSync(`${dist}/${f}`));
if (missing.length) {
  console.error("Build failed, missing:", missing.join(", "));
  process.exit(1);
}
console.log(`Built ${dist}/ for ${origin || "(no site URL: share-preview links stay relative)"}`);
