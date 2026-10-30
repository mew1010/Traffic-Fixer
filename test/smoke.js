// Smoke test: node test/smoke.js (needs the playwright package and its Chromium).
// Draws a road over the river, checks the bridge cost, undo, speed and a long bot-free run.
const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.tap('#startBtn');

  // find a straight line across the river that misses trees, rocks, lakes and buildings
  const line = await page.evaluate(() => {
    const S = window.__trafik.S, across = S.river.pts[0].x < 0;
    for (let k = 40; k < 440; k += 7) {
      const at = i => S.river.pts.reduce((b, q) => (Math.abs((across ? q.x : q.y) - k) < Math.abs((across ? b.x : b.y) - k) ? q : b));
      const c = at(), a = across ? { x: k, y: c.y - 45 } : { x: c.x - 45, y: k }, b = across ? { x: k, y: c.y + 45 } : { x: c.x + 45, y: k };
      const clear = [...S.obstacles, ...S.houses, ...S.places].every(o => {
        for (let t = 0; t <= 1; t += 0.02) if (Math.hypot(a.x + (b.x - a.x) * t - o.x, a.y + (b.y - a.y) * t - o.y) < o.r + 30) return false;
        return true;
      });
      if (clear) return [a, b];
    }
    return null;
  });
  assert(line, 'no clear crossing found');
  const cdp = await ctx.newCDPSession(page);
  const pts = await page.evaluate(([a, b]) => Array.from({ length: 31 }, (_, i) => window.__trafik.toScreen({ x: a.x + (b.x - a.x) * i / 30, y: a.y + (b.y - a.y) * i / 30 })), line);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]] });
  for (const q of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [q] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  const after = await page.evaluate(() => {
    const S = window.__trafik.S, edges = [...S.edges.values()];
    return { asphalt: S.asphalt, bridges: edges.filter(e => e.bridge).length, len: edges.reduce((s, e) => s + e.len, 0) };
  });
  const spent = 1300 - after.asphalt;
  assert(after.bridges > 0, 'road over the river should become a bridge');
  assert(spent > after.len * 1.2, `bridge should cost extra: spent ${spent} kg for ${after.len.toFixed(0)} m`);

  await page.tap('#undoBtn');
  const undone = await page.evaluate(() => ({ asphalt: window.__trafik.S.asphalt, edges: window.__trafik.S.edges.size }));
  assert.strictEqual(undone.edges, 0, 'undo should remove the road');
  assert.strictEqual(undone.asphalt, 1300, 'undo should refund the asphalt');

  await page.tap('#speedBtn');
  assert.strictEqual(await page.textContent('#speedBtn'), '2×');

  // a long unattended run must end in a jam, without errors, with weekly asphalt arriving
  const run = await page.evaluate(() => {
    const T = window.__trafik; let supply = false;
    for (let i = 0; i < 400 * 60 && document.querySelector('#over[hidden]'); i++) { const a = T.S.asphalt; T.update(1 / 60); if (T.S.asphalt - a === 200) supply = true; }
    return { over: !document.querySelector('#over[hidden]'), supply, t: T.S.t };
  });
  assert(run.over && run.supply, JSON.stringify(run));
  assert.deepStrictEqual(errors, []);
  console.log('smoke ok', { spent, metres: Math.round(after.len), endedAt: Math.round(run.t) + 's' });
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
