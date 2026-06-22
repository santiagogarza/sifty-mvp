/**
 * Capture comprehensive screenshots and a screen recording of the Sifty MVP.
 *
 * This is a build-time helper, not part of the app. It uses puppeteer-core
 * with the system Chrome and the CDP screencast API to produce both still
 * frames and an MP4 of the capture flow.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const ARTIFACTS = "/opt/cursor/artifacts";
const URL = process.env.SIFTY_URL ?? "http://localhost:3030";
const CHROME = "/usr/local/bin/google-chrome";

const DESKTOP = { width: 1280, height: 800, deviceScaleFactor: 2 };
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 3 };

await fs.mkdir(ARTIFACTS, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    "--font-render-hinting=none",
    "--force-device-scale-factor=2",
  ],
});

async function withPage(viewport, theme, fn) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument((t) => {
    try {
      window.localStorage.setItem("sifty.theme", t);
    } catch (_) {
      void 0;
    }
  }, theme);
  try {
    await fn(page);
  } finally {
    await page.close();
  }
}

async function shoot(name, viewport, theme, navigateTo, after) {
  await withPage(viewport, theme, async (page) => {
    await page.goto(`${URL}${navigateTo}`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 600)); // allow reflow + animations
    if (after) await after(page);
    const out = path.join(ARTIFACTS, `${name}.png`);
    await page.screenshot({ path: out, type: "png" });
    console.log("shot", out);
  });
}

const ONLY_RECORD = process.env.ONLY_RECORD === "1";

if (!ONLY_RECORD) {

// ---- Static shots ---------------------------------------------------------

const views = [
  { name: "today", path: "/today" },
  { name: "focus", path: "/focus" },
  { name: "inbox", path: "/inbox" },
  { name: "waiting", path: "/waiting" },
  { name: "someday", path: "/someday" },
  { name: "memory", path: "/memory" },
  { name: "settings", path: "/settings" },
];

for (const theme of ["dark", "light"]) {
  for (const v of views) {
    await shoot(`shot-${theme}-${v.name}`, DESKTOP, theme, v.path);
  }
}

// Mobile shots
for (const theme of ["dark", "light"]) {
  await shoot(`shot-${theme}-mobile-today`, MOBILE, theme, "/today");
  await shoot(`shot-${theme}-mobile-focus`, MOBILE, theme, "/focus");
}

// Capture dialog open
await shoot("shot-dark-capture-open", DESKTOP, "dark", "/today", async (page) => {
  await page.keyboard.press("c");
  await new Promise((r) => setTimeout(r, 400));
  await page.keyboard.type("Draft launch announcement for the Sifty preview by Friday", {
    delay: 18,
  });
  await new Promise((r) => setTimeout(r, 250));
});

// Command palette
await shoot("shot-dark-palette-open", DESKTOP, "dark", "/today", async (page) => {
  await page.keyboard.press("/");
  await new Promise((r) => setTimeout(r, 400));
  await page.keyboard.type("focus", { delay: 30 });
  await new Promise((r) => setTimeout(r, 200));
});

// Task detail sheet — open the first task on Focus
await shoot("shot-dark-detail", DESKTOP, "dark", "/focus", async (page) => {
  await page.waitForSelector('[role="option"]');
  await page.evaluate(() => {
    const first = document.querySelector('[role="option"]');
    if (first) first.click();
  });
  await new Promise((r) => setTimeout(r, 700));
});

await shoot("shot-light-detail", DESKTOP, "light", "/focus", async (page) => {
  await page.waitForSelector('[role="option"]');
  await page.evaluate(() => {
    const first = document.querySelector('[role="option"]');
    if (first) first.click();
  });
  await new Promise((r) => setTimeout(r, 700));
});

} // /ONLY_RECORD gate

// ---- Screencast of the capture flow --------------------------------------

async function recordCapture(name, theme) {
  const framesDir = path.join(ARTIFACTS, `_frames_${name}`);
  await fs.rm(framesDir, { recursive: true, force: true });
  await fs.mkdir(framesDir, { recursive: true });

  const page = await browser.newPage();
  await page.setViewport(DESKTOP);
  await page.evaluateOnNewDocument((t) => {
    try {
      // Reset any state left over from earlier shots/recordings so each
      // recording starts from a deterministic seeded inbox.
      window.localStorage.clear();
      window.localStorage.setItem("sifty.theme", t);
    } catch (_) {
      void 0;
    }
  }, theme);

  const client = await page.createCDPSession();

  let frameIndex = 0;
  const frameTimes = [];
  const start = Date.now();

  client.on("Page.screencastFrame", async (frame) => {
    const t = (Date.now() - start) / 1000;
    const buf = Buffer.from(frame.data, "base64");
    const fname = path.join(framesDir, `${String(frameIndex).padStart(5, "0")}.jpg`);
    await fs.writeFile(fname, buf);
    frameTimes.push(t);
    frameIndex += 1;
    try {
      await client.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
    } catch (_) {
      void 0;
    }
  });

  await page.goto(`${URL}/inbox`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 700));

  await client.send("Page.startScreencast", {
    format: "jpeg",
    quality: 85,
    everyNthFrame: 1,
  });

  // Pause on Inbox so the viewer reads the page
  await new Promise((r) => setTimeout(r, 900));

  // Open capture
  await page.keyboard.press("c");
  await new Promise((r) => setTimeout(r, 750));

  // Type a task with deliberate pacing
  await page.keyboard.type(
    "Reply to investor email about the demo by Friday",
    { delay: 36 },
  );
  await new Promise((r) => setTimeout(r, 700));

  // Submit. The new task lands at the top of Inbox with "Triaging" status,
  // then settles to "Ready" with title, next-action, labels, and due date.
  await page.keyboard.down("Meta");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Meta");

  // Wait through the triage-running → ready transition
  await new Promise((r) => setTimeout(r, 2000));

  // Open the freshly created task — it sits at the top of the list
  await page.evaluate(() => {
    const first = document.querySelector('[role="option"]');
    if (first) first.click();
  });
  await new Promise((r) => setTimeout(r, 1500));

  // Reveal the AI rationale section
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const target = buttons.find((b) => /AI rationale/i.test(b.textContent ?? ""));
    if (target) target.click();
  });
  await new Promise((r) => setTimeout(r, 1500));

  await client.send("Page.stopScreencast");
  await page.close();

  // Encode frames into mp4 with explicit per-frame timestamps so the playback
  // pacing matches the real interaction speed.
  const concat = path.join(framesDir, "concat.txt");
  const lines = [];
  for (let i = 0; i < frameTimes.length; i += 1) {
    const next = frameTimes[i + 1];
    const dur = next ? Math.max(0.04, next - frameTimes[i]) : 0.2;
    lines.push(`file '${String(i).padStart(5, "0")}.jpg'`);
    lines.push(`duration ${dur.toFixed(3)}`);
  }
  if (lines.length) {
    lines.push(`file '${String(frameTimes.length - 1).padStart(5, "0")}.jpg'`);
  }
  await fs.writeFile(concat, lines.join("\n"));

  const outMp4 = path.join(ARTIFACTS, `${name}.mp4`);
  const outGif = path.join(ARTIFACTS, `${name}.gif`);

  await runFfmpeg([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concat,
    "-vsync",
    "vfr",
    "-pix_fmt",
    "yuv420p",
    "-vf",
    "scale='min(1280,iw)':-2:flags=lanczos",
    "-c:v",
    "libx264",
    "-crf",
    "20",
    "-preset",
    "veryfast",
    "-movflags",
    "+faststart",
    outMp4,
  ]);
  console.log("encoded", outMp4);

  await runFfmpeg([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concat,
    "-vf",
    "fps=18,scale=900:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
    "-loop",
    "0",
    outGif,
  ]);
  console.log("encoded", outGif);

  await fs.rm(framesDir, { recursive: true, force: true });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${err.slice(-1200)}`));
    });
  });
}

await recordCapture("sifty-capture-flow-dark", "dark");
await recordCapture("sifty-capture-flow-light", "light");

await browser.close();
console.log("done");
