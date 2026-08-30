import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, html, css, sw] = await Promise.all([
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../style.css', import.meta.url), 'utf8'),
    readFile(new URL('../sw.js', import.meta.url), 'utf8')
]);

const start = app.indexOf('// LINE注文テキスト取込（APIなし・MASTERログイン限定）');
const end = app.indexOf('// 発注書画像取込（固定座標＋Gemini数量OCR・本店MASTER限定）', start);
assert.ok(start >= 0 && end > start, 'LINE取込の独立ブロックが必要');
const block = app.slice(start, end);

const tests = [];
const test = (name, run) => tests.push({ name, run });

test('LINE取込は本店と稼働中の社員dealerへ配信し、旧AI取込は停止したまま', () => {
    assert.match(app, /const LINE_TEXT_IMPORT_DEALERS = new Set\(\['default', '755', '747'\]\);/);
    assert.match(app, /const ENABLE_LINE_TEXT_IMPORT = LINE_TEXT_IMPORT_DEALERS\.has\(CONFIG\.DEALER\);/);
    assert.match(app, /const ENABLE_IMPORT_MODE = false;/);
});

test('テストdealerはLINE取込の対象外', () => {
    const allowlist = app.match(/const LINE_TEXT_IMPORT_DEALERS = new Set\(\[([^\]]+)\]\);/)?.[1] || '';
    assert.doesNotMatch(allowlist, /test-sub/);
});

test('MASTERセッションだけにボタンを表示する', () => {
    assert.match(app, /lineImportBtn\.classList\.toggle\('hidden', !ENABLE_LINE_TEXT_IMPORT \|\| !isMasterSession\)/);
    assert.match(block, /if \(!ENABLE_LINE_TEXT_IMPORT \|\| !isMasterSession\) return;/);
});

test('LINE取込ブロックは外部APIを呼ばない', () => {
    assert.doesNotMatch(block, /CONFIG\.API_URL|fetch\s*\(/);
    assert.match(block, /lineMatch\.parseLineOrderText/);
});

test('チェックボックスなしで数量と未確定だけを確認する', () => {
    const modalStart = html.indexOf('id="line-import-modal"');
    const modalEnd = html.indexOf('<!-- Import Modal（旧AI取り込み・停止中）', modalStart);
    const modal = html.slice(modalStart, modalEnd);
    assert.ok(modalStart >= 0 && modalEnd > modalStart);
    assert.doesNotMatch(modal, /type="checkbox"/);
    assert.match(block, /counts\.attention === 0/);
});

test('カート追加は既存処理を通り、注文送信は行わない', () => {
    assert.match(block, /updateFromCart\(code, lineProductName\(product\), existingQty \+ entry\.quantity\)/);
    assert.match(block, /openCartSidebar\(\)/);
    assert.doesNotMatch(block, /executeOrderActual|order-submit|modalConfirmBtn/);
});

test('お気に入り外商品も既存カートへ追加できる', () => {
    assert.match(block, /lineImportProductByCode\.get\(select\.value\)/);
    assert.match(block, /全商品から手動選択/);
});

test('LINE原文と商品名をHTMLとして解釈しない', () => {
    assert.match(block, /quote\.textContent = entry\.source_text/);
    assert.match(block, /name\.textContent = entry\.product/);
    assert.doesNotMatch(block, /innerHTML\s*=.*source_text/);
});

test('PWAはLINE照合ファイルと最新版アプリを配信する', () => {
    assert.match(html, /line-order-match\.js\?v=2\.38\.0/);
    assert.match(html, /app\.js\?v=2\.39\.2/);
    assert.match(html, /style\.css\?v=2\.39\.2/);
    assert.match(sw, /CACHE_VERSION = 'v2\.39\.2'/);
    assert.match(sw, /'\.\/line-order-match\.js'/);
});

test('スマホ用レイアウトと44px相当の操作欄がある', () => {
    assert.match(css, /@media \(max-width: 680px\)/);
    assert.match(css, /\.line-candidate-search,[\s\S]*min-height: 42px/);
    assert.match(css, /\.line-import-qty[\s\S]*min-height: 48px/);
});

for (const { name, run } of tests) {
    run();
    console.log(`  ok - ${name}`);
}
console.log(`\n✅ LINE text import integration tests: ${tests.length} passed`);
