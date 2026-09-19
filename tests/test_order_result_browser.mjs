// 空発注対策（2026-09-20）のブラウザ通しテスト。
// 本物の index.html / config.js / app.js をローカル配信し、GASの応答だけモックする。
// 見るもの: 完了は「書いた行」が返ったときだけ／失敗はカゴを残す／旧GASは従来どおり／商品一覧の取得失敗を知らせる。
// 実行: node tests/test_order_result_browser.mjs   （スクショは最後に出るフォルダへ）
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const repo = fileURLToPath(new URL('../', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'b2b-order-result-'));
const USER = 'UT-20260920-e2e-user';
const SALON = 'UT-20260920-e2e-サロン';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(repo, p === '/' ? 'index.html' : p);
  // SWは登録させない（キャッシュが通しテストに混ざるため）
  if (p.endsWith('sw.js') || !file.startsWith(repo) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': (types[extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const sitePort = server.address().port;

// ページ読み込み前に差し込むモック（GASのURLだけ横取り）
const mock = String.raw`
(() => {
  const cfg = JSON.parse(sessionStorage.getItem('__mock') || '{}');
  window.__posts = []; window.__alerts = [];
  window.alert = (m) => { window.__alerts.push(String(m)); };
  window.confirm = () => true;
  const items = Array.from({ length: 5 }, (_, i) => ({ code: String(100001 + i), name: 'UT シャンプー ' + (i + 1), manufacturer: 'UTメーカー', category: 'UTケア', special: '' }));
  const json = (o) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = String(input && input.url || input);
    if (!url.includes('script.google.com')) return realFetch(input, init);
    if (!init.method || init.method === 'GET') {
      const action = new URL(url).searchParams.get('action');
      if (action === 'items') {
        if (cfg.items === 'fail') throw new TypeError('Failed to fetch');
        return json({ status: 'success', data: items, dataVersion: '1' });
      }
      if (action === 'version') return json({ status: 'success', dataVersion: '1' });
      return json({ status: 'success', data: [] });
    }
    const body = JSON.parse(init.body);
    window.__posts.push(body);
    if (body.action === 'login') {
      return json({ status: 'success', clientName: '${SALON}', sessionToken: 'tk', clientType: '', announcement: '', dataVersion: '1', favorites: [] });
    }
    if (body.action === 'order' || body.action === 'multi_order') {
      const groups = body.action === 'multi_order' ? body.orderGroups : [{ clientName: body.clientName, orders: body.orders }];
      const written = [];
      groups.forEach(g => g.orders.filter(o => o.qty > 0).forEach(o => written.push({ salon: g.clientName, name: o.name, qty: o.qty })));
      switch (cfg.order) {
        case 'zero': return json({ status: 'success', message: 'x', rows: 0, written: [] });
        case 'legacy': return json({ status: 'success', message: 'Order recorded successfully' });
        case 'error': return json({ status: 'error', message: 'Error: Invalid order data format.' });
        case 'network': throw new TypeError('Failed to fetch');
        default: return json({ status: 'success', message: 'x', rows: written.length, orderId: 1790000123456, receivedAt: '2026/09/22 10:15:32', sheetDate: '2026-09-22', written });
      }
    }
    return json({ status: 'success' });
  };
})();
`;

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const portServer = createNetServer(); await new Promise(r => portServer.listen(0, '127.0.0.1', r));
const cdpPort = portServer.address().port; await new Promise(r => portServer.close(r));
const child = spawn(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-background-networking', `--user-data-dir=${join(outDir, 'profile')}`, `--remote-debugging-port=${cdpPort}`, 'about:blank'], { stdio: 'ignore' });

let socket;
let passed = 0;
try {
  let tabs;
  for (let i = 0; i < 100; i++) { try { tabs = (await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()).filter(t => t.type === 'page'); if (tabs.length) break; } catch {} await delay(100); }
  assert.ok(tabs?.length, 'Chrome CDP startup');
  socket = new WebSocket(tabs[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let serial = 0; const waiting = new Map();
  socket.addEventListener('message', e => { const d = JSON.parse(e.data); if (d.id && waiting.has(d.id)) { const w = waiting.get(d.id); waiting.delete(d.id); d.error ? w.reject(Error(JSON.stringify(d.error))) : w.resolve(d.result); } });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; const timer = setTimeout(() => { waiting.delete(id); reject(Error('CDP timeout: ' + method)); }, 15000); waiting.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expression, label, ms = 8000) => {
    for (let i = 0; i < ms / 100; i++) { if (await evaluate(expression)) return; await delay(100); }
    throw Error('timeout: ' + label);
  };
  const shot = async (name) => { const s = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(outDir, name + '.png'), Buffer.from(s.data, 'base64')); };

  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: mock });
  const base = `http://127.0.0.1:${sitePort}/index.html`;
  const cartKey = `b2b_cart_${USER}_${SALON}`;
  const cart = JSON.stringify({ cart: { '100001': { qty: 1, name: 'UT シャンプー 1' }, '100002': { qty: 2, name: 'UT シャンプー 2' } }, order: ['100001', '100002'], remarks: 'UT-20260920-e2e-正常', savedAt: Date.now() });

  // 1ケース = 白紙のブラウザ状態 → カゴを仕込む → ログイン
  const openCase = async ({ order = 'receipt', items = 'ok', seed = '' } = {}) => {
    await cdp('Page.navigate', { url: base });
    await waitFor('document.readyState === "complete"', 'first load');
    await evaluate(`localStorage.clear(); sessionStorage.setItem('__mock', ${JSON.stringify(JSON.stringify({ order, items }))});
      localStorage.setItem(${JSON.stringify(cartKey)}, ${JSON.stringify(cart)}); ${seed} true`);
    await cdp('Page.navigate', { url: base });
    await waitFor('document.readyState === "complete" && !!document.getElementById("login-form")', 'reload');
    await evaluate(`document.getElementById('username').value = ${JSON.stringify(USER)};
      document.getElementById('password').value = 'x';
      document.getElementById('login-form').requestSubmit(); true`);
  };
  const submitCart = async (beforeConfirm = '') => {
    await waitFor(`parseInt(document.getElementById('total-qty')?.textContent || '0') === 3`, 'cart restored');
    await evaluate(`document.getElementById('order-submit-btn').click(); true`);
    await waitFor(`!document.getElementById('confirmation-container').classList.contains('hidden')`, 'confirmation');
    await evaluate(`${beforeConfirm} document.getElementById('modal-confirm-btn').click(); true`);
  };
  const resultScreen = `(() => { const s = document.getElementById('order-result-screen'); return s && !s.classList.contains('hidden') ? s.innerText : ''; })()`;
  const noOverflow = `document.documentElement.scrollWidth <= innerWidth`;
  const t = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name); };

  await t('F-3 正常: 受付画面に書いた行が出て、カゴが空になる', async () => {
    await openCase();
    await submitCart();
    await waitFor(resultScreen, 'receipt');
    const text = await evaluate(resultScreen);
    assert.match(text, /発注を受け付けました/);
    assert.match(text, /UT シャンプー 1/); assert.match(text, /UT シャンプー 2/);
    assert.match(text, /合計 2品目・3点/);
    assert.doesNotMatch(text, /日分/, 'お届け日と誤解される日付は出さない');
    assert.match(text, /123456/);
    assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(cartKey)})`), null);
    assert.deepEqual(await evaluate('window.__alerts'), []);
    const post = (await evaluate('window.__posts')).find(p => p.action === 'order');
    assert.ok(post.ua, '端末情報を送る');
    assert.ok(await evaluate(noOverflow), '横にはみ出さない');
    await shot('F-3_受付画面');
    await evaluate(`document.querySelector('#order-result-screen [data-close]').click(); true`);
    assert.equal(await evaluate(resultScreen), '');
  });

  await t('F-4 success でも0行: 失敗表示・カゴは残る', async () => {
    await openCase({ order: 'zero' });
    await submitCart();
    await waitFor(resultScreen, 'failure');
    const text = await evaluate(resultScreen);
    assert.match(text, /送れませんでした/);
    assert.match(text, /商品が0件のため受け付けていません/);
    assert.doesNotMatch(text, /受け付けました/);
    assert.ok(await evaluate(`!!localStorage.getItem(${JSON.stringify(cartKey)})`), 'カゴが残る');
    assert.equal(await evaluate(`document.getElementById('total-qty').textContent`), '3');
    await shot('F-4_送れませんでした');
  });

  await t('旧GAS（rowsなし）の担当は従来の完了表示のまま', async () => {
    await openCase({ order: 'legacy' });
    await submitCart();
    await waitFor(`window.__alerts.length > 0`, 'legacy alert');
    assert.match((await evaluate('window.__alerts'))[0], /発注が完了しました/);
    assert.equal(await evaluate(resultScreen), '');
    assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(cartKey)})`), null);
  });

  await t('F-2 英語エラーは見せない・担当のLINEボタンは設定があるときだけ', async () => {
    await openCase({ order: 'error' });
    await evaluate(`CONFIG.CONTACT_LINE_URL = 'https://line.me/R/ti/p/UT-20260920-e2e'; true`);
    await submitCart();
    await waitFor(resultScreen, 'failure');
    const text = await evaluate(resultScreen);
    assert.doesNotMatch(text, /Error|Invalid/);
    assert.match(text, /商品が0件のため受け付けていません/);
    assert.equal(await evaluate(`document.querySelector('.order-result-contact')?.getAttribute('href')`), 'https://line.me/R/ti/p/UT-20260920-e2e');
    assert.ok(await evaluate(`!!localStorage.getItem(${JSON.stringify(cartKey)})`));
    await shot('F-2_英語エラー_LINEボタンあり');
  });

  await t('F-8 通信が切れた: 届いている可能性と履歴の確認を案内・カゴは残る', async () => {
    await openCase({ order: 'network' });
    await submitCart();
    await waitFor(resultScreen, 'network failure');
    const text = await evaluate(resultScreen);
    assert.match(text, /履歴/);
    assert.equal(await evaluate(`document.querySelector('.order-result-contact')`), null, '設定が空ならボタンなし');
    assert.ok(await evaluate(`!!localStorage.getItem(${JSON.stringify(cartKey)})`));
  });

  await t('F-6 店販に振り分け: 受付画面にグループごとに出る', async () => {
    await openCase();
    await submitCart(`const sel = document.querySelector('.confirm-item-row .item-assign-select'); sel.value = '店販'; sel.dispatchEvent(new Event('change'));`);
    await waitFor(resultScreen, 'multi receipt');
    const text = await evaluate(resultScreen);
    assert.match(text, new RegExp(SALON + ' 店販'));
    assert.match(text, /合計 2品目・3点/);
    assert.equal((await evaluate('window.__posts')).filter(p => p.action === 'multi_order').length, 1);
    await shot('F-6_振り分け受付');
  });

  await t('F-1 商品一覧が取れない（手元の一覧なし）: お知らせと再読み込み', async () => {
    await openCase({ items: 'fail' });
    await waitFor(`!!document.getElementById('items-fetch-notice')`, 'notice');
    assert.match(await evaluate(`document.getElementById('items-fetch-notice').innerText`), /商品一覧を取得できませんでした/);
    assert.deepEqual(await evaluate('window.__alerts'), []);
    await shot('F-1_一覧なし');
  });

  await t('F-1 商品一覧が取れない（期限切れの一覧あり）: 前回の一覧で続けられる', async () => {
    const cached = JSON.stringify([{ code: '100001', name: 'UT シャンプー 1', manufacturer: 'UTメーカー', category: 'UTケア', special: '', _searchKey: 'utシャンプー1100001' }]);
    await openCase({ items: 'fail', seed: `localStorage.setItem('b2b_items_cache', ${JSON.stringify(cached)}); localStorage.setItem('b2b_items_ts', '1');` });
    await waitFor(`!!document.getElementById('items-fetch-notice')`, 'notice');
    assert.match(await evaluate(`document.getElementById('items-fetch-notice').innerText`), /前回の一覧を表示しています/);
    assert.deepEqual(await evaluate('window.__alerts'), []);
    assert.ok(await evaluate(noOverflow));
  });

  console.log(`\n${passed} passed\nスクショ: ${outDir}`);
} finally {
  if (socket) socket.close();
  child.kill();
  server.close();
}
