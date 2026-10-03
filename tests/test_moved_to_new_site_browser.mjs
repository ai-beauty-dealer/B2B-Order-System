// 「新しいサイトへ切り替えた担当を、新しいURLへ送り出す」（config.js・2026-10-03）のブラウザ通しテスト。
// 本物の index.html / config.js / app.js をローカル配信し、切り替えた担当の表（DEALER_MOVED_URLS）だけ差し替える。
// 新しいサイトの代わりは、着いた時の # と「どこから来たか」を控えるだけのページ（このテストが自分で立てる）。
// 見るもの: 表が空なら今までと同じ／表にある担当だけ送る／渡すのは札とカゴだけ（パスワードは渡さない）／
//           カゴは1回だけ／この端末の記憶は消さない／移るまでの間に GAS へ通信しない・警告も出さない／
//           戻した後は、渡したカゴだけを1回消して知らせを出す（二重発注を防ぐ）。
// 実行: node tests/test_moved_to_new_site_browser.mjs
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
const outDir = mkdtempSync(join(tmpdir(), 'b2b-moved-'));
const configSource = readFileSync(join(repo, 'config.js'), 'utf8');
const TABLE = /const DEALER_MOVED_URLS = \{[\s\S]*?\n\};/;

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name); };

// ---- ファイルそのものの検査（ブラウザ無し） ----
const tableOf = (name) => {
  const m = new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\};`).exec(configSource);
  assert.ok(m, `${name} が config.js にある`);
  const body = m[1].split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  return Object.fromEntries([...body.matchAll(/['"]([A-Za-z0-9_-]+)['"]\s*:\s*['"]([^'"]*)['"]/g)].map(x => [x[1], x[2]]));
};
await t('切り替えた担当の表: 載っているのは今ある担当だけ・https で始まり「/」で終わる', async () => {
  const dealers = tableOf('DEALER_API_URLS');
  for (const [dealer, url] of Object.entries(tableOf('DEALER_MOVED_URLS'))) {
    assert.ok(dealer in dealers, `${dealer} は DEALER_API_URLS に無い（戻す時に使うので消さない）`);
    assert.match(url, /^https:\/\/[^/]+\/$/, `${dealer} の新しいURL`);
    assert.doesNotMatch(url, /script\.google\.com/);
  }
});

// ---- 新しいサイトの代わり ----
let newSiteDelayMs = 0;
const newSite = createServer(async (_req, res) => {
  if (newSiteDelayMs) await delay(newSiteDelayMs);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('<!doctype html><meta charset="utf-8"><title>new</title><p>試験用: 新しいサイトの代わり</p>'
    + '<script>window.__arrived = { hash: location.hash, referrer: document.referrer };</script>');
});
await new Promise(r => newSite.listen(0, '127.0.0.1', r));
const NEW = `http://127.0.0.1:${newSite.address().port}/`;

// ---- 今のサイト（本物のファイル。config.js は表だけ差し替える） ----
let moved = {};   // テストごとに差し替える「切り替えた担当の表」。null なら config.js をそのまま配る
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(repo, p === '/' ? 'index.html' : p);
  // SWは登録させない（キャッシュが通しテストに混ざるため）
  if (p.endsWith('sw.js') || !file.startsWith(repo) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': (types[extname(file)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' });
  if (p === '/config.js' && moved) {
    assert.match(configSource, TABLE);
    res.end(configSource.replace(TABLE, () => `const DEALER_MOVED_URLS = ${JSON.stringify(moved)};`));
    return;
  }
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const OLD = `http://127.0.0.1:${server.address().port}`;

// ページ読み込み前に差し込む見張り（GAS への通信と警告を数える。GAS へは実際には出さない）
const watch = String.raw`
(() => {
  window.__gas = []; window.__alerts = [];
  window.alert = (m) => { window.__alerts.push(String(m)); };
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = String(input && input.url || input);
    if (!url.includes('script.google.com')) return realFetch(input, init);
    window.__gas.push(url);
    return new Response(JSON.stringify({ status: 'error', message: 'テストでは GAS へ出さない' }), { headers: { 'Content-Type': 'application/json' } });
  };
  // 移るのを待っている間は外から画面を覗けない（CDP が次の画面を待つ）ので、画面が自分で様子を控える。
  // ?probe=1 の時だけ。自動ログイン（開いて0.6秒後）が動いた後の 1.5 秒後に控える
  if (new URLSearchParams(location.search).get('probe') === '1') {
    setTimeout(() => {
      const c = document.getElementById('moved-cover');
      const r = c ? c.getBoundingClientRect() : { width: 0, height: 0 };
      const hit = document.elementFromPoint(195, 300);
      const a = c && c.querySelector('a');
      localStorage.setItem('__probe', JSON.stringify({
        origin: location.origin, cover: !!c, text: c ? c.innerText : '', w: r.width, h: r.height,
        onTop: !!c && (hit === c || c.contains(hit)), href: a ? a.href : '',
        moved: typeof CONFIG === 'object' && CONFIG.MOVED, api: typeof CONFIG === 'object' && CONFIG.API_URL,
        gas: window.__gas, alerts: window.__alerts, resume: localStorage.getItem('b2b_resume'),
        noOverflow: document.documentElement.scrollWidth <= innerWidth
      }));
    }, 1500);
  }
})();
`;

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const portServer = createNetServer(); await new Promise(r => portServer.listen(0, '127.0.0.1', r));
const cdpPort = portServer.address().port; await new Promise(r => portServer.close(r));
const child = spawn(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-background-networking', `--user-data-dir=${join(outDir, 'profile')}`, `--remote-debugging-port=${cdpPort}`, 'about:blank'], { stdio: 'ignore' });

let socket;
try {
  let tabs;
  for (let i = 0; i < 100; i++) { try { tabs = (await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()).filter(x => x.type === 'page'); if (tabs.length) break; } catch {} await delay(100); }
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
    for (let i = 0; i < ms / 100; i++) { try { if (await evaluate(expression)) return; } catch { /* 画面が移る途中 */ } await delay(100); }
    throw Error('timeout: ' + label);
  };

  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: watch });

  const USER = 'UT-20261003-moved-user';
  const SALON = 'UT-20261003-moved-サロン';
  const CART_KEY = `b2b_cart_${USER}_${SALON}`;
  const CART = JSON.stringify({ cart: { '100001': { qty: 2, name: 'UT シャンプー 1' } }, order: ['100001'], remarks: 'UT-20261003-moved-備考', savedAt: Date.now() });
  const RESUME = JSON.stringify({ u: USER, name: SALON, tk: 'UT-token.UT-sign' });

  // この端末の記憶を仕込む（アプリを読まないページで。アプリを開くと送り出されてしまうため）
  const seed = async (entries) => {
    await cdp('Page.navigate', { url: OLD + '/terms.html' });
    await waitFor(`location.origin === ${JSON.stringify(OLD)} && document.readyState === 'complete'`, '仕込み用のページ');
    await evaluate(`localStorage.clear(); for (const [k, v] of Object.entries(${JSON.stringify(entries)})) localStorage.setItem(k, v); true`);
  };
  const oldMemory = async (key) => {
    await cdp('Page.navigate', { url: OLD + '/terms.html' });
    await waitFor(`location.origin === ${JSON.stringify(OLD)} && document.readyState === 'complete'`, '今のサイトへ戻る');
    return evaluate(`localStorage.getItem(${JSON.stringify(key)})`);
  };
  const open = (path) => cdp('Page.navigate', { url: OLD + path });
  const arrived = async () => {
    await waitFor(`location.origin + '/' === ${JSON.stringify(NEW)} && !!window.__arrived`, '新しいサイトへ移る');
    const a = await evaluate('window.__arrived');
    const m = /^#h=([A-Za-z0-9_-]+)$/.exec(a.hash);
    assert.ok(m, '# に引き継ぎの中身が付く: ' + a.hash.slice(0, 40));
    return { ...a, payload: JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')) };
  };
  const stayed = async () => {
    await waitFor(`document.readyState === 'complete' && !!document.getElementById('login-form')`, '今のサイトのまま');
    await delay(400);
    assert.equal(await evaluate('location.origin'), OLD, '移らない');
    assert.equal(await evaluate(`!!document.getElementById('moved-cover')`), false);
  };

  await t('表が空（配る時の形）なら、今までと同じ。どの担当も移らず、接続先も変わらない', async () => {
    // 表が空の間は config.js をそのまま配る（配る時の形そのもの）。切替の後で表に行がある時は、空に差し替えて同じことを見る
    moved = Object.keys(tableOf('DEALER_MOVED_URLS')).length === 0 ? null : {};
    await seed({ b2b_resume: RESUME });
    for (const [path, dealer] of [['/', 'default'], ['/?dealer=test-sub', 'test-sub'], ['/?dealer=755', '755']]) {
      await open(path);
      await stayed();
      assert.equal(await evaluate('CONFIG.DEALER'), dealer);
      assert.equal(await evaluate('CONFIG.API_URL'), tableOf('DEALER_API_URLS')[dealer]);
      assert.equal(await evaluate('CONFIG.MOVED'), undefined);
    }
  });

  await t('表にある担当だけ送る: ほかの担当・本店は今までどおり', async () => {
    moved = { 'test-sub': NEW };
    await seed({});
    await open('/');
    await stayed();
    assert.equal(await evaluate('CONFIG.API_URL'), tableOf('DEALER_API_URLS').default);
    await open('/?dealer=755');
    await stayed();
    assert.equal(await evaluate('CONFIG.API_URL'), tableOf('DEALER_API_URLS')['755']);
  });

  await t('切り替えた担当のURLを開くと新しいサイトへ移り、札とカゴと入力の控えが渡る。「どこから来たか」は今のサイト', async () => {
    moved = { 'test-sub': NEW };
    await seed({ b2b_resume: RESUME, [CART_KEY]: CART, b2b_saved_username: USER, b2b_remember_me: 'true', b2b_items_cache: '[]', b2b_install_dismissed: '1' });
    await open('/?dealer=test-sub');
    const a = await arrived();
    assert.equal(a.payload.v, 1);
    assert.equal(a.payload.d, 'test-sub');
    assert.deepEqual(JSON.parse(a.payload.ls.b2b_resume), JSON.parse(RESUME));
    assert.equal(a.payload.ls[CART_KEY], CART);
    assert.equal(a.payload.ls.b2b_saved_username, USER);
    assert.deepEqual(Object.keys(a.payload.ls).sort(), ['b2b_remember_me', 'b2b_resume', 'b2b_saved_username', CART_KEY].sort(), '商品のキャッシュや「案内を閉じた」印は渡さない');
    assert.equal(a.referrer, OLD + '/');
  });

  await t('この端末の記憶は消さない（戻す時の備え）。カゴを渡した控えが付く', async () => {
    assert.equal(await oldMemory('b2b_resume'), RESUME);
    assert.equal(await oldMemory(CART_KEY), CART);
    assert.equal(await oldMemory('b2b_moved_carts_sent'), NEW);
    assert.deepEqual(JSON.parse(await oldMemory('b2b_moved_carts_keys')), [CART_KEY], 'どのカゴを渡したかの控え');
    assert.equal(await oldMemory('b2b_dealer'), 'test-sub');
  });

  await t('2回目からはカゴを渡さない（送り終えたカゴをよみがえらせない）。札は渡す', async () => {
    await open('/?dealer=test-sub');
    const a = await arrived();
    assert.ok(a.payload.ls.b2b_resume);
    assert.equal(Object.keys(a.payload.ls).some(k => k.startsWith('b2b_cart_')), false);
  });

  await t('ホーム画面のアイコン（?dealer= 無し・端末が担当を覚えている）でも移る', async () => {
    await seed({ b2b_dealer: 'test-sub', b2b_resume: RESUME });
    await open('/');
    assert.equal((await arrived()).payload.d, 'test-sub');
  });

  await t('パスワード入りの昔の記憶は渡さない', async () => {
    await seed({ b2b_resume: JSON.stringify({ u: USER, p: 'UT-secret-pass', name: SALON }) });
    await open('/?dealer=test-sub');
    const a = await arrived();
    assert.equal(a.payload.ls.b2b_resume, undefined);
    assert.equal(JSON.stringify(a.payload).includes('UT-secret-pass'), false);
    await seed({ b2b_resume: JSON.stringify({ u: USER, p: 'UT-secret-pass', name: SALON, tk: 'UT-token.UT-sign' }) });
    await open('/?dealer=test-sub');
    assert.equal(JSON.stringify((await arrived()).payload).includes('UT-secret-pass'), false);
  });

  await t('開かれた時のURLに付いていた # は引き継がない', async () => {
    await seed({ b2b_resume: RESUME });
    await open('/?dealer=test-sub#h=' + Buffer.from(JSON.stringify({ v: 1, d: 'test-sub', ls: { b2b_resume: 'よその札' } }), 'utf8').toString('base64url'));
    const a = await arrived();
    assert.deepEqual(JSON.parse(a.payload.ls.b2b_resume), JSON.parse(RESUME));
  });

  await t('新しいサイトの返事が遅い間: 案内が出てログイン画面は隠れる。GAS へ通信しない・警告を出さない・記憶を消さない', async () => {
    await seed({ b2b_resume: RESUME, [CART_KEY]: CART });
    newSiteDelayMs = 2500;
    try {
      await open('/?dealer=test-sub&probe=1');
      await delay(1200);
      try {  // 移る前の画面のスクショ（撮れない環境では飛ばす）
        const s = await cdp('Page.captureScreenshot', { format: 'png' });
        writeFileSync(join(outDir, '移動中の案内.png'), Buffer.from(s.data, 'base64'));
      } catch { /* 見た目の控えだけ。判定は下 */ }
      await arrived();
    } finally { newSiteDelayMs = 0; }
    const probe = JSON.parse(await oldMemory('__probe'));
    assert.equal(probe.origin, OLD, '控えた時はまだ今のサイト');
    assert.equal(probe.moved, true);
    assert.equal(probe.api, 'about:blank#moved');
    assert.ok(probe.cover, '案内が出る');
    assert.match(probe.text, /新しくなりました/);
    assert.ok(probe.w >= 390 && probe.h >= 844 && probe.onTop, '画面全体を覆う');
    assert.ok(probe.href.startsWith(NEW + '#h='), '自動で移らない時のリンク');
    assert.deepEqual(probe.gas, [], 'GAS へ通信しない');
    assert.deepEqual(probe.alerts, [], '警告を出さない');
    assert.equal(probe.resume, RESUME, '自動ログインが失敗しても記憶は残る');
    assert.ok(probe.noOverflow, '横にはみ出さない');
  });

  // ---- 戻した後（表からその行を消した後） ----
  const OTHER_KEY = 'b2b_cart_UT-20261003-other-user_UT-20261003-別のサロン';
  const noticeText = () => evaluate(`(document.getElementById('moved-back-notice') || {}).innerText || ''`);

  await t('まだ切り替えたままの間（渡した先が表にある）は、ほかの担当で開いても、カゴを消さず知らせも出さない', async () => {
    moved = { 'test-sub': NEW };
    await open('/?dealer=755');
    await stayed();
    assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(CART_KEY)})`), CART);
    assert.equal(await evaluate(`localStorage.getItem('b2b_moved_carts_sent')`), NEW);
    assert.equal(await noticeText(), '');
  });

  await t('戻した後: 同じ端末で今のサイトが使える。渡したカゴだけ消え（二重発注を防ぐ）、渡していないカゴとログインの記憶は残る。知らせが出る', async () => {
    assert.equal(await oldMemory(CART_KEY), CART, '戻す前はカゴの写しが残っている');
    await evaluate(`localStorage.setItem(${JSON.stringify(OTHER_KEY)}, ${JSON.stringify(CART)}); localStorage.setItem('b2b_dealer', 'test-sub'); true`);
    moved = {};
    await open('/');   // ホーム画面のアイコン（端末が担当を覚えている）
    await stayed();
    assert.equal(await evaluate('CONFIG.API_URL'), tableOf('DEALER_API_URLS')['test-sub']);
    assert.equal(await evaluate(`localStorage.getItem('b2b_resume')`), RESUME);
    assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(CART_KEY)})`), null, '渡したカゴは消す');
    assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(OTHER_KEY)})`), CART, '渡していないカゴは消さない');
    assert.equal(await evaluate(`localStorage.getItem('b2b_moved_carts_sent')`), null);
    assert.equal(await evaluate(`localStorage.getItem('b2b_moved_carts_keys')`), null);
    assert.match(await noticeText(), /前の場所に戻しました。.*サロン様名をお確かめください。.*空にしてあります/);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), '横にはみ出さない');
    assert.deepEqual(await evaluate('window.__alerts'), [], '警告は出さない');
    try {
      const s = await cdp('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(outDir, '戻した後の知らせ.png'), Buffer.from(s.data, 'base64'));
    } catch { /* 見た目の控えだけ */ }
  });

  await t('消すのは1回だけ: その後に入れたカゴは、開き直しても消えない。知らせは閉じるまで出て、閉じたら出ない', async () => {
    await evaluate(`localStorage.setItem(${JSON.stringify(CART_KEY)}, ${JSON.stringify(CART)}); true`);
    await open('/?dealer=test-sub');
    await stayed();
    assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(CART_KEY)})`), CART);
    assert.notEqual(await noticeText(), '', '閉じていないので、まだ出ている');
    await evaluate(`document.getElementById('moved-back-notice-close').click(); true`);
    assert.equal(await noticeText(), '');
    await open('/?dealer=test-sub');
    await stayed();
    assert.equal(await noticeText(), '');
    assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(CART_KEY)})`), CART);
  });

  await t('切り替えたことの無い端末では、何も起きない（知らせも出ない）', async () => {
    await seed({ b2b_resume: RESUME, [CART_KEY]: CART });
    await open('/?dealer=test-sub');
    await stayed();
    assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(CART_KEY)})`), CART);
    assert.equal(await noticeText(), '');
  });

  console.log(`\n${passed} passed（スクショ: ${outDir}）`);
} finally {
  try { socket?.close(); } catch {}
  child.kill();
  server.close();
  newSite.close();
}
