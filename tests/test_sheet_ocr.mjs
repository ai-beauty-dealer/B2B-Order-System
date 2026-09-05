import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ocr = require('../sheet-ocr.js');
const tests = [];
const test = (name, run) => tests.push({ name, run });

test('発注書QR v2を往復できる', () => {
    const id = 'SO-test1234567890';
    assert.deepEqual(ocr.parseQrValue(ocr.makeQrValue(id, 2)), { sheet_id: id, page_no: 2 });
});

test('旧QRや不正ページを固定座標OCRへ混ぜない', () => {
    assert.equal(ocr.parseQrValue('B2BORDER|テストサロン'), null);
    assert.equal(ocr.parseQrValue('B2BORDER2|SO-test1234567890|0'), null);
});

test('選択中サロンと一致する旧QRだけをサーバー照合へ渡す', () => {
    assert.deepEqual(ocr.parseLegacyQrValue('B2BORDER|テストサロン', 'テストサロン'), {
        legacy_qr: 'B2BORDER|テストサロン', page_no: 1, legacy: true
    });
    assert.equal(ocr.parseLegacyQrValue('B2BORDER|テストサロン', '別サロン'), null);
    assert.equal(ocr.parseLegacyQrValue('B2BORDER2|SO-test1234567890|1', 'テストサロン'), null);
});

test('正規化bboxを画像座標へ戻す', () => {
    assert.deepEqual(ocr.normalizedBoxToPixels([1000, 2000, 3000, 4000], 1000, 2000), {
        x: 100, y: 400, width: 300, height: 800
    });
});

test('四隅の射影変換が恒等写像になる', () => {
    const points = [[0, 0], [100, 0], [100, 200], [0, 200]];
    const matrix = ocr.computeHomography(points, points);
    const projected = ocr.projectPoint(matrix, [37, 91]);
    assert.ok(Math.abs(projected[0] - 37) < 1e-8);
    assert.ok(Math.abs(projected[1] - 91) < 1e-8);
});

test('四隅は左上から時計回りだけを受け付ける', () => {
    const good = [{ x: 10, y: 10 }, { x: 190, y: 10 }, { x: 190, y: 290 }, { x: 10, y: 290 }];
    const bad = [good[1], good[0], good[3], good[2]];
    assert.equal(ocr.validCornerOrder(good, 200, 300), true);
    assert.equal(ocr.validCornerOrder(bad, 200, 300), false);
});

test('Gemini結果は全セルが揃わないと採用しない', () => {
    const products = [{ cell_id: 'P1-C001' }, { cell_id: 'P1-C002' }];
    assert.throws(() => ocr.validateRecognition({ cells: [{
        cell_id: 'P1-C001', mark_type: 'arabic_digit', raw_reading: '2', quantity: 2, confidence: 'high'
    }] }, products), /不足/);
});

test('空欄を除き商品コードと数量へ結び付ける', () => {
    const products = [
        { cell_id: 'P1-C001', product_code: '305009', row_bbox: [1, 2, 3, 4] },
        { cell_id: 'P1-C002', product_code: '305010', row_bbox: [5, 6, 7, 8] }
    ];
    const cells = [
        { cell_id: 'P1-C001', mark_type: 'blank', raw_reading: '', quantity: null, confidence: 'high' },
        { cell_id: 'P1-C002', mark_type: 'japanese_tally', raw_reading: '正', quantity: 5, confidence: 'high' }
    ];
    assert.deepEqual(ocr.buildReviewRows(products, cells, [{ code: '305010', name: '商品B' }]), [{
        ...cells[1], code: '305010', name: '商品B', row_bbox: [5, 6, 7, 8], quantity: 5
    }]);
});

test('位置合わせマーク4つの中心をページ座標で返す', () => {
    const page = { anchors: { tl: [0, 0, 238, 168], tr: [9762, 0, 238, 168], br: [9762, 9500, 238, 168], bl: [0, 9500, 238, 168] } };
    assert.deepEqual(ocr.getPageAnchors(page), [[119, 84], [9881, 84], [9881, 9584], [119, 9584]]);
});

test('マーク無しの旧JSON（schema 1.0）は再印刷案内で止める', () => {
    assert.throws(() => ocr.getPageAnchors({ products: [{ cell_id: 'P1-C001' }] }), /位置合わせマークの無い旧発注書/);
    assert.throws(() => ocr.getPageAnchors({ anchors: { tl: [0, 0, 10, 10], tr: [0, 0, 10, 10], br: [0, 0, 10, 10], bl: [0, 0, 10, 10] } }), /並びが不正/);
});

test('schema 1.1の位置JSONを受け付ける', () => {
    const manifest = { schema_version: '1.1', client_name: 'テストサロン', pages: [{ page_no: 1, anchors: {}, products: [{ cell_id: 'P1-C001' }] }] };
    assert.equal(ocr.getManifestPage(manifest, 1, 'テストサロン').page_no, 1);
    assert.throws(() => ocr.getManifestPage({ ...manifest, schema_version: '2.0' }, 1, 'テストサロン'), /レイアウト版/);
});

test('タップ点を近くの黒い四角の中心へ吸着し、白地なら止める', () => {
    const width = 200, height = 200;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    // (60..80, 100..120) に黒い四角
    for (let y = 100; y < 120; y++) for (let x = 60; x < 80; x++) { const i = (y * width + x) * 4; data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; }
    const imageData = { width, height, data };
    const snapped = ocr.snapToDarkCentroid(imageData, { x: 85, y: 95 }, 30);
    assert.ok(Math.abs(snapped.x - 69.5) < 0.01 && Math.abs(snapped.y - 109.5) < 0.01, `中心へ吸着すること: ${JSON.stringify(snapped)}`);
    assert.equal(snapped.darkPixels, 400);
    assert.equal(ocr.snapToDarkCentroid(imageData, { x: 10, y: 10 }, 30), null);
    // 近くにQRのような暗い模様があっても、窓を絞って四角の中心へ寄る
    for (let y = 95; y < 125; y += 3) for (let x = 110; x < 150; x += 2) { const i = (y * width + x) * 4; data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; }
    const nearQr = ocr.snapToDarkCentroid(imageData, { x: 78, y: 108 }, 40);
    assert.ok(Math.abs(nearQr.x - 69.5) < 2 && Math.abs(nearQr.y - 109.5) < 2, `QRに引っ張られないこと: ${JSON.stringify(nearQr)}`);
    // 窓がほぼ全部暗い（机・影）はマークではない
    const dark = { width: 100, height: 100, data: new Uint8ClampedArray(100 * 100 * 4).fill(20) };
    assert.equal(ocr.snapToDarkCentroid(dark, { x: 50, y: 50 }, 30), null);
});

test('マーク中心→写真タップ点の射影で、印刷の縦縮みを相殺する', () => {
    // 紙の上では y が 0.885倍+2.9mm に縮んだ状態（2026-09-05 実測）を模した「写真」座標
    const paperY = (y) => y * 0.885 + 98;
    const anchors = [[119, 84], [9881, 84], [9881, 9584], [119, 9584]];
    const tapped = anchors.map(([x, y]) => [x, paperY(y)]);
    // 出力(ページ正規化) → 写真 の写像。出力側の数量欄 y=8061 が写真上のどこへ写るか
    const matrix = ocr.computeHomography(anchors, tapped);
    const projected = ocr.projectPoint(matrix, [2937, 8061]);
    assert.ok(Math.abs(projected[1] - paperY(8061)) < 1e-6, `最下段のセルが縮んだ紙の位置へ写ること: ${projected}`);
    assert.ok(Math.abs(projected[0] - 2937) < 1e-6);
});

for (const { name, run } of tests) {
    run();
    console.log(`  ok - ${name}`);
}
console.log(`\n✅ sheet OCR helper tests: ${tests.length} passed`);
