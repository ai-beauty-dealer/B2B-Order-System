// v2.39.2 (FIXED-LAYOUT-SHEET-OCR-MAIN-ONLY)


document.addEventListener('DOMContentLoaded', () => {
    console.log('--- B2B Order System v2.39.2 (FIXED-LAYOUT-SHEET-OCR-MAIN-ONLY) Loaded ---');

    // Loading banner (non-blocking -- does not intercept any clicks)
    const loadingBanner = document.getElementById('loading-banner');
    const loadingBannerText = document.getElementById('loading-banner-text');
    const loginBtn = document.getElementById('login-btn');

    const showLoading = (message = '読み込み中...') => {
        if (loadingBannerText) loadingBannerText.textContent = message;
        if (loadingBanner) loadingBanner.classList.remove('hidden');
        if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = message; }
    };

    const hideLoading = () => {
        if (loadingBanner) loadingBanner.classList.add('hidden');
        if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'ログイン'; }
    };

    /**
     * ログイン失敗が「接続先の担当違い」で説明できるときだけ案内を足す。
     *
     * ホーム画面アプリを ?dealer= 無しで追加すると、iPhoneではSafariと
     * localStorageが分かれるため記憶したdealerも読めず、defaultの本店へ
     * 接続してしまう。社員のサロン様は本店に居ないので必ず弾かれるが、
     * 「IDまたはパスワードが違う」としか出ないため原因に辿り着けなかった。
     * 本店のサロン様はログインが通るのでこの文言は出ない。
     */
    const wrongDealerHint = () => {
        const standalone = window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;
        if (!standalone) return '';
        if (CONFIG.DEALER !== 'default') return '';
        return '\n\nホーム画面のアイコンから開いている場合、担当者の指定が'
            + '外れていることがあります。担当者から案内されたURLをブラウザで'
            + '開いてログインできるか試し、できた場合はそのページから'
            + 'ホーム画面に追加し直してください。';
    };

    // UI Elements
    const loginForm = document.getElementById('login-form');
    const loginContainer = document.getElementById('login-container');
    const usernameInput = document.getElementById('username');
    const orderContainer = document.getElementById('order-container');
    const refreshItemsBtn = document.getElementById('refresh-items-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const masterReturnBtn = document.getElementById('master-return-btn');
    const codeEntryBtn = document.getElementById('code-entry-btn');
    const codeFilterBtn = document.getElementById('code-filter-btn');
    const lineImportBtn = document.getElementById('line-import-btn');
    const sheetImageImportBtn = document.getElementById('sheet-image-import-btn');
    const directShipBtn = document.getElementById('direct-ship-btn');
    const CLIENT_TYPE_DIRECT_LABEL = '直送'; // GAS側 CLIENT_TYPE_DIRECT と対
    const totalQtySpan = document.getElementById('total-qty');
    const orderSubmitBtn = document.getElementById('order-submit-btn');
    const searchInput = document.getElementById('search-input');
    const itemListContainer = document.getElementById('item-list');
    const tabAll = document.getElementById('tab-all');
    const tabFavorites = document.getElementById('tab-favorites');
    const tabHistory = document.getElementById('tab-history');
    const historyListContainer = document.getElementById('history-list');
    const searchWrapper = document.getElementById('search-wrapper');
    const cartSummary = document.querySelector('.cart-summary');
    const confirmationContainer = document.getElementById('confirmation-container');
    const confirmItemList = document.getElementById('confirm-item-list');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalConfirmBtn = document.getElementById('modal-confirm-btn');
    const confirmationTitle = confirmationContainer ? confirmationContainer.querySelector('h2') : null;
    const confirmationDesc = confirmationContainer ? confirmationContainer.querySelector('.modal-desc') : null;
    const announcementBanner = document.getElementById('announcement-banner');
    const categoryChipsContainer = document.getElementById('category-chips-container');
    const orderRemarks = document.getElementById('order-remarks');
    const personalPurchaseCheck = document.getElementById('personal-purchase-check');
    const staffNameContainer = document.getElementById('staff-name-container');
    const staffNameInput = document.getElementById('staff-name-input');
    const addCustomItemBtn = document.getElementById('add-custom-item-btn');
    const customItemsList = document.getElementById('custom-items-list');
    const manufacturerChipsContainer = document.getElementById('manufacturer-chips-container');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const customItemsWrapper = document.getElementById('custom-items-wrapper');
    const clientNameDisplay = document.getElementById('client-name-display');
    const rememberMeCheckbox = document.getElementById('remember-me');

    const syncFavsWrapper = document.getElementById('sync-favs-wrapper');
    const syncHistoryFavsBtn = document.getElementById('sync-history-favs-btn');
    const globalSyncBtn = document.getElementById('global-sync-btn');
    const syncMsgArea = document.getElementById('sync-msg');

    // Personal Purchase Logic
    if (personalPurchaseCheck) {
        personalPurchaseCheck.addEventListener('change', (e) => {
            if (e.target.checked) {
                if (staffNameContainer) staffNameContainer.classList.remove('hidden');
                if (staffNameInput) {
                    staffNameInput.focus();
                    const savedName = localStorage.getItem('b2b_personal_name') || '';
                    if (savedName && !staffNameInput.value) {
                        staffNameInput.value = savedName;
                    }
                }
            } else {
                if (staffNameContainer) staffNameContainer.classList.add('hidden');
                if (staffNameInput) staffNameInput.style.borderColor = '#cbd5e1';
            }
        });
    }


    // Helper: LocalStorage keys (include clientName for master account isolation)
    const getFavsKey = () => `b2b_favs_${currentUsername}_${currentClientName}`;

    // Master Account UI
    const masterLoginBtn = document.getElementById('master-login-btn');
    const masterCancelBtn = document.getElementById('master-cancel-btn');
    const masterSalonSelect = document.getElementById('master-salon-select');
    const masterSalonSearch = document.getElementById('master-salon-search');
    const masterSalonList = document.getElementById('master-salon-list');
    const masterSalonCount = document.getElementById('master-salon-count');

    // Load saved ID if exists
    const savedId = localStorage.getItem('b2b_saved_username');
    const isRemembered = localStorage.getItem('b2b_remember_me') === 'true';
    if (savedId && isRemembered) {
        if (usernameInput) usernameInput.value = savedId;
        if (rememberMeCheckbox) rememberMeCheckbox.checked = true;
    }

    // --- PWA: 自動ログイン（アイコン起動で即発注画面）---
    // セッションは通常ログイン成功時に保存し、次回以降は自動で入る。
    // 別のサロンに切り替えるときはログアウトすればよい（下記でclearする）。
    // 認証失敗時はセッションを消して手動ログイン画面に戻す（無限ループ防止）。
    let autoLoginInProgress = false;
    // セキュリティ: パスワードはもう保存しない。サーバー発行のセッション
    // トークン（tk）だけを保存し、自動ログインはトークンで行う。
    // （旧バージョンが保存した {u, p, name} は初回だけ読み、成功後に
    //   トークン形式で上書きされて平文パスワードが消える）
    const saveResumeSession = (u, name) => {
        // トークンが無い＝GAS側がまだ旧版。そのときは何も保存しない。
        // （空トークンを保存すると次回の自動ログインが必ず失敗して
        //   「ログイン中…」で止まったように見えるため）
        if (!sessionToken) {
            clearResumeSession();
            return;
        }
        try {
            localStorage.setItem('b2b_resume', JSON.stringify({ u, name, tk: sessionToken }));
        } catch (e) { /* 保存不可でも通常動作 */ }
    };
    const clearResumeSession = () => {
        try { localStorage.removeItem('b2b_resume'); } catch (e) {}
    };
    const attemptAutoLogin = () => {
        let session = null;
        try { session = JSON.parse(localStorage.getItem('b2b_resume') || 'null'); }
        catch (e) { session = null; }
        if (!session || !session.u || (!session.p && !session.tk)) return;

        // 自動ログイン中の表示＋「別のサロン」への脱出口
        const banner = document.createElement('div');
        banner.id = 'auto-login-banner';
        banner.style.cssText = 'background:#f3f7fb;border:1px solid #d6e4f0;border-radius:10px;padding:16px;margin-bottom:16px;text-align:center;';
        banner.innerHTML =
            '<div style="color:#1e3a5f;font-weight:600;margin-bottom:8px;">' +
            (session.name ? session.name + ' として自動ログイン中…' : 'ログイン中…') + '</div>' +
            '<button type="button" id="auto-login-cancel" style="background:none;border:none;color:#5b7089;text-decoration:underline;font-size:0.9rem;cursor:pointer;">別のサロンでログインする</button>';
        loginForm.style.display = 'none';
        loginContainer.insertBefore(banner, loginForm);

        let cancelled = false;
        document.getElementById('auto-login-cancel').addEventListener('click', () => {
            cancelled = true;
            autoLoginInProgress = false;
            banner.remove();
            loginForm.style.display = '';
        });

        // 猶予中に商品キャッシュのparseとチップ構築を先に済ませておく（起動短縮）
        setTimeout(() => {
            try {
                const cachedData = localStorage.getItem('b2b_items_cache');
                const cachedTs = localStorage.getItem('b2b_items_ts');
                if (cachedData && cachedTs && (Date.now() - parseInt(cachedTs) < CACHE_DURATION) && !itemsData.length) {
                    itemsData = JSON.parse(cachedData);
                    itemsPreparsedFromCache = true;
                    renderManufacturerChips();
                    renderCategoryChips();
                }
            } catch (e) { /* 失敗してもfetchItemsが通常経路で再parseする */ }
        }, 0);

        // 「別のサロン」を押す猶予を少しだけ置いてから自動送信
        setTimeout(async () => {
            if (cancelled) return;
            autoLoginInProgress = true;
            const b = document.getElementById('auto-login-banner');
            if (b) b.remove();
            loginForm.style.display = '';

            if (session.tk) {
                // 新方式: トークンで再ログイン（パスワードは端末に無い）
                showLoading();
                try {
                    const response = await fetch(CONFIG.API_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                        redirect: 'follow',
                        body: JSON.stringify({ action: 'login', token: session.tk })
                    });
                    const result = await response.json();
                    if (result.status === 'success') {
                        await processLoginResult(result, session.u);
                    } else {
                        // トークン失効: 記憶を消して静かに手動ログインへ
                        hideLoading();
                        clearResumeSession();
                        autoLoginInProgress = false;
                        if (usernameInput) usernameInput.value = session.u;
                    }
                } catch (e) {
                    // 通信エラーは一時的なので記憶は消さない
                    console.error(e);
                    hideLoading();
                    autoLoginInProgress = false;
                }
                return;
            }

            // 旧方式の保存（平文パスワード）からの移行パス。
            // 1回だけ従来のフォーム送信で入り、成功時にトークン形式で上書きされる。
            if (usernameInput) usernameInput.value = session.u;
            const pwEl = document.getElementById('password');
            if (pwEl) pwEl.value = session.p;
            loginForm.requestSubmit
                ? loginForm.requestSubmit()
                : loginForm.dispatchEvent(new Event('submit', { cancelable: true }));
        }, 600);
    };
    window.addEventListener('load', attemptAutoLogin);

    // --- PWA: ホーム画面追加の案内（iOS/Android）---
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
    if (!isStandalone && localStorage.getItem('b2b_install_dismissed') !== '1') {
        const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
        const hint = document.createElement('div');
        hint.id = 'install-hint';
        hint.style.cssText = 'position:fixed;left:0;right:0;bottom:0;background:#1e3a5f;color:#fff;padding:12px 16px;font-size:0.85rem;z-index:998;display:flex;align-items:center;gap:10px;';
        const msg = isIOS
            ? '📲 共有ボタン → 「ホーム画面に追加」でアプリのように使えます'
            : '📲 メニュー → 「ホーム画面に追加」でアプリのように使えます';
        hint.innerHTML = '<span style="flex:1;">' + msg + '</span>' +
            '<button type="button" id="install-hint-close" style="background:rgba(255,255,255,0.2);border:none;color:#fff;border-radius:6px;padding:6px 10px;cursor:pointer;">閉じる</button>';
        window.addEventListener('load', () => {
            document.body.appendChild(hint);
            document.getElementById('install-hint-close').addEventListener('click', () => {
                hint.remove();
                try { localStorage.setItem('b2b_install_dismissed', '1'); } catch (e) {}
            });
        });
    }

    // Cart Sidebar Elements
    const cartSidebarEl = document.getElementById('cart-sidebar');
    const cartSidebarList = document.getElementById('cart-sidebar-list');
    const cartSidebarTotalQty = document.getElementById('cart-sidebar-total-qty');
    const cartToggleBtn = document.getElementById('cart-toggle-btn');
    const cartCloseBtn = document.getElementById('cart-close-btn');
    const cartBadge = document.getElementById('cart-badge');
    const cartOverlay = document.getElementById('cart-overlay');

    // State
    let currentUsername = '';
    let currentClientName = '';
    // history_favorites.json の参照キー。得意先名は公開ファイルに出さない（ClientMaster G列）
    let currentClientCode = '';

    // XSS対策: サーバー・発注履歴・ユーザー入力由来の文字列は
    // 必ずこれを通してからinnerHTMLテンプレートに埋め込む。
    // （発注履歴の商品名はシート経由で第三者が汚染し得るため）
    const escHtml = (v) => String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    // セッショントークン（ログイン成功時にGASが発行するHMAC署名トークン）。
    // 旧方式の「パスワードをlocalStorageに保存」を置き換えるもの。
    // 全API呼び出しに同梱し、GAS側はこれでサロンを特定する。
    let sessionToken = '';
    const tokenQuery = () => sessionToken ? `&token=${encodeURIComponent(sessionToken)}` : '';

    // 取り込みモード（LINE文面・写メ → カート）。2026-08-02 停止。
    // バックエンドの ENABLE_PARSE_ORDER と対で切り替える。
    // 再開するときは true に戻すだけ。UIもモーダルもコードは残してある。
    const ENABLE_IMPORT_MODE = false;
    // 検証済みの本店と稼働中の社員dealerへ展開。test-subは対象外。
    const LINE_TEXT_IMPORT_DEALERS = new Set(['default', '755', '747']);
    const ENABLE_LINE_TEXT_IMPORT = LINE_TEXT_IMPORT_DEALERS.has(CONFIG.DEALER);
    // 画像OCRは本店で検証してから社員へ広げる。GAS側も本店sheetIdで二重制限。
    const ENABLE_SHEET_IMAGE_IMPORT = CONFIG.DEALER === 'default';
    let currentClientType = ''; // '直送' or ''
    // ClientMaster D列に登録された本来の区分。直送トグルをOFFに戻すときここへ戻す。
    // currentClientType は「今回の発注をどのシートへ送るか」で、こちらは登録値。
    let registeredClientType = '';

    // --- 直送トグル（MASTERログイン限定） ---
    // 直送区分で登録していないサロンでも、その回の発注だけ直送シートへ送るための切替。
    // currentClientType を書き換えるだけで、発注・内容変更・取消の送信箇所すべてに効く
    // （バックエンドは data.clientType を見てシートを振り分けているため、GAS側の変更は不要）。
    function isDirectShipOn() {
        return currentClientType === CLIENT_TYPE_DIRECT_LABEL;
    }

    function renderDirectShipBtn() {
        if (!directShipBtn) return;

        const on = isDirectShipOn();
        // 登録上すでに直送のサロンは切り替える意味がないので固定表示にする
        const locked = registeredClientType === CLIENT_TYPE_DIRECT_LABEL;

        directShipBtn.textContent = locked
            ? '🚚 直送（登録済）'
            : (on ? '🚚 直送: ON' : '🚚 直送: OFF');
        directShipBtn.disabled = locked;
        directShipBtn.title = locked
            ? 'このサロンはClientMasterで直送に登録されています'
            : 'この発注だけ直送シートへ送る（マスター限定）';
        directShipBtn.style.background = on ? '#EF6B32' : '';
        directShipBtn.style.color = on ? '#fff' : '';
        directShipBtn.style.borderColor = on ? '#EF6B32' : '';

        // サロン名の [直送] 表示も追随させる（誤送信に気づけるようにする）
        if (clientNameDisplay && currentClientName) {
            clientNameDisplay.textContent =
                currentClientName + ' 様' + (on ? ' [直送]' : '');
        }
    }

    if (directShipBtn) {
        directShipBtn.addEventListener('click', () => {
            if (registeredClientType === CLIENT_TYPE_DIRECT_LABEL) return;

            if (!isDirectShipOn()) {
                const ok = confirm(
                    currentClientName + ' 様の発注を【直送】として送ります。\n\n' +
                    '・' + '直送シート（YYYY-MM-DD直送）に記録されます\n' +
                    '・LINE通知が【直送発注】になります\n\n' +
                    'よろしいですか？'
                );
                if (!ok) return;
                currentClientType = CLIENT_TYPE_DIRECT_LABEL;
            } else {
                currentClientType = registeredClientType || '';
            }

            renderDirectShipBtn();
        });
    }
    let itemsData = [];
    let itemsPreparsedFromCache = false; // 自動ログイン猶予中にキャッシュをparse済みか
    let favoriteItems = [];
    let historyFavoritesData = null; // Mapping from history_favorites.json
    let currentFilter = 'all';
    let currentManufacturerFilter = 'all';
    let currentCategoryFilter = 'all';
    let orderFrequency = {}; // よく頼む順: 商品コード → このサロンの発注回数
    let lastOrderDate = {};  // 最終発注日順: 商品コード → 最後に頼んだ時刻(epoch)
    let currentSort = 'frequency'; // 並べ替え: frequency / lastdate / aiueo / code
    let editingOrderId = null;
    let currentCart = {};
    let cartOrder = []; // Track the order in which items are added to the cart
    let isSubmitting = false;
    let isMasterSession = false; // MASTERアカウントでログイン中か（サロン切替後もtrueを維持。取り込みモードの表示制御に使う）
    let masterAllClients = []; // MASTERログイン時の全サロン一覧（サロン検索の絞り込み元）
    let masterSalonSearchTimeout = null; // サロン検索のデバウンス（メイン検索の searchTimeout とは別管理）

    const setSubmittingState = (submitting, isEditing = false) => {
        isSubmitting = submitting;
        if (modalConfirmBtn) {
            modalConfirmBtn.disabled = submitting;
            modalConfirmBtn.textContent = submitting
                ? (isEditing ? '変更を保存中...' : '送信中...')
                : (isEditing ? '変更を保存する' : '注文を確定する');
        }
        if (orderSubmitBtn) orderSubmitBtn.disabled = submitting;
    };

    const updateConfirmationCopy = (isEditing) => {
        // 直送トグルがONのときは最終確認でも明示する（誤送信に気づける最後の場所）
        const direct = isDirectShipOn();
        if (confirmationTitle) {
            confirmationTitle.textContent =
                (direct ? '【直送】' : '') +
                (isEditing ? '発注内容の変更確認' : '発注内容の最終確認');
        }
        if (confirmationDesc) {
            if (direct) {
                confirmationDesc.textContent = isEditing
                    ? 'この内容を【直送】として変更しますか？'
                    : 'この内容を【直送】として発注しますか？';
            } else {
                confirmationDesc.textContent = isEditing
                    ? '以下の内容で発注内容を変更しますか？'
                    : '以下の内容で発注を確定しますか？';
            }
        }
        if (modalConfirmBtn) {
            modalConfirmBtn.textContent = isEditing ? '変更を保存する' : '注文を確定する';
        }
    };
    let searchTimeout = null; // For debouncing
    let loggedUnknownJans = new Set(); // 未登録JAN重複送信防止（キー: jan_サロン名）

    const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in ms

    // --- Utility Functions ---
    const isValidCode = (code) => {
        if (!code) return false;
        // 万が一、GAS側の意図しないシングルクォートが混じっていてもここで無視・除去してチェック
        const cleanS = String(code).replace(/^'/, '').toLowerCase();
        
        // 指数表記（e+が含まれる）は、スプレッドシート側でコードが数値として結合・破損したデータとみなして除外
        if (cleanS.includes('e+')) {
            console.warn('[Validation] Corrupted product code detected (scientific notation):', code);
            return false;
        }
        // 桁数が異常に長い場合（20桁超）も破損の疑いがあるため除外
        if (cleanS.length > 20) {
            console.warn('[Validation] Abnormal code length detected:', cleanS);
            return false;
        }
        return true;
    };

    const normalizeForSearch = (str) => {
        if (!str) return '';
        str = String(str);
        let normalized = str.replace(/[\uFF01-\uFF5E]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
        normalized = normalized.replace(/[\u3041-\u3096]/g, (s) => String.fromCharCode(s.charCodeAt(0) + 0x0060));
        const kanaMap = {
            'ｶﾞ': 'ガ', 'ｷﾞ': 'ギ', 'ｸﾞ': 'グ', 'ｹﾞ': 'ゲ', 'ｺﾞ': 'ゴ', 'ｻﾞ': 'ザ', 'ｼﾞ': 'ジ', 'ｽﾞ': 'ズ', 'ｾﾞ': 'ゼ', 'ｿﾞ': 'ゾ',
            'ﾀﾞ': 'ダ', 'ﾁﾞ': 'ヂ', 'ﾂﾞ': 'ヅ', 'ﾃﾞ': 'デ', 'ﾄﾞ': 'ド', 'ﾊﾞ': 'バ', 'ﾋﾞ': 'ビ', 'ﾌﾞ': 'ブ', 'ﾍﾞ': 'ベ', 'ﾎﾞ': 'ボ',
            'ﾊﾟ': 'パ', 'ﾋﾟ': 'ピ', 'ﾌﾟ': 'プ', 'ﾍﾟ': 'ペ', 'ﾎﾟ': 'ポ', 'ｳﾞ': 'ヴ', 'ﾜﾞ': 'ヷ', 'ｦﾞ': 'ヺ',
            'ｱ': 'ア', 'ｲ': 'イ', 'ｳ': 'ウ', 'ｴ': 'エ', 'ｵ': 'オ', 'ｶ': 'カ', 'ｷ': 'キ', 'ｸ': 'ク', 'ｹ': 'ケ', 'ｺ': 'コ',
            'ｻ': 'サ', 'ｼ': 'シ', 'ｽ': 'ス', 'ｾ': 'セ', 'ｿ': 'ソ', 'ﾀ': 'タ', 'ﾁ': 'チ', 'ﾂ': 'ツ', 'ﾃ': 'テ', 'ﾄ': 'ト',
            'ﾅ': 'ナ', 'ﾆ': 'ニ', 'ﾇ': 'ヌ', 'ﾈ': 'ネ', 'ﾉ': 'ノ', 'ﾊ': 'ハ', 'ﾋ': 'ヒ', 'ﾌ': 'フ', 'ﾍ': 'ヘ', 'ﾎ': 'ホ',
            'ﾏ': 'マ', 'ﾐ': 'ミ', 'ﾑ': 'ム', 'ﾒ': 'メ', 'ﾓ': 'モ', 'ﾔ': 'ヤ', 'ﾕ': 'ユ', 'ﾖ': 'ヨ',
            'ﾗ': 'ラ', 'ﾘ': 'リ', 'ﾙ': 'ル', 'ﾚ': 'レ', 'ﾛ': 'ロ', 'ﾜ': 'ワ', 'ｦ': 'ヲ', 'ﾝ': 'ン',
            'ｧ': 'ァ', 'ｨ': 'ィ', 'ｩ': 'ゥ', 'ｪ': 'ェ', 'ｫ': 'ォ', 'ｯ': 'ッ', 'ｬ': 'ャ', 'ｭ': 'ュ', 'ｮ': 'ョ',
            'ｰ': 'ー', '･': '・', '､': '、', 'ﾟ': '゜', 'ﾞ': '゛'
        };
        const keys = Object.keys(kanaMap).sort((a, b) => b.length - a.length);
        const reg = new RegExp('(' + keys.join('|') + ')', 'g');
        normalized = normalized.replace(reg, (match) => kanaMap[match] || match);
        return normalized.toLowerCase().replace(/[\s　\-\_\/\\.,:;]/g, '');
    };

    const calculateTotal = () => {
        let total = 0;
        Object.values(currentCart).forEach(item => { total += item.qty || 0; });
        totalQtySpan.textContent = total;
        // Update cart badge + sidebar
        if (cartBadge) cartBadge.textContent = total;
        renderCartSidebar();
    };

    /**
     * Parse product name into structured info (Feature 1, 4)
     * e.g. "ADX 8-Sapphire" -> { brand: "ADX", level: 8, tone: "Sapphire" }
     */
    const extractInfo = (name) => {
        const parts = name.split(/[\s-]+/);
        const brand = parts[0] || 'その他';
        let level = null;
        let tone = '';

        for (let i = 1; i < parts.length; i++) {
            const num = parseInt(parts[i]);
            if (!isNaN(num) && num > 0 && num < 20) {
                level = num;
                tone = parts.slice(i + 1).join('-');
                if (!tone && i > 1) tone = parts.slice(1, i).join('-');
                break;
            }
        }
        if (!level && parts.length > 1) tone = parts.slice(1).join('-');
        return { brand, level, tone: tone || 'Default' };
    };

    // Category detection (selective grouping - Feature 1)
    const isColor = (category) => {
        if (!category) return false;
        const c = String(category);
        return c.includes('カラー') || c.includes('1剤') || c.includes('2剤') || c.includes('オキシ') || c.includes('ハイトーン');
    };

    const isPerm = (category) => {
        if (!category) return false;
        const c = String(category);
        return c.includes('パーマ') || c.includes('縮毛') || c.includes('ストレート') || c.includes('カーリング');
    };

    // --- Surgical Cache Clearing (v2.10) ---
    window.clearCacheSurgically = () => {
        const keysToKeep = [];
        // Identify keys to preserve (Favorites and Login identity)
        // b2b_dealer / b2b_resume を消すと、PWA起動（?dealer=なし）の端末が
        // 本店GASに戻って社員担当のサロン様がログイン不能になる。必ず残す。
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('b2b_favs_') ||
                key.startsWith('b2b_cart_') ||
                key === 'b2b_saved_username' ||
                key === 'b2b_remember_me' ||
                key === 'b2b_dealer' ||
                key === 'b2b_resume') {
                keysToKeep.push({ key, value: localStorage.getItem(key) });
            }
        }

        // Clear everything
        localStorage.clear();

        // Restore favorites
        keysToKeep.forEach(item => {
            localStorage.setItem(item.key, item.value);
        });

        alert('商品データのキャッシュを消去しました（お気に入りは保存されました）。画面を再読み込みします。');

        // Service Workerのキャッシュも消す（「真っ黒画面」の原因が
        // 壊れたSWキャッシュだった場合、localStorageだけでは直らない）。
        // 失敗しても従来どおり再読み込みだけは必ず行う。
        if (window.caches && caches.keys) {
            caches.keys()
                .then((names) => Promise.all(names.map((n) => caches.delete(n))))
                .catch(() => {})
                .then(() => location.reload());
        } else {
            location.reload();
        }
    };


    // --- Cart Persistence (localStorage) ---
    const getCartKey = () => `b2b_cart_${currentUsername}_${currentClientName}`;

    const saveCartToStorage = () => {
        if (!currentUsername || !currentClientName || editingOrderId !== null) return;
        const cartToSave = {};
        const orderToSave = [];
        cartOrder.forEach(code => {
            if (!String(code).startsWith('CUSTOM_ITEM_') && currentCart[code]) {
                orderToSave.push(code);
                cartToSave[code] = currentCart[code];
            }
        });
        localStorage.setItem(getCartKey(), JSON.stringify({
            cart: cartToSave, order: orderToSave, savedAt: Date.now()
        }));
    };

    const clearCartFromStorage = () => {
        if (!currentUsername || !currentClientName) return;
        localStorage.removeItem(getCartKey());
    };

    // Returns the number of restored items (0 = nothing restored)
    const restoreCartFromStorage = () => {
        const saved = localStorage.getItem(getCartKey());
        if (!saved) return 0;
        try {
            const parsed = JSON.parse(saved);
            if (parsed.savedAt && Date.now() - parsed.savedAt > 7 * 24 * 60 * 60 * 1000) {
                localStorage.removeItem(getCartKey());
                return 0;
            }
            currentCart = parsed.cart || {};
            cartOrder = parsed.order || [];
            return Object.values(currentCart).filter(v => v.qty > 0).length;
        } catch (e) {
            console.warn('[Cart] Failed to restore cart from storage:', e);
            return 0;
        }
    };

    const showCartRestoredBanner = (itemCount) => {
        const existing = document.getElementById('cart-restore-banner');
        if (existing) existing.remove();
        const banner = document.createElement('div');
        banner.id = 'cart-restore-banner';
        banner.className = 'cart-restore-banner';
        banner.innerHTML = `<span>前回の発注を復元しました（${itemCount}点）</span><button class="cart-restore-close" aria-label="閉じる">&times;</button>`;
        banner.querySelector('.cart-restore-close').addEventListener('click', () => banner.remove());
        document.body.appendChild(banner);
        setTimeout(() => { if (banner.parentNode) banner.remove(); }, 6000);
    };

    // --- Cart Sidebar Renderer ---
    // Sync helper: update the item card's qty input (if visible on screen)
    const syncCardQty = (code, newQty) => {
        const input = itemListContainer.querySelector(`.qty-input[data-code="${code}"]`);
        if (input) input.value = newQty;
    };

    // Update cart from sidebar and sync everything
    const updateFromCart = (code, name, newQty) => {
        if (newQty > 0) {
            if (!currentCart[code]) {
                cartOrder.push(code);
            }
            currentCart[code] = { qty: newQty, name };
        } else {
            delete currentCart[code];
            cartOrder = cartOrder.filter(c => c !== code);
        }
        syncCardQty(code, newQty);
        calculateTotal();
        saveCartToStorage();
    };

    const renderCartSidebar = () => {
        if (!cartSidebarList) return;
        const cartItems = Object.entries(currentCart).filter(([, v]) => v.qty > 0);
        const total = cartItems.reduce((sum, [, v]) => sum + v.qty, 0);

        if (cartSidebarTotalQty) cartSidebarTotalQty.textContent = total;

        if (cartItems.length === 0) {
            cartSidebarList.innerHTML = '<p class="cart-empty-msg">🛒 まだ商品が選ばれていません</p>';
            return;
        }

        cartSidebarList.innerHTML = '';
        cartItems.forEach(([code, data]) => {
            const row = document.createElement('div');
            row.className = 'cart-item-row';
            row.innerHTML = `
                <div class="cart-item-info">
                    <span class="cart-item-code">${escHtml(code)}</span>
                    <span class="cart-item-name">${escHtml(data.name)}</span>
                </div>
                <div class="cart-item-controls">
                    <button class="cart-qty-btn cart-minus" data-code="${code}">−</button>
                    <span class="cart-qty-display">${data.qty}</span>
                    <button class="cart-qty-btn cart-plus" data-code="${code}">+</button>
                    <button class="cart-delete-btn" data-code="${code}" title="削除">&times;</button>
                </div>
            `;

            // Minus button
            row.querySelector('.cart-minus').addEventListener('click', () => {
                const current = (currentCart[code]?.qty || 0);
                updateFromCart(code, data.name, Math.max(0, current - 1));
            });
            // Plus button
            row.querySelector('.cart-plus').addEventListener('click', () => {
                const current = (currentCart[code]?.qty || 0);
                updateFromCart(code, data.name, current + 1);
            });
            // Delete button
            row.querySelector('.cart-delete-btn').addEventListener('click', () => {
                updateFromCart(code, data.name, 0);
            });

            cartSidebarList.appendChild(row);
        });
    };

    // Cart sidebar open/close
    const openCartSidebar = () => {
        if (cartSidebarEl) cartSidebarEl.classList.remove('hidden');
        if (cartOverlay) cartOverlay.classList.remove('hidden');
        renderCartSidebar();
    };
    const closeCartSidebar = () => {
        if (cartSidebarEl) cartSidebarEl.classList.add('hidden');
        if (cartOverlay) cartOverlay.classList.add('hidden');
    };
    if (cartToggleBtn) cartToggleBtn.addEventListener('click', openCartSidebar);
    if (cartCloseBtn) cartCloseBtn.addEventListener('click', closeCartSidebar);
    if (cartOverlay) cartOverlay.addEventListener('click', closeCartSidebar);

    // --- MASTER限定: CODE → 数量の連続入力 ---
    const codeEntryOverlay = document.getElementById('code-entry-overlay');
    const codeEntryModal = document.getElementById('code-entry-modal');
    const codeEntryCloseBtn = document.getElementById('code-entry-close-btn');
    const codeEntryForm = document.getElementById('code-entry-form');
    const codeEntryCode = document.getElementById('code-entry-code');
    const codeEntryQty = document.getElementById('code-entry-qty');
    const codeEntryProduct = document.getElementById('code-entry-product');
    const codeEntryStatus = document.getElementById('code-entry-status');
    const codeEntryRowsEl = document.getElementById('code-entry-rows');
    const codeEntryNextNo = document.getElementById('code-entry-next-no');
    const codeEntryAddBtn = document.getElementById('code-entry-add-btn');
    let resolvedCodeEntryItem = null;
    let codeEntryItemIndex = new Map();
    let codeEntryRows = [];
    let codeEntryRowsOwner = '';
    let codeEntryRowSequence = 0;

    const normalizeCodeEntry = (value) => String(value || '')
        .trim()
        .replace(/^CODE\s*[:：#-]?\s*/i, '')
        .replace(/^'/, '')
        .replace(/[\s　]/g, '');

    const setCodeEntryStatus = (message, isError = false) => {
        if (!codeEntryStatus) return;
        codeEntryStatus.textContent = message;
        codeEntryStatus.classList.toggle('is-error', isError);
    };

    const getCodeEntryCanonicalCode = (item) => String(item && item.code || '')
        .replace(/^'/, '')
        .trim();

    const updateCodeEntryNextNo = () => {
        if (codeEntryNextNo) {
            codeEntryNextNo.textContent = String(codeEntryRows.length + 1).padStart(2, '0');
        }
    };

    const renderCodeEntryRows = () => {
        if (!codeEntryRowsEl) return;
        codeEntryRowsEl.innerHTML = '';

        codeEntryRows.forEach((entry, index) => {
            const row = document.createElement('div');
            row.className = 'code-entry-table-row code-entry-saved-row';
            row.setAttribute('role', 'row');

            const no = document.createElement('span');
            no.className = 'code-entry-no';
            no.setAttribute('role', 'cell');
            no.textContent = String(index + 1).padStart(2, '0');

            const code = document.createElement('span');
            code.className = 'code-entry-saved-code';
            code.setAttribute('role', 'cell');
            code.textContent = entry.code;

            const name = document.createElement('span');
            name.className = 'code-entry-saved-name';
            name.setAttribute('role', 'cell');
            name.textContent = entry.name;

            const qty = document.createElement('input');
            qty.className = 'code-entry-row-qty';
            qty.type = 'number';
            qty.inputMode = 'numeric';
            qty.min = '1';
            qty.max = '999';
            qty.value = String(entry.qty);
            qty.dataset.rowId = String(entry.id);
            qty.setAttribute('aria-label', `${entry.name}の数量`);
            qty.setAttribute('role', 'cell');

            const remove = document.createElement('button');
            remove.className = 'code-entry-row-action code-entry-delete-btn';
            remove.type = 'button';
            remove.dataset.rowId = String(entry.id);
            remove.setAttribute('aria-label', `${entry.name}を削除`);
            remove.title = '削除';
            remove.textContent = '×';

            row.append(no, code, name, qty, remove);
            codeEntryRowsEl.appendChild(row);
        });

        updateCodeEntryNextNo();
    };

    const resetCodeEntryRows = () => {
        codeEntryRows = [];
        codeEntryRowsOwner = '';
        codeEntryRowSequence = 0;
        if (codeEntryCode) codeEntryCode.value = '';
        renderCodeEntryRows();
        clearResolvedCodeEntry();
    };

    const clearResolvedCodeEntry = () => {
        resolvedCodeEntryItem = null;
        if (codeEntryQty) {
            codeEntryQty.value = '1';
            codeEntryQty.disabled = true;
        }
        if (codeEntryProduct) {
            codeEntryProduct.textContent = 'CODEを入力';
            codeEntryProduct.classList.remove('is-resolved');
        }
        if (codeEntryAddBtn) codeEntryAddBtn.disabled = true;
    };

    const resolveCodeEntry = () => {
        const code = normalizeCodeEntry(codeEntryCode && codeEntryCode.value);
        if (!code) {
            clearResolvedCodeEntry();
            setCodeEntryStatus('商品CODEを入力してください。', true);
            if (codeEntryCode) codeEntryCode.focus();
            return false;
        }
        const item = codeEntryItemIndex.get(code);
        if (!item) {
            clearResolvedCodeEntry();
            setCodeEntryStatus(`CODE ${code} は商品マスタにありません。`, true);
            if (codeEntryCode) { codeEntryCode.focus(); codeEntryCode.select(); }
            return false;
        }

        resolvedCodeEntryItem = item;
        const canonicalCode = getCodeEntryCanonicalCode(item);
        if (codeEntryCode) codeEntryCode.value = canonicalCode;
        if (codeEntryProduct) {
            codeEntryProduct.textContent = item.name;
            codeEntryProduct.classList.add('is-resolved');
        }
        if (codeEntryQty) {
            codeEntryQty.disabled = false;
            codeEntryQty.value = '1';
            codeEntryQty.focus();
            codeEntryQty.select();
        }
        if (codeEntryAddBtn) codeEntryAddBtn.disabled = false;
        setCodeEntryStatus('数量を入力してEnter');
        return true;
    };

    const addResolvedCodeEntry = () => {
        if (!resolvedCodeEntryItem && !resolveCodeEntry()) return false;
        const rawQty = parseInt(codeEntryQty && codeEntryQty.value, 10);
        if (!Number.isFinite(rawQty) || rawQty < 1 || rawQty > 999) {
            setCodeEntryStatus('数量は1〜999で入力してください。', true);
            if (codeEntryQty) { codeEntryQty.focus(); codeEntryQty.select(); }
            return false;
        }
        const qty = rawQty;
        const code = getCodeEntryCanonicalCode(resolvedCodeEntryItem);
        const name = resolvedCodeEntryItem.name;
        const existingQty = (currentCart[code] && currentCart[code].qty) || 0;
        updateFromCart(code, name, existingQty + qty);
        codeEntryRows.push({
            id: ++codeEntryRowSequence,
            code,
            name,
            qty
        });
        renderCodeEntryRows();

        if (codeEntryCode) codeEntryCode.value = '';
        clearResolvedCodeEntry();
        setCodeEntryStatus(`${name} × ${qty} を追加しました。`);
        if (codeEntryCode) codeEntryCode.focus();
        return true;
    };

    const openCodeEntryModal = () => {
        if (!isMasterSession || !currentClientName || !codeEntryModal || !codeEntryOverlay) return;
        if (!itemsData.length) {
            alert('商品マスタを読み込み中です。少し待ってからもう一度開いてください。');
            return;
        }
        const owner = `${currentUsername}|${currentClientName}`;
        if (owner !== codeEntryRowsOwner) {
            codeEntryRows = [];
            codeEntryRowSequence = 0;
            codeEntryRowsOwner = owner;
        }

        codeEntryItemIndex = new Map();
        itemsData.forEach((item) => {
            const code = getCodeEntryCanonicalCode(item);
            if (code) codeEntryItemIndex.set(code, item);
        });
        itemsData.forEach((item) => {
            const code = getCodeEntryCanonicalCode(item);
            if (/^\d{6}$/.test(code)) {
                const leadingZeroAlias = `0${code}`;
                if (!codeEntryItemIndex.has(leadingZeroAlias)) {
                    codeEntryItemIndex.set(leadingZeroAlias, item);
                }
            }
        });

        renderCodeEntryRows();
        if (codeEntryCode) codeEntryCode.value = '';
        clearResolvedCodeEntry();
        setCodeEntryStatus('商品CODEを入力してEnter');
        codeEntryModal.classList.remove('hidden');
        codeEntryOverlay.classList.remove('hidden');
        requestAnimationFrame(() => { if (codeEntryCode) codeEntryCode.focus(); });
    };

    const closeCodeEntryModal = () => {
        if (codeEntryModal) codeEntryModal.classList.add('hidden');
        if (codeEntryOverlay) codeEntryOverlay.classList.add('hidden');
        codeEntryItemIndex = new Map();
        clearResolvedCodeEntry();
    };

    if (codeEntryBtn) codeEntryBtn.addEventListener('click', openCodeEntryModal);
    if (codeEntryCloseBtn) codeEntryCloseBtn.addEventListener('click', closeCodeEntryModal);
    if (codeEntryOverlay) codeEntryOverlay.addEventListener('click', closeCodeEntryModal);
    if (codeEntryCode) {
        codeEntryCode.addEventListener('input', () => {
            clearResolvedCodeEntry();
            setCodeEntryStatus('商品CODEを入力してEnter');
        });
        codeEntryCode.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            resolveCodeEntry();
        });
    }
    if (codeEntryQty) {
        codeEntryQty.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            addResolvedCodeEntry();
        });
    }
    if (codeEntryRowsEl) {
        codeEntryRowsEl.addEventListener('keydown', (event) => {
            const input = event.target.closest('.code-entry-row-qty');
            if (!input || event.key !== 'Enter') return;
            event.preventDefault();
            input.blur();
            const qty = parseInt(input.value, 10);
            if (Number.isFinite(qty) && qty >= 1 && qty <= 999 && codeEntryCode) {
                codeEntryCode.focus();
            }
        });

        codeEntryRowsEl.addEventListener('change', (event) => {
            const input = event.target.closest('.code-entry-row-qty');
            if (!input) return;
            const rowId = Number(input.dataset.rowId);
            const entry = codeEntryRows.find((row) => row.id === rowId);
            if (!entry) return;

            const nextQty = parseInt(input.value, 10);
            if (!Number.isFinite(nextQty) || nextQty < 1 || nextQty > 999) {
                input.value = String(entry.qty);
                setCodeEntryStatus('数量は1〜999で入力してください。', true);
                input.focus();
                input.select();
                return;
            }

            const currentQty = (currentCart[entry.code] && currentCart[entry.code].qty) || 0;
            updateFromCart(entry.code, entry.name, Math.max(0, currentQty + nextQty - entry.qty));
            entry.qty = nextQty;
            setCodeEntryStatus(`${entry.name}の数量を${nextQty}に変更しました。`);
        });

        codeEntryRowsEl.addEventListener('click', (event) => {
            const button = event.target.closest('.code-entry-delete-btn');
            if (!button) return;
            const rowId = Number(button.dataset.rowId);
            const rowIndex = codeEntryRows.findIndex((row) => row.id === rowId);
            if (rowIndex < 0) return;

            const [entry] = codeEntryRows.splice(rowIndex, 1);
            const currentQty = (currentCart[entry.code] && currentCart[entry.code].qty) || 0;
            updateFromCart(entry.code, entry.name, Math.max(0, currentQty - entry.qty));
            renderCodeEntryRows();
            setCodeEntryStatus(`${entry.name}を削除しました。`);
            if (codeEntryCode) codeEntryCode.focus();
        });
    }
    if (codeEntryForm) {
        codeEntryForm.addEventListener('submit', (event) => {
            event.preventDefault();
            addResolvedCodeEntry();
        });
    }

    // ============================================================
    // 分類コード発注（MASTER限定）
    //   コード頭4桁で該当商品を一覧 → 各数量を上書きでカート反映。
    //   既存「CODE入力」(code-entry) とは別物。送信は既存「発注する」。
    // ============================================================
    const codeFilterOverlay = document.getElementById('code-filter-overlay');
    const codeFilterModal = document.getElementById('code-filter-modal');
    const codeFilterCloseBtn = document.getElementById('code-filter-close-btn');
    const codeFilterPrefix = document.getElementById('code-filter-prefix');
    const codeFilterStatus = document.getElementById('code-filter-status');
    const codeFilterRowsEl = document.getElementById('code-filter-rows');
    let codeFilterTimeout = null;

    // 全角数字→半角、数字以外を除去
    const normalizeDigits = (value) => String(value || '')
        .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
        .replace(/[^0-9]/g, '');

    const codeFilterCanonical = (item) => String(item && item.code || '')
        .replace(/^'/, '')
        .trim();

    // マッチ用のコード候補：素のcanonicalと、6桁数値なら先頭0補完形の両方。
    //   ItemMasterは6桁保存で先頭0が落ちるため、これを外すと 0704 がヒットしない。
    const codeFilterVariants = (item) => {
        const canonical = codeFilterCanonical(item);
        const variants = [canonical];
        if (/^\d{6}$/.test(canonical)) variants.push('0' + canonical);
        return variants;
    };

    // 表示用コード：6桁数値なら先頭0を補って7桁表示
    const codeFilterDisplay = (item) => {
        const canonical = codeFilterCanonical(item);
        return /^\d{6}$/.test(canonical) ? '0' + canonical : canonical;
    };

    const setCodeFilterStatus = (message, isError = false) => {
        if (!codeFilterStatus) return;
        codeFilterStatus.textContent = message;
        codeFilterStatus.classList.toggle('is-error', isError);
    };

    const renderCodeFilterRows = () => {
        if (!codeFilterRowsEl || !codeFilterPrefix) return;
        const prefix = normalizeDigits(codeFilterPrefix.value).slice(0, 4);
        // 入力欄も正規化後の値に合わせる（全角で打っても半角に）
        if (codeFilterPrefix.value !== prefix) codeFilterPrefix.value = prefix;

        codeFilterRowsEl.innerHTML = '';

        if (prefix.length < 4) {
            setCodeFilterStatus(`コードの頭4桁を入力してください（あと${4 - prefix.length}桁）。`);
            return;
        }

        const matches = itemsData.filter((item) =>
            isValidCode(item.code) &&
            codeFilterVariants(item).some((v) => v.startsWith(prefix))
        );
        matches.sort((a, b) => codeFilterDisplay(a).localeCompare(codeFilterDisplay(b)));

        if (!matches.length) {
            setCodeFilterStatus(`頭4桁「${prefix}」に該当する商品はありません。`, true);
            return;
        }

        setCodeFilterStatus(`${matches.length}件ヒット。数量を入れると即カートに反映されます。`);

        matches.forEach((item) => {
            const cartKey = String(item.code); // カタログ・syncCardQtyと同じキーで合流
            const currentQty = (currentCart[cartKey] && currentCart[cartKey].qty) || 0;

            const row = document.createElement('div');
            row.className = 'code-filter-row';
            row.setAttribute('role', 'listitem');

            const code = document.createElement('span');
            code.className = 'code-filter-code';
            code.textContent = codeFilterDisplay(item);

            const name = document.createElement('span');
            name.className = 'code-filter-name';
            name.textContent = item.name;

            const qty = document.createElement('input');
            qty.className = 'code-filter-qty';
            qty.type = 'number';
            qty.inputMode = 'numeric';
            qty.min = '0';
            qty.max = '999';
            // 0のときは空欄＋placeholderにする（「0」の左に1を打って10になる事故防止）
            qty.value = currentQty > 0 ? String(currentQty) : '';
            qty.placeholder = '0';
            qty.dataset.code = cartKey;
            qty.dataset.name = item.name;

            row.appendChild(code);
            row.appendChild(name);
            row.appendChild(qty);
            codeFilterRowsEl.appendChild(row);
        });
    };

    // 数量変更＝上書きでカート反映（現在値を表示しているので上書きが自然・二重加算しない）
    const applyCodeFilterQty = (input) => {
        if (!input) return;
        const cartKey = input.dataset.code;
        const name = input.dataset.name || '';
        let qty = parseInt(input.value, 10);
        if (!Number.isFinite(qty) || qty < 0) qty = 0;
        if (qty > 999) qty = 999;
        input.value = qty > 0 ? String(qty) : '';
        updateFromCart(cartKey, name, qty); // 絶対値で上書き
    };

    const openCodeFilterModal = () => {
        if (!isMasterSession || !currentClientName || !codeFilterModal || !codeFilterOverlay) return;
        if (!itemsData.length) {
            alert('商品マスタを読み込み中です。少し待ってからもう一度開いてください。');
            return;
        }
        if (codeFilterPrefix) codeFilterPrefix.value = '';
        if (codeFilterRowsEl) codeFilterRowsEl.innerHTML = '';
        setCodeFilterStatus('コードの頭4桁を入力してください。');
        codeFilterModal.classList.remove('hidden');
        codeFilterOverlay.classList.remove('hidden');
        requestAnimationFrame(() => { if (codeFilterPrefix) codeFilterPrefix.focus(); });
    };

    const closeCodeFilterModal = () => {
        if (codeFilterModal) codeFilterModal.classList.add('hidden');
        if (codeFilterOverlay) codeFilterOverlay.classList.add('hidden');
    };

    if (codeFilterBtn) codeFilterBtn.addEventListener('click', openCodeFilterModal);
    if (codeFilterCloseBtn) codeFilterCloseBtn.addEventListener('click', closeCodeFilterModal);
    if (codeFilterOverlay) codeFilterOverlay.addEventListener('click', closeCodeFilterModal);
    if (codeFilterPrefix) {
        codeFilterPrefix.addEventListener('input', () => {
            if (codeFilterTimeout) clearTimeout(codeFilterTimeout);
            codeFilterTimeout = setTimeout(renderCodeFilterRows, 150);
        });
        codeFilterPrefix.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (codeFilterTimeout) clearTimeout(codeFilterTimeout);
            renderCodeFilterRows();
            const firstQty = codeFilterRowsEl && codeFilterRowsEl.querySelector('.code-filter-qty');
            if (firstQty) { firstQty.focus(); firstQty.select(); }
        });
    }
    if (codeFilterRowsEl) {
        // 既存数量があるとき、タップ/クリックで全選択して上書きできるようにする
        codeFilterRowsEl.addEventListener('focusin', (event) => {
            const input = event.target.closest('.code-filter-qty');
            if (input) input.select();
        });
        codeFilterRowsEl.addEventListener('change', (event) => {
            const input = event.target.closest('.code-filter-qty');
            if (input) applyCodeFilterQty(input);
        });
        // Enter/↓＝次の行、↑＝前の行へ移動（type=numberの矢印増減はpreventDefaultで無効化）
        codeFilterRowsEl.addEventListener('keydown', (event) => {
            const input = event.target.closest('.code-filter-qty');
            if (!input) return;
            const step = (event.key === 'Enter' || event.key === 'ArrowDown') ? 1
                : (event.key === 'ArrowUp') ? -1
                : 0;
            if (!step) return;
            event.preventDefault();
            applyCodeFilterQty(input);
            const inputs = [...codeFilterRowsEl.querySelectorAll('.code-filter-qty')];
            const next = inputs[inputs.indexOf(input) + step];
            if (next) { next.focus(); next.select(); }
            else if (event.key === 'Enter') input.blur();
        });
    }

    // --- Save Favorites to Cloud Helper ---
    const saveFavoritesToCloud = () => {
        if (!currentClientName) return;
        
        // 【トリプル・ガード】保存直前に強制クリーンアップ（シングルクォート除去とバリデーションを徹底実行）
        favoriteItems = favoriteItems
            .map(c => String(c).replace(/^'/, ''))
            .filter(c => isValidCode(c));
            
        fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
                action: 'save_favorites',
                token: sessionToken,
                clientName: currentClientName,
                favorites: favoriteItems
            })
        }).catch(e => console.error('Failed to save favorites to cloud', e));
    };

    // Sidebar Action Buttons (v2.10)
    const cartOrderBtn = document.getElementById('cart-order-submit-btn');
    if (cartOrderBtn) {
        cartOrderBtn.addEventListener('click', () => {
            if (isSubmitting) return;
            if (orderSubmitBtn) orderSubmitBtn.click();
            closeCartSidebar();
        });
    }

    // --- Scroll Arrow Event Listeners ---
    const setupScrollArrows = (leftBtnId, rightBtnId, containerId, step = 240) => {
        const leftBtn = document.getElementById(leftBtnId);
        const rightBtn = document.getElementById(rightBtnId);
        const container = document.getElementById(containerId);
        if (!container) return;
        if (leftBtn) leftBtn.addEventListener('click', () => { container.scrollLeft -= step; });
        if (rightBtn) rightBtn.addEventListener('click', () => { container.scrollLeft += step; });
    };
    setupScrollArrows('mfr-arrow-left', 'mfr-arrow-right', 'manufacturer-chips-container');
    setupScrollArrows('cat-arrow-left', 'cat-arrow-right', 'category-chips-container');

    // --- Sync History Favorites (v2.11) ---
    const fetchHistoryFavorites = async () => {
        try {
            const response = await fetch('history_favorites.json');
            if (response.ok) {
                historyFavoritesData = await response.json();
                console.log('History favorites data loaded');
            }
        } catch (e) {
            console.warn('Failed to load history_favorites.json', e);
        }
    };

    const syncHistoryToFavs = () => {
        console.log('[SyncFavs] currentClientName:', currentClientName);
        console.log('[SyncFavs] historyFavoritesData keys:', historyFavoritesData ? Object.keys(historyFavoritesData).slice(0, 5) : null);

        if (!currentClientCode || !historyFavoritesData) {
            showSyncMsg('データが読み込まれていないか、ログイン情報が不正です。', 'error');
            return;
        }

        let historyCodes = historyFavoritesData[currentClientCode] || [];
        
        console.log('[SyncFavs] historyCodes count:', historyCodes ? historyCodes.length : 'NOT FOUND');

        if (!historyCodes || historyCodes.length === 0) {
            showSyncMsg('このサロンの導入履歴データが見つかりません。', 'error');
            return;
        }

        let addedCount = 0;
        let corruptedCount = 0;
        historyCodes.forEach(code => {
            const strCode = String(code).replace(/^'/, '');
            if (isValidCode(strCode)) {
                if (!favoriteItems.includes(strCode)) {
                    favoriteItems.push(strCode);
                    addedCount++;
                }
            } else {
                corruptedCount++;
            }
        });

        if (corruptedCount > 0) {
            console.error(`[SyncFavs] Skipped ${corruptedCount} corrupted items (scientific notation)`);
        }

        if (addedCount > 0) {
            localStorage.setItem(getFavsKey(), JSON.stringify(favoriteItems));
            saveFavoritesToCloud();
            showSyncMsg(`${addedCount}件の商品をお気に入りに追加しました！`, 'success');
            renderItems(itemsData); // Re-render to show stars
        } else {
            showSyncMsg('すべてのお気に入りは既に同期済みです。', 'info');
        }
    };

    /**
     * 🚀 [MASTER ONLY] 全サロン一括同期を実行
     * history_favorites.json を取得し、スプレッドシートの履歴とマージするようバックエンドに依頼
     */
    const triggerGlobalHistorySync = async () => {
        if (!confirm('【管理者設定】全サロンの「導入履歴(JSON)」と「発注履歴(スプレッドシート)」をお気に入りに一括同期しますか？\n\n※この操作は全得意先のデータに影響します。')) {
            return;
        }

        showLoading('全サロン同期を実行中...');
        try {
            // 1. 導入履歴 (JSON) をロード
            const jsonRes = await fetch('history_favorites.json');
            const introHistory = jsonRes.ok ? await jsonRes.json() : null;

            // 2. バックエンドへ送信
            const response = await fetch(CONFIG.API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'sync_all_history_to_favorites',
                    token: sessionToken,
                    extraData: introHistory
                })
            });

            const result = await response.json();
            if (result.status === 'success') {
                alert('同期完了しました！\n' + (result.message || ''));
                location.reload(); // 状態を再初期化
            } else {
                alert('同期に失敗しました: ' + (result.message || '不明なエラー'));
            }
        } catch (e) {
            console.error(e);
            alert('同期エラー: ' + e.toString());
        } finally {
            hideLoading();
        }
    };

    if (globalSyncBtn) {
        globalSyncBtn.addEventListener('click', triggerGlobalHistorySync);
    }

    const showSyncMsg = (text, type) => {
        if (!syncMsgArea) return;
        syncMsgArea.textContent = text;
        syncMsgArea.style.color = type === 'error' ? '#b91c1c' : '#166534';
        syncMsgArea.classList.remove('hidden');
        setTimeout(() => {
            syncMsgArea.classList.add('hidden');
        }, 3000);
    };

    if (syncHistoryFavsBtn) {
        syncHistoryFavsBtn.addEventListener('click', syncHistoryToFavs);
    }

    // --- Render Items ---
    const renderItems = (items) => {
        itemListContainer.innerHTML = ''; // Clear current

        // Filter by current tab selection before rendering
        let displayItems = items.filter(item => isValidCode(item.code));
        
        if (currentFilter === 'favorites') {
            displayItems = displayItems.filter(item => favoriteItems.includes(String(item.code)));
        }

        // Filter by selected manufacturer
        if (currentManufacturerFilter !== 'all') {
            displayItems = displayItems.filter(item => item.manufacturer === currentManufacturerFilter);
        }

        // Filter by selected category
        if (currentCategoryFilter !== 'all') {
            displayItems = displayItems.filter(item => item.category === currentCategoryFilter);
        }

        // --- PERFORMANCE OPTIMIZATION ---
        // Force the user to select both Manufacturer and Category before rendering anything on the 'all' tab.
        // This prevents the browser from crashing when trying to render 10,000+ items at once.
        // EXCEPTION: Allow rendering if the user has typed something in the search bar.
        const isSearchActive = searchInput && searchInput.value.trim() !== '';
        if (currentFilter === 'all' && (currentManufacturerFilter === 'all' || currentCategoryFilter === 'all') && !isSearchActive) {
            itemListContainer.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: #64748b; background: white; border-radius: 12px; margin: 20px 0; border: 1px dashed #cbd5e1;">
                    <span style="font-size: 2.5rem; display: block; margin-bottom: 12px;">👆</span>
                    <p style="font-size: 1.1rem; margin-bottom: 8px; font-weight: bold; color: var(--text-color);">メーカーとカテゴリを選択してください</p>
                    <p style="font-size: 0.9rem; line-height: 1.5;">商品データ量が非常に多いため、<br>絞り込みを行ってから一覧を表示します。<br>※商品名で直接検索することも可能です。</p>
                </div>
            `;
            return;
        }

        if (displayItems.length === 0) {
            itemListContainer.innerHTML = '<p style="text-align: center; padding: 20px; color: #64748b;">該当する商品が見つかりません。</p>';
            return;
        }

        // お気に入りタブ: カラー/パーマのグループ分けは残しつつ、
        // 各グループ内を並び替えセレクタ(currentSort)で並べる
        if (currentFilter === 'favorites') {
            displayItems = sortByCurrent(displayItems);

            // Grouping by Category (Color vs Perm)
            const colorGroup = [];
            const permGroup = [];
            const otherItems = [];

            displayItems.forEach(item => {
                if (isColor(item.category)) colorGroup.push(item);
                else if (isPerm(item.category)) permGroup.push(item);
                else otherItems.push(item);
            });

            // Helper to render accordion
            const renderAccordion = (title, items) => {
                if (items.length === 0) return;
                const section = document.createElement('div');
                section.className = 'brand-section';
                
                const header = document.createElement('div');
                header.className = 'brand-header';
                header.innerHTML = `
                    <div>${title} <span class="brand-count">${items.length}件</span></div>
                    <span class="arrow">▼</span>
                `;
                header.addEventListener('click', () => {
                    section.classList.toggle('expanded');
                });
                section.appendChild(header);

                const content = document.createElement('div');
                content.className = 'brand-content';
                items.forEach(item => {
                    const strCode = String(item.code);
                    const isFav = favoriteItems.includes(strCode);
                    content.appendChild(createItemRow(item, isFav));
                });
                section.appendChild(content);
                itemListContainer.appendChild(section);
            };

            renderAccordion('カラー関連', colorGroup);
            renderAccordion('パーマ関連', permGroup);

            // Render Other items (Flat list)
            otherItems.forEach(item => {
                const strCode = String(item.code);
                const isFav = favoriteItems.includes(strCode);
                itemListContainer.appendChild(createItemRow(item, isFav));
            });
            return;
        }

        // --- 並べ替え（すべてタブ・検索結果に適用。安定ソート）---
        displayItems = sortByCurrent(displayItems);

        // --- Standard List Rendering (All Tab) ---
        // Optimization: Use DocumentFragment for batch appending
        const fragment = document.createDocumentFragment();
        displayItems.forEach(item => {
            const strCode = String(item.code);
            const isFav = favoriteItems.includes(strCode);
            const card = createItemRow(item, isFav);
            fragment.appendChild(card);
        });
        itemListContainer.appendChild(fragment);
    };

    // Helper to create a single item row (refactored for reuse)
    const createItemRow = (item, isFav) => {
        const strCode = String(item.code);
        const card = document.createElement('div');
        card.className = 'item-row';
        card.dataset.code = strCode;
        const currentQty = currentCart[item.code] ? currentCart[item.code].qty : 0;
        // よく頼む商品にはバッジ（このサロンの発注履歴にある品）
        const freq = orderFrequency[strCode.replace(/^'/, '')] || 0;
        const freqBadge = freq > 0
            ? '<span class="freq-badge" style="font-size:0.65rem;background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:8px;padding:1px 6px;margin-left:6px;white-space:nowrap;">🕒よく頼む</span>'
            : '';
        card.innerHTML = `
            <button type="button" class="btn-fav ${isFav ? 'active' : ''}" data-code="${strCode}">${isFav ? '★' : '☆'}</button>
            <div class="item-row-info">
                <span class="item-code">${escHtml(strCode.replace(/^'/, ''))}</span>
                <span class="item-row-name">${escHtml(item.name)}${freqBadge}</span>
            </div>
            <div class="order-controls">
                <button type="button" class="btn-qty minus">-</button>
                <input type="number" class="qty-input" data-code="${item.code}" data-name="${item.name}" value="${currentQty}" min="0">
                <button type="button" class="btn-qty plus">+</button>
            </div>
        `;

        const input = card.querySelector('.qty-input');
        const favBtn = card.querySelector('.btn-fav');

        // Favorite toggle
        favBtn.addEventListener('click', () => {
            if (favoriteItems.includes(strCode)) {
                favoriteItems = favoriteItems.filter(c => c !== strCode);
                favBtn.classList.remove('active');
                favBtn.textContent = '☆';
            } else {
                // 指数表示などの破損データは登録を拒否 (v2.12.1)
                if (!isValidCode(strCode)) {
                    console.error('[Fav] Rejected corrupted code:', strCode);
                    alert('商品コードが不正なため、お気に入りに登録できません。管理者に連絡してください。');
                    return;
                }
                favoriteItems.push(strCode);
                favBtn.classList.add('active');
                favBtn.textContent = '★';
            }
            
            // 保存前に再度クリーンアップを徹底
            favoriteItems = favoriteItems.filter(c => isValidCode(c));
            
            localStorage.setItem(getFavsKey(), JSON.stringify(favoriteItems));
            saveFavoritesToCloud();

            if (currentFilter === 'favorites') {
                renderItems(itemsData);
            }
        });

        const updateCart = (val) => {
            if (val > 0) {
                if (!currentCart[item.code]) {
                    cartOrder.push(String(item.code));
                }
                currentCart[item.code] = { qty: val, name: item.name };
            } else {
                delete currentCart[item.code];
                cartOrder = cartOrder.filter(c => c !== String(item.code));
            }
        };

        card.querySelector('.minus').addEventListener('click', () => {
            let val = parseInt(input.value) || 0;
            if (val > 0) { val -= 1; input.value = val; updateCart(val); calculateTotal(); saveCartToStorage(); }
        });
        card.querySelector('.plus').addEventListener('click', () => {
            let val = parseInt(input.value) || 0;
            val += 1; input.value = val; updateCart(val); calculateTotal(); saveCartToStorage();
        });
        input.addEventListener('change', () => {
            let val = parseInt(input.value) || 0;
            if (val < 0) { val = 0; input.value = 0; }
            updateCart(val);
            calculateTotal();
            saveCartToStorage();
        });

        return card;
    };

    // --- Render History ---
    const renderHistory = (historyData) => {
        historyListContainer.innerHTML = '';

        if (historyData.length === 0) {
            historyListContainer.innerHTML = '<p>発注履歴がありません。</p>';
            appendArchiveSection();
            return;
        }

        // Group history by orderId so multiple orders in the same minute stay separate.
        const groupedHistory = new Map();
        historyData.forEach(hist => {
            const groupKey = String(hist.orderId || hist.date);
            if (!groupedHistory.has(groupKey)) {
                groupedHistory.set(groupKey, []);
            }
            groupedHistory.get(groupKey).push(hist);
        });

        groupedHistory.forEach((items, orderId) => {
            const date = items[0]?.date || '';
            let totalItems = 0;
            let detailsHtml = '';

            items.forEach(item => {
                totalItems += parseInt(item.qty);
                detailsHtml += `<div class="history-item"><span>${escHtml(item.name)}</span><span>${escHtml(item.qty)}点</span></div>`;
            });

            const isCompleted = items.length > 0 && items[0].status === '完了';
            const badgeHtml = isCompleted ? `<span style="font-size: 0.75rem; color: #166534; background: #dcfce7; padding: 2px 8px; border-radius: 12px; margin-left: 8px; font-weight: bold; border: 1px solid #bbf7d0; display: inline-block;">発注済み</span>` : '';

            const card = document.createElement('div');
            card.className = 'history-group-card';

            card.innerHTML = `
                <div class="history-header">
                    <div style="width: 100%;">
                        <div class="history-date" style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">${date}${badgeHtml}</div>
                        <div class="history-summary">計 ${totalItems}点</div>
                    </div>
                    <div class="history-toggle">▼</div>
                </div>
                <div class="history-body hidden">
                    ${detailsHtml}
                    <div class="history-actions">
                        <button class="btn-secondary edit-order-btn ${isCompleted ? 'hidden' : ''}" data-order-id="${orderId}">変更</button>
                        <button class="btn-danger cancel-order-btn ${isCompleted ? 'hidden' : ''}" data-order-id="${orderId}">キャンセル</button>
                    </div>
                </div>
            `;

            // Accordion toggle logic
            const header = card.querySelector('.history-header');
            const body = card.querySelector('.history-body');
            const toggleIcon = card.querySelector('.history-toggle');

            header.addEventListener('click', () => {
                const isHidden = body.classList.contains('hidden');
                if (isHidden) {
                    body.classList.remove('hidden');
                    toggleIcon.textContent = '▲';
                } else {
                    body.classList.add('hidden');
                    toggleIcon.textContent = '▼';
                }
            });

            // Action Buttons
            const editBtn = card.querySelector('.edit-order-btn');
            const cancelBtn = card.querySelector('.cancel-order-btn');

            cancelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('この発注をキャンセルします。よろしいですか？')) {
                    cancelOrder(e.target.dataset.orderId);
                }
            });

            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                startEditingOrder(e.target.dataset.orderId, items);
            });

            historyListContainer.appendChild(card);
        });

        appendArchiveSection();
    };

    // --- Archive History (1ヶ月以上前の履歴。押したときだけ読む) ---
    let archiveNextBefore = null;
    let archiveLoading = false;

    const appendArchiveSection = () => {
        archiveNextBefore = null;

        const section = document.createElement('div');
        section.id = 'archive-history-section';

        const divider = document.createElement('div');
        divider.textContent = '── これより古い履歴はアーカイブから ──';
        divider.style.cssText = 'text-align:center;color:#94a3b8;font-size:0.8rem;margin:16px 0 8px;';

        const container = document.createElement('div');

        const button = document.createElement('button');
        button.className = 'btn-secondary';
        button.style.cssText = 'width:100%;margin-top:6px;';
        button.textContent = '📜 もっと古い履歴を見る（1ヶ月以上前）';
        button.addEventListener('click', () => fetchArchiveHistory(button, container));

        section.appendChild(divider);
        section.appendChild(container);
        section.appendChild(button);
        historyListContainer.appendChild(section);
    };

    const fetchArchiveHistory = async (button, container) => {
        if (archiveLoading) return;
        archiveLoading = true;

        const originalLabel = button.textContent;
        button.textContent = '読み込み中...';
        button.disabled = true;

        try {
            let url = `${CONFIG.API_URL}?action=history_archive&clientName=${encodeURIComponent(currentClientName)}${tokenQuery()}`;
            if (archiveNextBefore) {
                url += `&before=${encodeURIComponent(archiveNextBefore)}`;
            }

            const response = await fetch(url);
            const result = await response.json();

            if (result.status !== 'success') {
                alert('アーカイブの取得に失敗しました: ' + (result.message || ''));
                button.textContent = originalLabel;
                button.disabled = false;
                return;
            }

            if (result.note === 'no_archive') {
                button.textContent = 'アーカイブはまだありません';
                return;
            }

            if ((result.data || []).length > 0) {
                renderArchiveCards(result.data, container);
            } else if (!container.hasChildNodes()) {
                const empty = document.createElement('p');
                empty.textContent = 'アーカイブに履歴はありませんでした。';
                empty.style.cssText = 'color:#94a3b8;text-align:center;';
                container.appendChild(empty);
            }

            archiveNextBefore = result.nextBefore || null;

            if (result.hasMore && archiveNextBefore) {
                button.textContent = '📜 さらに古い履歴を見る';
                button.disabled = false;
            } else {
                button.textContent = 'これより古い履歴はありません';
            }
        } catch (error) {
            console.error(error);
            alert('通信エラーが発生しました。');
            button.textContent = originalLabel;
            button.disabled = false;
        } finally {
            archiveLoading = false;
        }
    };

    const renderArchiveCards = (items, container) => {
        // 通常履歴と同じカード表示。ただし過去分なので変更/キャンセルは無し
        const grouped = new Map();
        items.forEach(hist => {
            const groupKey = String(hist.orderId || hist.date);
            if (!grouped.has(groupKey)) grouped.set(groupKey, []);
            grouped.get(groupKey).push(hist);
        });

        grouped.forEach((groupItems) => {
            const date = groupItems[0]?.date || '';
            let totalItems = 0;
            let detailsHtml = '';

            groupItems.forEach(item => {
                totalItems += parseInt(item.qty) || 0;
                detailsHtml += `<div class="history-item"><span>${escHtml(item.name)}</span><span>${escHtml(item.qty)}点</span></div>`;
            });

            const card = document.createElement('div');
            card.className = 'history-group-card';
            card.innerHTML = `
                <div class="history-header">
                    <div style="width: 100%;">
                        <div class="history-date">${date}</div>
                        <div class="history-summary">計 ${totalItems}点</div>
                    </div>
                    <div class="history-toggle">▼</div>
                </div>
                <div class="history-body hidden">
                    ${detailsHtml}
                </div>
            `;

            const header = card.querySelector('.history-header');
            const body = card.querySelector('.history-body');
            const toggleIcon = card.querySelector('.history-toggle');

            header.addEventListener('click', () => {
                const isHidden = body.classList.contains('hidden');
                body.classList.toggle('hidden');
                toggleIcon.textContent = isHidden ? '▲' : '▼';
            });

            container.appendChild(card);
        });
    };

    // --- Cancel Order ---
    const cancelOrder = async (orderId) => {
        showLoading();
        try {
            const response = await fetch(CONFIG.API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'cancel_order',
                    token: sessionToken,
                    clientName: currentClientName,
                    clientType: currentClientType, // '直送' or ''
                    orderId: orderId
                })
            });
            const result = await response.json();
            if (result.status === 'success') {
                alert('発注をキャンセルしました。');
                fetchHistory(true); // Refresh
            } else {
                alert('失敗しました: ' + result.message);
            }
        } catch (error) {
            console.error(error);
            alert('通信エラーが発生しました。');
        } finally {
            hideLoading();
        }
    };

    // --- Custom Item Logic (Dynamic) ---
    const renderCustomItemsFromCart = () => {
        if (!customItemsList) return;
        customItemsList.innerHTML = '';
        Object.keys(currentCart).forEach(code => {
            if (code.startsWith('CUSTOM_ITEM')) {
                addCustomItemUI(code, currentCart[code].name, currentCart[code].qty);
            }
        });
    };

    const addCustomItemUI = (code = null, initialName = '', initialQty = 0) => {
        if (!customItemsList) return;
        const itemCode = code || `CUSTOM_ITEM_${Date.now()}`;

        const card = document.createElement('div');
        card.className = 'item-card custom-item-card';
        card.style.marginBottom = '12px';
        card.innerHTML = `
            <div class="item-info" style="width: 100%;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span class="item-code" style="color: var(--primary-color); font-weight: bold;">+ 特注・その他の商品</span>
                    <button type="button" class="btn-remove-custom" style="background: none; border: none; font-size: 1.2rem; cursor: pointer; color: #94a3b8;">×</button>
                </div>
                <input type="text" class="custom-name-input" placeholder="商品名や規格を入力してください..." value="${initialName === '（商品名未入力）' ? '' : escHtml(initialName)}"
                       style="width: 100%; margin-top: 8px; padding: 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
            </div>
            <div class="order-controls" style="margin-top: 12px; justify-content: flex-end; width: 100%;">
                <button type="button" class="btn-qty minus">-</button>
                <input type="number" class="qty-input custom-qty-input" data-code="${itemCode}" value="${initialQty}" min="0">
                <button type="button" class="btn-qty plus">+</button>
            </div>
        `;

        const nameInput = card.querySelector('.custom-name-input');
        const qtyInput = card.querySelector('.custom-qty-input');
        const minusBtn = card.querySelector('.minus');
        const plusBtn = card.querySelector('.plus');
        const removeBtn = card.querySelector('.btn-remove-custom');

        const updateCart = (val) => {
            if (val > 0) {
                const customName = nameInput.value.trim() || '（商品名未入力）';
                if (!currentCart[itemCode]) {
                    cartOrder.push(itemCode);
                }
                currentCart[itemCode] = { qty: val, name: customName };
            } else {
                delete currentCart[itemCode];
                cartOrder = cartOrder.filter(c => c !== itemCode);
            }
        };

        nameInput.addEventListener('input', () => {
            const val = parseInt(qtyInput.value) || 0;
            if (val > 0) updateCart(val);
        });

        minusBtn.addEventListener('click', () => {
            let val = parseInt(qtyInput.value) || 0;
            if (val > 0) { val -= 1; qtyInput.value = val; updateCart(val); calculateTotal(); saveCartToStorage(); }
        });

        plusBtn.addEventListener('click', () => {
            if (!nameInput.value.trim()) {
                alert('先に特注商品の「商品名や規格」を入力してください。');
                return;
            }
            let val = parseInt(qtyInput.value) || 0;
            val += 1; qtyInput.value = val; updateCart(val); calculateTotal(); saveCartToStorage();
        });

        qtyInput.addEventListener('change', () => {
            let val = parseInt(qtyInput.value) || 0;
            if (val < 0) val = 0;
            if (val > 0 && !nameInput.value.trim()) {
                alert('先に特注商品の「商品名や規格」を入力してください。');
                val = 0;
            }
            qtyInput.value = val;
            updateCart(val);
            calculateTotal();
            saveCartToStorage();
        });

        removeBtn.addEventListener('click', () => {
            if (confirm('この特注商品を削除しますか？')) {
                delete currentCart[itemCode];
                cartOrder = cartOrder.filter(c => c !== itemCode);
                card.remove();
                calculateTotal();
                saveCartToStorage();
            }
        });

        customItemsList.appendChild(card);
        // Focus the name input if it's a new empty item
        if (!code) {
            nameInput.focus();
        }
    };

    if (addCustomItemBtn) {
        addCustomItemBtn.addEventListener('click', () => {
            addCustomItemUI();
        });
    }

    const addCustomItemBtnTop = document.getElementById('add-custom-item-btn-top');
    if (addCustomItemBtnTop) {
        addCustomItemBtnTop.addEventListener('click', () => {
            addCustomItemUI();
            const wrapper = document.getElementById('custom-items-wrapper');
            if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }

    // --- Start Editing Order ---
    const startEditingOrder = (orderId, items) => {
        editingOrderId = orderId;
        resetCodeEntryRows();
        currentCart = {}; // Reset cart for editing
        cartOrder = []; // Reset cart order

        // Restore quantities from the history items into cart
        items.forEach(item => {
            if (!currentCart[item.code]) {
                cartOrder.push(String(item.code));
            }
            
            // Extract assignedTo from item.clientName
            let assignedTo = '業務';
            const clientNameStr = item.clientName || '';
            if (clientNameStr === currentClientName + ' 店販') {
                assignedTo = '店販';
            } else if (clientNameStr !== currentClientName && clientNameStr.startsWith(currentClientName + ' ') && clientNameStr.endsWith('様')) {
                // e.g. "SalonA 山田様"
                let namePart = clientNameStr.replace(currentClientName + ' ', '');
                namePart = namePart.substring(0, namePart.length - 1); // remove "様"
                assignedTo = 'staff_' + namePart;
            }

            currentCart[item.code] = { qty: parseInt(item.qty), name: item.name, assignedTo: assignedTo };
        });

        // Switch back to 'all' tab first so the items are rendered
        switchTab('tab-all');
        window.scrollTo(0, 0);

        calculateTotal();

        // Update UI for Edit Mode
        if (orderSubmitBtn) orderSubmitBtn.textContent = '変更を保存する';
        if (cancelEditBtn) cancelEditBtn.classList.remove('hidden');
    };

    // --- Cancel Edit Mode ---
    if (cancelEditBtn) {
        cancelEditBtn.addEventListener('click', () => {
            resetEditMode();
        });
    }

    const resetEditMode = () => {
        editingOrderId = null;
        resetCodeEntryRows();
        currentCart = {};
        cartOrder = [];
        restoreCartFromStorage(); // Restore draft cart (no-op if cleared by successful submit)
        if (orderSubmitBtn) orderSubmitBtn.textContent = '発注する';
        if (cancelEditBtn) cancelEditBtn.classList.add('hidden');
        if (customItemsList) customItemsList.innerHTML = '';
        calculateTotal();
        if (searchInput) searchInput.value = '';
        renderItems(itemsData);
    };


    // --- Fetch History from API ---
    // Optimization: Implement Caching in LocalStorage
    // 履歴APIの同時リクエスト合流: 履歴タブと「よく頼む順」の読み込みが
    // 同時に走っても、重いGAS呼び出しは1本にまとめる
    let historyRequestPromise = null;
    let historyRequestKey = '';
    const requestHistoryData = () => {
        const key = currentClientName;
        if (historyRequestPromise && historyRequestKey === key) {
            return historyRequestPromise;
        }
        historyRequestKey = key;
        historyRequestPromise = (async () => {
            try {
                const url = `${CONFIG.API_URL}?action=history&clientName=${encodeURIComponent(key)}${tokenQuery()}`;
                const response = await fetch(url);
                const result = await response.json();
                if (result.status !== 'success') {
                    throw new Error(result.message || '履歴の取得に失敗しました');
                }
                localStorage.setItem(`b2b_history_${key}`, JSON.stringify(result.data));
                localStorage.setItem(`b2b_history_${key}_ts`, Date.now().toString());
                return result.data;
            } finally {
                historyRequestPromise = null;
            }
        })();
        return historyRequestPromise;
    };

    const fetchHistory = async (forceRefresh = false) => {
        // 未ログイン等でサロン名が無いまま呼ばれたら通信しない
        // （GAS側で "clientName parameter is required" エラーになるため）
        if (!currentClientName) return;

        // 1. Check Cache first
        const cacheKey = `b2b_history_${currentClientName}`;
        const cachedHistory = localStorage.getItem(cacheKey);
        const cachedTs = localStorage.getItem(cacheKey + '_ts');
        const now = Date.now();
        const CACHE_LIFE = 10 * 60 * 1000; // 10 minutes cache for history

        if (!forceRefresh && cachedHistory && cachedTs && (now - parseInt(cachedTs) < CACHE_LIFE)) {
            console.log('Using cached history');
            renderHistory(JSON.parse(cachedHistory));
            return;
        }

        showLoading('履歴を読み込み中...');
        try {
            const data = await requestHistoryData();
            renderHistory(data);
        } catch (error) {
            console.error(error);
            alert('履歴の取得に失敗しました: ' + (error && error.message ? error.message : '通信エラー'));
        } finally {
            hideLoading();
        }
    };

    // --- 並べ替え用: 発注履歴から頻度と最終発注日のマップを作る ---
    const buildOrderFrequency = (historyData) => {
        const freq = {};
        const last = {};
        (historyData || []).forEach(h => {
            const code = String(h.code || '').replace(/^'/, '').trim();
            if (!code) return;
            freq[code] = (freq[code] || 0) + 1;
            const t = Number(h.orderId) || 0;
            if (t > (last[code] || 0)) last[code] = t;
        });
        orderFrequency = freq;
        lastOrderDate = last;
    };

    const loadOrderFrequency = async () => {
        orderFrequency = {}; // サロン切替時に前のサロンの頻度を持ち越さない
        if (!currentClientName) return;

        const cacheKey = `b2b_history_${currentClientName}`;
        // 履歴タブ用のキャッシュがあれば流用（10分・fetchHistoryと共通）
        try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                buildOrderFrequency(JSON.parse(cached));
                if (itemsData.length) renderItems(itemsData);
                return;
            }
        } catch (e) { /* パース失敗は無視 */ }

        try {
            // fetchHistoryと同じ合流リクエストを使う（キャッシュ書き込みも共通）
            const data = await requestHistoryData();
            buildOrderFrequency(data);
            if (itemsData.length) renderItems(itemsData);
        } catch (e) { /* 頻度が取れなくても通常動作 */ }
    };

    // --- 現在の選択(currentSort)で商品配列を並べ替える共通関数 ---
    const sortByCurrent = (items) => {
        const codeOf = (it) => String(it.code).replace(/^'/, '');
        if (currentSort === 'code') {
            // 商品コード順（数値として比較。桁数違い・先頭0でも自然な順になる）
            return items.slice().sort((a, b) =>
                codeOf(a).localeCompare(codeOf(b), 'ja', { numeric: true }));
        }
        if (currentSort === 'aiueo') {
            return items.slice().sort((a, b) =>
                String(a.name || '').localeCompare(String(b.name || ''), 'ja'));
        }
        if (currentSort === 'lastdate') {
            return items.slice().sort((a, b) =>
                (lastOrderDate[codeOf(b)] || 0) - (lastOrderDate[codeOf(a)] || 0));
        }
        // frequency（よく頼む順・既定）
        if (Object.keys(orderFrequency).length > 0) {
            return items.slice().sort((a, b) =>
                (orderFrequency[codeOf(b)] || 0) - (orderFrequency[codeOf(a)] || 0));
        }
        return items;
    };

    // --- 並べ替えセレクタの配線 ---
    const sortSelect = document.getElementById('sort-select');
    const sortWrapper = document.getElementById('sort-wrapper');
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            currentSort = e.target.value;
            if (itemsData.length) renderItems(itemsData);
        });
    }

    // --- Tab Filtering ---
    const switchTab = (tabId) => {
        // Reset all
        tabAll.classList.remove('active');
        tabFavorites.classList.remove('active');
        tabHistory.classList.remove('active');

        document.getElementById(tabId).classList.add('active');

        const customBtnTop = document.getElementById('add-custom-item-btn-top');

        if (tabId === 'tab-history') {
            itemListContainer.classList.add('hidden');
            searchWrapper.classList.add('hidden');
            cartSummary.classList.add('hidden');
            if (syncFavsWrapper) syncFavsWrapper.classList.add('hidden');
            if (customItemsWrapper) customItemsWrapper.classList.add('hidden');
            if (customBtnTop) customBtnTop.classList.add('hidden');
            if (sortWrapper) sortWrapper.classList.add('hidden');
            historyListContainer.classList.remove('hidden');
            fetchHistory(false); // Try cache first
        } else {
            itemListContainer.classList.remove('hidden');
            searchWrapper.classList.remove('hidden');
            cartSummary.classList.remove('hidden');
            // 並べ替えは「すべて」「お気に入り」両タブで表示（履歴タブは非表示）
            if (sortWrapper) sortWrapper.classList.remove('hidden');

            // Sync Favorite Button visibility
            if (syncFavsWrapper) {
                if (tabId === 'tab-favorites') {
                    syncFavsWrapper.classList.remove('hidden');
                } else {
                    syncFavsWrapper.classList.add('hidden');
                }
            }

            if (customItemsWrapper) customItemsWrapper.classList.remove('hidden');
            if (customBtnTop) customBtnTop.classList.remove('hidden');
            historyListContainer.classList.add('hidden');

            // Re-render items based on all/favs
            currentFilter = tabId === 'tab-favorites' ? 'favorites' : 'all';
            currentManufacturerFilter = 'all';
            currentCategoryFilter = 'all';
            searchInput.value = ''; // Reset search focus
            renderManufacturerChips();
            renderCategoryChips();
            renderItems(itemsData);
        }
    };

    if (tabAll) tabAll.addEventListener('click', () => switchTab('tab-all'));
    if (tabFavorites) tabFavorites.addEventListener('click', () => switchTab('tab-favorites'));
    if (tabHistory) tabHistory.addEventListener('click', () => switchTab('tab-history'));

    // --- Search Logic ---
    searchInput.addEventListener('input', (e) => {
        const rawSearch = e.target.value;

        // Clear existing timeout (Debounce)
        if (searchTimeout) clearTimeout(searchTimeout);
        
        // Add visual feedback (searching)
        if (searchWrapper) searchWrapper.classList.add('searching');

        searchTimeout = setTimeout(() => {
            if (rawSearch.trim() === '') {
                renderItems(itemsData);
            } else {
                // Split by space for AND search
                const searchTokens = rawSearch.trim().split(/[\s　]+/);

                const filteredItems = itemsData.filter(item => {
                    // Use pre-normalized search key for performance
                    const searchableText = item._searchKey || (item.name + item.code).toLowerCase();

                    // Return true only if ALL tokens are found (AND search)
                    return searchTokens.every(token => {
                        const normalizedToken = normalizeForSearch(token);
                        if (!normalizedToken) return true;
                        return searchableText.includes(normalizedToken);
                    });
                });
                renderItems(filteredItems);
            }
            calculateTotal();
            if (searchWrapper) searchWrapper.classList.remove('searching');
        }, 300); // 300ms delay
    });

    // --- Render Manufacturer Chips ---
    const renderManufacturerChips = () => {
        if (!manufacturerChipsContainer) return;
        manufacturerChipsContainer.innerHTML = '';

        // Extract unique manufacturers from current data
        const manufacturers = [...new Set(itemsData.map(item => item.manufacturer))].filter(Boolean);
        if (manufacturers.length === 0) {
            manufacturerChipsContainer.style.display = 'none';
            return;
        }
        manufacturerChipsContainer.style.display = 'flex';

        // Add "All" Manufacturer chip
        const allChip = document.createElement('div');
        allChip.className = `manufacturer-chip ${currentManufacturerFilter === 'all' ? 'active' : ''}`;
        allChip.textContent = 'すべてのメーカー';
        allChip.addEventListener('click', () => {
            currentManufacturerFilter = 'all';
            currentCategoryFilter = 'all'; // Reset category when switching manufacturer
            renderManufacturerChips();
            renderCategoryChips();
            if (searchInput) searchInput.value = '';
            renderItems(itemsData);
        });
        manufacturerChipsContainer.appendChild(allChip);

        manufacturers.forEach(m => {
            const chip = document.createElement('div');
            chip.className = `manufacturer-chip ${currentManufacturerFilter === m ? 'active' : ''}`;
            chip.textContent = m;
            chip.addEventListener('click', () => {
                currentManufacturerFilter = m;
                currentCategoryFilter = 'all'; // Reset category when switching manufacturer
                renderManufacturerChips();
                renderCategoryChips();
                if (searchInput) searchInput.value = '';
                renderItems(itemsData);
            });
            manufacturerChipsContainer.appendChild(chip);
        });
    };

    // --- Render Category Chips ---
    const renderCategoryChips = () => {
        if (!categoryChipsContainer) return;
        categoryChipsContainer.innerHTML = '';

        // Filter items by current manufacturer before extracting categories
        const filteredByManufacturer = currentManufacturerFilter === 'all'
            ? itemsData
            : itemsData.filter(item => item.manufacturer === currentManufacturerFilter);

        // Extract unique categories (filter out empty strings)
        const categories = [...new Set(filteredByManufacturer.map(item => item.category))].filter(Boolean);
        if (categories.length === 0) return; // Hide chips if no categories exist

        // Add "All" chip
        const allChip = document.createElement('div');
        allChip.className = `category-chip ${currentCategoryFilter === 'all' ? 'active' : ''}`;
        allChip.textContent = 'すべて';
        allChip.addEventListener('click', () => {
            currentCategoryFilter = 'all';
            renderCategoryChips(); // Re-render chips to update active state
            if (searchInput) searchInput.value = ''; // Reset search focus
            renderItems(itemsData);
        });
        categoryChipsContainer.appendChild(allChip);

        categories.forEach(category => {
            const chip = document.createElement('div');
            chip.className = `category-chip ${currentCategoryFilter === category ? 'active' : ''}`;
            chip.textContent = category;
            chip.addEventListener('click', () => {
                currentCategoryFilter = category;
                renderCategoryChips();
                if (searchInput) searchInput.value = '';
                renderItems(itemsData);
            });
            categoryChipsContainer.appendChild(chip);
        });
    };

    // --- Fetch Items from API ---
    const fetchItems = async (forceFetch = false, customLoadingMsg = null) => {
        if (!currentUsername) return;

        let needsFetch = forceFetch;
        let loadingMsg = forceFetch ? '最新データを取得中...' : 'サーバーに接続中...';
        if (customLoadingMsg) loadingMsg = customLoadingMsg;

        const cachedData = localStorage.getItem('b2b_items_cache');
        const cachedTs = localStorage.getItem('b2b_items_ts');
        const now = Date.now();

        if (!needsFetch) {
            if (cachedData && cachedTs && (now - parseInt(cachedTs) < CACHE_DURATION)) {
                let parsedOk = false;
                try {
                    // 自動ログインの猶予中に事前parse済みならそれを流用
                    if (!(itemsPreparsedFromCache && itemsData.length)) {
                        itemsData = JSON.parse(cachedData);
                    }
                    parsedOk = true;
                } catch (e) {
                    console.error('Failed to parse cache:', e);
                    needsFetch = true;
                }

                if (parsedOk) {
                    // キャッシュを即描画。バージョンチェックは裏に回す（無表示待ちをなくす）
                    console.log('Using cached item data (valid for 24h)');
                    setTimeout(() => {
                        renderManufacturerChips();
                        renderCategoryChips();
                        renderItems(itemsData);
                        if (announcementBanner) announcementBanner.classList.remove('hidden');
                    }, 0);

                    // --- 1時間スロットリング付きバージョンチェック（非ブロッキング） ---
                    const lastVersionCheck = parseInt(localStorage.getItem('b2b_last_version_check') || '0');
                    if (now - lastVersionCheck > 60 * 60 * 1000) { // 1時間以上経過
                        (async () => {
                            try {
                                console.log('[Version Check] Throttled check running...');
                                const versionRes = await fetch(`${CONFIG.API_URL}?action=version`);
                                const versionData = await versionRes.json();
                                localStorage.setItem('b2b_last_version_check', now.toString());

                                if (versionData.status === 'success' && versionData.dataVersion) {
                                    const localVersion = localStorage.getItem('b2b_data_version');
                                    if (localVersion !== versionData.dataVersion) {
                                        console.log(`[Version Check] Data version changed: ${localVersion} -> ${versionData.dataVersion}. Forcing refresh.`);
                                        // ここではキャッシュを消さず、fetch終了後に上書きする（ホワイトアウト対策）
                                        await fetchItems(true, '最新の商品マスタに更新しています...');
                                        // 裏差し替えで数量入力が初期化されるためカートから復元
                                        Object.entries(currentCart).forEach(([code, data]) => syncCardQty(code, data.qty));
                                    }
                                }
                            } catch (e) {
                                console.warn('Version check failed, ignoring:', e);
                            }
                        })();
                    }
                    return;
                }
            } else {
                needsFetch = true;
            }
        }

        showLoading(loadingMsg);
        try {
            const url = `${CONFIG.API_URL}?action=items`;
            const response = await fetch(url);

            showLoading('データを解析中 (11,000件)...');
            await new Promise(resolve => setTimeout(resolve, 50));

            const result = await response.json();

            if (result.status === 'success') {
                showLoading('画面を構築中...');
                await new Promise(resolve => setTimeout(resolve, 10));

                itemsData = result.data.map(item => {
                    const cleanCode = String(item.code).replace(/^'/, '');
                    return {
                        ...item,
                        code: cleanCode,
                        _searchKey: normalizeForSearch(item.name + cleanCode),
                        _isColor: isColor(item.category),
                        _isPerm: isPerm(item.category)
                    };
                });

                // Save to cache (Atomic Update)
                localStorage.setItem('b2b_items_cache', JSON.stringify(itemsData));
                localStorage.setItem('b2b_items_ts', Date.now().toString());
                if (result.dataVersion) {
                    localStorage.setItem('b2b_data_version', result.dataVersion);
                    localStorage.setItem('b2b_last_version_check', Date.now().toString());
                }

                renderManufacturerChips();
                renderCategoryChips();
                // Avoid rendering huge list immediately on login
                if (currentFilter === 'all' && (currentManufacturerFilter === 'all' || currentCategoryFilter === 'all')) {
                    renderItems(itemsData); // This will show the "Please select filters" message
                } else {
                    renderItems(itemsData);
                }

                if (announcementBanner) {
                    announcementBanner.classList.remove('hidden');
                }
                if (forceFetch) console.log('Manual refresh complete. Cache updated.');
            } else {
                alert('商品データの取得に失敗しました: ' + result.message);
            }
        } catch (error) {
            console.error(error);
            alert('通信エラーが発生しました。');
        } finally {
            hideLoading();
        }
    };

    if (refreshItemsBtn) {
        refreshItemsBtn.addEventListener('click', () => fetchItems(true));
    }

    // --- Login Helper ---
    // cloudFavorites: ログインレスポンス同梱のお気に入り（新GASのみ）。配列ならGET往復を省略できる
    const processLoginSuccess = async (announcement, isMaintenance, maintenanceMessage, dataVersion = null, cloudFavorites = null) => {
        loggedUnknownJans.clear(); // サロン切替時に未登録JANの送信済みSetをリセット
        // PWA: インストール案内バナーはログイン画面だけに出す
        // （注文画面のカートボタンに重ならないよう、ログイン後は消す）
        const _installHint = document.getElementById('install-hint');
        if (_installHint) _installHint.remove();
        if (clientNameDisplay) {
            const typeLabel = currentClientType === '直送' ? ' [直送]' : '';
            clientNameDisplay.textContent = currentClientName + ' 様' + typeLabel;
        }

        // Announcement banner control
        if (announcementBanner && document.getElementById('announcement-text')) {
            if (announcement) {
                document.getElementById('announcement-text').textContent = announcement;
                announcementBanner.classList.remove('hidden');
            } else {
                announcementBanner.classList.add('hidden');
            }
        }

        // Maintenance mode control
        if (isMaintenance) {
            loginContainer.classList.add('hidden');
            const maintenanceContainer = document.getElementById('maintenance-container');
            const maintenanceMsgEl = document.getElementById('maintenance-message');
            if (maintenanceContainer) {
                if (maintenanceMsgEl && maintenanceMessage) {
                    maintenanceMsgEl.innerHTML = escHtml(maintenanceMessage).replace(/\n/g, '<br>');
                }
                maintenanceContainer.classList.remove('hidden');
            }
            hideLoading();
            return;
        }

        // Load favorites: ローカルを即読みして先に進み、クラウドは裏で取得（届いたら★を差し替え）
        try {
            const savedFavs = localStorage.getItem(getFavsKey());
            favoriteItems = savedFavs ? JSON.parse(savedFavs).filter(code => isValidCode(code)) : [];
        } catch (e) {
            favoriteItems = [];
        }
        // ログインレスポンスにfavoritesが同梱されていればGET往復を省略（新GASのみ）。
        // 空配列＝クラウド未登録は従来のGET応答が空の時と同じ扱い（ローカルを維持）
        if (Array.isArray(cloudFavorites)) {
            if (cloudFavorites.length > 0) {
                favoriteItems = cloudFavorites
                    .map(code => String(code).replace(/^'/, ''))
                    .filter(code => isValidCode(code));
                localStorage.setItem(getFavsKey(), JSON.stringify(favoriteItems));
                console.log('Loaded favorites from login response');
            }
        } else {
            const favClientName = currentClientName;
            (async () => {
                if (!favClientName) return; // 名前なしでGETするとGAS側でエラーになる
                try {
                    const favRes = await fetch(`${CONFIG.API_URL}?action=get_favorites&clientName=${encodeURIComponent(favClientName)}${tokenQuery()}`);
                    const favData = await favRes.json();
                    if (favClientName !== currentClientName) return; // 取得中にサロン切替済みなら破棄
                    if (favData.status === 'success' && favData.data && favData.data.length > 0) {
                        // 有効なコードのみを抽出（指数表示などの破損データを除去し、シングルクォートも剥がす）
                        favoriteItems = favData.data
                            .map(code => String(code).replace(/^'/, ''))
                            .filter(code => isValidCode(code));
                        localStorage.setItem(getFavsKey(), JSON.stringify(favoriteItems));
                        if (itemsData.length) renderItems(itemsData); // ★を再描画
                        console.log('Loaded favorites from cloud (and filtered corrupted items)');
                    }
                } catch (e) {
                    console.warn('Failed to load favorites from cloud, keeping local', e);
                }
            })();
        }

        // よく頼む順: このサロンの発注頻度を裏で読み込む（非同期・非ブロッキング）
        loadOrderFrequency();

        // Switch screen
        loginContainer.classList.add('hidden');
        orderContainer.classList.remove('hidden');

        // 管理者ボタンの表示制御
        if (globalSyncBtn) {
            // 普通のサロン入室時に管理者ボタンを隠すが、masterログイン時のみの挙動を担保
            if (currentClientType !== 'MASTER') {
                globalSyncBtn.classList.add('hidden');
                console.log('[DEBUG] Not Master, hiding GlobalSyncBtn');
            }
        }

        // 管理機能（MASTERログインでサロンに入室したときだけ表示）
        if (masterReturnBtn) {
            masterReturnBtn.classList.toggle('hidden', !isMasterSession);
        }
        if (codeEntryBtn) {
            codeEntryBtn.classList.toggle('hidden', !isMasterSession);
        }
        if (codeFilterBtn) {
            codeFilterBtn.classList.toggle('hidden', !isMasterSession);
        }
        if (importModeBtn) {
            importModeBtn.classList.toggle('hidden', !ENABLE_IMPORT_MODE || !isMasterSession);
        }
        if (lineImportBtn) {
            lineImportBtn.classList.toggle('hidden', !ENABLE_LINE_TEXT_IMPORT || !isMasterSession);
        }
        if (sheetImageImportBtn) {
            sheetImageImportBtn.classList.toggle('hidden', !ENABLE_SHEET_IMAGE_IMPORT || !isMasterSession);
        }
        if (printSheetBtn) {
            printSheetBtn.classList.toggle('hidden', !isMasterSession);
        }
        if (directShipBtn) {
            directShipBtn.classList.toggle('hidden', !isMasterSession);
            renderDirectShipBtn();
        }
        // 一括取り込みのドラフトがあれば自動でプレビューを開く
        if (isMasterSession) {
            setTimeout(() => maybeOpenImportDraft(), 900);
        }

        // Version Check Logic
        let forceFetchVersion = false;
        if (dataVersion) {
            const currentLocalVersion = localStorage.getItem('b2b_data_version');
            if (currentLocalVersion && currentLocalVersion !== dataVersion) {
                console.log(`[Version Check] Master version updated (${currentLocalVersion} -> ${dataVersion}). Forcing cache clear.`);
                forceFetchVersion = true;
            }
            // バージョン保存は fetchItems 側で成功時にアトミックに行うか、ここで先行して行うか
            // 今回はfetchItemsで確実に行うので、とりあえずフラグだけ立てる
        }

        // --- ANTI-FREEZE: Delay fetchItems slightly ---
        console.log(`[DEBUG] Login successful for ${currentClientName}, starting data fetch...`);
        const restoredCount = restoreCartFromStorage();
        setTimeout(() => {
            fetchItems(forceFetchVersion, forceFetchVersion ? '最新の商品マスタに更新しています...' : null)
                .then(() => {
                    // Sync restored cart quantities to product list inputs after render
                    Object.entries(currentCart).forEach(([code, data]) => syncCardQty(code, data.qty));
                    calculateTotal();
                    if (restoredCount > 0) showCartRestoredBanner(restoredCount);
                });
            switchTab('tab-all');
        }, 50);
        hideLoading();
    };

    // --- Login成功時の共通処理 ---
    // フォームログインとトークン自動ログインの両方から呼ばれる。
    // マスター/グループはサロン選択画面へ、通常サロンは発注画面へ。
    async function processLoginResult(result, username) {
        currentUsername = username;
        sessionToken = result.sessionToken || '';

        // PWA: 全アカウント共通で次回の自動ログイン情報を保存する。
        // 以前は通常サロン分岐にだけ置いていたため、社員用のマスター／
        // グループはここより下でreturnし、毎回ID/PWが必要になっていた。
        const resumeName = (result.clientName || '').trim();
        autoLoginInProgress = false;
        saveResumeSession(username, resumeName);

        // --- Master / Group Account Logic ---
        isMasterSession = !!result.isMaster;
        if (result.isMaster || result.isGroup) {
            currentClientType = result.isMaster ? 'MASTER' : 'GROUP';
            console.log(`[DEBUG] ${result.isMaster ? 'Master' : 'Group'} Account detected`);
            masterAllClients = result.allClients || [];
            const selectEl = document.getElementById('master-salon-select');
            if (selectEl) {
                selectEl.innerHTML = '';
                masterAllClients.forEach(c => {
                    const option = document.createElement('option');
                    option.value = JSON.stringify(c);
                    const typeLabel = c.type === '直送' ? ' [直送]' : '';
                    option.textContent = c.name + typeLabel;
                    selectEl.appendChild(option);
                });
                // サロン検索の初期表示（全件）。検索欄はクリア。
                if (masterSalonSearch) masterSalonSearch.value = '';
                renderMasterSalonList('');
                loginForm.classList.add('hidden');
                document.getElementById('master-salon-selector').classList.remove('hidden');

                if (globalSyncBtn) {
                    if (result.isMaster) {
                        console.log('[DEBUG] Showing GlobalSyncBtn for Master');
                        globalSyncBtn.classList.remove('hidden');
                    } else {
                        globalSyncBtn.classList.add('hidden');
                    }
                }
                // 一括取り込みボタン（MASTERのみ）
                const batchBtnEl = document.getElementById('batch-import-btn');
                if (batchBtnEl) batchBtnEl.classList.toggle('hidden', !ENABLE_IMPORT_MODE || !result.isMaster);

                // Save these temporarily to pass to the processLoginSuccess later
                selectEl.dataset.announcement = result.announcement || '';
                selectEl.dataset.isMaintenance = result.isMaintenance || false;
                selectEl.dataset.maintenanceMessage = result.maintenanceMessage || '';
                selectEl.dataset.dataVersion = result.dataVersion || '';
            }
            hideLoading();
            return;
        }

        currentClientName = (result.clientName || '').trim();
        currentClientCode = String(result.clientCode || '').trim();
        currentClientType = result.clientType || ''; // '直送' or ''
        registeredClientType = currentClientType;

        await processLoginSuccess(result.announcement, result.isMaintenance, result.maintenanceMessage, result.dataVersion, result.favorites);
    }

    // --- Login (API) ---
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        // IDはtrimする。iOSの予測変換は確定時に末尾スペースを入れることがあり、
        // 見た目が同じなのに弾かれる。パスワードは触らない（前後に空白を含む
        // パスワードが登録されていた場合、既存の人を締め出してしまうため）。
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        if (!username || !password) return;

        showLoading();
        try {
            const response = await fetch(CONFIG.API_URL, {
                method: 'POST',
                // Using text/plain prevents CORS preflight issues with GAS
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                redirect: 'follow', // GAS requires following redirects for POST responses
                body: JSON.stringify({
                    action: 'login',
                    username: username,
                    password: password
                })
            });

            const result = await response.json();

            if (result.status === 'success') {
                console.log('[DEBUG] Login Success API result:', result);
                // Remember Me logic
                if (rememberMeCheckbox && rememberMeCheckbox.checked) {
                    localStorage.setItem('b2b_saved_username', username);
                    localStorage.setItem('b2b_remember_me', 'true');
                } else {
                    localStorage.removeItem('b2b_saved_username');
                    localStorage.setItem('b2b_remember_me', 'false');
                }

                await processLoginResult(result, username);
            } else {
                console.error('[DEBUG] Login Failed result:', result);
                // ★重要: 失敗時もローディングを必ず解除する。
                //   これが無いとログインボタンが「読み込み中…」のまま無効化され、
                //   再入力できず固まる（＝パスワード変更後に自動ログインが古いPWで
                //   失敗した端末が二度とログインできなくなる不具合の原因だった）。
                hideLoading();
                if (autoLoginInProgress) {
                    // 自動ログインの失敗はユーザー操作ではない。記憶を消して
                    // 手動ログイン画面に静かに戻すだけ（驚かせるアラートは出さない）。
                    clearResumeSession();
                    autoLoginInProgress = false;
                } else {
                    alert('ログインに失敗しました: ' + result.message
                        + wrongDealerHint());
                }
            }
        } catch (error) {
            console.error(error);
            // 通信エラーは一時的なので記憶は消さない（次回また自動で試す）
            autoLoginInProgress = false;
            alert('通信に失敗しました。');
            hideLoading();
        }
    });

    // --- マスター：サロン検索（インクリメンタル絞り込み） ---
    // 入室は従来どおり「入室する」ボタン。リストは選択（select.value設定）まで。
    const selectMasterSalon = (clientJson, liEl) => {
        if (masterSalonSelect) masterSalonSelect.value = clientJson;
        if (masterSalonList) {
            masterSalonList.querySelectorAll('.master-salon-item').forEach(el => el.classList.remove('is-selected'));
        }
        if (liEl) liEl.classList.add('is-selected');
    };

    const renderMasterSalonList = (query) => {
        if (!masterSalonList) return;
        const q = normalizeForSearch(query || '');
        // 半角全角・大小文字・ひらがな/カタカナは normalizeForSearch が吸収する
        const matches = q
            ? masterAllClients.filter(c => normalizeForSearch(c.name).includes(q))
            : masterAllClients.slice();

        masterSalonList.innerHTML = '';
        if (masterSalonCount) {
            masterSalonCount.textContent = matches.length + '件'
                + (q ? '（絞り込み中）' : '');
        }

        if (!matches.length) {
            const empty = document.createElement('li');
            empty.className = 'master-salon-empty';
            empty.textContent = '該当するサロンがありません';
            masterSalonList.appendChild(empty);
            if (masterSalonSelect) masterSalonSelect.value = '';
            return;
        }

        matches.forEach(c => {
            const li = document.createElement('li');
            li.className = 'master-salon-item';
            li.setAttribute('role', 'option');
            const json = JSON.stringify(c);
            li.dataset.client = json;
            const typeLabel = c.type === '直送' ? ' [直送]' : '';
            li.textContent = c.name + typeLabel;
            li.addEventListener('click', () => selectMasterSalon(json, li));
            masterSalonList.appendChild(li);
        });

        // 先頭を選択状態に（1件のときは実質確定。入室は「入室する」ボタン）
        const first = masterSalonList.querySelector('.master-salon-item');
        if (first) selectMasterSalon(first.dataset.client, first);
    };

    if (masterSalonSearch) {
        masterSalonSearch.addEventListener('input', () => {
            if (masterSalonSearchTimeout) clearTimeout(masterSalonSearchTimeout);
            const val = masterSalonSearch.value;
            masterSalonSearchTimeout = setTimeout(() => renderMasterSalonList(val), 150);
        });
        masterSalonSearch.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault(); // ログインフォームのsubmit暴発を防ぐ
            if (masterSalonSearchTimeout) clearTimeout(masterSalonSearchTimeout);
            renderMasterSalonList(masterSalonSearch.value);
        });
    }

    if (masterLoginBtn) {
        masterLoginBtn.addEventListener('click', async () => {
            const selectedVal = masterSalonSelect.value;
            if (!selectedVal) return;
            const clientData = JSON.parse(selectedVal);
            
            // 重要: 前のサロン（またはマスター自身の）データが混ざらないよう完全クリア
            clearCartFromStorage(); // Must be called before currentClientName changes
            favoriteItems = [];
            currentCart = {};
            cartOrder = [];

            currentClientName = (clientData.name || '').trim();
            currentClientCode = String(clientData.code || '').trim();
            currentClientType = clientData.type;
            // サロンを切り替えたら直送トグルは必ず解除する。
            // 前のサロンの指定が残ったまま別のサロンを発注する事故を防ぐ。
            registeredClientType = clientData.type || '';

            document.getElementById('master-salon-selector').classList.add('hidden');
            loginForm.classList.remove('hidden');

            showLoading('サロンデータを準備中...');
            await processLoginSuccess(
                masterSalonSelect.dataset.announcement || '',
                masterSalonSelect.dataset.isMaintenance === 'true',
                masterSalonSelect.dataset.maintenanceMessage || '',
                masterSalonSelect.dataset.dataVersion || null
            );
        });
    }

    if (masterCancelBtn) {
        masterCancelBtn.addEventListener('click', () => {
            document.getElementById('master-salon-selector').classList.add('hidden');
            if (globalSyncBtn) globalSyncBtn.classList.add('hidden');
            const batchBtnEl = document.getElementById('batch-import-btn');
            if (batchBtnEl) batchBtnEl.classList.add('hidden');
            loginForm.classList.remove('hidden');
            clearCartFromStorage(); // Must be called before currentUsername is cleared
            currentUsername = '';
            currentClientName = '';
            currentClientCode = '';
            registeredClientType = '';
            currentClientType = '';
            isMasterSession = false;
            // 切替キャンセル時もクリアしておく
            favoriteItems = [];
            currentCart = {};
            cartOrder = [];
            resetCodeEntryRows();
        });
    }

    if (masterReturnBtn) {
        masterReturnBtn.addEventListener('click', () => {
            if (!isMasterSession) return;
            if (editingOrderId !== null && !confirm('発注内容の編集中です。編集を中止してマスター画面へ戻りますか？')) return;
            const hasUnsavedCustomItem = cartOrder.some((code) =>
                String(code).startsWith('CUSTOM_ITEM_') && currentCart[code] && currentCart[code].qty > 0
            );
            if (hasUnsavedCustomItem && !confirm('特注・その他の商品は一時保存できません。破棄してマスター画面へ戻りますか？')) return;

            // 現在サロンの未発注カートはサロン別キーに保存し、再入室時に復元する。
            saveCartToStorage();
            closeCartSidebar();
            closeCodeEntryModal();
            closeCodeFilterModal();

            currentClientName = '';
            currentClientCode = '';
            registeredClientType = '';
            currentClientType = 'MASTER';
            favoriteItems = [];
            currentCart = {};
            cartOrder = [];
            orderFrequency = {};
            lastOrderDate = {};
            currentFilter = 'all';
            currentManufacturerFilter = 'all';
            currentCategoryFilter = 'all';
            currentSort = 'frequency';
            editingOrderId = null;
            loggedUnknownJans.clear();

            if (clientNameDisplay) clientNameDisplay.textContent = '';
            if (itemListContainer) itemListContainer.innerHTML = '';
            if (historyListContainer) historyListContainer.innerHTML = '';
            if (customItemsList) customItemsList.innerHTML = '';
            if (searchInput) searchInput.value = '';
            if (announcementBanner) announcementBanner.classList.add('hidden');
            calculateTotal();

            orderContainer.classList.add('hidden');
            confirmationContainer.classList.add('hidden');
            loginContainer.classList.remove('hidden');
            loginForm.classList.add('hidden');
            document.getElementById('master-salon-selector').classList.remove('hidden');
            // サロン検索を初期状態（全件・検索欄クリア）へ戻す
            if (masterSalonSearch) masterSalonSearch.value = '';
            renderMasterSalonList('');
            if (globalSyncBtn) globalSyncBtn.classList.remove('hidden');
            const batchBtnEl = document.getElementById('batch-import-btn');
            if (batchBtnEl) batchBtnEl.classList.remove('hidden');

            if (masterReturnBtn) masterReturnBtn.classList.add('hidden');
            if (codeEntryBtn) codeEntryBtn.classList.add('hidden');
            if (codeFilterBtn) codeFilterBtn.classList.add('hidden');
            if (importModeBtn) importModeBtn.classList.add('hidden');
            if (lineImportBtn) lineImportBtn.classList.add('hidden');
            if (sheetImageImportBtn) sheetImageImportBtn.classList.add('hidden');
            if (printSheetBtn) printSheetBtn.classList.add('hidden');
            switchTab('tab-all');
        });
    }

    // --- Logout ---
    logoutBtn.addEventListener('click', () => {
        sessionToken = ''; // トークンも破棄（以後のAPI呼び出しに乗せない）
        clearResumeSession(); // 明示ログアウト＝別の人に切り替える意図なので再開情報を消す
        clearCartFromStorage(); // Must be called before clearing currentUsername/currentClientName
        currentUsername = '';
        currentClientName = '';
        currentClientCode = '';
        registeredClientType = '';
        currentClientType = '';
        isMasterSession = false;
        if (masterReturnBtn) masterReturnBtn.classList.add('hidden');
        if (codeEntryBtn) codeEntryBtn.classList.add('hidden');
        if (codeFilterBtn) codeFilterBtn.classList.add('hidden');
        if (importModeBtn) importModeBtn.classList.add('hidden');
        if (lineImportBtn) lineImportBtn.classList.add('hidden');
        if (sheetImageImportBtn) sheetImageImportBtn.classList.add('hidden');
        if (printSheetBtn) printSheetBtn.classList.add('hidden');
        favoriteItems = [];
        currentCart = {};
        cartOrder = [];
        resetCodeEntryRows();
        loggedUnknownJans.clear(); // 未登録JANの送信済みSetをリセット

        if (customItemsList) customItemsList.innerHTML = '';

        orderContainer.classList.add('hidden');
        loginContainer.classList.remove('hidden');
        loginForm.reset();
        // Re-apply saved ID if remembered
        if (localStorage.getItem('b2b_remember_me') === 'true') {
            const savedId = localStorage.getItem('b2b_saved_username');
            if (savedId && usernameInput) usernameInput.value = savedId;
            if (rememberMeCheckbox) rememberMeCheckbox.checked = true;
        }
        itemListContainer.innerHTML = '';
        historyListContainer.innerHTML = '';
        totalQtySpan.textContent = '0';
        searchInput.value = '';

        // Reset to default tab
        switchTab('tab-all');
    });

    // --- 別注フラグの同梱（速度改善フェーズ2） ---
    // 各orderにisSpecial(boolean)を付けて送ると、GAS側がマスタ11,000行の全読みをスキップできる。
    // itemsDataに無いコード（廃番等）はisSpecialを付けない → サーバが従来のマスタ読みにフォールバック。
    const attachIsSpecial = (orders) => {
        const specialByCode = new Map();
        itemsData.forEach(item => {
            specialByCode.set(String(item.code), String(item.special || '').trim() !== '');
        });
        return orders.map(order => {
            const strCode = String(order.code);
            if (strCode.startsWith('CUSTOM_ITEM_')) return { ...order, isSpecial: true };
            if (specialByCode.has(strCode)) return { ...order, isSpecial: specialByCode.get(strCode) };
            return order;
        });
    };

    // --- Execute Order Helper ---
    const executeOrderActual = async (orders, isEditing, remarks, staffName = '') => {
        if (isSubmitting) return;
        setSubmittingState(true, isEditing);
        showLoading();
        // 送信時点の直送指定を控える。送信後に自動でOFFへ戻すため。
        const wasDirectShip = isDirectShipOn();
        try {
            const action = isEditing ? 'update_order' : 'order';
            const payload = {
                action: action,
                token: sessionToken,
                clientName: currentClientName,
                clientType: currentClientType, // '直送' or ''
                orders: attachIsSpecial(orders),
                remarks: remarks,
                staffName: staffName
            };

            const requestBody = isEditing ? { ...payload, orderId: String(editingOrderId) } : payload;

            const response = await fetch(CONFIG.API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                redirect: 'follow', // Crucial for GAS Web Apps
                body: JSON.stringify(requestBody)
            });

            const result = await response.json();

            if (result.status === 'success') {
                fetchHistory(true); // alertを閉じるのを待たず履歴更新を先行開始
                alert((wasDirectShip ? '【直送】として送信しました。\n\n' : '') +
                    (isEditing ? '発注内容を変更しました。' : '発注が完了しました！\n引き続き発注いただけます。'));
                // 直送は都度指定。送信できたら自動でOFFへ戻し、次の発注へ持ち越さない。
                // （登録上が直送のサロンは registeredClientType が '直送' なので変わらない）
                if (wasDirectShip) {
                    currentClientType = registeredClientType || '';
                    renderDirectShipBtn();
                }
                // ... (中略: favoriteItems の処理はそのまま)
                let favsUpdated = false;
                orders.forEach(order => {
                    const strCode = String(order.code);
                    if (!strCode.startsWith('CUSTOM_ITEM_')) {
                        if (!favoriteItems.includes(strCode)) {
                            favoriteItems.push(strCode);
                            favsUpdated = true;
                        }
                    }
                });
                if (favsUpdated) {
                    localStorage.setItem(getFavsKey(), JSON.stringify(favoriteItems));
                    saveFavoritesToCloud();
                    renderItems(itemsData);
                }
                if (customItemsList) customItemsList.innerHTML = '';
                clearCartFromStorage(); // Order submitted — discard persisted draft
                resetEditMode();
            } else {
                const errorMsg = result.message || '不明なエラーが発生しました。';
                if (errorMsg.includes('サーバーが混み合っています')) {
                    alert('【混雑中】' + errorMsg + '\n\n注文が完了していない可能性があります。数分後に再度お試しください。');
                } else {
                    alert('エラー: ' + errorMsg);
                }
            }
        } catch (error) {
            console.error(error);
            alert('通信エラーが発生しました。\nネットワークの状態を確認するか、数分後に再度お試しください。\n（注文が完了していない可能性があります）');
        } finally {
            hideLoading();
            setSubmittingState(false, editingOrderId !== null);
        }
    };

    const executeMultiOrderActual = async (orderGroups, updateOrderId = null) => {
        const isEditing = updateOrderId !== null;
        if (isSubmitting) return;
        setSubmittingState(true, isEditing);
        showLoading();
        // 送信時点の直送指定を控える。送信後に自動でOFFへ戻すため。
        const wasDirectShip = isDirectShipOn();
        try {
            const payload = {
                action: 'multi_order',
                token: sessionToken,
                orderGroups: orderGroups.map(group => ({
                    ...group,
                    orders: attachIsSpecial(group.orders)
                }))
            };
            if (updateOrderId) {
                payload.orderId = updateOrderId;
            }
            const response = await fetch(CONFIG.API_URL, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (result.status === 'success') {
                fetchHistory(true); // alertを閉じるのを待たず履歴更新を先行開始
                alert((wasDirectShip ? '【直送】として送信しました。\n\n' : '') +
                    (isEditing ? '発注内容を変更しました。' : '発注が完了しました！\n引き続き発注いただけます。'));
                // 直送は都度指定。送信できたら自動でOFFへ戻し、次の発注へ持ち越さない。
                // （登録上が直送のサロンは registeredClientType が '直送' なので変わらない）
                if (wasDirectShip) {
                    currentClientType = registeredClientType || '';
                    renderDirectShipBtn();
                }
                let favsUpdated = false;
                orderGroups.forEach(group => {
                    group.orders.forEach(order => {
                        const strCode = String(order.code);
                        if (!strCode.startsWith('CUSTOM_ITEM_') && !favoriteItems.includes(strCode)) {
                            favoriteItems.push(strCode);
                            favsUpdated = true;
                        }
                    });
                });
                if (favsUpdated) {
                    localStorage.setItem(getFavsKey(), JSON.stringify(favoriteItems));
                    saveFavoritesToCloud();
                    renderItems(itemsData);
                }
                if (customItemsList) customItemsList.innerHTML = '';
                clearCartFromStorage(); // Order submitted — discard persisted draft
                resetEditMode();
            } else {
                const errorMsg = result.message || '不明なエラーが発生しました。';
                if (errorMsg.includes('サーバーが混み合っています')) {
                    alert('【混雑中】' + errorMsg + '\n\n注文が完了していない可能性があります。数分後に再度お試しください。');
                } else {
                    alert('エラー: ' + errorMsg);
                }
            }
        } catch (error) {
            console.error(error);
            alert('通信エラーが発生しました。\n（注文が完了していない可能性があります）');
        } finally {
            hideLoading();
            setSubmittingState(false, editingOrderId !== null);
        }
    };

    // --- Submit Order (API) ---
    if (orderSubmitBtn) {
        orderSubmitBtn.addEventListener('click', () => {
            if (isSubmitting) return;
            const total = parseInt(totalQtySpan.textContent);
            if (total === 0) {
                alert('商品を1点以上選択してください。');
                return;
            }

            const orders = [];

            const isEditing = editingOrderId !== null;
            updateConfirmationCopy(isEditing);

            // Check if Confirmation Screen elements exist safely
            if (confirmationContainer && confirmItemList) {
                confirmItemList.innerHTML = ''; // Reset list

                const savedStaffs = JSON.parse(localStorage.getItem('b2b_staff_names') || '[]');
                const generateOptions = () => {
                    let opts = `<option value="業務">業務</option><option value="店販">店販</option>`;
                    savedStaffs.forEach(staff => {
                        opts += `<option value="staff_${staff}">${staff}様用</option>`;
                    });
                    opts += `<option value="staff_new">＋ 新しいスタッフを追加</option>`;
                    return opts;
                };

                cartOrder.forEach(code => {
                    const data = currentCart[code];
                    if (data && data.qty > 0) {
                        orders.push({
                            code: code,
                            name: data.name,
                            qty: data.qty
                        });

                        // Add to UI
                        const row = document.createElement('div');
                        row.className = 'confirm-item-row';
                        row.dataset.code = code;
                        
                        const assignedTo = data.assignedTo || '業務';

                        let assignHtml = `
                            <div style="margin-top: 8px;">
                                <select class="item-assign-select" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid #cbd5e1; font-size: 0.85rem; margin-bottom: 4px;">
                                    ${generateOptions()}
                                </select>
                                <input type="text" class="item-staff-input hidden" placeholder="スタッフ名" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid #cbd5e1; font-size: 0.85rem;">
                            </div>
                        `;
                        
                        row.innerHTML = `<div style="display: flex; justify-content: space-between;"><span class="confirm-item-name" style="font-weight: 600;">${escHtml(data.name)}</span><span class="confirm-item-qty">${escHtml(data.qty)}点</span></div>${assignHtml}`;
                        
                        // Set the default value
                        const select = row.querySelector('.item-assign-select');
                        if (select) {
                            let optionExists = false;
                            for(let i=0; i<select.options.length; i++) {
                                if(select.options[i].value === assignedTo) {
                                    optionExists = true; break;
                                }
                            }
                            if (!optionExists && assignedTo.startsWith('staff_')) {
                                const staffName = assignedTo.replace('staff_', '');
                                const newOption = document.createElement('option');
                                newOption.value = assignedTo;
                                newOption.textContent = staffName + '様用';
                                select.insertBefore(newOption, select.lastElementChild);
                            }
                            select.value = assignedTo;
                        }

                        confirmItemList.appendChild(row);
                    }
                });

                // Attach events for per-item select
                document.querySelectorAll('.item-assign-select').forEach(select => {
                    select.addEventListener('change', (e) => {
                        const input = e.target.nextElementSibling;
                        if (e.target.value === 'staff_new') {
                            input.classList.remove('hidden');
                            input.focus();
                        } else {
                            input.classList.add('hidden');
                            input.style.borderColor = '#cbd5e1';
                        }
                    });
                });

                // Clear order remarks
                if (orderRemarks) orderRemarks.value = '';

                // Show Confirmation Screen, Hide Order Screen
                orderContainer.classList.add('hidden');
                confirmationContainer.classList.remove('hidden');
                window.scrollTo(0, 0); // Scroll to top
            } else {
                // FALLBACK: If HTML is cached and missing the modal, use standard confirm()
                Object.entries(currentCart).forEach(([code, data]) => {
                    if (data.qty > 0) {
                        orders.push({
                            code: code,
                            name: data.name,
                            qty: data.qty
                        });
                    }
                });

                const isEditing = editingOrderId !== null;
                const confirmMsg = isEditing
                    ? `${total}点で発注内容を変更します。よろしいですか？`
                    : `${total}点の商品を発注します。よろしいですか？`;

                if (!confirm(confirmMsg)) return;
                executeOrderActual(orders, isEditing);
            }
        });
    }

    // Close Confirmation Screen
    if (modalCancelBtn) {
        modalCancelBtn.addEventListener('click', () => {
            if (isSubmitting) return;
            if (confirmationContainer) {
                confirmationContainer.classList.add('hidden');
                orderContainer.classList.remove('hidden');
            }
            if (personalPurchaseCheck) {
                personalPurchaseCheck.checked = false;
                if (staffNameContainer) staffNameContainer.classList.add('hidden');
                if (staffNameInput) staffNameInput.style.borderColor = '#cbd5e1';
            }
        });
    }
    // Actually Execute Order from Confirmation Screen
    if (modalConfirmBtn) {
        modalConfirmBtn.addEventListener('click', async () => {
            if (isSubmitting) return;
            const isEditing = editingOrderId !== null;
            const remarks = orderRemarks ? orderRemarks.value.trim() : '';

            // Grouping logic for new multi_order
            const groupsMap = {}; // key -> { clientName, staffName, clientType, orders, remarks }
            let hasError = false;
            let newStaffsToSave = [];

            document.querySelectorAll('.confirm-item-row').forEach(row => {
                if (hasError) return;
                
                const code = row.dataset.code;
                const data = currentCart[code];
                if (!data || data.qty <= 0) return;

                const select = row.querySelector('.item-assign-select');
                const input = row.querySelector('.item-staff-input');
                let groupKey = '';
                let gClientName = currentClientName;
                let gStaffName = '';

                if (select) {
                    const val = select.value;
                    if (val === '業務') {
                        groupKey = 'shop';
                    } else if (val === '店販') {
                        groupKey = 'retail';
                        gClientName = currentClientName + ' 店販';
                    } else if (val.startsWith('staff_')) {
                        if (val === 'staff_new') {
                            const sName = input.value.trim();
                            if (!sName) {
                                input.style.borderColor = '#ef4444';
                                hasError = true;
                                return;
                            }
                            gStaffName = sName;
                            groupKey = 'staff_' + sName;
                            if (!newStaffsToSave.includes(sName)) newStaffsToSave.push(sName);
                        } else {
                            gStaffName = val.replace('staff_', '');
                            groupKey = val;
                        }
                    }
                } else {
                    groupKey = 'shop'; // Fallback
                }

                if (!groupsMap[groupKey]) {
                    groupsMap[groupKey] = {
                        clientName: gClientName,
                        staffName: gStaffName,
                        clientType: currentClientType,
                        remarks: remarks,
                        orders: []
                    };
                }
                groupsMap[groupKey].orders.push({ code: code, name: data.name, qty: data.qty });
            });

            if (hasError) {
                alert('個人買いのスタッフ名が未入力の項目があります。');
                return;
            }

            // Save new staff names to local storage
            if (newStaffsToSave.length > 0) {
                let savedStaffs = JSON.parse(localStorage.getItem('b2b_staff_names') || '[]');
                newStaffsToSave.forEach(name => {
                    if (!savedStaffs.includes(name)) savedStaffs.push(name);
                });
                localStorage.setItem('b2b_staff_names', JSON.stringify(savedStaffs));
            }

            if (confirmationContainer) {
                confirmationContainer.classList.add('hidden');
                orderContainer.classList.remove('hidden'); // Return immediately so loading overlay shows here
            }

            const orderGroups = Object.values(groupsMap);
            if (orderGroups.length === 1 && !orderGroups[0].staffName && orderGroups[0].clientName === currentClientName) {
                // If everything is just a standard shop order, use legacy method or multi order?
                // For edit mode, we must use multi order because it clears the correct items and re-inserts.
                if (isEditing) {
                    executeMultiOrderActual(orderGroups, editingOrderId);
                } else {
                    executeOrderActual(orderGroups[0].orders, false, remarks, '');
                }
            } else {
                executeMultiOrderActual(orderGroups, isEditing ? editingOrderId : null);
            }
        });
    }

    // --- Initial Fetch ---
    fetchHistoryFavorites();

    // ==========================================
    // 📷 Barcode Scanner Module (v2 - High Sensitivity)
    // ==========================================
    const scanBtn = document.getElementById('scan-btn');
    const scannerModal = document.getElementById('scanner-modal');
    const scannerOverlay = document.getElementById('scanner-overlay');
    const scannerCloseBtn = document.getElementById('scanner-close-btn');
    const scannerStatus = document.getElementById('scanner-status');
    const scanToast = document.getElementById('scan-toast');
    const scanToastIcon = document.getElementById('scan-toast-icon');
    const scanToastMessage = document.getElementById('scan-toast-message');
    const scanResultPanel = document.getElementById('scan-result-panel');
    const scanResultCode = document.getElementById('scan-result-code');
    const scanResultName = document.getElementById('scan-result-name');
    const scanQtyInput = document.getElementById('scan-qty-input');
    const scanQtyMinus = document.getElementById('scan-qty-minus');
    const scanQtyPlus = document.getElementById('scan-qty-plus');
    const scanQtyClear = document.getElementById('scan-qty-clear');
    const janTailInput = document.getElementById('jan-tail-input');
    const janTailSearchBtn = document.getElementById('jan-tail-search-btn');
    const janTailResults = document.getElementById('jan-tail-results');

    let html5QrcodeScanner = null;
    let lastScannedCode = '';
    let activeScannedItem = null;
    let pendingScanCode = '';
    let pendingScanCount = 0;
    let pendingScanTs = 0;
    let pendingScanFirstTs = 0;
    const SCAN_CONFIRM_WINDOW_MS = 1200;
    const SCAN_CONFIRM_MIN_GAP_MS = 250; // 2回一致の最短間隔。450msから短縮（15fpsで約4フレーム分は確保）
    const SCAN_REQUIRED_MATCHES = 2;

    // ビープ音生成（Web Audio API - iOS Safari対応）
    let audioCtx = null;
    const playBeep = (freq = 1000, duration = 100, type = 'sine') => {
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = type;
            osc.frequency.value = freq;
            gain.gain.value = 0.3;
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + duration / 1000);
        } catch (e) { /* 音声非対応環境では無視 */ }
    };

    // JAN → 商品の逆引きマップ
    let janToItemMap = new Map();
    const buildJanMap = () => {
        janToItemMap.clear();
        if (itemsData && itemsData.length > 0) {
            itemsData.forEach(item => {
                const jan = String(item.jan || '').trim();
                if (jan) janToItemMap.set(jan, item);
            });
        }
        console.log(`JAN Map built: ${janToItemMap.size} items indexed.`);
    };

    // トースト表示
    const showScanToast = (message, isError = false) => {
        if (!scanToast) return;
        scanToastIcon.textContent = isError ? '⚠️' : '✅';
        scanToastMessage.textContent = message;
        scanToast.classList.remove('hidden', 'toast-error');
        if (isError) scanToast.classList.add('toast-error');
        clearTimeout(scanToast._timer);
        scanToast._timer = setTimeout(() => scanToast.classList.add('hidden'), 2500);
    };

    const getScanQty = () => {
        const val = parseInt(scanQtyInput?.value, 10);
        return Number.isFinite(val) && val > 0 ? val : 0;
    };

    const setActiveScanQty = (newQty, showToast = false) => {
        if (!activeScannedItem || !scanQtyInput) return;

        const qty = Math.max(0, parseInt(newQty, 10) || 0);
        const code = String(activeScannedItem.code);

        updateFromCart(code, activeScannedItem.name, qty);
        scanQtyInput.value = qty;

        if (scannerStatus) {
            scannerStatus.textContent = qty > 0
                ? `✅ ${activeScannedItem.name} は ${qty}個でカートに入っています`
                : `🗑️ ${activeScannedItem.name} をカートから削除しました`;
        }
        if (showToast) {
            showScanToast(qty > 0
                ? `${activeScannedItem.name} を ${qty}個に変更`
                : `${activeScannedItem.name} を削除`);
        }
    };

    const showScanResultPanel = (item) => {
        if (!scanResultPanel || !scanQtyInput) return;

        activeScannedItem = item;
        const code = String(item.code);
        const currentQty = currentCart[code] ? currentCart[code].qty : 0;

        if (scanResultCode) scanResultCode.textContent = code.replace(/^'/, '');
        if (scanResultName) scanResultName.textContent = item.name;
        scanQtyInput.value = currentQty;
        scanResultPanel.classList.remove('hidden');
    };

    const addScannedItemToCart = (item, source = 'scan') => {
        const code = String(item.code);
        const currentQty = currentCart[code] ? currentCart[code].qty : 0;
        const nextQty = currentQty + 1;
        updateFromCart(code, item.name, nextQty);
        showScanResultPanel(item);

        playBeep(1000, 100);
        if (navigator.vibrate) navigator.vibrate(200);

        showScanToast(`${item.name} を追加 (${nextQty}個)`);
        if (scannerStatus) {
            scannerStatus.textContent = source === 'jan-tail'
                ? `✅ ${item.name} をJAN下4桁検索から追加しました`
                : `✅ ${item.name} は ${nextQty}個でカートに入っています`;
        }
    };

    const clearJanTailResults = () => {
        if (!janTailResults) return;
        janTailResults.innerHTML = '';
        janTailResults.classList.add('hidden');
    };

    const renderJanTailResults = (matches, tail) => {
        if (!janTailResults) return;
        janTailResults.innerHTML = '';

        if (matches.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'jan-tail-empty';
            empty.textContent = `${tail} に一致するJANはありません`;
            janTailResults.appendChild(empty);
            janTailResults.classList.remove('hidden');
            return;
        }

        matches.slice(0, 10).forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'jan-tail-result-btn';

            const name = document.createElement('span');
            name.className = 'jan-tail-result-name';
            name.textContent = item.name;

            const meta = document.createElement('span');
            meta.className = 'jan-tail-result-meta';
            meta.textContent = `コード: ${String(item.code).replace(/^'/, '')} / JAN: ${String(item.jan || '').trim()}`;

            btn.appendChild(name);
            btn.appendChild(meta);
            btn.addEventListener('click', () => {
                addScannedItemToCart(item, 'jan-tail');
                clearJanTailResults();
                if (janTailInput) janTailInput.value = '';
            });
            janTailResults.appendChild(btn);
        });

        if (matches.length > 10) {
            const more = document.createElement('div');
            more.className = 'jan-tail-empty';
            more.textContent = '候補が多いため先頭10件を表示しています';
            janTailResults.appendChild(more);
        }

        janTailResults.classList.remove('hidden');
    };

    const searchByJanTail = () => {
        const tail = String(janTailInput?.value || '').replace(/\D/g, '').slice(0, 4);
        if (janTailInput) janTailInput.value = tail;
        if (tail.length < 4) {
            clearJanTailResults();
            if (scannerStatus) scannerStatus.textContent = 'JAN下4桁を入力してください';
            return;
        }

        const matches = (itemsData || []).filter(item => {
            const jan = String(item.jan || '').trim();
            return jan.length >= 4 && jan.endsWith(tail);
        });
        renderJanTailResults(matches, tail);
        if (scannerStatus) scannerStatus.textContent = `${tail} の候補: ${matches.length}件`;
    };

    const confirmScanCode = (janCode) => {
        const now = Date.now();
        if (janCode === pendingScanCode && (now - pendingScanTs) <= SCAN_CONFIRM_WINDOW_MS) {
            pendingScanCount += 1;
        } else {
            pendingScanCode = janCode;
            pendingScanCount = 1;
            pendingScanFirstTs = now;
        }
        pendingScanTs = now;

        if (pendingScanCount < SCAN_REQUIRED_MATCHES || (now - pendingScanFirstTs) < SCAN_CONFIRM_MIN_GAP_MS) {
            if (scannerStatus) scannerStatus.textContent = `読み取り確認中... ${janCode}`;
            return false;
        }

        pendingScanCode = '';
        pendingScanCount = 0;
        pendingScanTs = 0;
        pendingScanFirstTs = 0;
        return true;
    };

    if (scanQtyMinus) {
        scanQtyMinus.addEventListener('click', () => setActiveScanQty(getScanQty() - 1, true));
    }
    if (scanQtyPlus) {
        scanQtyPlus.addEventListener('click', () => setActiveScanQty(getScanQty() + 1, true));
    }
    if (scanQtyInput) {
        scanQtyInput.addEventListener('input', () => {
            if (scanQtyInput.value !== '') setActiveScanQty(getScanQty());
        });
        scanQtyInput.addEventListener('change', () => setActiveScanQty(getScanQty(), true));
    }
    if (scanQtyClear) {
        scanQtyClear.addEventListener('click', () => setActiveScanQty(0, true));
    }
    if (janTailSearchBtn) {
        janTailSearchBtn.addEventListener('click', searchByJanTail);
    }
    if (janTailInput) {
        janTailInput.addEventListener('input', () => {
            janTailInput.value = janTailInput.value.replace(/\D/g, '').slice(0, 4);
            if (janTailInput.value.length === 4) {
                searchByJanTail();
            } else {
                clearJanTailResults();
            }
        });
        janTailInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                searchByJanTail();
            }
        });
    }

    // スキャン成功時の処理
    const onScanSuccess = (decodedText) => {
        if (decodedText === lastScannedCode) {
            return;
        }

        const normalizedJan = String(decodedText).trim();
        if (!confirmScanCode(normalizedJan)) {
            return;
        }

        lastScannedCode = normalizedJan;
        const matchedItem = janToItemMap.get(normalizedJan);

        if (matchedItem) {
            addScannedItemToCart(matchedItem);
        } else {
            // エラー: 低音ビープ + 振動パターン
            playBeep(400, 200);
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
            showScanToast(`未登録のバーコードです (${normalizedJan})`, true);
            if (scannerStatus) scannerStatus.textContent = `⚠️ 未登録コード: ${normalizedJan}`;

            // 未登録JANコードをバックエンドに記録（非同期・Fire-and-forget）
            logUnknownJan(normalizedJan);
        }
    };

    // 未登録JANコードをバックエンドに記録
    const logUnknownJan = (janCode) => {
        // サロン別に重複送信を防止（キー: JAN_サロン名）
        const dedupeKey = `${janCode}_${currentClientName}`;
        if (loggedUnknownJans.has(dedupeKey)) return;
        loggedUnknownJans.add(dedupeKey);

        // Fire-and-forget（失敗してもスキャン動作に影響しない）
        fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            redirect: 'follow',
            body: JSON.stringify({
                action: 'log_unknown_jan',
                token: sessionToken,
                janCode: janCode,
                clientName: currentClientName
            })
        }).catch(err => console.warn('Unknown JAN log failed:', err));
    };

    // スキャナ起動
    // iPhone 13等の近接ピント問題対策（マクロ非対応機はバーコードに近づけるほどボケる）:
    // 対応端末ではズーム＋連続AFをかけて、レンズが合焦できる距離のまま
    // バーコードを大きく写せるようにする。倍率はスライダーで調整でき、端末ごとに記憶する。
    // 非対応端末（iOS16以前等）では何もしない（スライダーも出さない）。
    const scanZoomRow = document.getElementById('scan-zoom-row');
    const scanZoomPresets = document.getElementById('scan-zoom-presets');
    // v2.23.0はデフォルト2倍を自動保存してしまっていたため、キーを変えて仕切り直し
    // （旧キーの値は「ユーザーが選んだ倍率」と区別できない）
    const SCAN_ZOOM_STORAGE_KEY = 'b2b_scan_zoom_v2';
    // スライダーは適用の重さ（iOSで1回数百ms）と相性が悪く狙った倍率に合わせにくいため、
    // プリセットボタンのタップ一発方式にする
    const SCAN_ZOOM_PRESET_VALUES = [1, 1.5, 2, 3, 4];
    let scanVideoTrack = null;

    const updateZoomActiveButton = (zoom) => {
        if (!scanZoomPresets) return;
        scanZoomPresets.querySelectorAll('.scan-zoom-preset-btn').forEach(btn => {
            btn.classList.toggle('active', parseFloat(btn.dataset.zoom) === zoom);
        });
    };

    // applyConstraintsはiOSで1回数百msかかる。ドラッグ中のイベント全部で呼ぶと
    // 行列ができて固まるため、実行中は1件だけ・中間値は捨てて最新値のみ適用する。
    let scanZoomBusy = false;
    let scanZoomPending = null;
    const setScanZoom = (zoom) => {
        updateZoomActiveButton(zoom); // 選択表示は即時反映
        scanZoomPending = zoom;
        if (scanZoomBusy || !scanVideoTrack) return;
        scanZoomBusy = true;
        (async () => {
            let lastApplied = null;
            while (scanZoomPending !== null && scanVideoTrack) {
                const target = scanZoomPending;
                scanZoomPending = null;
                try {
                    await scanVideoTrack.applyConstraints({ advanced: [{ zoom: target }] });
                    lastApplied = target;
                } catch (e) {
                    console.warn('[Scanner] Zoom apply failed:', e);
                    break;
                }
            }
            if (lastApplied !== null) localStorage.setItem(SCAN_ZOOM_STORAGE_KEY, String(lastApplied));
            scanZoomBusy = false;
        })();
    };

    const applyFocusWorkaround = async () => {
        try {
            const video = document.querySelector('#reader video');
            const track = video && video.srcObject && video.srcObject.getVideoTracks()[0];
            if (!track || !track.getCapabilities) return;
            scanVideoTrack = track;
            const caps = track.getCapabilities();

            if (caps.focusMode && caps.focusMode.includes('continuous')) {
                try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) {}
            }

            if (caps.zoom && caps.zoom.max && caps.zoom.max > (caps.zoom.min || 1)) {
                const minZoom = caps.zoom.min || 1;
                const maxZoom = caps.zoom.max;
                // デフォルトは1倍＝従来のカメラ挙動のまま（今まで読めていた人を変えない）。
                // ボタンを押した端末だけ、その倍率を記憶して次回復元する。
                const saved = parseFloat(localStorage.getItem(SCAN_ZOOM_STORAGE_KEY));
                const zoom = Math.min(maxZoom, Math.max(minZoom, Number.isFinite(saved) ? saved : 1));

                if (scanZoomPresets && scanZoomRow) {
                    scanZoomPresets.innerHTML = '';
                    SCAN_ZOOM_PRESET_VALUES
                        .filter(v => v >= minZoom && v <= maxZoom)
                        .forEach(v => {
                            const btn = document.createElement('button');
                            btn.type = 'button';
                            btn.className = 'scan-zoom-preset-btn';
                            btn.dataset.zoom = String(v);
                            btn.textContent = (Number.isInteger(v) ? v : v.toFixed(1)) + 'x';
                            btn.addEventListener('click', () => setScanZoom(v));
                            scanZoomPresets.appendChild(btn);
                        });
                    scanZoomRow.classList.remove('hidden');
                }
                if (scannerStatus) scannerStatus.textContent = 'バーコードを枠内に収めてください（ピントが合わない時は🔍ズーム調整）';
                // 記憶済みの端末だけ適用。初回（=1倍）はカメラに触らない
                if (Number.isFinite(saved)) {
                    setScanZoom(zoom);
                } else {
                    updateZoomActiveButton(zoom);
                }
                console.log(`[Scanner] Zoom presets ready: ${zoom}x (range ${minZoom}-${maxZoom})`);
            }
        } catch (e) { console.warn('[Scanner] Focus/zoom constraints not applied:', e); }
    };


    const startScanner = async () => {
        if (!scannerModal || !scannerOverlay) return;
        if (janToItemMap.size === 0) buildJanMap();
        activeScannedItem = null;
        if (scanResultPanel) scanResultPanel.classList.add('hidden');

        // iOS Safari: AudioContextのロック解除（ユーザージェスチャー内で初期化）
        if (!audioCtx) {
            try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
        }

        scannerModal.classList.remove('hidden');
        scannerOverlay.classList.remove('hidden');
        clearJanTailResults();
        if (janTailInput) janTailInput.value = '';
        if (scannerStatus) scannerStatus.textContent = `カメラ起動中... (読込済JAN: ${janToItemMap.size}件)`;

        try {
            html5QrcodeScanner = new Html5Qrcode("reader", {
                // EAN-13（JANコード）に絞り込み → 解析速度2〜3倍向上
                formatsToSupport: [ Html5QrcodeSupportedFormats.EAN_13 ],
                verbose: false
            });
            await html5QrcodeScanner.start(
                { facingMode: "environment" },
                {
                    fps: 15,
                    qrbox: { width: 300, height: 120 },
                    disableFlip: true,
                    // 高解像度で起動：離した位置からでもバーコードのピクセル数を確保する
                    // （iPhone 13等は近づけるほどピントが合わないため「離して読む」前提を作る）
                    videoConstraints: {
                        facingMode: "environment",
                        width: { ideal: 1920 },
                        height: { ideal: 1080 }
                    },
                    // ブラウザのネイティブBarcode Detection APIを優先使用（GPU高速化）
                    experimentalFeatures: {
                        useBarCodeDetectorIfSupported: true
                    }
                },
                onScanSuccess,
                () => {}
            );
            if (scannerStatus) scannerStatus.textContent = 'バーコードを枠内に収めてください';
            applyFocusWorkaround();
        } catch (err) {
            console.error("Camera error:", err);
            if (scannerStatus) {
                scannerStatus.innerHTML = `
                    <span style="color: #dc2626;">⚠️ カメラを起動できませんでした</span><br>
                    <span style="font-size: 0.75rem; color: #64748b; margin-top: 4px; display: block;">
                        スマホの設定 → Safari/Chrome → カメラ → 「許可」に変更してください
                    </span>`;
            }
        }
    };

    // スキャナ停止
    const stopScanner = async () => {
        if (html5QrcodeScanner) {
            try {
                await html5QrcodeScanner.stop();
                html5QrcodeScanner.clear();
            } catch (e) { console.warn('Scanner stop error:', e); }
            html5QrcodeScanner = null;
        }
        scanVideoTrack = null;
        if (scanZoomRow) scanZoomRow.classList.add('hidden');
        if (scannerModal) scannerModal.classList.add('hidden');
        if (scannerOverlay) scannerOverlay.classList.add('hidden');
        if (scanResultPanel) scanResultPanel.classList.add('hidden');
        clearJanTailResults();
        if (janTailInput) janTailInput.value = '';
        activeScannedItem = null;
        lastScannedCode = '';
        pendingScanCode = '';
        pendingScanCount = 0;
        pendingScanTs = 0;
        pendingScanFirstTs = 0;
    };

    // イベントリスナー
    if (scanBtn) scanBtn.addEventListener('click', startScanner);
    if (scannerCloseBtn) scannerCloseBtn.addEventListener('click', stopScanner);
    if (scannerOverlay) scannerOverlay.addEventListener('click', stopScanner);

    // ==========================================
    // LINE注文テキスト取込（APIなし・MASTERログイン限定）
    // ==========================================
    const lineImportOverlay = document.getElementById('line-import-overlay');
    const lineImportModal = document.getElementById('line-import-modal');
    const lineImportCloseBtn = document.getElementById('line-import-close-btn');
    const lineImportText = document.getElementById('line-import-text');
    const lineImportParseBtn = document.getElementById('line-import-parse-btn');
    const lineImportStatus = document.getElementById('line-import-status');
    const lineImportInputStep = document.getElementById('line-import-input-step');
    const lineImportPreviewStep = document.getElementById('line-import-preview-step');
    const lineImportList = document.getElementById('line-import-list');
    const lineImportMatchedCount = document.getElementById('line-import-matched-count');
    const lineImportAttentionCount = document.getElementById('line-import-attention-count');
    const lineImportTime = document.getElementById('line-import-time');
    const lineImportMessage = document.getElementById('line-import-message');
    const lineImportBackBtn = document.getElementById('line-import-back-btn');
    const lineImportApplyBtn = document.getElementById('line-import-apply-btn');
    const lineMatch = window.LineOrderMatch;

    let lineImportEntries = [];
    let lineImportProducts = [];
    let lineImportFavorites = [];
    let lineImportProductByCode = new Map();

    const lineProductCode = (product) => lineMatch.productCode(product);
    const lineProductName = (product) => lineMatch.productName(product);
    const lineProductLabel = (product) => `${product.favorite ? '★ ' : ''}${lineProductName(product)}（${lineProductCode(product)}）`;

    const buildLineImportCatalog = () => {
        const favoriteCodes = new Set(favoriteItems.map((code) => String(code).replace(/^'/, '')));
        const deduplicated = new Map();
        itemsData.forEach((item) => {
            if (!isValidCode(item.code)) return;
            const code = String(item.code).replace(/^'/, '');
            const product = {
                code,
                name: String(item.name || '').trim(),
                favorite: favoriteCodes.has(code),
                normalized_name: lineMatch.normalizeOrderName(item.name),
                manufacturer: item.manufacturer || '',
                category: item.category || ''
            };
            const current = deduplicated.get(code);
            const score = Number(Boolean(product.manufacturer)) + Number(Boolean(product.category));
            const currentScore = current
                ? Number(Boolean(current.manufacturer)) + Number(Boolean(current.category))
                : -1;
            if (product.name && score > currentScore) deduplicated.set(code, product);
        });
        lineImportProducts = Array.from(deduplicated.values());
        lineImportFavorites = lineImportProducts.filter((product) => product.favorite);
        lineImportProductByCode = new Map(lineImportProducts.map((product) => [product.code, product]));
    };

    const setLineImportStatus = (message, isError = false) => {
        if (!lineImportStatus) return;
        lineImportStatus.textContent = message;
        lineImportStatus.classList.toggle('import-status-error', isError);
        lineImportStatus.classList.toggle('hidden', !message);
    };

    const lineImportCounts = () => {
        const active = lineImportEntries.filter((entry) => !entry.excluded);
        const ready = active.filter((entry) => entry.product
            && Number.isInteger(entry.quantity)
            && entry.quantity >= 1
            && entry.quantity <= 999);
        return { active, ready, attention: active.length - ready.length };
    };

    const updateLineImportReadiness = () => {
        const counts = lineImportCounts();
        lineImportMatchedCount.textContent = String(counts.ready.length);
        lineImportAttentionCount.textContent = String(counts.attention);
        const canApply = counts.active.length > 0 && counts.attention === 0;
        lineImportApplyBtn.disabled = !canApply;
        lineImportMessage.textContent = canApply
            ? `${counts.ready.length}商品をカートへ追加できます。`
            : counts.active.length === 0
                ? 'カートへ追加する商品がありません。'
                : `${counts.attention}行の商品または数量を確認してください。`;
    };

    const renderLineImportResults = (result) => {
        lineImportEntries = result.entries.map((entry) => ({ ...entry, excluded: false }));
        lineImportList.replaceChildren();

        lineImportEntries.forEach((entry, index) => {
            const row = document.createElement('article');
            row.className = 'line-import-row';

            const source = document.createElement('div');
            source.className = 'line-import-source';
            const sourceLabel = document.createElement('small');
            sourceLabel.textContent = 'LINE原文';
            const quote = document.createElement('q');
            quote.textContent = entry.source_text;
            source.append(sourceLabel, quote);

            const match = document.createElement('div');
            match.className = 'line-import-match';
            const matchLabel = document.createElement('small');
            matchLabel.textContent = '商品照合';
            const name = document.createElement('strong');
            const code = document.createElement('code');
            const reason = document.createElement('span');
            reason.className = 'line-import-reason';
            match.append(matchLabel, name, code, reason);

            const syncMatchView = () => {
                name.textContent = entry.product
                    ? `${entry.product.favorite ? '★ ' : ''}${lineProductName(entry.product)}`
                    : '候補を選んでください';
                code.textContent = entry.product ? `CODE ${lineProductCode(entry.product)}` : '未確定';
                reason.textContent = entry.reason || '候補を選んでください';
                reason.classList.toggle('is-attention', !entry.product);
                reason.classList.toggle('is-all-product', Boolean(entry.product && !entry.product.favorite));
                row.classList.toggle('needs-attention', !entry.product || !entry.quantity);
            };
            syncMatchView();

            if (!entry.product) {
                const picker = document.createElement('div');
                picker.className = 'line-candidate-picker';
                const search = document.createElement('input');
                search.type = 'search';
                search.className = 'line-candidate-search';
                search.autocomplete = 'off';
                search.placeholder = '商品名・コードで全商品検索';
                search.setAttribute('aria-label', `${entry.source_text}の商品検索`);
                const searchStatus = document.createElement('small');
                searchStatus.className = 'line-candidate-status';
                const select = document.createElement('select');
                select.className = 'line-candidate-select';
                select.setAttribute('aria-label', `${entry.source_text}の商品候補`);
                let shownCandidates = entry.candidates || [];

                const showCandidates = (candidates, searching = false) => {
                    shownCandidates = candidates;
                    select.replaceChildren();
                    const blank = document.createElement('option');
                    blank.value = '';
                    blank.textContent = candidates.length ? '候補から選ぶ' : '該当商品なし';
                    select.appendChild(blank);
                    candidates.forEach((candidate) => {
                        const option = document.createElement('option');
                        option.value = lineProductCode(candidate);
                        option.textContent = lineProductLabel(candidate);
                        select.appendChild(option);
                    });
                    select.disabled = candidates.length === 0;
                    searchStatus.textContent = searching
                        ? `検索結果 ${candidates.length}件（最大50件）${candidates.length === 1 ? '／Enterでも選択' : ''}`
                        : `★お気に入り${lineImportFavorites.length}商品を優先／全${lineImportProducts.length.toLocaleString('ja-JP')}商品`;
                };

                const clearManualProduct = () => {
                    entry.product = null;
                    entry.reason = '候補を選んでください';
                    syncMatchView();
                    updateLineImportReadiness();
                };

                showCandidates(shownCandidates);
                search.addEventListener('input', () => {
                    clearManualProduct();
                    const query = search.value.trim();
                    showCandidates(query ? lineMatch.searchProducts(query, lineImportProducts) : entry.candidates, Boolean(query));
                });
                search.addEventListener('keydown', (event) => {
                    if (event.key !== 'Enter' || shownCandidates.length !== 1) return;
                    event.preventDefault();
                    select.value = lineProductCode(shownCandidates[0]);
                    select.dispatchEvent(new Event('change'));
                });
                select.addEventListener('change', () => {
                    entry.product = lineImportProductByCode.get(select.value) || null;
                    entry.reason = entry.product
                        ? entry.product.favorite ? 'お気に入りから手動選択' : '全商品から手動選択'
                        : '候補を選んでください';
                    syncMatchView();
                    updateLineImportReadiness();
                });
                picker.append(search, searchStatus, select);
                match.appendChild(picker);
            }

            const quantityBlock = document.createElement('div');
            quantityBlock.className = 'line-import-quantity';
            const quantityLabel = document.createElement('label');
            quantityLabel.textContent = '数量';
            quantityLabel.htmlFor = `line-import-qty-${index}`;
            const quantity = document.createElement('input');
            quantity.id = `line-import-qty-${index}`;
            quantity.type = 'number';
            quantity.inputMode = 'numeric';
            quantity.min = '1';
            quantity.max = '999';
            quantity.value = entry.quantity || '';
            quantity.className = 'line-import-qty';
            quantity.classList.toggle('is-invalid', !entry.quantity);
            quantity.addEventListener('input', () => {
                const value = Number.parseInt(quantity.value, 10);
                entry.quantity = Number.isInteger(value) && value >= 1 && value <= 999 ? value : null;
                quantity.classList.toggle('is-invalid', !entry.quantity);
                row.classList.toggle('needs-attention', !entry.product || !entry.quantity);
                updateLineImportReadiness();
            });
            quantityBlock.append(quantityLabel, quantity);

            const exclude = document.createElement('button');
            exclude.type = 'button';
            exclude.className = 'line-import-exclude';
            exclude.textContent = 'この行を除外';
            exclude.addEventListener('click', () => {
                entry.excluded = !entry.excluded;
                row.classList.toggle('is-excluded', entry.excluded);
                exclude.textContent = entry.excluded ? '除外を戻す' : 'この行を除外';
                updateLineImportReadiness();
            });

            row.append(source, match, quantityBlock, exclude);
            lineImportList.appendChild(row);
        });

        lineImportTime.textContent = result.elapsed_ms < 1 ? '<1ms' : `${Math.round(result.elapsed_ms)}ms`;
        lineImportInputStep.classList.add('hidden');
        lineImportPreviewStep.classList.remove('hidden');
        updateLineImportReadiness();
    };

    const openLineImportModal = () => {
        if (!ENABLE_LINE_TEXT_IMPORT || !isMasterSession) return;
        if (!lineMatch) {
            alert('LINE取込機能を読み込めませんでした。画面を再読み込みしてください。');
            return;
        }
        if (!itemsData.length) {
            alert('商品データを読み込み中です。少し待ってからもう一度お試しください。');
            return;
        }
        buildLineImportCatalog();
        lineImportEntries = [];
        lineImportText.value = '';
        lineImportList.replaceChildren();
        setLineImportStatus('');
        lineImportInputStep.classList.remove('hidden');
        lineImportPreviewStep.classList.add('hidden');
        lineImportModal.classList.remove('hidden');
        lineImportOverlay.classList.remove('hidden');
        setTimeout(() => lineImportText.focus(), 0);
    };

    const closeLineImportModal = () => {
        lineImportModal.classList.add('hidden');
        lineImportOverlay.classList.add('hidden');
    };

    const parseLineImport = () => {
        const text = lineImportText.value.trim();
        if (!text) {
            setLineImportStatus('LINEの注文文面を貼り付けてください。', true);
            lineImportText.focus();
            return;
        }
        setLineImportStatus('');
        const result = lineMatch.parseLineOrderText(text, lineImportFavorites, lineImportProducts);
        if (!result.entries.length) {
            setLineImportStatus('商品として読み取れる行がありませんでした。', true);
            return;
        }
        renderLineImportResults(result);
    };

    const applyLineImportToCart = () => {
        const counts = lineImportCounts();
        if (!counts.active.length || counts.attention > 0) return;
        counts.ready.forEach((entry) => {
            const product = entry.product;
            const code = lineProductCode(product);
            const existingQty = (currentCart[code] && currentCart[code].qty) || 0;
            updateFromCart(code, lineProductName(product), existingQty + entry.quantity);
        });
        closeLineImportModal();
        openCartSidebar();
    };

    if (lineImportBtn) lineImportBtn.addEventListener('click', openLineImportModal);
    if (lineImportCloseBtn) lineImportCloseBtn.addEventListener('click', closeLineImportModal);
    if (lineImportOverlay) lineImportOverlay.addEventListener('click', closeLineImportModal);
    if (lineImportParseBtn) lineImportParseBtn.addEventListener('click', parseLineImport);
    if (lineImportBackBtn) lineImportBackBtn.addEventListener('click', () => {
        lineImportPreviewStep.classList.add('hidden');
        lineImportInputStep.classList.remove('hidden');
        setTimeout(() => lineImportText.focus(), 0);
    });
    if (lineImportApplyBtn) lineImportApplyBtn.addEventListener('click', applyLineImportToCart);

    // ==========================================
    // 発注書画像取込（固定座標＋Gemini数量OCR・本店MASTER限定）
    // ==========================================
    const sheetOcr = window.SheetOrderOcr;
    const sheetOcrOverlay = document.getElementById('sheet-ocr-overlay');
    const sheetOcrModal = document.getElementById('sheet-ocr-modal');
    const sheetOcrCloseBtn = document.getElementById('sheet-ocr-close-btn');
    const sheetOcrPhoto = document.getElementById('sheet-ocr-photo');
    const sheetOcrPhotoBtn = document.getElementById('sheet-ocr-photo-btn');
    const sheetOcrUploadStep = document.getElementById('sheet-ocr-upload-step');
    const sheetOcrCornerStep = document.getElementById('sheet-ocr-corner-step');
    const sheetOcrProcessingStep = document.getElementById('sheet-ocr-processing-step');
    const sheetOcrReviewStep = document.getElementById('sheet-ocr-review-step');
    const sheetOcrPhotoCanvas = document.getElementById('sheet-ocr-photo-canvas');
    const sheetOcrCornerMessage = document.getElementById('sheet-ocr-corner-message');
    const sheetOcrCornerReset = document.getElementById('sheet-ocr-corner-reset');
    const sheetOcrRecognizeBtn = document.getElementById('sheet-ocr-recognize-btn');
    const sheetOcrReviewList = document.getElementById('sheet-ocr-review-list');
    const sheetOcrItemCount = document.getElementById('sheet-ocr-item-count');
    const sheetOcrAttentionCount = document.getElementById('sheet-ocr-attention-count');
    const sheetOcrTime = document.getElementById('sheet-ocr-time');
    const sheetOcrCartMessage = document.getElementById('sheet-ocr-cart-message');
    const sheetOcrCartBtn = document.getElementById('sheet-ocr-cart-btn');
    const sheetOcrStatus = document.getElementById('sheet-ocr-status');

    const sheetOcrState = {
        sourceCanvas: null,
        rectifiedCanvas: null,
        corners: [],
        qr: null,
        manifest: null,
        page: null,
        reviewRows: [],
        startedAt: 0,
        prepareMs: 0,
        machineMs: 0,
        reviewStartedAt: 0,
        busy: false
    };
    const SHEET_OCR_CORNER_LABELS = ['左上', '右上', '右下', '左下'];

    const setSheetOcrStep = (number) => {
        document.querySelectorAll('[data-sheet-ocr-step]').forEach((element) => {
            element.classList.toggle('is-active', Number(element.dataset.sheetOcrStep) === number);
        });
    };

    const showSheetOcrStatus = (message, isError = false) => {
        if (!sheetOcrStatus) return;
        sheetOcrStatus.textContent = message;
        sheetOcrStatus.classList.toggle('import-status-error', isError);
        sheetOcrStatus.classList.toggle('hidden', !message);
    };

    const callSheetOcrApi = async (payload) => {
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            redirect: 'follow',
            body: JSON.stringify({ ...payload, token: sessionToken, clientName: currentClientName })
        });
        const result = await response.json();
        if (!response.ok || result.status !== 'success') {
            throw new Error(String(result.message || '画像取り込みAPIでエラーが発生しました。').replace(/^Error:\s*/, ''));
        }
        return result;
    };

    const resetSheetOcrState = () => {
        sheetOcrState.sourceCanvas = null;
        sheetOcrState.rectifiedCanvas = null;
        sheetOcrState.corners = [];
        sheetOcrState.qr = null;
        sheetOcrState.manifest = null;
        sheetOcrState.page = null;
        sheetOcrState.reviewRows = [];
        sheetOcrState.startedAt = 0;
        sheetOcrState.prepareMs = 0;
        sheetOcrState.machineMs = 0;
        sheetOcrState.reviewStartedAt = 0;
        sheetOcrState.busy = false;
        if (sheetOcrPhoto) sheetOcrPhoto.value = '';
        if (sheetOcrReviewList) sheetOcrReviewList.replaceChildren();
        sheetOcrUploadStep.classList.remove('hidden');
        sheetOcrCornerStep.classList.add('hidden');
        sheetOcrProcessingStep.classList.add('hidden');
        sheetOcrReviewStep.classList.add('hidden');
        sheetOcrRecognizeBtn.disabled = true;
        setSheetOcrStep(1);
        showSheetOcrStatus('');
    };

    const imageFileToCanvas = async (file, maxLongEdge = 1800) => {
        let image;
        try {
            image = await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch (bitmapError) {
            image = await new Promise((resolve, reject) => {
                const url = URL.createObjectURL(file);
                const element = new Image();
                element.onload = () => { URL.revokeObjectURL(url); resolve(element); };
                element.onerror = () => { URL.revokeObjectURL(url); reject(bitmapError); };
                element.src = url;
            });
        }
        const scale = Math.min(1, maxLongEdge / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        if (typeof image.close === 'function') image.close();
        return canvas;
    };

    const isHeicFile = (file) => {
        const mime = String(file && file.type || '').toLowerCase();
        const name = String(file && file.name || '').toLowerCase();
        return mime === 'image/heic' || mime === 'image/heif' || /\.(heic|heif)$/.test(name);
    };

    const normalizeSheetOcrImageFile = async (file) => {
        if (!isHeicFile(file)) return file;
        showSheetOcrStatus('HEIC写真を端末内でJPEGへ変換しています。写真は外部へ送信しません。');
        try {
            const converter = await import('./lib/heic-to.js?v=1.5.2');
            const jpegBlob = await converter.heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
            return new File([jpegBlob], String(file.name || 'order-sheet').replace(/\.(heic|heif)$/i, '') + '.jpg', {
                type: 'image/jpeg',
                lastModified: file.lastModified || Date.now()
            });
        } catch (error) {
            console.warn('[SheetOCR] HEIC conversion failed:', error);
            throw new Error('HEIC写真を変換できませんでした。iPhoneの共有画面で「互換性優先」にするか、JPEGで撮り直してください。');
        }
    };

    const canvasToFile = (canvas, name) => new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) { reject(new Error('写真をJPEGへ変換できません。')); return; }
            resolve(new File([blob], name, { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.9);
    });

    const decodeSheetOcrQr = async (file, fallbackCanvas) => {
        if (typeof Html5Qrcode !== 'function') throw new Error('QR読み取り機能を読み込めませんでした。');
        const scanner = new Html5Qrcode('sheet-ocr-qr-reader');
        try {
            let decoded = '';
            try {
                decoded = await scanner.scanFile(file, true);
            } catch (firstError) {
                const converted = await canvasToFile(fallbackCanvas, `sheet-ocr-${Date.now()}.jpg`);
                decoded = await scanner.scanFile(converted, true);
            }
            return sheetOcr.parseQrValue(decoded);
        } catch (error) {
            return null;
        } finally {
            try { scanner.clear(); } catch (error) { /* noop */ }
        }
    };

    const drawSheetOcrCorners = () => {
        if (!sheetOcrState.sourceCanvas) return;
        sheetOcrPhotoCanvas.width = sheetOcrState.sourceCanvas.width;
        sheetOcrPhotoCanvas.height = sheetOcrState.sourceCanvas.height;
        const context = sheetOcrPhotoCanvas.getContext('2d');
        context.drawImage(sheetOcrState.sourceCanvas, 0, 0);
        if (sheetOcrState.corners.length > 1) {
            context.beginPath();
            context.moveTo(sheetOcrState.corners[0].x, sheetOcrState.corners[0].y);
            sheetOcrState.corners.slice(1).forEach((point) => context.lineTo(point.x, point.y));
            if (sheetOcrState.corners.length === 4) context.closePath();
            context.strokeStyle = '#f97316';
            context.lineWidth = Math.max(4, sheetOcrPhotoCanvas.width / 230);
            context.stroke();
        }
        sheetOcrState.corners.forEach((point, index) => {
            context.beginPath();
            context.fillStyle = '#f97316';
            context.arc(point.x, point.y, Math.max(12, sheetOcrPhotoCanvas.width / 75), 0, Math.PI * 2);
            context.fill();
            context.fillStyle = '#fff';
            context.font = `900 ${Math.max(16, sheetOcrPhotoCanvas.width / 48)}px Menlo, monospace`;
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(String(index + 1), point.x, point.y + 1);
        });
        const next = sheetOcrState.corners.length;
        sheetOcrCornerMessage.textContent = next < 4
            ? `紙の${SHEET_OCR_CORNER_LABELS[next]}をタップしてください。`
            : '四隅を指定しました。数量を読み取れます。';
        sheetOcrRecognizeBtn.disabled = next !== 4;
    };

    const resetSheetOcrCorners = () => {
        sheetOcrState.corners = [];
        drawSheetOcrCorners();
    };

    const loadSheetOcrPhoto = async (file) => {
        if (!file || sheetOcrState.busy) return;
        sheetOcrState.busy = true;
        sheetOcrPhotoBtn.disabled = true;
        sheetOcrPhotoBtn.textContent = '用紙IDを確認中…';
        showSheetOcrStatus('発注書のQRと保存済み位置JSONを照合しています。');
        sheetOcrState.startedAt = performance.now();
        try {
            if (file.size > 30 * 1024 * 1024) {
                throw new Error('写真が30MBを超えています。スマホの通常画質で撮り直してください。');
            }
            let browserFile = file;
            let sourceCanvas;
            try {
                sourceCanvas = await imageFileToCanvas(browserFile);
            } catch (nativeError) {
                if (!isHeicFile(file)) throw nativeError;
                browserFile = await normalizeSheetOcrImageFile(file);
                sourceCanvas = await imageFileToCanvas(browserFile);
            }
            const qr = await decodeSheetOcrQr(browserFile, sourceCanvas);
            if (!qr) {
                throw new Error('新しい発注書用QRを読めませんでした。このサイトから発注書を再印刷し、明るい場所で紙全体を撮影してください。');
            }
            const response = await callSheetOcrApi({ action: 'get_order_sheet_layout', sheetId: qr.sheet_id });
            const manifest = response.data;
            const page = sheetOcr.getManifestPage(manifest, qr.page_no, currentClientName);
            sheetOcrState.sourceCanvas = sourceCanvas;
            sheetOcrState.qr = qr;
            sheetOcrState.manifest = manifest;
            sheetOcrState.page = page;
            sheetOcrState.corners = [];
            sheetOcrState.prepareMs = performance.now() - sheetOcrState.startedAt;
            sheetOcrUploadStep.classList.add('hidden');
            sheetOcrCornerStep.classList.remove('hidden');
            setSheetOcrStep(2);
            showSheetOcrStatus(`${manifest.printed_product_count}商品の発注書・${qr.page_no}ページ目を確認しました（準備 ${(sheetOcrState.prepareMs / 1000).toFixed(1)}秒）。`);
            drawSheetOcrCorners();
        } catch (error) {
            showSheetOcrStatus(error.message || '写真を読み込めませんでした。', true);
            if (sheetOcrPhoto) sheetOcrPhoto.value = '';
        } finally {
            sheetOcrState.busy = false;
            sheetOcrPhotoBtn.disabled = false;
            sheetOcrPhotoBtn.textContent = 'カメラで撮る・写真を選ぶ';
        }
    };

    const updateSheetOcrReadiness = () => {
        const invalid = sheetOcrState.reviewRows.filter((row) => !Number.isInteger(row.quantity) || row.quantity < 0 || row.quantity > 999);
        const included = sheetOcrState.reviewRows.filter((row) => Number.isInteger(row.quantity) && row.quantity > 0);
        const attention = sheetOcrState.reviewRows.filter((row) => (
            !Number.isInteger(row.quantity) || row.quantity < 0 || row.quantity > 999 ||
            (row.quantity > 0 && row.confidence !== 'high')
        ));
        sheetOcrAttentionCount.textContent = String(attention.length);
        sheetOcrCartBtn.disabled = included.length === 0 || invalid.length > 0;
        sheetOcrCartMessage.textContent = invalid.length > 0
            ? `${invalid.length}商品の数量を修正してください。誤検出は0で除外できます。`
            : included.length === 0
                ? 'カートへ入れる商品を1件以上残してください。'
                : attention.length > 0
                    ? `黄色の${attention.length}件を確認してください。誤検出は0で除外できます。`
                    : `${included.length}商品をカートへ追加できます。`;
    };

    const renderSheetOcrReview = () => {
        sheetOcrReviewList.replaceChildren();
        sheetOcrState.reviewRows.forEach((row, index) => {
            const article = document.createElement('article');
            article.className = 'sheet-ocr-review-row';

            const product = document.createElement('div');
            product.className = 'sheet-ocr-product';
            const name = document.createElement('strong');
            name.textContent = row.name;
            const code = document.createElement('code');
            code.textContent = `CODE ${row.code}`;
            const strip = document.createElement('img');
            strip.className = 'sheet-ocr-strip';
            strip.alt = `${row.name}の商品名から数量欄までの元画像`;
            strip.src = sheetOcr.cropRowDataUrl(sheetOcrState.rectifiedCanvas, row.row_bbox);
            const reading = document.createElement('span');
            reading.className = 'sheet-ocr-reading';
            reading.textContent = row.mark_type === 'japanese_tally'
                ? `正の字「${row.raw_reading || '記入'}」→ ${row.quantity ?? '要確認'}`
                : row.mark_type === 'unclear'
                    ? '読み取り不明・数字を入力'
                    : `読み取り ${row.raw_reading || row.quantity || '要確認'}`;
            reading.classList.toggle('is-attention', row.confidence !== 'high' || !row.quantity);
            product.append(name, code, strip, reading);

            const quantityBlock = document.createElement('div');
            quantityBlock.className = 'sheet-ocr-quantity';
            const label = document.createElement('label');
            label.htmlFor = `sheet-ocr-qty-${index}`;
            label.textContent = '数量';
            const quantity = document.createElement('input');
            quantity.id = `sheet-ocr-qty-${index}`;
            quantity.className = 'sheet-ocr-qty';
            quantity.type = 'number';
            quantity.inputMode = 'numeric';
            quantity.min = '0';
            quantity.max = '999';
            quantity.value = row.quantity ?? '';
            const excludeHint = document.createElement('span');
            excludeHint.className = 'sheet-ocr-quantity-hint';
            excludeHint.textContent = '0で除外';
            const sync = () => {
                const value = Number.parseInt(quantity.value, 10);
                row.quantity = Number.isInteger(value) && value >= 0 && value <= 999 ? value : null;
                const invalid = !Number.isInteger(row.quantity);
                quantity.classList.toggle('is-invalid', invalid);
                article.classList.toggle('needs-attention', invalid || (row.quantity > 0 && row.confidence !== 'high'));
                article.classList.toggle('is-excluded', row.quantity === 0);
                updateSheetOcrReadiness();
            };
            quantity.addEventListener('input', sync);
            quantityBlock.append(label, quantity, excludeHint);
            article.append(product, quantityBlock);
            sheetOcrReviewList.appendChild(article);
            sync();
        });
        sheetOcrItemCount.textContent = String(sheetOcrState.reviewRows.length);
        sheetOcrTime.textContent = sheetOcrState.machineMs < 1000
            ? `${Math.round(sheetOcrState.machineMs)}ms`
            : `${(sheetOcrState.machineMs / 1000).toFixed(1)}秒`;
        updateSheetOcrReadiness();
    };

    const recognizeSheetOcrPhoto = async () => {
        if (sheetOcrState.busy || !sheetOcrState.sourceCanvas || !sheetOcrState.page) return;
        if (!sheetOcr.validCornerOrder(sheetOcrState.corners, sheetOcrState.sourceCanvas.width, sheetOcrState.sourceCanvas.height)) {
            showSheetOcrStatus('左上→右上→右下→左下の順で、紙の四隅を指定し直してください。', true);
            return;
        }
        sheetOcrState.busy = true;
        sheetOcrCornerStep.classList.add('hidden');
        sheetOcrProcessingStep.classList.remove('hidden');
        setSheetOcrStep(3);
        showSheetOcrStatus('');
        await new Promise((resolve) => setTimeout(resolve, 30));
        try {
            const startedAt = performance.now();
            const rectifiedCanvas = sheetOcr.warpPerspective(sheetOcrState.sourceCanvas, sheetOcrState.corners);
            const contactSheet = sheetOcr.buildContactSheet(rectifiedCanvas, sheetOcrState.page.products);
            const response = await callSheetOcrApi({
                action: 'recognize_order_sheet_cells',
                sheetId: sheetOcrState.qr.sheet_id,
                pageNo: sheetOcrState.qr.page_no,
                cellIds: sheetOcrState.page.products.map((product) => product.cell_id),
                imageBase64: contactSheet.toDataURL('image/jpeg', 0.88).split(',')[1]
            });
            const cells = sheetOcr.validateRecognition(response.data, sheetOcrState.page.products);
            const reviewRows = sheetOcr.buildReviewRows(sheetOcrState.page.products, cells, itemsData);
            if (reviewRows.length === 0) throw new Error('記入された数量を検出できませんでした。四隅と写真の明るさを確認してください。');
            sheetOcrState.rectifiedCanvas = rectifiedCanvas;
            sheetOcrState.reviewRows = reviewRows;
            sheetOcrState.machineMs = sheetOcrState.prepareMs + (performance.now() - startedAt);
            sheetOcrState.reviewStartedAt = performance.now();
            renderSheetOcrReview();
            sheetOcrProcessingStep.classList.add('hidden');
            sheetOcrReviewStep.classList.remove('hidden');
            setSheetOcrStep(4);
        } catch (error) {
            sheetOcrProcessingStep.classList.add('hidden');
            sheetOcrCornerStep.classList.remove('hidden');
            setSheetOcrStep(2);
            showSheetOcrStatus(error.message || '数量を読み取れませんでした。', true);
        } finally {
            sheetOcrState.busy = false;
        }
    };

    const closeSheetOcrModal = () => {
        if (sheetOcrState.busy) return;
        sheetOcrModal.classList.add('hidden');
        sheetOcrOverlay.classList.add('hidden');
        resetSheetOcrState();
    };

    const openSheetOcrModal = async () => {
        if (!ENABLE_SHEET_IMAGE_IMPORT || !isMasterSession || !currentClientName) return;
        if (!sheetOcr) {
            alert('画像取り込み機能を読み込めませんでした。画面を再読み込みしてください。');
            return;
        }
        resetSheetOcrState();
        sheetOcrModal.classList.remove('hidden');
        sheetOcrOverlay.classList.remove('hidden');
        sheetOcrPhotoBtn.disabled = true;
        showSheetOcrStatus('Gemini数量OCRの接続を確認しています。');
        try {
            const result = await callSheetOcrApi({ action: 'order_sheet_ocr_status' });
            if (!result.data.gemini_configured) throw new Error('Gemini APIが未設定です。管理者設定後に利用できます。');
            showSheetOcrStatus(`接続OK：${result.data.model}（数量欄のみ送信）`);
            sheetOcrPhotoBtn.disabled = false;
        } catch (error) {
            showSheetOcrStatus(error.message || '画像取り込みAPIへ接続できません。', true);
        }
    };

    const applySheetOcrToCart = () => {
        const invalid = sheetOcrState.reviewRows.find((row) => !Number.isInteger(row.quantity) || row.quantity < 0 || row.quantity > 999);
        if (invalid) return;
        const included = sheetOcrState.reviewRows.filter((row) => row.quantity > 0);
        if (included.length === 0) return;
        included.forEach((row) => {
            const existingQty = (currentCart[row.code] && currentCart[row.code].qty) || 0;
            updateFromCart(row.code, row.name, existingQty + row.quantity);
        });
        const reviewMs = Math.max(0, performance.now() - sheetOcrState.reviewStartedAt);
        console.log(`[SheetOCR] machine=${Math.round(sheetOcrState.machineMs)}ms review=${Math.round(reviewMs)}ms items=${included.length}`);
        closeSheetOcrModal();
        openCartSidebar();
    };

    if (sheetImageImportBtn) sheetImageImportBtn.addEventListener('click', openSheetOcrModal);
    if (sheetOcrCloseBtn) sheetOcrCloseBtn.addEventListener('click', closeSheetOcrModal);
    if (sheetOcrOverlay) sheetOcrOverlay.addEventListener('click', closeSheetOcrModal);
    if (sheetOcrPhotoBtn) sheetOcrPhotoBtn.addEventListener('click', () => sheetOcrPhoto.click());
    if (sheetOcrPhoto) sheetOcrPhoto.addEventListener('change', () => loadSheetOcrPhoto(sheetOcrPhoto.files && sheetOcrPhoto.files[0]));
    if (sheetOcrCornerReset) sheetOcrCornerReset.addEventListener('click', resetSheetOcrCorners);
    if (sheetOcrPhotoCanvas) sheetOcrPhotoCanvas.addEventListener('click', (event) => {
        if (!sheetOcrState.sourceCanvas || sheetOcrState.corners.length >= 4) return;
        const rect = sheetOcrPhotoCanvas.getBoundingClientRect();
        sheetOcrState.corners.push({
            x: (event.clientX - rect.left) * sheetOcrPhotoCanvas.width / rect.width,
            y: (event.clientY - rect.top) * sheetOcrPhotoCanvas.height / rect.height
        });
        drawSheetOcrCorners();
    });
    if (sheetOcrRecognizeBtn) sheetOcrRecognizeBtn.addEventListener('click', recognizeSheetOcrPhoto);
    if (sheetOcrCartBtn) sheetOcrCartBtn.addEventListener('click', applySheetOcrToCart);

    // ==========================================
    // 📥 旧AI取り込みモード（停止中・MASTERログイン限定）
    // ==========================================
    const importModeBtn = document.getElementById('import-mode-btn');
    const importOverlay = document.getElementById('import-overlay');
    const importModal = document.getElementById('import-modal');
    const importCloseBtn = document.getElementById('import-close-btn');
    const importText = document.getElementById('import-text');
    const importParseBtn = document.getElementById('import-parse-btn');
    const importStatus = document.getElementById('import-status');
    const importInputStep = document.getElementById('import-input-step');
    const importPreviewStep = document.getElementById('import-preview-step');
    const importPreviewList = document.getElementById('import-preview-list');
    const importUnmatchedWrapper = document.getElementById('import-unmatched-wrapper');
    const importUnmatchedList = document.getElementById('import-unmatched-list');
    const importBackBtn = document.getElementById('import-back-btn');
    const importApplyBtn = document.getElementById('import-apply-btn');
    const importHighAccuracyBtn = document.getElementById('import-high-accuracy-btn');
    const importUsageSummary = document.getElementById('import-usage-summary');

    const importPhotosInput = document.getElementById('import-photos');
    const importPhotoLabel = document.querySelector('.import-photo-label');
    const importPhotoThumbs = document.getElementById('import-photo-thumbs');

    let importParsedItems = [];
    let isParsingImport = false;
    let importImages = []; // [{data, preview, standardSheet, qrSalon}]
    const IMPORT_MAX_PHOTOS = 3;
    const IMPORT_PHOTO_LONG_EDGE = 1568; // Claude vision の推奨解像度に縮小して転送量とコストを抑える

    const selectedImageModel = (radioName) => {
        const selected = document.querySelector(`input[name="${radioName}"]:checked`);
        return selected && selected.value === 'opus' ? 'opus' : 'sonnet';
    };
    const resetImageModel = (radioName) => {
        const sonnet = document.querySelector(`input[name="${radioName}"][value="sonnet"]`);
        if (sonnet) sonnet.checked = true;
    };
    const disableImageModelPicker = (radioName, disabled) => {
        document.querySelectorAll(`input[name="${radioName}"]`).forEach((input) => { input.disabled = disabled; });
    };

    // 写真をcanvasで縮小してJPEG base64にする
    const resizeImportPhoto = (file) => new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const scale = Math.min(1, IMPORT_PHOTO_LONG_EDGE / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');
            // 細い印字を保ちつつ紙面の影を弱める。画像寸法は据え置きなのでAIコストは増えない。
            ctx.filter = 'contrast(1.12) saturate(0.92)';
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
            resolve({ data: dataUrl.split(',')[1], preview: dataUrl });
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
        img.src = url;
    });

    const importDataUrlToFile = async (dataUrl, fileName) => {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        return new File([blob], fileName, { type: blob.type || 'image/jpeg' });
    };

    const renderImportThumbs = () => {
        if (!importPhotoThumbs) return;
        importPhotoThumbs.innerHTML = '';
        importImages.forEach((im, idx) => {
            const wrap = document.createElement('div');
            wrap.className = 'import-thumb';
            wrap.innerHTML = `<img src="${im.preview}" alt="発注書${idx + 1}"><button type="button" class="import-thumb-del" data-idx="${idx}">&times;</button>`;
            importPhotoThumbs.appendChild(wrap);
        });
        if (importPhotoLabel) {
            importPhotoLabel.classList.toggle('import-photo-label-full', importImages.length >= IMPORT_MAX_PHOTOS);
        }
    };

    if (importPhotoLabel && importPhotosInput) {
        importPhotoLabel.addEventListener('click', (e) => {
            e.preventDefault();
            if (importImages.length >= IMPORT_MAX_PHOTOS) { alert(`写真は${IMPORT_MAX_PHOTOS}枚までです。`); return; }
            importPhotosInput.click();
        });
        importPhotosInput.addEventListener('change', async () => {
            const files = Array.from(importPhotosInput.files || []);
            importPhotosInput.value = '';
            let qrScanner = null;
            try { qrScanner = new Html5Qrcode('batch-qr-scratch'); } catch (e) { console.warn('[Import] QR scanner unavailable:', e); }
            for (const f of files) {
                if (importImages.length >= IMPORT_MAX_PHOTOS) { alert(`写真は${IMPORT_MAX_PHOTOS}枚までです。`); break; }
                try {
                    const resized = await resizeImportPhoto(f);
                    let qrSalon = qrScanner ? await decodeSalonQr(qrScanner, f) : null;
                    if (!qrSalon && qrScanner) {
                        const qrFile = await importDataUrlToFile(resized.preview, `qr-${Date.now()}.jpg`);
                        qrSalon = await decodeSalonQr(qrScanner, qrFile);
                    }
                    importImages.push({
                        ...resized,
                        standardSheet: Boolean(qrSalon),
                        qrSalon: qrSalon || ''
                    });
                } catch (err) {
                    console.error('[Import] photo resize error:', err);
                    alert('写真の読み込みに失敗しました。');
                }
            }
            if (qrScanner) { try { qrScanner.clear(); } catch (e) { /* noop */ } }
            renderImportThumbs();
        });
    }
    if (importPhotoThumbs) {
        importPhotoThumbs.addEventListener('click', (e) => {
            const btn = e.target.closest('.import-thumb-del');
            if (!btn) return;
            importImages.splice(parseInt(btn.dataset.idx, 10), 1);
            renderImportThumbs();
        });
    }

    const escImportHtml = (s) => String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const showImportStatus = (msg, isError = false) => {
        if (!importStatus) return;
        importStatus.textContent = msg;
        importStatus.classList.toggle('import-status-error', isError);
        importStatus.classList.remove('hidden');
    };

    const openImportModal = () => {
        if (!isMasterSession) return; // 念のための二重ガード
        importParsedItems = [];
        importImages = [];
        renderImportThumbs();
        if (importText) importText.value = '';
        if (importStatus) importStatus.classList.add('hidden');
        if (importUsageSummary) importUsageSummary.classList.add('hidden');
        if (importHighAccuracyBtn) importHighAccuracyBtn.classList.add('hidden');
        resetImageModel('import-image-model');
        if (importInputStep) importInputStep.classList.remove('hidden');
        if (importPreviewStep) importPreviewStep.classList.add('hidden');
        importModal.classList.remove('hidden');
        importOverlay.classList.remove('hidden');
    };

    const closeImportModal = () => {
        importModal.classList.add('hidden');
        importOverlay.classList.add('hidden');
    };

    const confLabel = { high: 'ほぼ確実', medium: '推定', low: '要確認' };

    const renderImportPreview = (data) => {
        importParsedItems = data.items || [];
        const unmatched = data.unmatched || [];
        const debug = data.debug || {};
        console.info('[ImportDebug]', {
            ...debug,
            transcript: data.transcript || ''
        });

        importPreviewList.innerHTML = '';
        importParsedItems.forEach((it, idx) => {
            const row = document.createElement('div');
            row.className = `import-row conf-${it.confidence}`;
            row.innerHTML = `
                <label class="import-row-check">
                    <input type="checkbox" class="import-check" data-idx="${idx}" checked>
                </label>
                <div class="import-row-info">
                    <span class="import-row-source">「${escImportHtml(it.source_text)}」</span>
                    <span class="import-row-name">${escImportHtml(it.name)} <span class="import-row-code">${escImportHtml(it.code)}</span></span>
                    <span class="import-row-conf">${confLabel[it.confidence] || ''}${it.note ? '・' + escImportHtml(it.note) : ''}</span>
                </div>
                <input type="number" class="import-qty" data-idx="${idx}" value="${it.qty}" min="0" inputmode="numeric">
            `;
            importPreviewList.appendChild(row);
        });
        if (importParsedItems.length === 0) {
            importPreviewList.innerHTML = '<p class="import-empty">カートに入れられる商品が見つかりませんでした。</p>';
            const details = document.createElement('details');
            details.className = 'import-debug';
            details.open = true;
            const summary = document.createElement('summary');
            summary.textContent = '解析ログ' + (debug.requestId ? '（' + debug.requestId + '）' : '');
            const pre = document.createElement('pre');
            pre.textContent = [
                'OCR行数: ' + (debug.transcriptLines ?? '不明'),
                'コード直接照合: ' + (debug.directResolved ?? '不明'),
                'コード未解決: ' + (debug.directUnresolved ?? '不明'),
                '照合候補数: ' + (debug.candidateCount ?? data.candidateCount ?? '不明'),
                '最終一致: ' + (debug.matched ?? 0),
                '未一致: ' + (debug.unmatched ?? unmatched.length),
                '画像AI: ' + (debug.imageModel || '不明'),
                '概算コスト: $' + Number(debug.estimatedCostUsd || 0).toFixed(4),
                '',
                '--- OCR文字起こし ---',
                data.transcript || '（文字起こしなし）'
            ].join('\n');
            details.append(summary, pre);
            importPreviewList.appendChild(details);
        }

        importUnmatchedList.innerHTML = '';
        unmatched.forEach((u) => {
            const row = document.createElement('div');
            row.className = 'import-row import-row-unmatched';
            row.innerHTML = `
                <div class="import-row-info">
                    <span class="import-row-source">「${escImportHtml(u.source_text)}」${u.qty ? ` × ${u.qty}` : ''}</span>
                    <span class="import-row-conf">${escImportHtml(u.note)}</span>
                </div>
            `;
            importUnmatchedList.appendChild(row);
        });
        importUnmatchedWrapper.classList.toggle('hidden', unmatched.length === 0);

        if (importUsageSummary) {
            const usage = Array.isArray(debug.apiUsage) ? debug.apiUsage : [];
            const modelNames = usage.map((entry) => {
                const model = String(entry.model || '');
                if (model.includes('haiku')) return 'Haiku';
                if (model.includes('sonnet')) return 'Sonnet';
                if (model.includes('opus')) return 'Opus';
                return model || 'AI';
            }).filter((name, idx, arr) => arr.indexOf(name) === idx);
            const cost = Number(debug.estimatedCostUsd || 0);
            importUsageSummary.textContent = modelNames.length
                ? `使用AI: ${modelNames.join(' + ')}／概算 $${cost.toFixed(4)}`
                : '';
            importUsageSummary.classList.toggle('hidden', !modelNames.length);
        }
        if (importHighAccuracyBtn) {
            const usedSonnetForImage = String(debug.imageModel || '').includes('sonnet');
            importHighAccuracyBtn.classList.toggle('hidden', !(usedSonnetForImage && importImages.length > 0));
        }

        importInputStep.classList.add('hidden');
        importPreviewStep.classList.remove('hidden');
    };

    const parseImportText = async (forcedImageModel = '') => {
        if (isParsingImport) return;
        const text = (importText.value || '').trim();
        if (!text && importImages.length === 0) { showImportStatus('写真を追加するか、文面を貼り付けてください。', true); return; }
        if (!currentClientName) { showImportStatus('サロンに入室してから使ってください。', true); return; }

        const standardSheet = importImages.length > 0 && importImages.every((im) => im.standardSheet);
        const imageModel = forcedImageModel || selectedImageModel('import-image-model');
        const isHighAccuracyRetry = forcedImageModel === 'opus';

        isParsingImport = true;
        importParseBtn.disabled = true;
        disableImageModelPicker('import-image-model', true);
        if (importHighAccuracyBtn) {
            importHighAccuracyBtn.disabled = true;
            if (isHighAccuracyRetry) importHighAccuracyBtn.textContent = '高精度で再解析中...';
        }
        if (!isHighAccuracyRetry) {
            importParseBtn.textContent = importImages.length > 0
                ? 'AIが写真を読み取り中...（1分ほどかかります）'
                : 'AIが解析中...（30秒ほどかかります）';
        }
        showImportStatus('候補商品と照合しています...');

        try {
            const response = await fetch(CONFIG.API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                redirect: 'follow',
                body: JSON.stringify({
                    action: 'parse_order',
                    token: sessionToken,
                    clientName: currentClientName,
                    text: text,
                    images: importImages.map(im => im.data),
                    standardSheet: standardSheet,
                    forceImageModel: importImages.length > 0 ? imageModel : ''
                })
            });
            const result = await response.json();
            if (result.status === 'success') {
                renderImportPreview(result.data);
            } else {
                const message = '解析に失敗しました: ' + (result.message || '不明なエラー');
                if (isHighAccuracyRetry) alert(message);
                else showImportStatus(message, true);
            }
        } catch (e) {
            console.error('[Import] parse error:', e);
            if (isHighAccuracyRetry) alert('通信に失敗しました。');
            else showImportStatus('通信に失敗しました。もう一度お試しください。', true);
        } finally {
            isParsingImport = false;
            importParseBtn.disabled = false;
            importParseBtn.textContent = '解析する';
            disableImageModelPicker('import-image-model', false);
            if (importHighAccuracyBtn) {
                importHighAccuracyBtn.disabled = false;
                importHighAccuracyBtn.textContent = '高精度で再解析（Opus）';
            }
        }
    };

    const applyImportToCart = () => {
        let applied = 0;
        importPreviewList.querySelectorAll('.import-check:checked').forEach((cb) => {
            const idx = parseInt(cb.dataset.idx, 10);
            const it = importParsedItems[idx];
            if (!it) return;
            const qtyInput = importPreviewList.querySelector(`.import-qty[data-idx="${idx}"]`);
            const qty = Math.max(0, parseInt(qtyInput && qtyInput.value, 10) || 0);
            if (qty <= 0) return;
            const existingQty = (currentCart[it.code] && currentCart[it.code].qty) || 0;
            updateFromCart(it.code, it.name, existingQty + qty);
            applied++;
        });
        closeImportModal();
        // 一括取り込みのドラフトはカート反映で役目を終える
        try { localStorage.removeItem('b2b_import_draft_' + currentClientName); } catch (e) { /* noop */ }
        if (applied > 0) {
            alert(`${applied}品目をカートに追加しました。\n内容を確認してから「発注する」で確定してください。`);
        } else {
            alert('カートに追加した商品はありません。');
        }
    };

    if (importModeBtn) importModeBtn.addEventListener('click', openImportModal);
    if (importCloseBtn) importCloseBtn.addEventListener('click', closeImportModal);
    if (importOverlay) importOverlay.addEventListener('click', closeImportModal);
    if (importParseBtn) importParseBtn.addEventListener('click', () => parseImportText(''));
    if (importHighAccuracyBtn) importHighAccuracyBtn.addEventListener('click', () => parseImportText('opus'));
    if (importBackBtn) importBackBtn.addEventListener('click', () => {
        importPreviewStep.classList.add('hidden');
        importInputStep.classList.remove('hidden');
    });
    if (importApplyBtn) importApplyBtn.addEventListener('click', applyImportToCart);

    // ==========================================
    // 🖨 発注書ジェネレーター（QR付き・MASTERログイン限定）
    // ==========================================
    const printSheetBtn = document.getElementById('print-sheet-btn');
    const printLayoutOverlay = document.getElementById('print-layout-overlay');
    const printLayoutModal = document.getElementById('print-layout-modal');
    const printLayoutCloseBtn = document.getElementById('print-layout-close-btn');
    const printLayoutCreateBtn = document.getElementById('print-layout-create-btn');
    const IMPORT_QR_PREFIX = 'B2BORDER|'; // QRの中身: B2BORDER|サロン名（一括取り込みのサロン判定に使う）
    const importDraftKey = (salonName) => 'b2b_import_draft_' + salonName;
    const PRINT_RENDERER_VERSION = 'b2b-print-v2.39.2';

    const PRINT_SHEET_MAX_ITEMS = 240;
    const PRINT_ARCHIVE_MAX_PAGES = 6;      // アーカイブ履歴を遡る最大ページ数（50件×6）
    const PRINT_LAYOUTS = {
        2: { cols: 2, namePt: 10, codePt: 8.5, qtyMm: 12, cellMinMm: 8, blankMinMm: 9 },
        3: { cols: 3, namePt: 8.5, codePt: 7.5, qtyMm: 10, cellMinMm: 6, blankMinMm: 7 },
        4: { cols: 4, namePt: 7.5, codePt: 6.5, qtyMm: 9, cellMinMm: 5.6, blankMinMm: 7 }
    };
    // 印刷時のカテゴリ掲載順（この順でセクション化し、各セクション内は商品名あいうえお順）
    const PRINT_CATEGORY_ORDER = ['カラー関連', '2剤/ブリーチ', 'パーマ関連', 'ストレート関連', 'シャンプー', 'トリートメント', 'スキャルプ関連', '業務用商品', 'コスメ関連'];

    // アーカイブ履歴からも商品コードを集めて「全履歴」に近づける
    // アーカイブは「28日より古い履歴」しか返さないため中身は1日1回しか変わらない。
    // サロン別に24時間キャッシュし、同日2回目以降の発注書出力を即時にする。
    const ARCHIVE_CODES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
    const archiveCodesCacheKey = (salonName) => 'b2b_archive_codes_' + salonName;
    const collectArchiveCodes = async () => {
        try {
            const cached = JSON.parse(localStorage.getItem(archiveCodesCacheKey(currentClientName)) || 'null');
            if (cached && Array.isArray(cached.codes) && (Date.now() - cached.at) < ARCHIVE_CODES_CACHE_TTL_MS) {
                return cached.codes;
            }
        } catch (e) { /* 壊れたキャッシュは無視して取り直す */ }

        const codes = [];
        let before = '';
        try {
            for (let page = 0; page < PRINT_ARCHIVE_MAX_PAGES; page++) {
                showLoading(`アーカイブ履歴を集めています... ${page + 1}/${PRINT_ARCHIVE_MAX_PAGES}ページ`);
                let url = `${CONFIG.API_URL}?action=history_archive&clientName=${encodeURIComponent(currentClientName)}${tokenQuery()}`;
                if (before) url += `&before=${encodeURIComponent(before)}`;
                const res = await fetch(url);
                const result = await res.json();
                if (result.status !== 'success') break;
                (result.data || []).forEach((h) => codes.push(String(h.code).replace(/^'/, '').trim()));
                if (!result.hasMore || !result.nextBefore) break;
                before = result.nextBefore;
            }
            // 途中で例外が出た不完全な結果は保存しない（24時間分の穴になるため）
            try {
                localStorage.setItem(archiveCodesCacheKey(currentClientName), JSON.stringify({ at: Date.now(), codes }));
            } catch (e) { /* 容量超過等は無視（キャッシュなしで動作継続） */ }
        } catch (e) {
            console.warn('[PrintSheet] archive fetch failed (続行):', e);
        }
        return codes;
    };

    // 印刷用の子画面が実寸DOMから測った位置を、本店GASへ保存する。
    // 子画面へトークンを渡さず、認証済みの親画面だけがAPIを呼ぶ。
    window.registerOrderSheetLayoutFromPrint = async (measuredManifest) => {
        if (!ENABLE_SHEET_IMAGE_IMPORT || !isMasterSession || !currentClientName || !sheetOcr) {
            throw new Error('画像取り込み用の位置保存は本店MASTER限定です。');
        }
        const manifest = {
            ...measuredManifest,
            schema_version: '1.0',
            client_name: currentClientName
        };
        const result = await callSheetOcrApi({ action: 'save_order_sheet_layout', manifest });
        return result.data;
    };

    const printOrderSheet = async (requestedColumns, requestedPageLimit) => {
        if (!isMasterSession || !currentClientName) return;
        const baseLayout = PRINT_LAYOUTS[requestedColumns] || PRINT_LAYOUTS[3];
        const printCols = baseLayout.cols;
        // 枚数（1=片面1枚 / 2=両面1枚 / 0=縮小なし・枚数自由）
        // 全商品掲載は変えず、収まらない場合は全体の倍率を縮小して収める
        const pageLimit = [1, 2].indexOf(requestedPageLimit) !== -1 ? requestedPageLimit : 0;
        const PRINT_MIN_SCALE = 0.5; // これ以上の縮小は読めなくなるので、超える場合は枚数が増えるのを許容

        // ---- ページ分割の見積もりは実寸(mm)で行う ----
        // 以前は抽象的な重み(1ページ=42)で数えていたが実描画より2割ほど楽観的で、
        // 片面1枚指定でも実際は2枚に溢れていた（2026-08-09修正）。
        const PT_MM = 25.4 / 72;       // 1pt = 0.353mm
        const PRINT_BODY_W_MM = 192;   // A4幅210mm - 左右余白9mm×2
        const PAIR_GAP_MM = 2.8;       // .pair の列間gap
        // 1ページで本文に使える高さ = A4印字可能283mm(297-上8-下6) - ヘッダー実測 - OS間フォント差の安全余白4mm
        const PAGE1_BODY_MM = 245;     // 1枚目ヘッダー（タイトル・説明・大QR）実測32.4mm
        const PAGE_CONT_BODY_MM = 262; // 2枚目以降ヘッダー（小QR）実測14.8mm
        const CAT_HEAD_MM = 6.8;       // カテゴリ見出し。フォント固定なので縮小率に依存しない

        const scaledLayout = (s) => {
            const namePt = Math.round(baseLayout.namePt * s * 100) / 100;
            const qtyMm = Math.max(6, Math.round(baseLayout.qtyMm * s * 100) / 100); // 手書き数字が入る最小幅は確保
            // 1行に入る文字数（全角換算）は商品名欄の実幅÷実フォント幅。全角1文字≒1em、1.2mmは右padding等
            const nameColMm = (PRINT_BODY_W_MM - (printCols - 1) * PAIR_GAP_MM) / printCols - qtyMm - 1.2;
            return {
                namePt,
                codePt: Math.round(baseLayout.codePt * s * 100) / 100,
                qtyMm,
                cellMinMm: Math.round(baseLayout.cellMinMm * s * 100) / 100,
                blankMinMm: Math.round(baseLayout.blankMinMm * s * 100) / 100,
                visualChars: nameColMm / (namePt * PT_MM)
            };
        };

        // 本店ではお気に入りが「印刷する商品」の正本。お気に入りから外した商品を
        // 過去履歴が復活させないようにする（ミツアミ堂7SB/8SBで顕在化）。
        // 社員版は従来の全履歴方式を維持し、今回の先行導入範囲を本店だけに限定する。
        const favoritePrintCodes = (favoriteItems || [])
            .map((code) => String(code).replace(/^'/, '').trim())
            .filter(Boolean);
        const useFavoriteOnlyPrint = ENABLE_SHEET_IMAGE_IMPORT && favoritePrintCodes.length > 0;
        let archiveCodes = [];
        if (!useFavoriteOnlyPrint) {
            showLoading('全履歴を集めています...');
            archiveCodes = await collectArchiveCodes();
            hideLoading();
        }

        // 商品の集め方（順序が印刷順になる）:
        //  1. 直近履歴のよく頼む順（発注回数 → 最終発注日）
        //  2. お気に入り（導入履歴同期済みならほぼ全取引商品）
        //  3. アーカイブ履歴（古い順路の商品まで拾う）
        //  4. history_favorites.json（一括同期スナップショット・保険）
        const itemByCode = {};
        itemsData.forEach((it) => { itemByCode[it.code] = it; });
        // 選抜は「重要な順」（よく頼む順→最終発注日→収集順）で行い、表示は後でカテゴリ別に並べ替える
        let codes = Object.keys(orderFrequency)
            .sort((a, b) => (orderFrequency[b] - orderFrequency[a]) || ((lastOrderDate[b] || 0) - (lastOrderDate[a] || 0)));
        if (useFavoriteOnlyPrint) {
            const favoriteSet = new Set(favoritePrintCodes);
            codes = codes.filter((code) => favoriteSet.has(String(code).replace(/^'/, '').trim()));
        }
        const pushCode = (c) => { if (c && codes.indexOf(c) === -1) codes.push(c); };
        favoritePrintCodes.forEach(pushCode);
        if (!useFavoriteOnlyPrint) {
            archiveCodes.forEach(pushCode);
            if (historyFavoritesData && historyFavoritesData[currentClientCode]) {
                historyFavoritesData[currentClientCode].forEach(pushCode);
            }
        }
        const sheetItems = codes.filter((c) => itemByCode[c]).slice(0, PRINT_SHEET_MAX_ITEMS)
            .map((c) => ({ code: c, name: itemByCode[c].name, category: itemByCode[c].category || 'その他' }));

        if (sheetItems.length === 0) {
            alert('このサロンの履歴・お気に入りがまだありません。発注書を作るには履歴が必要です。');
            return;
        }

        const sheetOcrPrintEnabled = ENABLE_SHEET_IMAGE_IMPORT && Boolean(sheetOcr);
        const sheetOcrSheetId = sheetOcrPrintEnabled ? sheetOcr.makeSheetId() : '';

        // QR生成（本店は用紙ID＋ページ、社員は従来どおりサロン名）
        const makePrintQr = (value) => {
            qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
            const qr = qrcode(0, 'M');
            qr.addData(value, 'Byte');
            qr.make();
            return qr.createDataURL(6, 3);
        };

        const today = new Date();
        const dateStr = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`;

        // 選択した列数で列優先配置する。列数ごとに文字サイズと改ページ見積もりを変える。
        const cell = (it) => it
            ? `<div class="cell"${sheetOcrPrintEnabled ? ` data-sheet-ocr-code="${escImportHtml(it.code)}"` : ''}><span class="nm">${escImportHtml(it.name)}<span class="cd">CODE ${escImportHtml(it.code)}</span></span><span class="qty"></span></div>`
            : '<div class="cell empty"></div>';
        const estimateCellLines = (it, L) => {
            if (!it || !it.name) return 1;
            // 文字幅の全角換算（Hiragino Sans実測: 英数字≈0.65em・半角カナ≈0.50em。少し安全側に切り上げ）
            const visualWidth = Array.from(String(it.name)).reduce((sum, ch) => {
                if (/^[\x20-\x7e]$/.test(ch)) return sum + 0.66;
                if (/^[ｦ-ﾟ]$/.test(ch)) return sum + 0.52;
                return sum + 1;
            }, 0);
            return Math.max(1, Math.ceil(visualWidth / L.visualChars));
        };
        // 行の実寸: 商品名(折り返し行数ぶん) + CODE行 + 上下余白。Chrome実測と±0.1mmで一致する
        const rowHeightMm = (rowItems, L) => {
            const lines = Math.max(...rowItems.map((x) => estimateCellLines(x, L)));
            return Math.max(L.cellMinMm, lines * L.namePt * 1.08 * PT_MM + L.codePt * PT_MM + 0.9);
        };
        const blankCell = '<div class="cell"><span class="nm"></span><span class="qty"></span></div>';
        let freeWriteHtml = '<p class="sec">▼ 表にない商品はこちらへ（商品名・サイズ・数量）</p>';
        for (let i = 0; i < 4; i++) {
            freeWriteHtml += `<div class="pair blank">${blankCell.repeat(printCols)}</div>`;
        }

        const paginatePrintBlocks = (blocks) => {
            const pages = [];
            let page = [];
            let used = 0;
            let limit = PAGE1_BODY_MM;
            const pushPage = () => {
                if (page.length) pages.push(page);
                page = [];
                used = 0;
                limit = PAGE_CONT_BODY_MM;
            };
            blocks.forEach((block) => {
                // カテゴリ見出しがページ最下段に孤立しないよう、直後に最低1行入る余地まで見る
                if (block.type === 'cat' && page.length && used + block.heightMm + 6 > limit) pushPage();
                if (page.length && used + block.heightMm > limit) pushPage();
                page.push(block);
                used += block.heightMm;
            });
            pushPage();
            return pages;
        };

        // 商品リスト → カテゴリ別グルーピング → ブロック化 → ページ分割（枚数上限の試算にも使う）
        const buildPrintPages = (items, s) => {
            const L = scaledLayout(s);
            // 表示用: カテゴリ → 商品コード順（同じブランド・系列が自然に固まる）
            const byCategory = {};
            items.forEach((it) => {
                if (!byCategory[it.category]) byCategory[it.category] = [];
                byCategory[it.category].push(it);
            });
            const categoryKeys = Object.keys(byCategory).sort((a, b) => {
                const ia = PRINT_CATEGORY_ORDER.indexOf(a);
                const ib = PRINT_CATEGORY_ORDER.indexOf(b);
                if (ia !== -1 && ib !== -1) return ia - ib;
                if (ia !== -1) return -1;
                if (ib !== -1) return 1;
                return a.localeCompare(b, 'ja');
            });
            const printBlocks = [];
            categoryKeys.forEach((cat) => {
                printBlocks.push({ type: 'cat', heightMm: CAT_HEAD_MM, html: `<div class="cat">${escImportHtml(cat)}</div>` });
                const arr = byCategory[cat].slice()
                    .sort((a, b) => String(a.code).localeCompare(String(b.code), 'ja', { numeric: true }));
                const rows = Math.ceil(arr.length / printCols);
                for (let i = 0; i < rows; i++) {
                    let row = '';
                    const rowItems = [];
                    for (let k = 0; k < printCols; k++) {
                        const rowItem = arr[i + k * rows];
                        rowItems.push(rowItem);
                        row += cell(rowItem);
                    }
                    printBlocks.push({
                        type: 'row',
                        heightMm: rowHeightMm(rowItems, L),
                        html: `<div class="pair">${row}</div>`
                    });
                }
            });
            // 自由記入欄 = 見出し行7.5mm + 空欄4行（罫線ぶん+0.4mm）
            printBlocks.push({ type: 'free', heightMm: 7.5 + 4 * (L.blankMinMm + 0.4), html: freeWriteHtml });
            return paginatePrintBlocks(printBlocks);
        };

        // 全商品を必ず掲載する（枚数で絞らない方が親切、という運用判断・2026-08-04）。
        // 枚数指定があり収まらない場合は、商品を削らず全体の倍率を縮小して収める。
        let printScale = 1;
        let printPages = buildPrintPages(sheetItems, 1);
        if (pageLimit > 0 && printPages.length > pageLimit) {
            if (buildPrintPages(sheetItems, PRINT_MIN_SCALE).length > pageLimit) {
                printScale = PRINT_MIN_SCALE; // 下限まで縮めても収まらない場合は下限倍率＋枚数超過を許容
            } else {
                // 収まる範囲で最大の倍率（＝最小の縮小）を二分探索
                let lo = PRINT_MIN_SCALE, hi = 1;
                for (let i = 0; i < 14; i++) {
                    const mid = (lo + hi) / 2;
                    if (buildPrintPages(sheetItems, mid).length <= pageLimit) lo = mid; else hi = mid;
                }
                printScale = Math.floor(lo * 100) / 100; // 切り捨て（切り上げると収まらない側に転ぶ）
            }
            printPages = buildPrintPages(sheetItems, printScale);
            if (printPages.length > pageLimit) {
                alert(`商品数が多く、最小倍率(50%)でも指定枚数に収まらないため${printPages.length}ページになります（全商品掲載を優先します）。列数を増やすと収まりやすくなります。`);
            }
        }
        const layout = scaledLayout(printScale);
        const metaCountLabel = `掲載 ${sheetItems.length}商品（${useFavoriteOnlyPrint ? 'お気に入り' : 'お取引履歴'}より）`
            + (printScale < 0.995 ? `／縮小 ${Math.round(printScale * 100)}%` : '')
            + (sheetOcrPrintEnabled ? '／画像取込対応' : '');
        let pageQrDataUrls;
        try {
            pageQrDataUrls = printPages.map((_, index) => makePrintQr(
                sheetOcrPrintEnabled
                    ? sheetOcr.makeQrValue(sheetOcrSheetId, index + 1)
                    : IMPORT_QR_PREFIX + currentClientName
            ));
        } catch (e) {
            console.error('[PrintSheet] QR generation failed:', e);
            alert('QRコードの生成に失敗しました。');
            return;
        }

        const renderPage = (blocks, idx) => {
            const bodyHtml = blocks.map((block) => block.html).join('');
            const qrDataUrl = pageQrDataUrls[idx];
            if (idx === 0) {
                return `<section class="print-page first-page">
<div class="first-head">
  <div class="htxt">
    <h1>アクティム発注書</h1>
    <div class="salon">${escImportHtml(currentClientName)} 様</div>
    <div class="meta">発行日: ${dateStr} ／ ${metaCountLabel}</div>
  </div>
  <img class="qr-main" src="${qrDataUrl}" alt="QR">
</div>
<p class="note">✏️ ご注文の商品名の<b>右側にある数量欄</b>へご記入ください。表にない商品は最後の空欄にご記入ください。記入したページを全て写真に撮ってお送りください。</p>
${bodyHtml}
</section>`;
            }
            return `<section class="print-page cont-page">
<div class="cont-head">
  <div class="cont-title">
    <strong>アクティム発注書</strong>
    <span>${escImportHtml(currentClientName)} 様</span>
    <span>発注商品 続き ${idx + 1}/${printPages.length}</span>
  </div>
  <img class="qr-small" src="${qrDataUrl}" alt="QR">
</div>
${bodyHtml}
</section>`;
        };
        const pagesHtml = printPages.map(renderPage).join('');

        const sheetOcrRegistrationScript = sheetOcrPrintEnabled ? `<script>
(function () {
  const button = document.getElementById('print-action-btn');
  const normalizeBox = function (element, pageRect) {
    const rect = element.getBoundingClientRect();
    const mmPerPixel = 192 / pageRect.width;
    const xMm = 9 + (rect.left - pageRect.left) * mmPerPixel;
    const yMm = 8 + (rect.top - pageRect.top) * mmPerPixel;
    const widthMm = rect.width * mmPerPixel;
    const heightMm = rect.height * mmPerPixel;
    return [
      Math.max(0, Math.min(9999, Math.round(xMm / 210 * 10000))),
      Math.max(0, Math.min(9999, Math.round(yMm / 297 * 10000))),
      Math.max(1, Math.min(10000, Math.round(widthMm / 210 * 10000))),
      Math.max(1, Math.min(10000, Math.round(heightMm / 297 * 10000)))
    ];
  };
  const register = async function () {
    try {
      if (!window.opener || typeof window.opener.registerOrderSheetLayoutFromPrint !== 'function') {
        throw new Error('元の発注サイトが閉じています。');
      }
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const pages = Array.from(document.querySelectorAll('.print-page')).map(function (page, pageIndex) {
        const pageRect = page.getBoundingClientRect();
        const products = Array.from(page.querySelectorAll('.cell[data-sheet-ocr-code]')).map(function (cell, productIndex) {
          const quantity = cell.querySelector('.qty');
          return {
            cell_id: 'P' + (pageIndex + 1) + '-C' + String(productIndex + 1).padStart(3, '0'),
            product_code: cell.dataset.sheetOcrCode,
            row_bbox: normalizeBox(cell, pageRect),
            qty_bbox: normalizeBox(quantity, pageRect)
          };
        });
        return { page_no: pageIndex + 1, products: products };
      });
      await window.opener.registerOrderSheetLayoutFromPrint({
        sheet_id: '${sheetOcrSheetId}',
        renderer_version: '${PRINT_RENDERER_VERSION}',
        printed_product_count: ${sheetItems.length},
        pages: pages
      });
      button.disabled = false;
      button.textContent = '🖨 印刷（画像取込対応）';
      button.dataset.registered = '1';
    } catch (error) {
      button.disabled = true;
      button.textContent = '位置情報の保存に失敗・閉じて再作成';
      alert('画像取り込み用の位置情報を保存できませんでした。元の発注サイトを閉じずに、発注書を作り直してください。\\n' + (error.message || ''));
    }
  };
  setTimeout(register, 120);
}());
<\/script>` : '';

        const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>発注書 - ${escImportHtml(currentClientName)}様</title>
<style>
@page { size: A4; margin: 8mm 9mm 6mm 9mm; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { width: 192mm; font-family: "Hiragino Sans", "Yu Gothic", sans-serif; color: #111; font-size: 7pt; }
.print-page { position: relative; width: 192mm; min-height: 280mm; break-after: page; page-break-after: always; }
.print-page:last-child { break-after: auto; page-break-after: auto; }
.first-head { position: relative; min-height: 25mm; border-bottom: 2px solid #111; padding: 0 28mm 2mm 0; margin-bottom: 1.6mm; }
.first-head h1 { font-size: 12pt; line-height: 1.1; }
.first-head .salon { font-size: 11pt; font-weight: bold; margin-top: 1mm; }
.meta { font-size: 7pt; color: #444; margin-top: 0.8mm; }
.qr-main { position: absolute; top: 1mm; right: 0; width: 23mm; height: 23mm; display: block; }
.cont-head { position: relative; height: 13mm; border-bottom: 1.5px solid #111; margin-bottom: 1.4mm; padding-right: 15mm; }
.cont-title { display: flex; align-items: baseline; gap: 3mm; flex-wrap: wrap; font-size: 7pt; line-height: 1.2; }
.cont-title strong { font-size: 8pt; }
.qr-small { position: absolute; top: 0; right: 0; width: 12mm; height: 12mm; display: block; }
.note { font-size: 7pt; color: #333; margin-bottom: 1.6mm; }
.cat { font-size: 7.5pt; font-weight: bold; background: #ececec; padding: 0.7mm 1.2mm; margin-top: 1.4mm; break-after: avoid; page-break-after: avoid; }
.pair { display: flex; gap: 2.8mm; break-inside: avoid; page-break-inside: avoid; }
.cell { flex: 1; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) ${layout.qtyMm}mm; align-items: stretch; border-bottom: 1px solid #bbb; min-height: ${layout.cellMinMm}mm; }
.cell.empty { border-bottom: none; }
.nm { min-width: 0; padding: 0.2mm 1mm 0.2mm 0; font-size: ${layout.namePt}pt; font-weight: 700; line-height: 1.08; overflow-wrap: anywhere; }
.cd { display: block; margin-top: 0.2mm; color: #111; font-family: Menlo, Monaco, "Courier New", monospace; font-size: ${layout.codePt}pt; font-weight: 600; line-height: 1; letter-spacing: 0.03em; white-space: nowrap; }
.qty { min-width: 0; border: 1px solid #999; border-bottom: none; }
.pair.blank .cell { min-height: ${layout.blankMinMm}mm; }
.sec { font-size: 7.5pt; font-weight: bold; margin: 2.5mm 0 1mm; break-after: avoid; }
.print-btn { position: fixed; top: 8px; right: 8px; padding: 10px 18px; font-size: 12pt; cursor: pointer; z-index: 10; }
@media print { .print-btn { display: none; } }
</style></head><body>
<button id="print-action-btn" class="print-btn" onclick="window.print()"${sheetOcrPrintEnabled ? ' disabled' : ''}>${sheetOcrPrintEnabled ? '位置情報を保存中…' : '🖨 印刷'}</button>
${pagesHtml}
${sheetOcrRegistrationScript}
</body></html>`;

        const win = window.open('', '_blank');
        if (!win) { alert('ポップアップがブロックされました。許可してください。'); return; }
        win.document.write(html);
        win.document.close();
    };

    const openPrintLayoutModal = () => {
        if (!isMasterSession || !currentClientName || !printLayoutModal || !printLayoutOverlay) return;
        const defaultOption = printLayoutModal.querySelector('input[name="print-columns"][value="3"]');
        if (defaultOption) defaultOption.checked = true;
        const defaultPages = printLayoutModal.querySelector('input[name="print-pages"][value="2"]');
        if (defaultPages) defaultPages.checked = true;
        printLayoutModal.classList.remove('hidden');
        printLayoutOverlay.classList.remove('hidden');
    };
    const closePrintLayoutModal = () => {
        if (printLayoutModal) printLayoutModal.classList.add('hidden');
        if (printLayoutOverlay) printLayoutOverlay.classList.add('hidden');
    };

    if (printSheetBtn) printSheetBtn.addEventListener('click', openPrintLayoutModal);
    if (printLayoutCloseBtn) printLayoutCloseBtn.addEventListener('click', closePrintLayoutModal);
    if (printLayoutOverlay) printLayoutOverlay.addEventListener('click', closePrintLayoutModal);
    if (printLayoutCreateBtn) printLayoutCreateBtn.addEventListener('click', () => {
        const selected = printLayoutModal && printLayoutModal.querySelector('input[name="print-columns"]:checked');
        const columns = selected ? Number(selected.value) : 3;
        const selectedPages = printLayoutModal && printLayoutModal.querySelector('input[name="print-pages"]:checked');
        const pageLimit = selectedPages ? Number(selectedPages.value) : 2;
        closePrintLayoutModal();
        printOrderSheet(columns, pageLimit);
    });

    // ==========================================
    // 📥 一括取り込み（発注書の束 → QRでサロン自動仕分け・MASTER限定）
    // ==========================================
    const batchImportBtn = document.getElementById('batch-import-btn');
    const batchOverlay = document.getElementById('batch-overlay');
    const batchModal = document.getElementById('batch-modal');
    const batchCloseBtn = document.getElementById('batch-close-btn');
    const batchPhotosInput = document.getElementById('batch-photos');
    const batchPhotoLabel = document.querySelector('#batch-modal .import-photo-label');
    const batchList = document.getElementById('batch-list');
    const batchStartBtn = document.getElementById('batch-start-btn');
    const batchStatus = document.getElementById('batch-status');

    const BATCH_MAX_PHOTOS = 12;
    let batchPhotos = []; // [{salon: string|null, data: base64, preview: dataURL}]
    let isBatchRunning = false;

    const showBatchStatus = (msg, isError = false) => {
        if (!batchStatus) return;
        batchStatus.textContent = msg;
        batchStatus.classList.toggle('import-status-error', isError);
        batchStatus.classList.remove('hidden');
    };

    // 有効なサロン名一覧（マスターのサロン選択プルダウンから取得）
    const getValidSalonNames = () => {
        const names = new Set();
        document.querySelectorAll('#master-salon-select option').forEach((opt) => {
            try { names.add((JSON.parse(opt.value).name || '').trim()); } catch (e) { /* skip */ }
        });
        return names;
    };

    // 元解像度のファイルからQRを読む（縮小前の方がQRが読みやすい）
    const decodeSalonQr = async (scanner, file) => {
        try {
            const decoded = await scanner.scanFile(file, false);
            const prefixes = [IMPORT_QR_PREFIX, 'B2B_ORDER:']; // 旧OCRテスト発注書も標準書式として扱う
            for (const prefix of prefixes) {
                if (decoded && decoded.indexOf(prefix) === 0) {
                    return decoded.slice(prefix.length).trim();
                }
            }
            return null;
        } catch (e) {
            return null; // QRが見つからない・読めない
        }
    };

    const renderBatchList = () => {
        if (!batchList) return;
        batchList.innerHTML = '';
        const salonOptions = Array.from(getValidSalonNames()).sort((a, b) => a.localeCompare(b, 'ja'));
        batchPhotos.forEach((p, idx) => {
            const row = document.createElement('div');
            row.className = 'import-row' + (p.salon ? (p.manual ? ' conf-medium' : ' conf-high') : ' import-row-unmatched');
            let salonHtml;
            if (p.salon && !p.manual) {
                salonHtml = `<span class="import-row-name">${escImportHtml(p.salon)} 様</span>
                    <span class="import-row-conf" data-batch-result="${idx}">QR読み取りOK・解析待ち</span>`;
            } else {
                // QRなし → 直前の写真のサロンを初期値にした手動選択（裏面・2ページ目対策）
                const opts = ['<option value="">（スキップ）</option>'].concat(
                    salonOptions.map((n) => `<option value="${escImportHtml(n)}"${n === p.salon ? ' selected' : ''}>${escImportHtml(n)}</option>`)
                ).join('');
                salonHtml = `<span class="import-row-name">QRなし → サロンを指定：</span>
                    <select class="batch-salon-select" data-idx="${idx}">${opts}</select>
                    <span class="import-row-conf" data-batch-result="${idx}">${p.salon ? '直前の写真と同じサロンとして扱います（変更可）' : '未指定ならスキップされます'}</span>`;
            }
            row.innerHTML = `
                <img src="${p.preview}" class="batch-row-thumb" alt="発注書${idx + 1}">
                <div class="import-row-info">${salonHtml}</div>
                <button type="button" class="import-thumb-del batch-row-del" data-idx="${idx}">&times;</button>
            `;
            batchList.appendChild(row);
        });
        if (batchStartBtn) batchStartBtn.classList.toggle('hidden', !batchPhotos.some((p) => p.salon));
    };

    const openBatchModal = () => {
        batchPhotos = [];
        isBatchRunning = false;
        if (batchStatus) batchStatus.classList.add('hidden');
        if (batchStartBtn) { batchStartBtn.disabled = false; batchStartBtn.textContent = '解析開始'; }
        resetImageModel('batch-image-model');
        disableImageModelPicker('batch-image-model', false);
        renderBatchList();
        batchModal.classList.remove('hidden');
        batchOverlay.classList.remove('hidden');
    };

    const closeBatchModal = () => {
        if (isBatchRunning) {
            if (!confirm('解析の途中です。閉じますか？（処理済みのサロンのドラフトは保存されています）')) return;
        }
        batchModal.classList.add('hidden');
        batchOverlay.classList.add('hidden');
    };

    if (batchPhotoLabel && batchPhotosInput) {
        batchPhotoLabel.addEventListener('click', (e) => {
            e.preventDefault();
            if (isBatchRunning) return;
            batchPhotosInput.click();
        });
        batchPhotosInput.addEventListener('change', async () => {
            const files = Array.from(batchPhotosInput.files || []);
            batchPhotosInput.value = '';
            if (files.length === 0) return;
            showBatchStatus('QRを読み取っています...');
            const validNames = getValidSalonNames();
            let scanner = null;
            try { scanner = new Html5Qrcode('batch-qr-scratch'); } catch (e) { console.error(e); }
            for (const f of files) {
                if (batchPhotos.length >= BATCH_MAX_PHOTOS) { alert(`写真は${BATCH_MAX_PHOTOS}枚までです。`); break; }
                try {
                    const resized = await resizeImportPhoto(f);
                    let salon = scanner ? await decodeSalonQr(scanner, f) : null;
                    if (!salon && scanner) {
                        const qrFile = await importDataUrlToFile(resized.preview, `qr-${Date.now()}.jpg`);
                        salon = await decodeSalonQr(scanner, qrFile);
                    }
                    if (salon && !validNames.has(salon)) salon = null; // 登録サロン名と一致しないQRは不採用
                    let manual = false;
                    if (!salon && batchPhotos.length > 0) {
                        // QRなし＝発注書の裏面（2ページ目）の可能性が高い → 直前の写真のサロンを引き継ぐ（変更可）
                        const prev = batchPhotos[batchPhotos.length - 1];
                        if (prev.salon) { salon = prev.salon; manual = true; }
                    }
                    batchPhotos.push({ salon: salon, manual: manual, data: resized.data, preview: resized.preview });
                } catch (err) {
                    console.error('[Batch] resize error:', err);
                }
            }
            if (scanner) { try { scanner.clear(); } catch (e) { /* noop */ } }
            batchStatus.classList.add('hidden');
            renderBatchList();
        });
    }

    if (batchList) {
        batchList.addEventListener('click', (e) => {
            const btn = e.target.closest('.batch-row-del');
            if (!btn || isBatchRunning) return;
            batchPhotos.splice(parseInt(btn.dataset.idx, 10), 1);
            renderBatchList();
        });
        // QRなし写真のサロン手動指定
        batchList.addEventListener('change', (e) => {
            const sel = e.target.closest('.batch-salon-select');
            if (!sel || isBatchRunning) return;
            const idx = parseInt(sel.dataset.idx, 10);
            if (!batchPhotos[idx]) return;
            batchPhotos[idx].salon = sel.value || null;
            batchPhotos[idx].manual = true;
            renderBatchList();
        });
    }

    const runBatchImport = async () => {
        if (isBatchRunning) return;
        // サロンごとに写真をまとめる（同じサロンの複数ページは1回で解析）
        const groups = {};
        batchPhotos.forEach((p, idx) => {
            if (!p.salon) return;
            if (!groups[p.salon]) groups[p.salon] = { images: [], rowIdxs: [] };
            groups[p.salon].images.push(p.data);
            groups[p.salon].rowIdxs.push(idx);
        });
        const salons = Object.keys(groups);
        if (salons.length === 0) return;
        const imageModel = selectedImageModel('batch-image-model');

        isBatchRunning = true;
        batchStartBtn.disabled = true;
        disableImageModelPicker('batch-image-model', true);
        let done = 0, ok = 0;

        for (const salon of salons) {
            done++;
            batchStartBtn.textContent = `解析中... (${done}/${salons.length}) ${salon}様`;
            const setRowResult = (msg) => {
                groups[salon].rowIdxs.forEach((i) => {
                    const el = batchList.querySelector(`[data-batch-result="${i}"]`);
                    if (el) el.textContent = msg;
                });
            };
            setRowResult('AIが解析中...');
            try {
                const response = await fetch(CONFIG.API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    redirect: 'follow',
                    body: JSON.stringify({
                        action: 'parse_order',
                        token: sessionToken,
                        clientName: salon,
                        text: '',
                        images: groups[salon].images,
                        standardSheet: true,
                        forceImageModel: imageModel
                    })
                });
                const result = await response.json();
                if (result.status === 'success') {
                    const d = result.data;
                    d.savedAt = Date.now();
                    localStorage.setItem(importDraftKey(salon), JSON.stringify(d));
                    const cost = Number((d.debug && d.debug.estimatedCostUsd) || 0);
                    setRowResult(`✅ ${d.items.length}件マッチ／未マッチ${d.unmatched.length}件／約$${cost.toFixed(4)}（入室すると開きます）`);
                    ok++;
                } else {
                    setRowResult('❌ ' + (result.message || '解析に失敗'));
                }
            } catch (e) {
                console.error('[Batch] parse error:', e);
                setRowResult('❌ 通信に失敗しました');
            }
        }

        isBatchRunning = false;
        batchStartBtn.textContent = '解析完了';
        disableImageModelPicker('batch-image-model', false);
        showBatchStatus(`${ok}/${salons.length}サロンのドラフトを保存しました。サロンに入室すると自動でプレビューが開きます。`);
    };

    if (batchImportBtn) batchImportBtn.addEventListener('click', openBatchModal);
    if (batchCloseBtn) batchCloseBtn.addEventListener('click', closeBatchModal);
    if (batchOverlay) batchOverlay.addEventListener('click', closeBatchModal);
    if (batchStartBtn) batchStartBtn.addEventListener('click', runBatchImport);

    // 入室したサロンに一括取り込みのドラフトがあれば、プレビューを自動で開く
    const maybeOpenImportDraft = () => {
        if (!isMasterSession || !currentClientName) return;
        const raw = localStorage.getItem(importDraftKey(currentClientName));
        if (!raw) return;
        try {
            const draft = JSON.parse(raw);
            if (!draft.items || (draft.items.length === 0 && (!draft.unmatched || draft.unmatched.length === 0))) return;
            importImages = []; // 一括取り込みの画像は保存しない。別サロンの残存画像で再解析させない。
            if (importText) importText.value = '';
            importModal.classList.remove('hidden');
            importOverlay.classList.remove('hidden');
            renderImportPreview(draft);
        } catch (e) {
            console.warn('[Import] draft parse error:', e);
            localStorage.removeItem(importDraftKey(currentClientName));
        }
    };

});
