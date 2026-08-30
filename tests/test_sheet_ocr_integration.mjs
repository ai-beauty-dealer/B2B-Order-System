import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, html, css, helper, sw] = await Promise.all([
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../style.css', import.meta.url), 'utf8'),
    readFile(new URL('../sheet-ocr.js', import.meta.url), 'utf8'),
    readFile(new URL('../sw.js', import.meta.url), 'utf8')
]);

const start = app.indexOf('// 発注書画像取込（固定座標＋Gemini数量OCR・本店MASTER限定）');
const end = app.indexOf('// 📥 旧AI取り込みモード', start);
assert.ok(start >= 0 && end > start, '画像取込の独立ブロックが必要');
const block = app.slice(start, end);
const tests = [];
const test = (name, run) => tests.push({ name, run });

test('画像取込は本店default限定で旧AI取込を再開しない', () => {
    assert.match(app, /const ENABLE_SHEET_IMAGE_IMPORT = CONFIG\.DEALER === 'default';/);
    assert.match(app, /const ENABLE_IMPORT_MODE = false;/);
});

test('MASTERセッションだけに画像取込ボタンを表示する', () => {
    assert.match(app, /sheetImageImportBtn\.classList\.toggle\('hidden', !ENABLE_SHEET_IMAGE_IMPORT \|\| !isMasterSession\)/);
    assert.match(block, /if \(!ENABLE_SHEET_IMAGE_IMPORT \|\| !isMasterSession \|\| !currentClientName\) return;/);
});

test('ブラウザへGemini APIキーやGemini直URLを置かない', () => {
    assert.doesNotMatch(app + helper + html, /GEMINI_API_KEY|generativelanguage\.googleapis\.com/);
    assert.match(block, /action: 'recognize_order_sheet_cells'/);
});

test('新QRと保存済み位置JSONが無ければ読み取らない', () => {
    assert.match(helper, /const QR_PREFIX = 'B2BORDER2'/);
    assert.match(block, /action: 'get_order_sheet_layout'/);
    assert.match(block, /新しい発注書用QRを読めませんでした/);
});

test('確認チェックなしで商品行画像と数量を同じ行へ表示する', () => {
    const modalStart = html.indexOf('id="sheet-ocr-modal"');
    const modalEnd = html.indexOf('<!-- Import Modal（旧AI取り込み・停止中）', modalStart);
    const modal = html.slice(modalStart, modalEnd);
    assert.doesNotMatch(modal, /type="checkbox"/);
    assert.match(block, /sheet-ocr-strip/);
    assert.match(block, /sheet-ocr-qty/);
    assert.match(block, /cropRowDataUrl/);
});

test('カート追加は既存処理を通り自動発注しない', () => {
    assert.match(block, /updateFromCart\(row\.code, row\.name, existingQty \+ row\.quantity\)/);
    assert.match(block, /openCartSidebar\(\)/);
    assert.doesNotMatch(block, /executeOrderActual|modalConfirmBtn/);
});

test('正の字と不明数量を構造化して扱う', () => {
    assert.match(helper, /japanese_tally/);
    assert.match(helper, /unclear/);
    assert.match(block, /正の字/);
});

test('印刷時に用紙ID・ページQR・位置JSONを登録する', () => {
    assert.match(app, /PRINT_RENDERER_VERSION = 'b2b-print-v2\.39\.2'/);
    assert.match(app, /data-sheet-ocr-code/);
    assert.match(app, /registerOrderSheetLayoutFromPrint/);
    assert.match(app, /action: 'save_order_sheet_layout'/);
});

test('本店発注書はお気に入りを正本にし外した商品を履歴から戻さない', () => {
    assert.match(app, /const useFavoriteOnlyPrint = ENABLE_SHEET_IMAGE_IMPORT && favoritePrintCodes\.length > 0/);
    assert.match(app, /codes = codes\.filter\(\(code\) => favoriteSet\.has/);
    assert.match(app, /if \(!useFavoriteOnlyPrint\) \{[\s\S]*archiveCodes\.forEach\(pushCode\)/);
});

test('PWAは画像OCRヘルパーとv2.39.2を配信する', () => {
    assert.match(html, /sheet-ocr\.js\?v=2\.39\.2/);
    assert.match(html, /app\.js\?v=2\.39\.2/);
    assert.match(html, /style\.css\?v=2\.39\.2/);
    assert.match(sw, /CACHE_VERSION = 'v2\.39\.2'/);
    assert.match(sw, /'\.\/sheet-ocr\.js'/);
});

test('スマホで商品画像と数量が横並びになり操作高を確保する', () => {
    assert.match(css, /\.sheet-ocr-review-row[\s\S]*grid-template-columns: minmax\(0, 1fr\) 72px/);
    assert.match(css, /\.sheet-ocr-qty[\s\S]*min-height: 54px/);
    assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.sheet-ocr-review-row/);
});

test('HEICを端末内でJPEG変換しWindowsでも写真を開ける', () => {
    assert.match(html, /accept="[^"]*image\/heic[^"]*\.heic/);
    assert.match(block, /import\('\.\/lib\/heic-to\.js\?v=1\.5\.2'\)/);
    assert.match(block, /HEIC写真を端末内でJPEGへ変換/);
    assert.match(block, /sourceCanvas = await imageFileToCanvas\(browserFile\)[\s\S]*if \(!isHeicFile\(file\)\) throw nativeError/);
    assert.doesNotMatch(block, /imageBase64[\s\S]{0,300}normalizeSheetOcrImageFile/);
});

test('誤検出は数量0で除外でき低信頼件数を表示する', () => {
    assert.match(block, /quantity\.min = '0'/);
    assert.match(block, /row\.quantity === 0/);
    assert.match(block, /row\.quantity > 0 && row\.confidence !== 'high'/);
    assert.match(block, /filter\(\(row\) => row\.quantity > 0\)/);
    assert.match(css, /\.sheet-ocr-review-row\.is-excluded/);
});

test('機械処理時間に写真準備を含め巨大ファイルを拒否する', () => {
    assert.match(block, /file\.size > 30 \* 1024 \* 1024/);
    assert.match(block, /sheetOcrState\.prepareMs = performance\.now\(\) - sheetOcrState\.startedAt/);
    assert.match(block, /sheetOcrState\.machineMs = sheetOcrState\.prepareMs \+ \(performance\.now\(\) - startedAt\)/);
});

for (const { name, run } of tests) {
    run();
    console.log(`  ok - ${name}`);
}
console.log(`\n✅ sheet OCR integration tests: ${tests.length} passed`);
