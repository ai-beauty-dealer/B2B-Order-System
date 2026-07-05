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

    // ▼ 社員を追加するときは上の行末にカンマを付けて、ここに1行追加
    // ,'tanaka': 'https://script.google.com/macros/s/XXXXXXXX/exec'
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

    return { API_URL: apiUrl, DEALER: dealer };
})();
