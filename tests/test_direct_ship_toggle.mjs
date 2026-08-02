// 直送トグル（MASTER限定）の状態遷移テスト。
// app.js の currentClientType / registeredClientType の扱いと同じロジックを固定する。
// 核心: 送信箇所（発注・内容変更・取消）はすべて currentClientType を見ているので、
//       ここが狂うと「別のサロンの発注が直送シートへ行く」出荷事故になる。
import assert from 'node:assert';

const DIRECT = '直送';

// --- app.js のコアと同一実装（ここが真になるよう app.js 側を保つ）---
function createSession() {
    return { currentClientType: '', registeredClientType: '' };
}

// ログイン時／マスターがサロンを選んだとき
function enterSalon(s, registeredType) {
    s.currentClientType = registeredType || '';
    s.registeredClientType = registeredType || '';
}

function isDirectShipOn(s) {
    return s.currentClientType === DIRECT;
}

function isLocked(s) {
    return s.registeredClientType === DIRECT;
}

// ボタンを押したとき
function toggleDirectShip(s) {
    if (isLocked(s)) return; // 登録上すでに直送なら何もしない
    s.currentClientType = isDirectShipOn(s) ? (s.registeredClientType || '') : DIRECT;
}

// 発注が成功したとき（失敗時は呼ばない＝再送のためONのまま残す）
function onOrderSuccess(s, wasDirectShip) {
    if (wasDirectShip) {
        s.currentClientType = s.registeredClientType || '';
    }
}

function logout(s) {
    s.currentClientType = '';
    s.registeredClientType = '';
}

// --- テスト ---
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name); };

t('通常サロンは初期状態がOFF', () => {
    const s = createSession();
    enterSalon(s, '');
    assert.strictEqual(isDirectShipOn(s), false);
    assert.strictEqual(s.currentClientType, '');
});

t('通常サロンでONにすると直送で送られる', () => {
    const s = createSession();
    enterSalon(s, '');
    toggleDirectShip(s);
    assert.strictEqual(isDirectShipOn(s), true);
    assert.strictEqual(s.currentClientType, DIRECT);
});

t('ONからOFFへ戻すと登録値（空）に戻る', () => {
    const s = createSession();
    enterSalon(s, '');
    toggleDirectShip(s);
    toggleDirectShip(s);
    assert.strictEqual(s.currentClientType, '');
});

t('登録済み直送サロンはロックされ、押しても変わらない', () => {
    const s = createSession();
    enterSalon(s, DIRECT);
    assert.strictEqual(isLocked(s), true);
    assert.strictEqual(isDirectShipOn(s), true);
    toggleDirectShip(s);
    assert.strictEqual(s.currentClientType, DIRECT, '登録済み直送が解除されてはいけない');
});

t('サロンを切り替えると直送指定が持ち越されない', () => {
    const s = createSession();
    enterSalon(s, '');
    toggleDirectShip(s);
    assert.strictEqual(isDirectShipOn(s), true);

    enterSalon(s, ''); // 別のサロンへ
    assert.strictEqual(isDirectShipOn(s), false, '前のサロンの直送指定が残ってはいけない');
    assert.strictEqual(s.registeredClientType, '');
});

t('直送サロンから通常サロンへ移ってもONのままにならない', () => {
    const s = createSession();
    enterSalon(s, DIRECT);
    assert.strictEqual(isDirectShipOn(s), true);

    enterSalon(s, '');
    assert.strictEqual(isDirectShipOn(s), false);
    assert.strictEqual(isLocked(s), false);
});

t('発注が通ったら自動でOFFへ戻る', () => {
    const s = createSession();
    enterSalon(s, '');
    toggleDirectShip(s);

    const wasDirect = isDirectShipOn(s); // 送信時点で控える
    onOrderSuccess(s, wasDirect);

    assert.strictEqual(isDirectShipOn(s), false, '次の発注へ持ち越してはいけない');
    assert.strictEqual(s.currentClientType, '');
});

t('発注が失敗したときはONのまま（再送できる）', () => {
    const s = createSession();
    enterSalon(s, '');
    toggleDirectShip(s);

    // 失敗時は onOrderSuccess を呼ばない
    assert.strictEqual(isDirectShipOn(s), true);
});

t('登録済み直送サロンは発注後もONのまま', () => {
    const s = createSession();
    enterSalon(s, DIRECT);

    const wasDirect = isDirectShipOn(s);
    onOrderSuccess(s, wasDirect);

    assert.strictEqual(s.currentClientType, DIRECT, '登録済み直送が発注のたびに外れてはいけない');
    assert.strictEqual(isLocked(s), true);
});

t('ログアウトで状態が残らない', () => {
    const s = createSession();
    enterSalon(s, '');
    toggleDirectShip(s);
    logout(s);
    assert.strictEqual(s.currentClientType, '');
    assert.strictEqual(s.registeredClientType, '');
});

console.log(`\n直送トグル: ${passed}件すべて通過`);
