// 発注書の数量欄が、商品名の長短に左右されず縦一列に揃うことを検証する。
// app.js 内の実際の印刷CSSを使い、Chromeの描画座標まで確認する。
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const appSource = readFileSync(join(repoRoot, 'app.js'), 'utf8');
const printStart = appSource.indexOf('const printOrderSheet =');
const printEnd = appSource.indexOf('// ==========================================', printStart + 1);
assert.ok(printStart >= 0 && printEnd > printStart, 'printOrderSheet の実装範囲を取得できること');
const printSource = appSource.slice(printStart, printEnd);

let passed = 0;
const test = (name, fn) => {
    fn();
    passed++;
    console.log('  ✓ ' + name);
};

console.log('発注書・数量欄レイアウト:');

test('商品名の右側に数量欄を出力する', () => {
    assert.match(
        printSource,
        /<span class="nm">[\s\S]*?<span class="cd">[\s\S]*?<\/span><\/span><span class="qty"><\/span>/
    );
});

test('商品セルが「可変の商品名＋固定幅の数量欄」の2列Gridである', () => {
    assert.match(
        printSource,
        /\.cell \{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\) \$\{layout\.qtyMm\}mm;/s
    );
});

test('数量欄の位置を商品名の実幅へ追従させない', () => {
    assert.doesNotMatch(printSource, /\.nm \{[^}]*flex: 0 1 auto;/s);
});

test('表にない商品の空欄も商品名の右側に数量欄を持つ', () => {
    assert.match(
        printSource,
        /const blankCell = '<div class="cell"><span class="nm"><\/span><span class="qty"><\/span><\/div>';/
    );
});

const styleMatch = printSource.match(/<style>\n([\s\S]*?)\n<\/style>/);
assert.ok(styleMatch, 'app.js から印刷CSSを取得できること');
const previewCss = styleMatch[1]
    .replaceAll('${layout.cellMinMm}mm', 'var(--cell-min)')
    .replaceAll('${layout.namePt}pt', 'var(--name-size)')
    .replaceAll('${layout.codePt}pt', 'var(--code-size)')
    .replaceAll('${layout.qtyMm}mm', 'var(--qty-width)')
    .replaceAll('${layout.blankMinMm}mm', 'var(--blank-min)');

const samples = [
    ['LOA THE OIL BLANCHE 100ml', '0704214'],
    ['RV8', '0104330'],
    ['プテロ AR エッセンス Uprise 140ml', '3307002'],
    ['薬用スカルプシャンプー グランディール 長い商品名テスト', '1234567'],
    ['N. ポリッシュオイル', '7654321'],
    ['カラー剤 8-NB', '1112223'],
];

const productCell = ([name, code]) =>
    `<div class="cell"><span class="nm">${name}<span class="cd">CODE ${code}</span></span><span class="qty"></span></div>`;
const blankCell = '<div class="cell"><span class="nm"></span><span class="qty"></span></div>';
const emptyCell = '<div class="cell empty"></div>';

const scenario = ({ id, label, cols, qty, cellMin, blankMin, namePt, codePt }) => {
    let rows = '';
    for (let row = 0; row < 5; row++) {
        let cells = '';
        for (let col = 0; col < cols; col++) {
            cells += row === 4 && col > 0
                ? emptyCell
                : productCell(samples[(row * cols + col) % samples.length]);
        }
        rows += `<div class="pair">${cells}</div>`;
    }
    return `<section class="scenario" id="${id}" data-cols="${cols}" data-qty="${qty}" style="--qty-width:${qty}mm;--cell-min:${cellMin}mm;--blank-min:${blankMin}mm;--name-size:${namePt}pt;--code-size:${codePt}pt">
<h2>${label}</h2>
<div class="cat">数量欄の縦揃え確認</div>
${rows}
<p class="sec">▼ 表にない商品はこちらへ（商品名・サイズ・数量）</p>
<div class="pair blank">${blankCell.repeat(cols)}</div>
</section>`;
};

const previewHtml = `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><style>
${previewCss}
body { width: 192mm; margin: 0 auto; padding: 3mm 0; }
.preview-title { font-size: 12pt; margin-bottom: 2mm; }
.scenario { margin-bottom: 4mm; }
.scenario h2 { font-size: 8pt; margin-bottom: 0.8mm; }
#layout-results { display: none; }
</style></head><body>
<h1 class="preview-title">発注書 数量欄レイアウト QA</h1>
${scenario({ id: 'cols-2', label: '2列・100%', cols: 2, qty: 12, cellMin: 8, blankMin: 9, namePt: 10, codePt: 8.5 })}
${scenario({ id: 'cols-3', label: '3列・64%（数量幅 6.4mm）', cols: 3, qty: 6.4, cellMin: 3.84, blankMin: 4.48, namePt: 5.44, codePt: 4.8 })}
${scenario({ id: 'cols-4', label: '4列・50%（数量幅 下限6mm）', cols: 4, qty: 6, cellMin: 2.8, blankMin: 3.5, namePt: 3.75, codePt: 3.25 })}
<pre id="layout-results"></pre>
<script>
window.addEventListener('load', () => {
    const results = [...document.querySelectorAll('.scenario')].map((section) => {
        const cols = Number(section.dataset.cols);
        const qtyMm = Number(section.dataset.qty);
        const rows = [...section.querySelectorAll('.pair')];
        const columns = [];
        for (let col = 0; col < cols; col++) {
            const samples = rows.map((row) => {
                const cell = row.children[col];
                const qty = cell && cell.querySelector('.qty');
                if (!qty) return null;
                const cellRect = cell.getBoundingClientRect();
                const qtyRect = qty.getBoundingClientRect();
                return { left: qtyRect.left, width: qtyRect.width, rightGap: Math.abs(cellRect.right - qtyRect.right) };
            }).filter(Boolean);
            const lefts = samples.map((sample) => sample.left);
            const widths = samples.map((sample) => sample.width);
            columns.push({
                leftSpread: Math.max(...lefts) - Math.min(...lefts),
                widthSpread: Math.max(...widths) - Math.min(...widths),
                width: widths[0],
                maxRightGap: Math.max(...samples.map((sample) => sample.rightGap)),
            });
        }
        return { id: section.id, qtyMm, columns };
    });
    document.getElementById('layout-results').textContent = JSON.stringify(results);
});
</script></body></html>`;

const chromeCandidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
].filter(Boolean);
const chromePath = chromeCandidates.find(existsSync);
const previewArg = process.argv.find((arg) => arg.startsWith('--preview='));

if (previewArg) {
    const outputPath = previewArg.slice('--preview='.length);
    writeFileSync(outputPath, previewHtml, 'utf8');
    console.log('  preview - ' + outputPath);
}

if (process.argv.includes('--browser')) {
    assert.ok(chromePath, 'Chrome実描画テストを指定したがChromeが見つからない');
    const tempDir = mkdtempSync(join(tmpdir(), 'b2b-print-layout-'));
    const previewPath = join(tempDir, 'preview.html');
    try {
        writeFileSync(previewPath, previewHtml, 'utf8');
        const browser = spawnSync(chromePath, [
            '--headless',
            '--disable-gpu',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-background-networking',
            `--user-data-dir=${join(tempDir, 'chrome-profile')}`,
            '--virtual-time-budget=1000',
            '--dump-dom',
            pathToFileURL(previewPath).href,
        ], { encoding: 'utf8', timeout: 8000 });
        const resultMatch = browser.stdout.match(/<pre id="layout-results">([^<]+)<\/pre>/);
        assert.ok(
            resultMatch,
            browser.stderr || browser.error?.message || 'Chromeから数量欄の描画座標を取得できない'
        );
        const results = JSON.parse(resultMatch[1]);
        results.forEach((result) => {
            assert.ok(result.qtyMm >= 6, `${result.id} の数量欄が6mm未満`);
            const expectedWidth = result.qtyMm * 96 / 25.4;
            result.columns.forEach((column, index) => {
                assert.ok(column.leftSpread <= 0.75, `${result.id} ${index + 1}列目の数量欄が縦にずれている`);
                assert.ok(column.widthSpread <= 0.75, `${result.id} ${index + 1}列目の数量幅が揃っていない`);
                assert.ok(Math.abs(column.width - expectedWidth) <= 0.75, `${result.id} ${index + 1}列目の数量幅が指定値と異なる`);
                assert.ok(column.maxRightGap <= 0.75, `${result.id} ${index + 1}列目の数量欄がセル右端にない`);
            });
        });
        passed++;
        console.log('  ✓ Chrome実描画で2・3・4列（通常行＋空欄行）の数量欄が縦一直線');
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
} else {
    console.log('  info - Chrome実描画は --browser 指定時に実行');
}

console.log(`\n✅ print-order layout tests: ${passed} passed`);
