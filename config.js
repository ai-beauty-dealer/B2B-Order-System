// config.js
// 🛠️ B2B Order System - Configuration
//
// 【複数販売担当（マルチディーラー）対応】
// サイトは1つを全員で共用し、URLの ?dealer=コード で
// 接続先のGAS（＝各担当のスプレッドシート）を切り替える。
//
// 使い方:
//   通常URL                → default（ぶんちゃん）に接続
//   ?dealer=tanaka を付与  → 田中さんのGASに接続
//
// 社員を追加するときは、下の表に1行足してpushするだけ。
//   'コード': 'GASウェブアプリのURL',
// コードは半角英数の小文字。サロン様への案内URLは
//   https://ai-beauty-dealer.github.io/B2B-Order-System/?dealer=コード

const DEALER_API_URLS = {
    // ぶんちゃん（本店）。パラメータなしはここに接続される
    'default': 'https://script.google.com/macros/s/AKfycbwkR588NKOrW4lvb2qa9stPdkQIyso2flRcVSZt6HyxLAqc8pLiSqMpuWeh1RPxV2RD/exec'

    // 8732（花光さん・ぶんちゃん名義の旧環境）は 2026-08-03 に退役。
    // 社員名義の 755 へ移行済みで、サロン様の登録も注文実績も無かった。

    // サブアカウント導入テスト（2026-07-18追加）
    ,'test-sub': 'https://script.google.com/macros/s/AKfycbzFFSKVcYi5Sel5MhJ7gf_2fq5UCtIALYuC0QM29hmQp12GyQcoqctG1mse_vxgNfeM/exec'

    // 社員2 花光（社員名義・2026-07-20追加）
    ,'755': 'https://script.google.com/macros/s/AKfycbyGmlJg4dIpqjd8r8C5GugKSRo3N34ebnHvEnKxmFCYHEpbdnYzMy-brBuNm1Mt75s/exec'

    // 社員3 平（社員名義・2026-08-03追加）
    ,'747': 'https://script.google.com/macros/s/AKfycbyZ-wJ7MQPAFJCh7v668znDci2NRqqV2wdS2isIpTR_-zAjmLdjF6gL_S6n0l7QdEfIXw/exec'

    // ▼ 社員を追加するときは上の行末にカンマを付けて、ここに1行追加
    // ,'tanaka': 'https://script.google.com/macros/s/XXXXXXXX/exec'
};

// 【新しいサイトへ切り替えた担当】（2026-10-03 追加）
// ここにコードがある担当は、開いた時に新しいサイトのURLへ自動で送る。
//   'コード': 'https://新しいサイト/'   ← 末尾は「/」
// 空の間は今までと同じ動き。戻す時はその行を消すだけ
// （端末の記憶は消していないので、このサイトでそのまま続きから使える）。
// 上の DEALER_API_URLS の行は消さない（戻す時に使う）。
const DEALER_MOVED_URLS = {
    'test-sub': 'https://b2b-order-test-sub.bunchanlab.workers.dev/'
};

// 新しいサイトへ送り出す。送ったら true。
//   - 渡すのは ID・名前・ログイン札・カゴの下書き・入力の控えだけ。パスワード入りの昔の記憶（p）は渡さない
//   - 開かれた時のURLに付いていた # は引き継がない（よそから札を差し込ませない）
//   - カゴの下書きは最初の1回だけ渡す（送り終えたカゴが新しいサイトでよみがえるのを防ぐ）
//   - この端末の記憶は消さない（戻す時の備え）
function b2bMoveToNewSite(dealer, movedUrls) {
    const target = movedUrls && movedUrls[dealer];
    if (!target) return false;

    const ls = {};
    const take = (key) => {
        try {
            const v = localStorage.getItem(key);
            if (typeof v === 'string' && v) ls[key] = v;
        } catch (e) { /* 読めない記憶は渡さない */ }
    };

    try {
        const r = JSON.parse(localStorage.getItem('b2b_resume') || 'null');
        if (r && r.u && r.tk && !r.p) {
            ls.b2b_resume = JSON.stringify({ u: r.u, name: r.name || '', tk: r.tk });
        }
    } catch (e) { /* 記憶なしで送る（新しいサイトはログイン画面になる） */ }
    ['b2b_saved_username', 'b2b_remember_me', 'b2b_personal_name', 'b2b_staff_names'].forEach(take);

    let cartsSentTo = '';
    try { cartsSentTo = localStorage.getItem('b2b_moved_carts_sent') || ''; } catch (e) { cartsSentTo = ''; }
    if (cartsSentTo !== target) {
        try {
            const cartKeys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.indexOf('b2b_cart_') === 0) { take(key); cartKeys.push(key); }
            }
            // 通信が無い時は「渡した」ことにしない（移れなかったら、次に開いた時にもう一度渡す）
            // どのカゴを渡したかも控える（戻した後に、渡したカゴだけを消すため）
            if (navigator.onLine !== false) {
                localStorage.setItem('b2b_moved_carts_keys', JSON.stringify(cartKeys));
                localStorage.setItem('b2b_moved_carts_sent', target);
            }
        } catch (e) { /* 控えが書けなくても送る。新しいサイト側も1回しか受け取らない */ }
    }

    let hash = '';
    try {
        const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, d: dealer, ls: ls }));
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        hash = '#h=' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (e) { hash = ''; }

    // 移るまでの間、このサイトのログイン画面を見せない（自動で移らない時のためにリンクも置く）
    try {
        const cover = document.createElement('div');
        cover.id = 'moved-cover';
        cover.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;background:#fff;color:#333;'
            + 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;'
            + 'font-size:1rem;line-height:1.7;text-align:center;';
        const text = document.createElement('p');
        text.textContent = '発注サイトが新しくなりました。新しいサイトへ移動しています…';
        const link = document.createElement('a');
        link.href = target + hash;
        link.textContent = '移動しない時は、ここを押してください';
        link.style.cssText = 'color:#1e3a5f;text-decoration:underline;';
        cover.appendChild(text);
        cover.appendChild(link);
        (document.body || document.documentElement).appendChild(cover);
    } catch (e) { /* 出せなくても送る */ }

    location.replace(target + hash);
    return true;
}

// 新しいサイトから戻した後（上の表からその担当の行を消した後）に、端末ごとに1回だけ働く。働いたら true。
// 切り替えの時に新しいサイトへ渡したカゴは、新しいサイトで送り終えているかもしれない。このサイトに残っている写しを
// そのまま出すと二重発注になるので、渡したカゴだけを消し、知らせを出す（閉じるまで）。
//   - 渡した先が表のどこかにまだある間は何もしない（その担当は切り替えたまま）
//   - 渡していないカゴ・ログインの記憶は消さない
function b2bAfterMovedBack(movedUrls) {
    try {
        const sentTo = localStorage.getItem('b2b_moved_carts_sent') || '';
        if (!sentTo) return false;
        if (Object.keys(movedUrls || {}).some((d) => movedUrls[d] === sentTo)) return false;
        let keys = [];
        try { keys = JSON.parse(localStorage.getItem('b2b_moved_carts_keys') || '[]'); } catch (e) { keys = []; }
        if (Array.isArray(keys)) {
            keys.forEach((key) => {
                if (typeof key === 'string' && key.indexOf('b2b_cart_') === 0) localStorage.removeItem(key);
            });
        }
        localStorage.removeItem('b2b_moved_carts_keys');
        localStorage.removeItem('b2b_moved_carts_sent');
        localStorage.setItem('b2b_moved_back_notice', '1');
        return true;
    } catch (e) { return false; }
}

// 戻した後の知らせ。閉じるまで出す（ログインの後も消えない）。出せなくても発注はできる
document.addEventListener('DOMContentLoaded', () => {
    try {
        if (localStorage.getItem('b2b_moved_back_notice') !== '1') return;
        const note = document.createElement('div');
        note.id = 'moved-back-notice';
        note.style.cssText = 'background:#eef6ff;border-bottom:1px solid #b6d4f5;color:#1e3a5f;font-size:13px;line-height:1.6;'
            + 'padding:10px 12px;display:flex;gap:10px;align-items:flex-start;';
        const text = document.createElement('div');
        text.style.cssText = 'flex:1;';
        text.textContent = '発注サイトを前の場所に戻しました。画面のサロン様名をお確かめください。'
            + '切り替えの前にカゴへ入れていた商品は、空にしてあります。';
        const close = document.createElement('button');
        close.type = 'button';
        close.id = 'moved-back-notice-close';
        close.textContent = '閉じる';
        close.style.cssText = 'background:#1e3a5f;color:#fff;border:none;border-radius:6px;padding:6px 10px;font-size:12px;'
            + 'cursor:pointer;white-space:nowrap;';
        close.addEventListener('click', () => {
            note.remove();
            try { localStorage.removeItem('b2b_moved_back_notice'); } catch (e) { /* 次も出るだけ */ }
        });
        note.appendChild(text);
        note.appendChild(close);
        document.body.insertBefore(note, document.body.firstChild);
    } catch (e) { /* 知らせが出せなくても発注はできる */ }
});

// 発注が送れなかったときに出す「担当にLINEで連絡する」の宛先（担当ごと）。
// 空欄の担当はボタンを出さない。
const DEALER_CONTACT_LINE_URLS = {
    'default': ''
};

const CONFIG = (() => {
    // dealer解決の優先順位（PWA対応・R-1）:
    //   ① URLの ?dealer=（あれば最優先。記憶も更新する）
    //   ② 前回記憶したdealer（localStorage）
    //      ← PWAはホーム画面起動で ?dealer= が消えるため、
    //        これが無いと default に誤接続して他担当のシートに
    //        注文が混ざる事故になる。ここが最重要ガード。
    //   ③ どちらも無ければ default
    let dealer = 'default';

    try {
        const params = new URLSearchParams(
            window.location.search
        );
        const urlDealer = (params.get('dealer') || '')
            .trim().toLowerCase();

        if (urlDealer) {
            dealer = urlDealer;
            try {
                localStorage.setItem('b2b_dealer', urlDealer);
            } catch (e) { /* localStorage不可でも続行 */ }
        } else {
            let saved = '';
            try {
                saved = (localStorage.getItem('b2b_dealer') || '')
                    .trim().toLowerCase();
            } catch (e) { saved = ''; }
            dealer = saved || 'default';
        }
    } catch (e) {
        dealer = 'default';
    }

    // 新しいサイトへ切り替えた担当は、ここで送り出す。
    // 担当の決め方（上の①②③）は変えない。移るまでの間に通信が出ても、どこにも届かない宛先にしておく
    if (b2bMoveToNewSite(dealer, DEALER_MOVED_URLS)) {
        return { API_URL: 'about:blank#moved', DEALER: dealer, MOVED: true };
    }
    // 新しいサイトから戻した後の片付け（端末ごとに1回。渡したカゴを消して知らせを出す）
    b2bAfterMovedBack(DEALER_MOVED_URLS);

    const apiUrl = DEALER_API_URLS[dealer];

    if (!apiUrl) {
        // 未登録コードは誤送信防止のため通信を遮断する。
        // （黙ってdefaultへ送ると、他担当のシートに
        //   注文が混ざる事故になるため）
        alert(
            '販売担当コード（' + dealer + '）が正しくありません。\n' +
            'URLをご確認のうえ、担当者にお問い合わせください。'
        );
        return {
            API_URL: 'about:blank#invalid-dealer',
            DEALER: dealer,
            INVALID: true
        };
    }

    return { API_URL: apiUrl, DEALER: dealer, CONTACT_LINE_URL: DEALER_CONTACT_LINE_URLS[dealer] || '' };
})();
