// Renders assets/icon.svg into everything that needs the logo, using Playwright's Chromium
// (npx playwright install chromium) so no native image library is required:
//   public/icon{16,32}.png   toolbar sizes: emblem on a dark tile so it reads on light and dark toolbars
//   public/icon{48,128}.png  full-colour emblem on a transparent background, centred with even padding
//   assets/logo.png          512 px, transparent, centred (README, listings)
//   docs/store/promo-440x280.png  Chrome Web Store small promo tile
// The emblem is centred by its rendered pixel bounds, so the source SVG needs no manual offsets.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const svg = fs.readFileSync('assets/icon.svg', 'utf8');
const TILE = '#0f172a';
const browser = await chromium.launch({ channel: process.env.CHROMIUM_PATH ? undefined : 'chromium', executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
await page.setContent('<html><body style="margin:0"></body></html>');

const renders = await page.evaluate(async ({ svg, TILE }) => {
  const img = new Image();
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
  await img.decode();
  // Measure the emblem's real bounds at high resolution.
  const M = 1024;
  const probe = document.createElement('canvas'); probe.width = M; probe.height = M;
  const pc = probe.getContext('2d'); pc.drawImage(img, 0, 0, M, M);
  const d = pc.getImageData(0, 0, M, M).data;
  let x0 = M, y0 = M, x1 = -1, y1 = -1;
  for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) if (d[(y * M + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const out = {};
  const draw = (size, { tile, pad }) => {
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    if (tile) { ctx.fillStyle = TILE; const r = size * 0.22; ctx.beginPath(); ctx.roundRect(0, 0, size, size, r); ctx.fill(); }
    const inner = size * (1 - 2 * pad);
    const s = inner / Math.max(bw, bh);
    const dw = bw * s, dh = bh * s;
    const dx = (size - dw) / 2, dy = (size - dh) / 2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, x0 / M * img.width, y0 / M * img.height, bw / M * img.width, bh / M * img.height, dx, dy, dw, dh);
    return c.toDataURL('image/png');
  };
  out['public/icon16.png'] = draw(16, { tile: true, pad: 0.08 });
  out['public/icon32.png'] = draw(32, { tile: true, pad: 0.08 });
  out['public/icon48.png'] = draw(48, { tile: false, pad: 0.06 });
  out['public/icon128.png'] = draw(128, { tile: false, pad: 0.125 }); // content inside the central 96 px, per store guidance
  out['assets/logo.png'] = draw(512, { tile: false, pad: 0.04 });
  return { out, bounds: { x0, y0, bw, bh, M } };
}, { svg, TILE });
for (const [file, dataUrl] of Object.entries(renders.out)) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(file);
}
console.log('emblem bounds in 1024 probe:', JSON.stringify(renders.bounds));

// Promo tile uses the centred logo.
const logo = fs.readFileSync('assets/logo.png').toString('base64');
await page.setViewportSize({ width: 440, height: 280 });
await page.setContent(`<html><body style="margin:0;width:440px;height:280px;background:${TILE};display:flex;align-items:center;justify-content:center;gap:28px;font-family:'Liberation Sans',Arial,Helvetica,sans-serif;color:#f8fafc">
  <img src="data:image/png;base64,${logo}" width="120" height="120" style="display:block">
  <div>
    <div style="font-size:34px;font-weight:700;letter-spacing:-0.5px">Jev for Chrome</div>
    <div style="font-size:16px;color:#c7d2fe;margin-top:8px;line-height:1.35">Sub-second browser agent.<br>Runs in your own tabs.</div>
  </div>
</body></html>`);
await page.screenshot({ path: 'docs/store/promo-440x280.png', clip: { x: 0, y: 0, width: 440, height: 280 } });
console.log('docs/store/promo-440x280.png');
await browser.close();
