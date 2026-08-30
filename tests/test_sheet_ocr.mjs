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

for (const { name, run } of tests) {
    run();
    console.log(`  ok - ${name}`);
}
console.log(`\n✅ sheet OCR helper tests: ${tests.length} passed`);
