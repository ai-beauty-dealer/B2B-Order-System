// 発注書の枚数指定（片面1枚/両面1枚/縮小なし）が実際の印刷ページ数と一致することを検証する。
// app.js 内の実際の printOrderSheet を実行し、生成HTMLをChromeでPDF化してページ数を数える。
// 実行: node tests/test_print_page_fit.mjs --browser  （--browser なしは構文チェックのみ）
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
assert.ok(layoutsMatch && catOrderMatch, 'PRINT_LAYOUTS / PRINT_CATEGORY_ORDER を取得できること');

// ---- ダミー商品（実マスタ相当の名前の長さ・文字種のばらつき）----
const CATS = ['カラー関連', '2剤/ブリーチ', 'パーマ関連', 'シャンプー', 'トリートメント', '業務用商品', 'コスメ関連'];
const NAMES = [
    'LOA THE OIL BLANCHE 100ml',
    'RV8',
    'プテロ AR エッセンス Uprise 140ml',
    '薬用スカルプシャンプー グランディール 400ml',
    'N. ポリッシュオイル 150ml',
    'カラー剤 8-NB 80g',
    'ｱｸﾃｨﾑ ﾌﾟﾛﾌｪｯｼｮﾅﾙ ﾄﾘｰﾄﾒﾝﾄ ﾓｲｽﾄ 1000g ﾘﾌｨﾙ',
    'OX 6% 1000ml',
];
const buildItems = (n) => {
    const items = [];
    for (let i = 0; i < n; i++) {
        items.push({ code: String(1000000 + i), name: NAMES[i % NAMES.length] + ' #' + i, category: CATS[i % CATS.length] });
    }
    return items;
};

// printOrderSheet が参照する外部を全部モックして実体を取り出す
const buildSheetHtml = async (itemCount, cols, pageLimit) => {
    const itemsData = buildItems(itemCount);
    const orderFrequency = {};
    const lastOrderDate = {};
    itemsData.forEach((it, i) => { orderFrequency[it.code] = (i % 9) + 1; lastOrderDate[it.code] = i; });
    let captured = '';
    const env = {
        isMasterSession: true,
        currentClientName: 'テストサロン',
        currentClientCode: 'C0001',
        itemsData, orderFrequency, lastOrderDate,
        favoriteItems: [],
        historyFavoritesData: {},
        PRINT_SHEET_MAX_ITEMS: 240,
        IMPORT_QR_PREFIX: 'B2BORDER|',
        ENABLE_SHEET_IMAGE_IMPORT: false,
        showLoading: () => {},
        hideLoading: () => {},
        collectArchiveCodes: async () => [],
        escImportHtml: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
        alert: () => {}, // 枚数超過の通知アラートはテストでは無視する
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

let passed = 0;
console.log('発注書・枚数指定とPDF実ページ数:');

const chromeCandidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
].filter(Boolean);
const chromePath = chromeCandidates.find(existsSync);

if (!process.argv.includes('--browser')) {
    const html = await buildSheetHtml(60, 3, 1);
    assert.ok(html.includes('print-page'), '発注書HTMLを生成できること');
    passed++;
    console.log('  ✓ HTML生成（PDF実ページ数の検証は --browser 指定時に実行）');
} else {
    assert.ok(chromePath, 'Chrome実描画テストを指定したがChromeが見つからない');
    const tempDir = mkdtempSync(join(tmpdir(), 'b2b-print-fit-'));
    const pdfPages = (html, tag) => {
        const htmlPath = join(tempDir, `${tag}.html`);
        const pdfPath = join(tempDir, `${tag}.pdf`);
        writeFileSync(htmlPath, html.replace('<button class="print-btn"', '<button style="display:none"'), 'utf8');
        // stdio を継承しない: Chromeの子プロセスがパイプを掴んだままだと timeout 後も spawnSync がブロックし続ける
        spawnSync(chromePath, [
            '--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
            `--user-data-dir=${join(tempDir, 'profile-' + tag)}`,
            '--no-pdf-header-footer',
            '--virtual-time-budget=2000',
            `--print-to-pdf=${pdfPath}`,
            pathToFileURL(htmlPath).href,
        ], { stdio: 'ignore', timeout: 60000 });
        const pdf = readFileSync(pdfPath, 'latin1');
        return (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
    };
    try {
        // [商品数, 列数, 枚数指定, 期待枚数(nullは「見積もりとPDFの一致のみ検証」)]
        const cases = [
            [60, 3, 1, 1],
            [120, 3, 1, 1],
            [60, 2, 1, 1],
            [100, 2, 1, null], // 2列で100商品は下限縮小でも1枚に入らない → 枚数超過を許容（見積もり＝実枚数のみ検証）
            [150, 4, 1, 1],
            [100, 3, 2, 2],
            [240, 3, 1, null],  // 下限縮小でも収まらない場合は枚数超過を許容（ただし見積もり＝実枚数）
            [150, 3, 0, null],  // 縮小なし: 枚数自由（ただし見積もり＝実枚数）
        ];
        for (const [n, cols, limit, expected] of cases) {
            const html = await buildSheetHtml(n, cols, limit);
            const sections = (html.match(/class="print-page/g) || []).length;
            const real = pdfPages(html, `${n}-${cols}-${limit}`);
            const label = `${n}商品/${cols}列/枚数指定${limit}`;
            assert.equal(real, sections, `${label}: 見積もり${sections}枚に対し実PDFが${real}枚（ページ割れ）`);
            if (expected !== null) {
                assert.equal(real, expected, `${label}: 実PDFが${real}枚（期待${expected}枚）`);
            }
            passed++;
            console.log(`  ✓ ${label} → 実PDF ${real}枚（見積もりと一致）`);
        }
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

console.log(`\n✅ print-page fit tests: ${passed} passed`);
