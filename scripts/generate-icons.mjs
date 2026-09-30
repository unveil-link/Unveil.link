// Generates PWA icons (monogram "U") using playwright-core + system Chrome.
// Usage: node scripts/generate-icons.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const out = new URL("../public/icons/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const svg = (size, { maskable = false } = {}) => {
  const r = maskable ? 0 : size * 0.22;
  const scale = maskable ? 0.6 : 0.78; // keep glyph inside maskable safe zone
  const s = size * scale;
  const o = (size - s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6b57f5"/><stop offset="1" stop-color="#4030c9"/></linearGradient></defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#g)"/>
  <g transform="translate(${o} ${o}) scale(${s / 100})">
    <path d="M26 24v30a24 24 0 0 0 48 0V24" fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="74" cy="80" r="0" fill="#14b8a6"/>
    <rect x="58" y="74" width="26" height="9" rx="4.5" fill="#14b8a6" transform="rotate(-18 71 78)"/>
  </g>
</svg>`;
};

const jobs = [
  ["icon-192.png", 192, {}],
  ["icon-512.png", 512, {}],
  ["icon-maskable-512.png", 512, { maskable: true }],
  ["apple-touch-icon.png", 180, { maskable: true }],
];

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
for (const [name, size, opts] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg(size, opts)}`);
  await page.screenshot({ path: out + name, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  console.log("wrote", name);
}
await browser.close();
