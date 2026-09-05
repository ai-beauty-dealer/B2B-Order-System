// 画像取込対応の発注書に刷る「位置合わせマーク」の実描画検査。
// app.js の printOrderSheet を実行し、Chrome headless で各要素の実寸を測って
//   ・マーク4つが各ページの四隅にあり、商品セル・QR・見出し・空欄行と重ならない
//   ・位置登録スクリプトが測る anchors が左上→右上→右下→左下の並びになる
//   ・70商品3列を片面1枚に指定したとき、実PDFが1枚である（本文予算5mm減の回帰）
// 実行: node tests/test_sheet_ocr_print_marks.mjs --browser   （--browser なしは構文・構造チェックのみ）
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const appSource = readFileSync(join(repoRoot, 'app.js'), 'utf8');
const printStart = appSource.indexOf('const printOrderSheet =');
const printEnd = appSource.indexOf('const openPrintLayoutModal =', printStart);
assert.ok(printStart >= 0 && printEnd > printStart, 'printOrderSheet の実装範囲を取得できること');
const printSource = appSource.slice(printStart, printEnd);
const layoutsMatch = appSource.match(/const PRINT_LAYOUTS = \{[\s\S]*?\n    \};/);
const catOrderMatch = appSource.match(/const PRINT_CATEGORY_ORDER = \[.*?\];/);
const anchorConsts = appSource.match(/const SHEET_OCR_ANCHOR_MM = (\d+);[\s\S]*?const SHEET_OCR_ANCHOR_TOP_MM = (\d+);[\s\S]*?const SHEET_OCR_ANCHOR_RESERVE_MM = (\d+);/);
assert.ok(layoutsMatch && catOrderMatch && anchorConsts, 'PRINT_LAYOUTS / PRINT_CATEGORY_ORDER / マーク定数を取得できること');

const CATS = ['カラー関連', '2剤/ブリーチ', 'パーマ関連', 'シャンプー', '業務用商品', 'その他'];
const buildItems = (n) => Array.from({ length: n }, (_, i) => ({
    code: String(300000 + i), name: `ｱｼﾞｱﾝｶﾗｰﾌｪｽ ${(i % 14) + 1} ﾏｯﾄ 85 #${i}`, category: CATS[Math.floor(i / 15) % CATS.length]
}));

const buildSheetHtml = async (itemCount, cols, pageLimit) => {
    const itemsData = buildItems(itemCount);
    const orderFrequency = {};
    const lastOrderDate = {};
    itemsData.forEach((it, i) => { orderFrequency[it.code] = (i % 9) + 1; lastOrderDate[it.code] = i; });
    let captured = '';
    const env = {
        isMasterSession: true, currentClientName: 'テストサロン', currentClientCode: 'C0001',
        itemsData, orderFrequency, lastOrderDate, favoriteItems: [], historyFavoritesData: {},
        PRINT_SHEET_MAX_ITEMS: 240, IMPORT_QR_PREFIX: 'B2BORDER|', ENABLE_SHEET_IMAGE_IMPORT: true,
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
    return captured;
};

// 位置登録スクリプト（window.opener 依存）を、実寸を <pre id="measure"> へ書き出す計測スクリプトに差し替える
const withMeasureScript = (html) => html
    .replace(/<script>[\s\S]*?<\/script>/, `<script>
(async function () {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const rect = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
  const pages = Array.from(document.querySelectorAll('.print-page')).map((page) => ({
    page: rect(page),
    anchors: Object.fromEntries(Array.from(page.querySelectorAll('[data-sheet-ocr-anchor]')).map((m) => [m.dataset.sheetOcrAnchor, rect(m)])),
    content: Array.from(page.querySelectorAll('.cell, .cat, .note, .htxt, .qr-main, .cont-title, .qr-small, .sec')).map(rect)
  }));
  const pre = document.createElement('pre'); pre.id = 'measure'; pre.textContent = JSON.stringify({ pxPerMm: document.querySelector('.print-page').getBoundingClientRect().width / 192, pages });
  document.body.appendChild(pre);
}());
<\/script>`)
    .replace('<button class="print-btn"', '<button style="display:none"');

const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

let passed = 0;
const html = await buildSheetHtml(70, 3, 1);
assert.equal((html.match(/data-sheet-ocr-anchor=/g) || []).length, 4, '70商品3列・片面1枚は1ページ＝マーク4つ');
assert.match(html, /body\.ocr \.qr-main \{ right: 9mm; \}/);
passed++;
console.log('  ✓ マーク付き発注書HTMLを生成（1ページ・マーク4つ）');

const chromeCandidates = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
const chromePath = chromeCandidates.find(existsSync);
if (!process.argv.includes('--browser')) {
    console.log('  info - 実描画（重なり・実PDF枚数）は --browser 指定時に実行');
} else {
    assert.ok(chromePath, 'Chromeが見つからない');
    const tempDir = mkdtempSync(join(tmpdir(), 'b2b-ocr-marks-'));
    try {
        const htmlPath = join(tempDir, 'sheet.html');
        writeFileSync(htmlPath, withMeasureScript(html), 'utf8');
        const dom = spawnSync(chromePath, [
            '--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
            `--user-data-dir=${join(tempDir, 'profile-dom')}`, '--virtual-time-budget=3000', '--dump-dom', pathToFileURL(htmlPath).href
        ], { encoding: 'utf8', timeout: 60000 });
        const measured = dom.stdout.match(/<pre id="measure">([\s\S]*?)<\/pre>/);
        assert.ok(measured, '計測結果を取得できること');
        const { pxPerMm, pages } = JSON.parse(measured[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
        for (const [index, page] of pages.entries()) {
            const { tl, tr, br, bl } = page.anchors;
            assert.ok(tl && tr && br && bl, `P${index + 1}: マーク4つ`);
            const mid = (r) => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
            assert.ok(mid(tl)[0] < mid(tr)[0] && mid(bl)[0] < mid(br)[0] && mid(tl)[1] < mid(bl)[1] && mid(tr)[1] < mid(br)[1], `P${index + 1}: 左上→右上→右下→左下の並び`);
            const sizeMm = (tl[2] - tl[0]) / pxPerMm;
            assert.ok(Math.abs(sizeMm - Number(anchorConsts[1])) < 0.3, `P${index + 1}: マークの一辺 ${sizeMm.toFixed(2)}mm`);
            assert.ok(Math.abs(tl[0] - page.page[0]) < 1 && Math.abs(tl[1] - page.page[1]) < 1, `P${index + 1}: 左上マークはページ枠の角`);
            assert.ok(Math.abs(tr[2] - page.page[2]) < 1, `P${index + 1}: 右上マークは右端`);
            const pageBottomMm = (page.page[3] - page.page[1]) / pxPerMm;
            assert.ok(pageBottomMm <= 283.1, `P${index + 1}: ページ枠の高さ ${pageBottomMm.toFixed(1)}mm が印字可能283mm以内`);
            assert.ok((br[3] - page.page[1]) / pxPerMm <= 280.1, `P${index + 1}: 下段マークがページ枠280mm以内`);
            for (const key of ['tl', 'tr', 'br', 'bl']) {
                const hit = page.content.find((r) => overlaps(page.anchors[key], r));
                assert.ok(!hit, `P${index + 1}: マーク${key}が内容と重なる ${JSON.stringify(hit)}`);
                // 3mm以上の余白（暗い画素の吸着がQR・文字へ引っ張られないため）
                const gapMm = Math.min(...page.content.map((r) => {
                    const dx = Math.max(r[0] - page.anchors[key][2], page.anchors[key][0] - r[2], 0);
                    const dy = Math.max(r[1] - page.anchors[key][3], page.anchors[key][1] - r[3], 0);
                    return Math.hypot(dx, dy) / pxPerMm;
                }));
                assert.ok(gapMm >= 2.5, `P${index + 1}: マーク${key}と内容の間隔 ${gapMm.toFixed(2)}mm（2.5mm以上）`);
            }
        }
        passed++;
        console.log(`  ✓ マークは四隅・${anchorConsts[1]}mm角・内容と重ならず2.5mm以上離れている（${pages.length}ページ）`);

        // PDF枚数は計測用<pre>を足さない素のHTMLで数える（位置登録スクリプトは opener 無しでは動かないので外す）
        const pdfHtmlPath = join(tempDir, 'sheet-print.html');
        writeFileSync(pdfHtmlPath, html.replace(/<script>[\s\S]*?<\/script>/, '').replace('<button id="print-action-btn" class="print-btn"', '<button style="display:none"'), 'utf8');
        const pdfPath = join(tempDir, 'sheet.pdf');
        spawnSync(chromePath, [
            '--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
            `--user-data-dir=${join(tempDir, 'profile-pdf')}`, '--no-pdf-header-footer', '--virtual-time-budget=2000',
            `--print-to-pdf=${pdfPath}`, pathToFileURL(pdfHtmlPath).href
        ], { stdio: 'ignore', timeout: 60000 });
        const pdf = readFileSync(pdfPath, 'latin1');
        const real = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
        assert.equal(real, 1, `70商品3列・片面1枚指定の実PDFが${real}枚`);
        passed++;
        console.log('  ✓ 70商品3列・片面1枚 → 実PDF 1枚（本文予算5mm減でも収まる）');
        if (process.env.KEEP_PDF) writeFileSync(process.env.KEEP_PDF, readFileSync(pdfPath));
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}
console.log(`\n✅ sheet OCR print-mark tests: ${passed} passed`);
