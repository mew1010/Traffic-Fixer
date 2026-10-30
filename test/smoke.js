// Smoke test: node test/smoke.js (needs the playwright package and its Chromium).
// Name entry, a bridge over the river, boulevard upgrade, undo, pinch zoom, right-drag, stop-time, missions and the second chance.
const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  const cdp = await ctx.newCDPSession(page);
  const T = fn => page.evaluate(fn);

  // the game asks for a name first
  await page.tap('#startForm button[type=submit]');
  assert(await page.isVisible('#nameError'), 'empty name should be refused');
  await page.fill('#playerName', 'Test');
  await page.tap('#startForm button[type=submit]');
  assert(await page.isHidden('#intro'));

  // open the whole map so a river crossing is reachable, then find a clear line over it
  await T(() => { const t = window.__trafik; t.S.region = { x: 0, y: 0, w: t.world.W, h: t.world.H }; t.fit(); });
  const line = await T(() => {
    const S = window.__trafik.S, across = S.river.pts[0].x < 0;
    for (let k = 60; k < 800; k += 7) {
      const c = S.river.pts.reduce((b, q) => (Math.abs((across ? q.x : q.y) - k) < Math.abs((across ? b.x : b.y) - k) ? q : b));
      const a = across ? { x: k, y: c.y - 50 } : { x: c.x - 50, y: k }, b = across ? { x: k, y: c.y + 50 } : { x: c.x + 50, y: k };
      const clear = [...S.obstacles, ...S.houses, ...S.places].every(o => {
        for (let t = 0; t <= 1; t += 0.02) if (Math.hypot(a.x + (b.x - a.x) * t - o.x, a.y + (b.y - a.y) * t - o.y) < o.r + 30) return false;
        return true;
      }) && S.lakes.every(l => Math.hypot(l.x - a.x, l.y - a.y) > l.R * 1.3 + 50);
      if (clear) return [a, b];
    }
    return null;
  });
  assert(line, 'no clear crossing found');
  const touchLine = async (a, b) => {
    const pts = await page.evaluate(([a, b]) => Array.from({ length: 31 }, (_, i) => window.__trafik.toScreen({ x: a.x + (b.x - a.x) * i / 30, y: a.y + (b.y - a.y) * i / 30 })), [a, b]);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]] });
    for (const q of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [q] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await touchLine(...line);
  const after = await T(() => {
    const S = window.__trafik.S, edges = [...S.edges.values()];
    return { asphalt: S.asphalt, bridges: edges.filter(e => e.bridge).length, len: edges.reduce((s, e) => s + e.len, 0) };
  });
  const spent = 900 - after.asphalt;
  assert(after.bridges > 0, 'road over the river should become a bridge');
  assert(spent > after.len * 1.2, `bridge should cost extra: spent ${spent} kg for ${after.len.toFixed(0)} m`);

  // upgrading along the road makes it a boulevard, paid in concrete; undo takes it back
  await page.tap('#upBtn');
  const beton0 = await T(() => window.__trafik.S.beton);
  await touchLine(...line);
  const up = await T(() => ({ beton: window.__trafik.S.beton, wide: [...window.__trafik.S.edges.values()].filter(e => e.lanes === 2).length }));
  assert(up.wide > 0 && up.beton < beton0, 'upgrade should widen the road for concrete: ' + JSON.stringify(up));
  await page.tap('#undoBtn');
  const down = await T(() => ({ beton: window.__trafik.S.beton, wide: [...window.__trafik.S.edges.values()].filter(e => e.lanes > 1).length }));
  assert(down.wide === 0 && Math.abs(down.beton - beton0) < 1, 'undo should take the upgrade back: ' + JSON.stringify(down));
  await page.tap('#drawBtn');

  await page.tap('#undoBtn');
  const undone = await T(() => ({ asphalt: window.__trafik.S.asphalt, edges: window.__trafik.S.edges.size }));
  assert.strictEqual(undone.edges, 0, 'undo should remove the road');
  assert(Math.abs(undone.asphalt - 900) < 0.01, 'undo should refund the asphalt: ' + undone.asphalt);

  // two fingers zoom in and do not draw
  const z0 = await T(() => window.__trafik.cam.z);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 400, id: 1 }, { x: 250, y: 400, id: 2 }] });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180 - i * 8, y: 400, id: 1 }, { x: 250 + i * 8, y: 400, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const z1 = await T(() => window.__trafik.cam.z);
  assert(z1 > z0 * 1.5, `pinch should zoom in: ${z0} -> ${z1}`);
  assert.strictEqual(await T(() => window.__trafik.S.edges.size), 0, 'pinch must not draw a road');

  // the right mouse button drags the map
  const c0 = await T(() => ({ ...window.__trafik.cam }));
  await page.mouse.move(200, 500); await page.mouse.down({ button: 'right' });
  await page.mouse.move(120, 440, { steps: 5 }); await page.mouse.up({ button: 'right' });
  const c1 = await T(() => ({ ...window.__trafik.cam }));
  assert(c1.x !== c0.x || c1.y !== c0.y, 'right-drag should move the map');
  assert.strictEqual(await T(() => window.__trafik.S.edges.size), 0, 'right-drag must not draw');

  // stop-time freezes the clock but the game keeps running
  await page.tap('#freezeBtn');
  const t0 = await T(() => window.__trafik.S.t);
  await page.waitForTimeout(500);
  assert.strictEqual(await T(() => window.__trafik.S.t), t0, 'time should not move while stopped');
  await page.tap('#freezeBtn');

  await T(() => document.getElementById('againBtn').click());

  // an unattended run: land opens, the first jam ends the game, the second chance clears it
  const run = await T(() => {
    const t = window.__trafik; let stage = 0;
    for (let i = 0; i < 400 * 60 && document.querySelector('#over[hidden]'); i++) { t.update(1 / 60); stage = t.S.stage; }
    return { over: !document.querySelector('#over[hidden]'), stage, t: t.S.t, mission: document.getElementById('missions').textContent };
  });
  assert(run.over && run.stage >= 0 && run.mission.includes('50 araba'), JSON.stringify(run));
  assert(await page.isVisible('#chanceBtn'), 'first loss offers a second chance');
  await page.tap('#chanceBtn');
  const resumed = await T(() => ({ over: !document.querySelector('#over[hidden]'), frozen: document.getElementById('stage').classList.contains('frozen'), lostWaiting: window.__trafik.S.lost.waiting }));
  assert(!resumed.over && !resumed.frozen && resumed.lostWaiting < 3, JSON.stringify(resumed));
  await T(() => { const t = window.__trafik; for (let i = 0; i < 400 * 60 && document.querySelector('#over[hidden]'); i++) t.update(1 / 60); });
  assert(await page.isHidden('#chanceBtn'), 'the second chance is used up');

  assert.deepStrictEqual(errors, []);
  console.log('smoke ok', { spent, metres: Math.round(after.len), zoom: `${z0.toFixed(2)} -> ${z1.toFixed(2)}`, firstLoss: Math.round(run.t) + 's' });
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
