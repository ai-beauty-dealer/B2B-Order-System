// 空発注対策（2026-09-20）の GAS 側テスト。
// 9/16 ラコヘアー様: 「発注完了」と出たのにシートに行が無かった。
// 核心: 書く行が0件なら success を返さない／編集の全部0で旧行を消さない／受信内容は検証前に残す。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(here, '..', 'backend', 'code.gs'), 'utf8');

function makeSheet(name) {
  const rows = [['日時', 'コード', '個数', '商品名', 'サロン名', 'ステータス', '備考', '別注']];
  return {
    rows,
    getName: () => name,
    getLastRow: () => rows.length,
    appendRow: (row) => rows.push(row),
    deleteRows: (start, count) => rows.splice(start - 1, count),
    insertRowsBefore: (at, count) => rows.splice(at - 1, 0, ...Array.from({ length: count }, () => [])),
    getRange: (r, c, nr) => ({
      getValues: () => rows.slice(r - 1, r - 1 + nr).map(row => [row[c - 1]]),
      setValues: (values) => values.forEach((v, i) => { rows[r - 1 + i] = v; })
    })
  };
}

function loadGas() {
  const sheets = new Map();
  const ss = {
    getSheetByName: (name) => sheets.get(name) || null,
    insertSheet: (name) => { const s = makeSheet(name); s.rows.length = 0; sheets.set(name, s); return s; },
    getSheets: () => [...sheets.values()],
    getName: () => 'テスト本店'
  };
  const cache = new Map();
  const calls = { notify: [], discord: [], removed: 0 };
  const context = vm.createContext({
    console: { log() {}, error() {}, warn() {} },
    Date, JSON, Math, Array, Object, String, Number,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'SPREADSHEET_ID' ? 'test-sheet' : ''), setProperty() {} }) },
    SpreadsheetApp: { openById: () => ss, getActiveSpreadsheet: () => ss },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) || null, put: (k, v) => cache.set(k, v) }) },
    Utilities: {
      getUuid: () => 'x',
      base64Encode: (v) => String(v),
      computeDigest: (_a, v) => v,
      DigestAlgorithm: { MD5: 'md5' },
      formatDate: (d, _tz, fmt) => fmt === 'yyyy-MM-dd' ? d.toISOString().slice(0, 10) : d.toISOString()
    },
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    UrlFetchApp: { fetch: (_url, opts) => calls.discord.push(JSON.parse(opts.payload).content) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(text) { return { text, setMimeType() { return this; } }; }
    },
    HtmlService: { createHtmlOutput: (html) => ({ html }) }
  });
  vm.runInContext(code, context);
  context.__ss = ss;
  context.__calls = calls;
  const orderSheet = makeSheet('2026-09-22');
  sheets.set('2026-09-22', orderSheet);
  vm.runInContext(`
    getOrCreateOrderSheet = function () { return __ss.getSheetByName('2026-09-22'); };
    isRecentDuplicateOrder = function () { return false; };
    getSpecialCodesSet = function () { return new Set(); };
    sendNotification = function (m) { __calls.notify.push(m); };
    removeOrderRowsFromAllSheets_ = function () { __calls.removed++; return { statusMap: {}, actualDisplayName: 'サロンA' }; };
  `, context);
  return {
    calls, sheets, orderSheet,
    post(body) {
      context.__body = JSON.stringify(body);
      return JSON.parse(vm.runInContext('doPost({ postData: { contents: __body } })', context).text);
    },
    call(expr) { return vm.runInContext(expr, context); }
  };
}

const item = (code, qty, name = '商品' + code) => ({ code, qty, name, isSpecial: false });
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name); };

t('正常な発注は書いた行数と中身を返す', () => {
  const gas = loadGas();
  const res = gas.post({ action: 'order', clientName: 'サロンA', orders: [item('1', 1), item('2', 2), item('3', 3)] });
  assert.equal(res.status, 'success');
  assert.equal(res.rows, 3);
  assert.equal(gas.orderSheet.rows.length, 4);
  assert.deepEqual(res.written.map(w => w.qty), [1, 2, 3]);
  assert.equal(res.written[0].salon, 'サロンA');
  assert.equal(typeof res.orderId, 'number');
  assert.equal(res.sheetDate.length, 10);
});

t('数量がすべて0の発注は失敗・シート不変・担当LINEへ1通', () => {
  const gas = loadGas();
  const res = gas.post({ action: 'order', token: '', clientName: 'ラコヘアー', orders: [item('1', 0)], ua: 'iPhone' });
  assert.equal(res.status, 'error');
  assert.match(res.message, /商品が0件のため受け付けていません/);
  assert.equal(gas.orderSheet.rows.length, 1);
  assert.equal(gas.calls.notify.length, 1);
  assert.match(gas.calls.notify[0], /ラコヘアー/);
  assert.doesNotMatch(gas.calls.notify[0], /【新規発注】/);
  assert.match(gas.calls.discord[0], /端末: iPhone/);
});

t('同じサロン様の再送は通知を重ねない', () => {
  const gas = loadGas();
  gas.post({ action: 'order', clientName: 'ラコヘアー', orders: [item('1', 0)] });
  gas.post({ action: 'order', clientName: 'ラコヘアー', orders: [item('1', 0)] });
  assert.equal(gas.calls.notify.length, 1);
});

t('トークンもサロン名も無い外部の叩きは通知しない', () => {
  const gas = loadGas();
  const res = gas.post({ action: 'order', orders: [] });
  assert.equal(res.status, 'error');
  assert.equal(gas.calls.notify.length, 0);
  assert.equal(gas.calls.discord.length, 0);
});

t('振り分け発注: 0件のグループが1つでもあれば全体を失敗にし、何も書かない', () => {
  const gas = loadGas();
  const res = gas.post({ action: 'multi_order', orderGroups: [
    { clientName: 'サロンA', orders: [item('1', 2)] },
    { clientName: 'サロンA 店販', orders: [item('2', 0)] }
  ] });
  assert.equal(res.status, 'error');
  assert.equal(gas.orderSheet.rows.length, 1);
});

t('振り分け発注: 正常なら全グループの行を返す', () => {
  const gas = loadGas();
  const res = gas.post({ action: 'multi_order', orderGroups: [
    { clientName: 'サロンA', orders: [item('1', 2)] },
    { clientName: 'サロンA 店販', orders: [item('2', 1)] },
    { clientName: 'サロンA', staffName: '田中', orders: [item('3', 1)] }
  ] });
  assert.equal(res.status, 'success');
  assert.equal(res.rows, 3);
  assert.deepEqual(res.written.map(w => w.salon), ['サロンA', 'サロンA 店販', 'サロンA 田中様']);
});

t('履歴編集で全部0: 旧行を消さずにキャンセルへ誘導（multi_order）', () => {
  const gas = loadGas();
  const res = gas.post({ action: 'multi_order', orderId: String(Date.now()), orderGroups: [
    { clientName: 'サロンA', orders: [item('1', 0)] }
  ] });
  assert.equal(res.status, 'error');
  assert.match(res.message, /キャンセル/);
  assert.equal(gas.calls.removed, 0);
  assert.equal(gas.calls.notify.length, 0);
});

t('履歴編集で全部0: 旧行を消さない（update_order）', () => {
  const gas = loadGas();
  const res = gas.post({ action: 'update_order', clientName: 'サロンA', orderId: String(Date.now()), orders: [item('1', 0)] });
  assert.equal(res.status, 'error');
  assert.match(res.message, /キャンセル/);
  assert.equal(gas.calls.removed, 0);
});

t('受信ログ: 検証で弾かれた発注も残り、数式は無害化される', () => {
  const gas = loadGas();
  gas.post({ action: 'order', token: 'tk', clientName: '=IMPORTXML("x")', orders: [item('1', 0)], ua: 'Safari' });
  const log = gas.sheets.get('_受信ログ');
  assert.ok(log);
  const row = log.rows[1];
  assert.equal(row[1], 'order');
  assert.equal(row[2], `'=IMPORTXML("x")`);
  assert.equal(row[3], 'あり');
  assert.equal(row[4], 1);
  assert.equal(row[6], 'Safari');
  assert.ok(!JSON.stringify(row).includes('"tk"'), 'トークンの値そのものは残さない');
});

t('受信ログ: 100行を超えたら古い順に消す', () => {
  const gas = loadGas();
  for (let i = 0; i < 105; i++) gas.call(`logIncomingOrder_({ clientName: 'S${i}', orders: [] }, 'order')`);
  const log = gas.sheets.get('_受信ログ');
  assert.equal(log.rows.length, 101);
  assert.equal(log.rows[0][0], '受信時刻');
  assert.equal(log.rows[1][2], 'S5');
});

console.log(`\n${passed} passed`);
