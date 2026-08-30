import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Match = require('../line-order-match.js');

const favorites = [
    { code: '204568', name: 'ｱﾙﾃｨｽﾄ CB/11 80', favorite: true },
    { code: '204569', name: 'ｱﾙﾃｨｽﾄ CB/9 80', favorite: true },
    { code: '204570', name: 'ｱﾙﾃｨｽﾄ CB/7 80', favorite: true },
    { code: '704062', name: 'BLｶﾗｰ RV8', favorite: true }
].map((product) => ({ ...product, normalized_name: Match.normalizeOrderName(product.name) }));

const allProducts = [
    ...favorites,
    { code: '101014', name: '新 ﾌﾟﾗｲｱ ｺｽﾒ 1', favorite: false },
    { code: '3204569', name: 'ﾌｧｲﾊﾞｰﾌﾟﾚｯｸｽ ﾎﾞﾝﾄﾞ ｶﾗｰ G-BR7 80', favorite: false }
].map((product) => ({ ...product, normalized_name: Match.normalizeOrderName(product.name) }));

const tests = [];
const test = (name, run) => tests.push({ name, run });

test('お気に入り商品を先に自動確定する', () => {
    const result = Match.parseLineOrderText('RV8 ×2', favorites, allProducts);
    assert.equal(result.entries[0].product.code, '704062');
    assert.equal(result.entries[0].quantity, 2);
    assert.match(result.entries[0].reason, /^お気に入り/);
});

test('お気に入り外の初回商品を全商品から確定する', () => {
    const result = Match.parseLineOrderText('新 プライア コスメ 1 2個', favorites, allProducts);
    assert.equal(result.entries[0].product.code, '101014');
    assert.equal(result.entries[0].quantity, 2);
    assert.match(result.entries[0].reason, /^全商品/);
});

test('色番不足は自動確定しない', () => {
    const result = Match.parseLineOrderText('アルティスト CB 2本', favorites, allProducts);
    assert.equal(result.entries[0].product, null);
    assert.ok(result.entries[0].candidates.length >= 2);
});

test('完全コード検索は部分一致コードを混ぜない', () => {
    const result = Match.searchProducts('ＣＯＤＥ ２０４５６９', allProducts);
    assert.deepEqual(result.map((product) => product.code), ['204569']);
});

test('先頭0付き7桁コードを6桁保存の商品へ照合する', () => {
    const parsed = Match.parseLineOrderText('CODE 0704062 ×2', favorites, allProducts);
    assert.equal(parsed.entries[0].product.code, '704062');
    assert.deepEqual(Match.searchProducts('0704062', allProducts).map((product) => product.code), ['704062']);
});

test('全商品検索でお気に入りを優先表示する', () => {
    const result = Match.searchProducts('CB/9', allProducts);
    assert.equal(result[0].code, '204569');
    assert.equal(result[0].favorite, true);
});

test('数量なしは未入力のまま保持する', () => {
    const result = Match.parseLineOrderText('RV8', favorites, allProducts);
    assert.equal(result.entries[0].product.code, '704062');
    assert.equal(result.entries[0].quantity, null);
});

test('入力HTMLを文字列として保持する', () => {
    const result = Match.parseLineOrderText('<script>alert(1)</script> ×2', favorites, allProducts);
    assert.equal(result.entries[0].source_text, '<script>alert(1)</script> ×2');
    assert.equal(result.entries[0].product, null);
});

for (const { name, run } of tests) {
    run();
    console.log(`  ok - ${name}`);
}
console.log(`\n✅ LINE text import tests: ${tests.length} passed`);
