#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

/**
 * Renders the Sifty app icons (PWA + Apple touch + favicon) from a single
 * HTML template so the mark stays identical everywhere. Re-run after
 * changing the brand mark:
 *
 *   node scripts/make-icons.mjs
 */

const OUT_DIR = new URL("../public/icons/", import.meta.url).pathname;

// Dark app background + ember accent, matching globals.css / manifest.
const BG = "#0d0c08";
const ACCENT = "#f54e00";

function iconHtml(size, { maskable }) {
  // Maskable icons need the mark inside the 80% safe zone.
  const dot = Math.round(size * (maskable ? 0.2 : 0.26));
  const glow = Math.round(dot * 2.4);
  const ring = Math.round(size * (maskable ? 0.46 : 0.58));
  return `<!doctype html><html><head><style>
    * { margin: 0; padding: 0; }
    body { width: ${size}px; height: ${size}px; background: ${BG}; overflow: hidden; }
    .wrap { position: relative; width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center; }
    .ring { position: absolute; width: ${ring}px; height: ${ring}px;
      border-radius: ${Math.round(ring * 0.24)}px;
      background: ${ACCENT}26; border: ${Math.max(1, Math.round(size * 0.012))}px solid ${ACCENT}4d; }
    .glow { position: absolute; width: ${glow}px; height: ${glow}px; border-radius: 50%;
      background: radial-gradient(circle, ${ACCENT}59 0%, transparent 65%); }
    .dot { position: absolute; width: ${dot}px; height: ${dot}px;
      border-radius: 50%; background: ${ACCENT}; }
  </style></head><body>
    <div class="wrap"><div class="ring"></div><div class="glow"></div><div class="dot"></div></div>
  </body></html>`;
}

const TARGETS = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180, maskable: true },
  { file: "favicon-32.png", size: 32, maskable: false },
];

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
try {
  for (const target of TARGETS) {
    const page = await browser.newPage({
      viewport: { width: target.size, height: target.size },
      deviceScaleFactor: 1,
    });
    await page.setContent(iconHtml(target.size, target), { waitUntil: "networkidle" });
    await page.screenshot({ path: `${OUT_DIR}${target.file}` });
    await page.close();
    console.log(`wrote public/icons/${target.file}`);
  }
} finally {
  await browser.close();
}
