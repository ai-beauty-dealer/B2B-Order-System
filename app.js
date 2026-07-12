// v2.15.3 (JAN-TAIL-SEARCH)


document.addEventListener('DOMContentLoaded', () => {
    console.log('--- B2B Order System v2.15.3 (JAN-TAIL-SEARCH) Loaded ---');

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

    // UI Elements
    const loginForm = document.getElementById('login-form');
    const loginContainer = document.getElementById('login-container');
    const usernameInput = document.getElementById('username');
    const orderContainer = document.getElementById('order-container');
    const refreshItemsBtn = document.getElementById('refresh-items-btn');
    const logoutBtn = document.getElementById('logout-btn');
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
    const saveResumeSession = (u, p, name) => {
        try {
            localStorage.setItem('b2b_resume', JSON.stringify({ u, p, name }));
        } catch (e) { /* 保存不可でも通常動作 */ }
    };
    const clearResumeSession = () => {
        try { localStorage.removeItem('b2b_resume'); } catch (e) {}
    };
    const attemptAutoLogin = () => {
        let session = null;
        try { session = JSON.parse(localStorage.getItem('b2b_resume') || 'null'); }
        catch (e) { session = null; }
        if (!session || !session.u || !session.p) return;

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
        setTimeout(() => {
            if (cancelled) return;
            autoLoginInProgress = true;
            if (usernameInput) usernameInput.value = session.u;
            const pwEl = document.getElementById('password');
            if (pwEl) pwEl.value = session.p;
            const b = document.getElementById('auto-login-banner');
            if (b) b.remove();
            loginForm.style.display = '';
            // 既存のログイン処理をそのまま流用（新しい経路を作らない）
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
    let currentClientType = ''; // '直送' or ''
    let itemsData = [];
    let itemsPreparsedFromCache = false; // 自動ログイン猶予中にキャッシュをparse済みか
    let favoriteItems = [];
    let historyFavoritesData = null; // Mapping from history_favorites.json
    let currentFilter = 'all';
    let currentManufacturerFilter = 'all';
    let currentCategoryFilter = 'all';
    let orderFrequency = {}; // よく頼む順: 商品コード → このサロンの発注回数
    let lastOrderDate = {};  // 最終発注日順: 商品コード → 最後に頼んだ時刻(epoch)
    let currentSort = 'frequency'; // 並べ替え: frequency / lastdate / aiueo
    let editingOrderId = null;
    let currentCart = {};
    let cartOrder = []; // Track the order in which items are added to the cart
    let isSubmitting = false;

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
        if (confirmationTitle) {
            confirmationTitle.textContent = isEditing ? '発注内容の変更確認' : '発注内容の最終確認';
        }
        if (confirmationDesc) {
            confirmationDesc.textContent = isEditing
                ? '以下の内容で発注内容を変更しますか？'
                : '以下の内容で発注を確定しますか？';
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
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('b2b_favs_') ||
                key.startsWith('b2b_cart_') ||
                key === 'b2b_saved_username' ||
                key === 'b2b_remember_me') {
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
        location.reload();
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
                    <span class="cart-item-code">${code}</span>
                    <span class="cart-item-name">${data.name}</span>
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

        if (!currentClientName || !historyFavoritesData) {
            showSyncMsg('データが読み込まれていないか、ログイン情報が不正です。', 'error');
            return;
        }

        let historyCodes = historyFavoritesData[currentClientName] || [];
        
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
                <span class="item-code">${strCode.replace(/^'/, '')}</span>
                <span class="item-row-name">${item.name}${freqBadge}</span>
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
                detailsHtml += `<div class="history-item"><span>${item.name}</span><span>${item.qty}点</span></div>`;
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
            let url = `${CONFIG.API_URL}?action=history_archive&clientName=${encodeURIComponent(currentClientName)}`;
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
                detailsHtml += `<div class="history-item"><span>${item.name}</span><span>${item.qty}点</span></div>`;
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
                <input type="text" class="custom-name-input" placeholder="商品名や規格を入力してください..." value="${initialName === '（商品名未入力）' ? '' : initialName}"
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
    const fetchHistory = async (forceRefresh = false) => {
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
            const url = `${CONFIG.API_URL}?action=history&clientName=${encodeURIComponent(currentClientName)}`;
            const response = await fetch(url);
            const result = await response.json();

            if (result.status === 'success') {
                // Save to cache
                localStorage.setItem(cacheKey, JSON.stringify(result.data));
                localStorage.setItem(cacheKey + '_ts', now.toString());
                
                renderHistory(result.data);
            } else {
                alert('履歴の取得に失敗しました: ' + result.message);
            }
        } catch (error) {
            console.error(error);
            alert('通信エラーが発生しました。');
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
            const url = `${CONFIG.API_URL}?action=history&clientName=${encodeURIComponent(currentClientName)}`;
            const res = await fetch(url);
            const result = await res.json();
            if (result.status === 'success') {
                localStorage.setItem(cacheKey, JSON.stringify(result.data));
                localStorage.setItem(cacheKey + '_ts', Date.now().toString());
                buildOrderFrequency(result.data);
                if (itemsData.length) renderItems(itemsData);
            }
        } catch (e) { /* 頻度が取れなくても通常動作 */ }
    };

    // --- 現在の選択(currentSort)で商品配列を並べ替える共通関数 ---
    const sortByCurrent = (items) => {
        const codeOf = (it) => String(it.code).replace(/^'/, '');
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
                    maintenanceMsgEl.innerHTML = maintenanceMessage.replace(/\n/g, '<br>');
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
                try {
                    const favRes = await fetch(`${CONFIG.API_URL}?action=get_favorites&clientName=${encodeURIComponent(favClientName)}`);
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

    // --- Login (API) ---
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
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

                currentUsername = username;

                // --- Master / Group Account Logic ---
                if (result.isMaster || result.isGroup) {
                    currentClientType = result.isMaster ? 'MASTER' : 'GROUP';
                    console.log(`[DEBUG] ${result.isMaster ? 'Master' : 'Group'} Account detected`);
                    const masterAllClients = result.allClients || [];
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
                currentClientType = result.clientType || ''; // '直送' or ''

                // PWA: 次回の自動ログイン用にセッション保存
                autoLoginInProgress = false;
                saveResumeSession(username, password, currentClientName);

                await processLoginSuccess(result.announcement, result.isMaintenance, result.maintenanceMessage, result.dataVersion, result.favorites);
            } else {
                console.error('[DEBUG] Login Failed result:', result);
                // 自動ログインが認証エラーで失敗したら、
                // 記憶を消して手動ログインへ（無限ループ防止）
                if (autoLoginInProgress) {
                    clearResumeSession();
                    autoLoginInProgress = false;
                }
                alert('ログインに失敗しました: ' + result.message);
            }
        } catch (error) {
            console.error(error);
            // 通信エラーは一時的なので記憶は消さない（次回また自動で試す）
            autoLoginInProgress = false;
            alert('通信に失敗しました。');
            hideLoading();
        }
    });

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
            currentClientType = clientData.type;

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
            loginForm.classList.remove('hidden');
            clearCartFromStorage(); // Must be called before currentUsername is cleared
            currentUsername = '';
            // 切替キャンセル時もクリアしておく
            favoriteItems = [];
            currentCart = {};
            cartOrder = [];
        });
    }

    // --- Logout ---
    logoutBtn.addEventListener('click', () => {
        clearResumeSession(); // 明示ログアウト＝別の人に切り替える意図なので再開情報を消す
        clearCartFromStorage(); // Must be called before clearing currentUsername/currentClientName
        currentUsername = '';
        currentClientName = '';
        currentClientType = '';
        favoriteItems = [];
        currentCart = {};
        cartOrder = [];
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
        try {
            const action = isEditing ? 'update_order' : 'order';
            const payload = {
                action: action,
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
                alert(isEditing ? '発注内容を変更しました。' : '発注が完了しました！\n引き続き発注いただけます。');
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
        try {
            const payload = {
                action: 'multi_order',
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
                alert(isEditing ? '発注内容を変更しました。' : '発注が完了しました！\n引き続き発注いただけます。');
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
                        
                        row.innerHTML = `<div style="display: flex; justify-content: space-between;"><span class="confirm-item-name" style="font-weight: 600;">${data.name}</span><span class="confirm-item-qty">${data.qty}点</span></div>${assignHtml}`;
                        
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
    const SCAN_CONFIRM_MIN_GAP_MS = 450;
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
                janCode: janCode,
                clientName: currentClientName
            })
        }).catch(err => console.warn('Unknown JAN log failed:', err));
    };

    // スキャナ起動
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
                    // ブラウザのネイティブBarcode Detection APIを優先使用（GPU高速化）
                    experimentalFeatures: {
                        useBarCodeDetectorIfSupported: true
                    }
                },
                onScanSuccess,
                () => {}
            );
            if (scannerStatus) scannerStatus.textContent = 'バーコードを枠内に収めてください';
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

});
