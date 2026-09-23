// 発注書の位置JSON（_OrderSheetLayouts）の保持ルール。
// サロン様は何か月も前に刷った発注書をそのまま使い続けるので、
// 「新しく刷ったら古い登録が消える」ことがあってはならない（2026-09-23）。
// 旧ルール（500件を超えたら古い順に即削除）を、
// 「上限超過分だけ・保持期限（400日）を過ぎた行だけ消す」に変えたことを固定する。
//
// 実行: node tests/test_sheet_ocr_layout_retention.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const projectRoot = path.resolve(import.meta.dirname, '..');
const source = await fs.readFile(path.join(projectRoot, 'backend', 'sheet_ocr.gs'), 'utf8');
const context = { module: { exports: {} }, console };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'sheet_ocr.gs' });
const { trimSheetOcrLayouts_, SHEET_OCR_MAX_LAYOUTS, SHEET_OCR_KEEP_DAYS } = context.module.exports;

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-23T09:00:00+09:00');
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY);

class FakeSheet {
    constructor(createdDates) {
        // 1行目は見出し。2行目以降が登録（B列=作成日時）
        this.rows = [['発注書ID', '作成日時']].concat(createdDates.map((d, i) => [`SO-${String(i).padStart(12, '0')}`, d]));
        this.deleted = [];
    }
    getLastRow() { return this.rows.length; }
    getRange(row, column, numRows, numColumns) {
        const rows = this.rows;
        return {
            getValues: () => rows.slice(row - 1, row - 1 + numRows)
                .map((r) => r.slice(column - 1, column - 1 + numColumns)),
        };
    }
    deleteRows(start, count) {
        this.deleted.push([start, count]);
        this.rows.splice(start - 1, count);
    }
}

const tests = [];
const test = (name, run) => tests.push({ name, run });

test('上限は3000件以上・保持期限は1年以上（古い発注書を忘れない前提）', () => {
    assert.ok(SHEET_OCR_MAX_LAYOUTS >= 3000, `MAX_LAYOUTS=${SHEET_OCR_MAX_LAYOUTS}`);
    assert.ok(SHEET_OCR_KEEP_DAYS >= 365, `KEEP_DAYS=${SHEET_OCR_KEEP_DAYS}`);
});

test('上限以内なら1行も消さない（期限切れがあっても）', () => {
    const sheet = new FakeSheet([daysAgo(900), daysAgo(800), daysAgo(1)]);
    assert.equal(trimSheetOcrLayouts_(sheet, NOW), 0);
    assert.deepEqual(sheet.deleted, []);
    assert.equal(sheet.getLastRow(), 4);
});

test('上限を超えても、全部が保持期限内なら消さない（新しく刷っても古い登録は残る）', () => {
    const dates = Array.from({ length: SHEET_OCR_MAX_LAYOUTS + 5 }, (_, i) => daysAgo(SHEET_OCR_KEEP_DAYS - 1 - (i % 30)));
    const sheet = new FakeSheet(dates);
    assert.equal(trimSheetOcrLayouts_(sheet, NOW), 0);
    assert.deepEqual(sheet.deleted, []);
});

test('上限超過分だけ、先頭の期限切れ行を消す（期限切れが超過分より多くても超過分まで）', () => {
    const expired = Array.from({ length: 10 }, (_, i) => daysAgo(SHEET_OCR_KEEP_DAYS + 100 - i));
    const fresh = Array.from({ length: SHEET_OCR_MAX_LAYOUTS - 7 }, () => daysAgo(3));
    const sheet = new FakeSheet(expired.concat(fresh)); // 合計 = MAX + 3
    assert.equal(trimSheetOcrLayouts_(sheet, NOW), 3);
    assert.deepEqual(sheet.deleted, [[2, 3]]);
    assert.equal(sheet.getLastRow() - 1, SHEET_OCR_MAX_LAYOUTS);
});

test('期限切れが超過分より少なければ、その分だけ消して期限内の行は残す', () => {
    const expired = [daysAgo(SHEET_OCR_KEEP_DAYS + 5), daysAgo(SHEET_OCR_KEEP_DAYS + 1)];
    const fresh = Array.from({ length: SHEET_OCR_MAX_LAYOUTS + 3 }, () => daysAgo(10));
    const sheet = new FakeSheet(expired.concat(fresh)); // 超過5・期限切れ2
    assert.equal(trimSheetOcrLayouts_(sheet, NOW), 2);
    assert.deepEqual(sheet.deleted, [[2, 2]]);
    assert.equal(sheet.getLastRow() - 1, SHEET_OCR_MAX_LAYOUTS + 3);
});

test('作成日時が文字列や空でも落ちずに止まる（壊れた行は消さない）', () => {
    const sheet = new FakeSheet([''].concat(Array.from({ length: SHEET_OCR_MAX_LAYOUTS + 2 }, () => daysAgo(1))));
    assert.equal(trimSheetOcrLayouts_(sheet, NOW), 0);
    const sheet2 = new FakeSheet(['2024/01/01 10:00:00', '2024/02/01 10:00:00'].concat(Array.from({ length: SHEET_OCR_MAX_LAYOUTS }, () => daysAgo(1))));
    assert.equal(trimSheetOcrLayouts_(sheet2, NOW), 2);
});

let failed = 0;
for (const { name, run } of tests) {
    try { run(); console.log(`  ok - ${name}`); } catch (error) { failed++; console.log(`  FAIL - ${name}\n    ${error.message}`); }
}
if (failed) { console.log(`❌ ${failed} failed`); process.exit(1); }
console.log(`✅ sheet OCR layout retention tests: ${tests.length} passed`);

// ---------------------------------------------------------------
// 保存経路の通しテスト（saveSheetOcrLayout_ → 登録簿 → loadSheetOcrLayout_）と、
// サロン名を変えた後でも得意先コードで古い発注書を照合できること。
// ---------------------------------------------------------------
const ctx2 = {
    module: { exports: {} }, console,
    RETAIL_SUFFIX: ' 店販',
    SHEET_NAMES: { CLIENT: 'ClientMaster', MASTER: 'ItemMaster' },
    splitRetailSuffix_: (name) => {
        const s = name == null ? '' : String(name);
        return s.length > 3 && s.endsWith(' 店販') ? { base: s.slice(0, -3), suffix: ' 店販' } : { base: s, suffix: '' };
    },
    userError_: (message) => Object.assign(new Error(message), { userError: true }),
    sanitizeSheetText_: (v) => String(v || '').replace(/^[=+\-@]/, "'$&"),
};
vm.createContext(ctx2);
vm.runInContext(source, ctx2, { filename: 'sheet_ocr.gs' });
const gas = ctx2.module.exports;

class GridSheet {
    constructor(rows = []) { this.rows = rows; this.frozen = 0; this.hidden = false; }
    getLastRow() { return this.rows.length; }
    getDataRange() { return { getValues: () => this.rows.map((r) => r.slice()) }; }
    getRange(row, column, numRows = 1, numColumns = 1) {
        const self = this;
        return {
            getValues: () => Array.from({ length: numRows }, (_, r) => Array.from({ length: numColumns }, (_, c) => (self.rows[row - 1 + r] || [])[column - 1 + c] ?? '')),
            getValue() { return this.getValues()[0][0]; },
            setValues(values) {
                values.forEach((vals, r) => { self.rows[row - 1 + r] = self.rows[row - 1 + r] || []; vals.forEach((v, c) => { self.rows[row - 1 + r][column - 1 + c] = v; }); });
                return this;
            },
            setFontWeight() { return this; },
        };
    }
    appendRow(row) { this.rows.push(row.slice()); }
    deleteRows(start, count) { this.rows.splice(start - 1, count); }
    setFrozenRows(n) { this.frozen = n; }
    hideSheet() { this.hidden = true; }
    createTextFinder(text) {
        const self = this;
        let entire = false;
        return {
            matchEntireCell(v) { entire = v; return this; },
            findNext() {
                for (let r = 0; r < self.rows.length; r++) {
                    for (const cell of self.rows[r]) {
                        if (entire ? String(cell) === text : String(cell).includes(text)) return { getRow: () => r + 1 };
                    }
                }
                return null;
            },
        };
    }
}

class FakeSpreadsheet {
    constructor() {
        this.sheets = {
            ClientMaster: new GridSheet([
                ['ID', 'PW', '得意先名', '種別', '曜日', 'グループ', '得意先コード'],
                ['a01', 'x', 'ひとみ美容室', '', '', '', "'1001"],
                ['a02', 'x', 'ミツアミ堂', '', '', '', '1002'],
                ['a03', 'x', 'コード未設定サロン', '', '', '', ''],
            ]),
        };
    }
    getSheetByName(name) { return this.sheets[name] || null; }
    insertSheet(name) { this.sheets[name] = new GridSheet(); return this.sheets[name]; }
}

const manifestFor = (id, clientName, code) => ({
    schema_version: '1.1', sheet_id: id, client_name: clientName, client_code: code,
    renderer_version: 'r', printed_product_count: 1, created_at: '2026-09-23T00:00:00.000Z',
    pages: [{ page_no: 1, anchors: {}, products: [] }],
});

const tests2 = [];
const test2 = (name, run) => tests2.push({ name, run });

test2('保存→読み戻しが通り、登録簿は非表示で見出し固定になる', () => {
    const ss = new FakeSpreadsheet();
    gas.saveSheetOcrLayout_(manifestFor('SO-000000000001', 'ひとみ美容室', '1001'), ss);
    gas.saveSheetOcrLayout_(manifestFor('SO-000000000002', 'ひとみ美容室', '1001'), ss);
    const sheet = ss.getSheetByName('_OrderSheetLayouts');
    assert.equal(sheet.getLastRow(), 3, '同じサロンで2回刷っても2行とも残る');
    assert.ok(sheet.hidden && sheet.frozen === 1);
    const loaded = gas.loadSheetOcrLayout_('SO-000000000001', ss);
    assert.equal(loaded.client_name, 'ひとみ美容室');
    assert.equal(loaded.client_code, '1001');
});

test2('同じ発注書IDの再登録は上書きで行が増えない', () => {
    const ss = new FakeSpreadsheet();
    gas.saveSheetOcrLayout_(manifestFor('SO-000000000001', 'ひとみ美容室', '1001'), ss);
    gas.saveSheetOcrLayout_(manifestFor('SO-000000000001', 'ひとみ美容室', '1001'), ss);
    assert.equal(ss.getSheetByName('_OrderSheetLayouts').getLastRow(), 2);
});

test2('得意先コードはClientMaster G列から取れ、先頭アポストロフィは外れる', () => {
    const ss = new FakeSpreadsheet();
    assert.equal(gas.sheetOcrClientCode_(ss, 'ひとみ美容室'), '1001');
    assert.equal(gas.sheetOcrClientCode_(ss, 'ひとみ美容室 店販'), '1001');
    assert.equal(gas.sheetOcrClientCode_(ss, 'コード未設定サロン'), '');
    assert.equal(gas.sheetOcrClientCode_(ss, '存在しない'), '');
});

test2('サロン名を変えた後でも、得意先コードが一致すれば古い発注書を通し名前を今のものに揃える', () => {
    const ss = new FakeSpreadsheet();
    ss.sheets.ClientMaster.rows[1][2] = 'ひとみ美容室 新店名';
    const old = manifestFor('SO-000000000001', 'ひとみ美容室', '1001');
    const resolved = gas.resolveSheetOcrManifestClient_(old, 'ひとみ美容室 新店名', ss);
    assert.equal(resolved.client_name, 'ひとみ美容室 新店名');
    assert.equal(resolved.client_name_at_print, 'ひとみ美容室');
    assert.equal(old.client_name, 'ひとみ美容室', '元のmanifestは変えない');
});

test2('名前が違いコードも違う（別サロン）なら従来どおり拒否', () => {
    const ss = new FakeSpreadsheet();
    assert.throws(() => gas.resolveSheetOcrManifestClient_(manifestFor('SO-1', 'ひとみ美容室', '1001'), 'ミツアミ堂', ss), /一致しません/);
});

test2('コード未設定のサロンは名前一致だけ（旧manifestにclient_codeが無くても落ちない）', () => {
    const ss = new FakeSpreadsheet();
    const legacy = manifestFor('SO-1', 'コード未設定サロン', undefined);
    delete legacy.client_code;
    assert.equal(gas.resolveSheetOcrManifestClient_(legacy, 'コード未設定サロン', ss), legacy);
    assert.throws(() => gas.resolveSheetOcrManifestClient_(legacy, 'ひとみ美容室', ss), /一致しません/);
});

test2('店販サフィックスの有無が違えば、コードが同じでも通さない（店販と通常の取り違え防止）', () => {
    const ss = new FakeSpreadsheet();
    ss.sheets.ClientMaster.rows[1][2] = 'ひとみ美容室 新店名';
    assert.throws(() => gas.resolveSheetOcrManifestClient_(manifestFor('SO-1', 'ひとみ美容室', '1001'), 'ひとみ美容室 新店名 店販', ss), /一致しません/);
});

let failed2 = 0;
for (const { name, run } of tests2) {
    try { run(); console.log(`  ok - ${name}`); } catch (error) { failed2++; console.log(`  FAIL - ${name}\n    ${error.message}`); }
}
if (failed2) { console.log(`❌ ${failed2} failed`); process.exit(1); }
console.log(`✅ sheet OCR layout save/rename tests: ${tests2.length} passed`);
