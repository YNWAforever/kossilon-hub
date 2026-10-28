// Isolated browser-only capability probe; no application or business target.
import { chromium } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
const output = resolve(import.meta.dirname);
const base = resolve('.worktrees/r22-fe4a5635-profiles');
await mkdir(base, { recursive: true });
const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><html><body>Local browser zoom probe</body></html>');
});
await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
const facts = [];
try {
  for (const zoom of [1, 2]) {
    const profile = await mkdtemp(join(base, `zoom-${zoom}-`));
    await mkdir(join(profile, 'Default'));
    const preferences = { partition: { default_zoom_level: { x: Math.log(zoom) / Math.log(1.2) } } };
    await writeFile(join(profile, 'Default', 'Preferences'), JSON.stringify(preferences), { flag: 'wx' });
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'msedge', headless: true, viewport: null,
      args: ['--window-size=1280,900', '--force-device-scale-factor=1'],
    });
    try {
      const page = context.pages()[0];
      const expectedOrigin = `http://127.0.0.1:${server.address().port}`;
      const blocked = [];
      await context.route('**/*', route => {
        const req = route.request();
        if (new URL(req.url()).origin !== expectedOrigin || req.method() !== 'GET') {
          blocked.push(`${req.method()} ${req.url()}`);
          return route.abort();
        }
        return route.continue();
      });
      await page.goto(expectedOrigin);
      const dimensions = await page.evaluate(() => ({
        innerWidth, innerHeight, outerWidth, outerHeight, devicePixelRatio,
        screenWidth: screen.width, screenHeight: screen.height,
        visualScale: visualViewport.scale, visualWidth: visualViewport.width,
        cssZoom: getComputedStyle(document.documentElement).zoom,
      }));
      const client = await context.newCDPSession(page);
      facts.push({ zoom, profile, preferences, version: context.browser()?.version(), dimensions,
        layout: await client.send('Page.getLayoutMetrics'), blocked });
      const shot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }); await writeFile(join(output, `probe-cdp-${zoom}x.png`), Buffer.from(shot.data, 'base64'), {flag: 'wx'});
    } finally { await context.close(); }
  }
} finally { await new Promise(ok => server.close(ok)); }
await writeFile(join(output, 'zoom-probe-cdp.json'), JSON.stringify(facts, null, 2), { flag: 'wx' });
console.log(JSON.stringify(facts.map(({zoom, dimensions}) => ({zoom, dimensions}))));
