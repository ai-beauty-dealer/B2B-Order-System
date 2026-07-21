// コードでまとめ発注：頭4桁マッチ／数字正規化の回帰テスト。
// app.js の codeFilterVariants / normalizeDigits と同じロジックを固定する。
// 核心: ItemMaster は6桁保存で先頭0が落ちる（0704214→704214）。
//       先頭0補完エイリアスが無いと `0704` がヒットしない財務級バグになる。
import assert from 'node:assert';

// --- app.js のコアと同一実装（ここが真になるよう app.js 側を保つ）---
const canonical = (code) => String(code || '').replace(/^'/, '').trim();

const codeFilterVariants = (code) => {
    const c = canonical(code);
    const variants = [c];
    if (/^\d{6}$/.test(c)) variants.push('0' + c);
    return variants;
};

const matchesPrefix = (code, prefix) =>
    codeFilterVariants(code).some((v) => v.startsWith(prefix));

const normalizeDigits = (value) => String(value || '')
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[^0-9]/g, '');

// --- テスト ---
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

console.log('code-filter マッチ:');

t('7桁保存の0704214は0704にヒット', () => {
    assert.strictEqual(matchesPrefix('0704214', '0704'), true);
});

t('【回帰】6桁保存(先頭0落ち)704214も0704にヒット', () => {
    assert.strictEqual(matchesPrefix('704214', '0704'), true);
});

t("先頭'付き'704214も0704にヒット", () => {
    assert.strictEqual(matchesPrefix("'704214", '0704'), true);
});

t('ルベル0104はルベル系だけにヒット', () => {
    assert.strictEqual(matchesPrefix('0104330', '0104'), true);
    assert.strictEqual(matchesPrefix('104330', '0104'), true);
});

t('フィヨーレ0704はルベル0104に非ヒット', () => {
    assert.strictEqual(matchesPrefix('704214', '0104'), false);
});

t('ヤクジョ3307は0704に非ヒット', () => {
    assert.strictEqual(matchesPrefix('3307002', '0704'), false);
});

console.log('数字正規化:');

t('全角０７０４→0704', () => {
    assert.strictEqual(normalizeDigits('０７０４'), '0704');
});

t('空白混じり 07 04 →0704', () => {
    assert.strictEqual(normalizeDigits(' 07 04 '), '0704');
});

t('数字以外を除去 abc07x→07', () => {
    assert.strictEqual(normalizeDigits('abc07x'), '07');
});

console.log(`\n✅ code-filter tests: ${passed} passed`);
