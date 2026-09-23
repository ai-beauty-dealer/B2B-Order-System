// 発注書が「余白指定を無視する印刷環境」でも指定枚数に収まるかの実描画テスト。
//
// 背景（2026-09-23 ハルズヘアー・104商品・3列・片面1枚）: 画面上のレイアウトは1ページで
// 位置JSONも1ページで登録されたのに、印刷すると2枚になった。用紙枠は縦280mmで、
// CSSの @page 余白（上8mm・下6mm）が効く Chrome では A4（297mm）に収まるが、
// スマホの Safari（AirPrint）などは @page の余白を使わず自分の余白（約12.7mm）を当てるため
// 280+12.7×2=305mm となり2枚目へはみ出す。
//
// ここでは Chrome の printToPDF に「CSSのページ設定を使わない・余白12.7mm」を指定して
// その環境を再現し、実PDFの枚数が見積もり枚数と一致することを固定する。
// 実行: node tests/test_print_page_fit_margins.mjs --browser   （--browser なしは構文チェックのみ）
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const appSource = readFileSync(join(repoRoot, 'app.js'), 'utf8');
const printStart = appSource.indexOf('const printOrderSheet =');
const printEnd = appSource.indexOf('const openPrintLayoutModal =', printStart);
assert.ok(printStart >= 0 && printEnd > printStart);
const printSource = appSource.slice(printStart, printEnd);
const layoutsMatch = appSource.match(/const PRINT_LAYOUTS = \{[\s\S]*?\n    \};/);
const catOrderMatch = appSource.match(/const PRINT_CATEGORY_ORDER = \[.*?\];/);
const anchorConsts = appSource.match(/const SHEET_OCR_ANCHOR_MM = (\d+);[\s\S]*?const SHEET_OCR_ANCHOR_TOP_MM = (\d+);[\s\S]*?const SHEET_OCR_ANCHOR_RESERVE_MM = (\d+);/);
assert.ok(layoutsMatch && catOrderMatch && anchorConsts, 'PRINT_LAYOUTS / PRINT_CATEGORY_ORDER / マーク定数を取得できること');

const CATS = ['カラー関連', '2剤/ブリーチ', 'パーマ関連', 'シャンプー', 'トリートメント', '業務用商品', 'コスメ関連'];
const NAMES = ['LOA THE OIL BLANCHE 100ml', 'RV8', 'プテロ AR エッセンス Uprise 140ml', '薬用スカルプシャンプー グランディール 400ml',
    'N. ポリッシュオイル 150ml', 'カラー剤 8-NB 80g', 'ｱｸﾃｨﾑ ﾌﾟﾛﾌｪｯｼｮﾅﾙ ﾄﾘｰﾄﾒﾝﾄ ﾓｲｽﾄ 1000g ﾘﾌｨﾙ', 'OX 6% 1000ml'];
const buildItems = (n) => Array.from({ length: n }, (_, i) => ({ code: String(1000000 + i), name: NAMES[i % NAMES.length] + ' #' + i, category: CATS[i % CATS.length] }));

const buildSheetHtml = async (itemCount, cols, pageLimit, sheetOcrEnabled) => {
    const itemsData = buildItems(itemCount);
    const orderFrequency = {}, lastOrderDate = {};
    itemsData.forEach((it, i) => { orderFrequency[it.code] = (i % 9) + 1; lastOrderDate[it.code] = i; });
    let captured = '';
    const env = {
        isMasterSession: true, currentClientName: 'テストサロン', currentClientCode: 'C0001',
        itemsData, orderFrequency, lastOrderDate, favoriteItems: [], historyFavoritesData: {},
        PRINT_SHEET_MAX_ITEMS: 240, IMPORT_QR_PREFIX: 'B2BORDER|', ENABLE_SHEET_IMAGE_IMPORT: sheetOcrEnabled,
        PRINT_RENDERER_VERSION: 'b2b-print-test',
        SHEET_OCR_ANCHOR_MM: Number(anchorConsts[1]), SHEET_OCR_ANCHOR_TOP_MM: Number(anchorConsts[2]), SHEET_OCR_ANCHOR_RESERVE_MM: Number(anchorConsts[3]),
        sheetOcr: { makeSheetId: () => 'SO-abcdefghijklmnop', makeQrValue: (id, p) => `B2BORDER2|${id}|${p}` },
        showLoading: () => {}, hideLoading: () => {}, collectArchiveCodes: async () => [],
        escImportHtml: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
        alert: () => {},
        window: { open: () => ({ document: { write: (h) => { captured = h; }, close: () => {} } }) },
    };
    const qrStub = () => ({ addData() {}, make() {}, createDataURL: () => 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' });
    qrStub.stringToBytesFuncs = { 'UTF-8': () => [] };
    env.qrcode = qrStub;
    const keys = Object.keys(env);
    const factory = new Function(...keys, `${layoutsMatch[0]}\n${catOrderMatch[0]}\n${printSource}\nreturn printOrderSheet;`);
    await factory(...keys.map((k) => env[k]))(cols, pageLimit);
    return captured.replace(/<script>[\s\S]*?<\/script>/, '');
};

if (!process.argv.includes('--browser')) {
    const html = await buildSheetHtml(104, 3, 1, true);
    assert.ok(html.includes('print-page'));
    // 画像取込対応の印刷ボタンは、位置登録が終わった時点で登録スクリプトが文言を書き換える
    assert.match(appSource, /button\.textContent = '🖨 印刷（画像取込対応・\$\{printPages\.length\}枚）'/, '印刷ボタンに枚数を出す（印刷前に1枚か分かるように）');
    assert.match(await buildSheetHtml(104, 3, 1, false), /🖨 印刷（1枚）/);
    assert.match(await buildSheetHtml(100, 3, 2, false), /🖨 印刷（2枚）/);
    console.log('✅ print-page fit (margins) syntax check passed（実PDF検証は --browser）');
    process.exit(0);
}

const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
assert.ok(chrome, 'Chromeが見つからない');
const dir = mkdtempSync(join(tmpdir(), 'b2b-fit-margin-'));
const port = 9400 + Math.floor(Math.random() * 400);
const proc = spawn(chrome, ['--headless=new', '--no-first-run', '--no-sandbox', `--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(200); } }
const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
let seq = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}, sessionId) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const MM_IN = 25.4;
const pdfPages = async (html, opts) => {
    const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
    const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    // @page の余白・サイズ指定を無視する印刷環境（スマホSafari等）は、指定そのものを外して再現する
    const source = opts.stripPageRule ? html.replace(/@page\s*\{[^}]*\}/, '') : html;
    await send('Page.setDocumentContent', { frameId: (await send('Page.getFrameTree', {}, sessionId)).result.frameTree.frame.id, html: source }, sessionId);
    await sleep(400);
    const { result } = await send('Page.printToPDF', {
        paperWidth: (opts.paperW || 210) / MM_IN, paperHeight: (opts.paperH || 297) / MM_IN,
        marginTop: opts.marginMm / MM_IN, marginBottom: opts.marginMm / MM_IN, marginLeft: opts.marginMm / MM_IN, marginRight: opts.marginMm / MM_IN,
        preferCSSPageSize: opts.preferCss, printBackground: true, displayHeaderFooter: false,
    }, sessionId);
    await send('Target.closeTarget', { targetId });
    const pdf = Buffer.from(result.data, 'base64').toString('latin1');
    return (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
};

let passed = 0, failed = 0;
try {
    // [商品数, 列数, 枚数指定, 画像取込対応]
    const cases = [[104, 3, 1, true], [120, 3, 1, true], [60, 2, 1, true], [150, 4, 1, true], [104, 3, 1, false], [100, 3, 2, true]];
    const envs = [
        { label: 'CSS余白を尊重（PC Chrome）', preferCss: true, marginMm: 10 },
        { label: '@page無視・余白12.7mm（スマホSafari相当）', preferCss: false, marginMm: 12.7, stripPageRule: true },
        { label: '@page無視・余白10mm', preferCss: false, marginMm: 10, stripPageRule: true },
        { label: '@page無視・余白15mm（横幅に合わせて縮小される側）', preferCss: false, marginMm: 15, stripPageRule: true },
    ];
    for (const [n, cols, limit, ocr] of cases) {
        const html = await buildSheetHtml(n, cols, limit, ocr);
        const sections = (html.match(/class="print-page/g) || []).length;
        for (const env of envs) {
            const real = await pdfPages(html, env);
            const label = `${n}商品/${cols}列/枚数指定${limit}${ocr ? '/画像取込' : ''} @ ${env.label}`;
            if (real === sections) { passed++; console.log(`  ✓ ${label} → 実PDF ${real}枚（見積もり${sections}枚）`); }
            else { failed++; console.log(`  ✗ ${label} → 実PDF ${real}枚（見積もり${sections}枚・ページ割れ）`); }
        }
    }
} finally {
    ws.close(); proc.kill(); rmSync(dir, { recursive: true, force: true });
}
if (failed) { console.log(`❌ ${failed} failed`); process.exit(1); }
console.log(`\n✅ print-page fit (margins) tests: ${passed} passed`);
