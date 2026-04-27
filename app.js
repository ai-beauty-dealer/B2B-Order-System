// v2.12.6 (GLOBAL-SYNC-MASTER)


document.addEventListener('DOMContentLoaded', () => {
    console.log('--- B2B Order System v2.12.7 (DIAGNOSTIC-MODE) Loaded ---');

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
    const saveDraftBtn = document.getElementById('save-draft-btn');
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
    const getDraftKey = () => `b2b_draft_${currentUsername}_${currentClientName}`;

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
    let favoriteItems = [];
    let historyFavoritesData = null; // Mapping from history_favorites.json
    let currentFilter = 'all';
    let currentManufacturerFilter = 'all';
    let currentCategoryFilter = 'all';
    let editingOrderId = null;
    let currentCart = {};
    let cartOrder = []; // Track the order in which items are added to the cart
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
    const cartSaveBtn = document.getElementById('cart-save-draft-btn');
    const cartOrderBtn = document.getElementById('cart-order-submit-btn');

    if (cartSaveBtn) {
        cartSaveBtn.addEventListener('click', () => {
            if (saveDraftBtn) saveDraftBtn.click();
            closeCartSidebar();
        });
    }
    if (cartOrderBtn) {
        cartOrderBtn.addEventListener('click', () => {
            if (orderSubmitBtn) orderSubmitBtn.click();
            closeCartSidebar();
        });
    }


    const saveDraft = () => {
        localStorage.setItem(getDraftKey(), JSON.stringify(currentCart));
        console.log('Draft saved');
    };

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

    const loadDraft = () => {
        const savedDraft = localStorage.getItem(getDraftKey());
        if (!savedDraft) return;
        console.log('Draft detected for user:', currentUsername);
    };

    if (saveDraftBtn) {
        saveDraftBtn.addEventListener('click', saveDraft);
    }

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

        if (currentFilter === 'favorites') {
            // Feature 4: Sort all by Brand -> Level -> Tone first
            displayItems.sort((a, b) => {
                const infoA = extractInfo(a.name);
                const infoB = extractInfo(b.name);
                if (infoA.brand !== infoB.brand) return infoA.brand.localeCompare(infoB.brand);
                if (infoA.level !== infoB.level) {
                    if (infoA.level === null) return 1;
                    if (infoB.level === null) return -1;
                    return infoA.level - infoB.level;
                }
                return infoA.tone.localeCompare(infoB.tone);
            });

            // Feature 1: Grouping by Category (Color vs Perm)
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
        card.innerHTML = `
            <button type="button" class="btn-fav ${isFav ? 'active' : ''}" data-code="${strCode}">${isFav ? '★' : '☆'}</button>
            <div class="item-row-info">
                <span class="item-code">${strCode.replace(/^'/, '')}</span>
                <span class="item-row-name">${item.name}</span>
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
            if (val > 0) { val -= 1; input.value = val; updateCart(val); calculateTotal(); }
        });
        card.querySelector('.plus').addEventListener('click', () => {
            let val = parseInt(input.value) || 0;
            val += 1; input.value = val; updateCart(val); calculateTotal();
        });
        input.addEventListener('change', () => {
            let val = parseInt(input.value) || 0;
            if (val < 0) { val = 0; input.value = 0; }
            updateCart(val);
            calculateTotal();
        });

        return card;
    };

    // --- Render History ---
    const renderHistory = (historyData) => {
        historyListContainer.innerHTML = '';

        if (historyData.length === 0) {
            historyListContainer.innerHTML = '<p>発注履歴がありません。</p>';
            return;
        }

        // Group history by date string
        const groupedHistory = {};
        historyData.forEach(hist => {
            if (!groupedHistory[hist.date]) {
                groupedHistory[hist.date] = [];
            }
            groupedHistory[hist.date].push(hist);
        });

        Object.keys(groupedHistory).forEach(date => {
            const items = groupedHistory[date];
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
                        <button class="btn-secondary edit-order-btn ${isCompleted ? 'hidden' : ''}" data-order-id="${items[0].orderId}">変更</button>
                        <button class="btn-danger cancel-order-btn ${isCompleted ? 'hidden' : ''}" data-order-id="${items[0].orderId}">キャンセル</button>
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
            if (val > 0) { val -= 1; qtyInput.value = val; updateCart(val); calculateTotal(); }
        });

        plusBtn.addEventListener('click', () => {
            if (!nameInput.value.trim()) {
                alert('先に特注商品の「商品名や規格」を入力してください。');
                return;
            }
            let val = parseInt(qtyInput.value) || 0;
            val += 1; qtyInput.value = val; updateCart(val); calculateTotal();
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
        });

        removeBtn.addEventListener('click', () => {
            if (confirm('この特注商品を削除しますか？')) {
                delete currentCart[itemCode];
                cartOrder = cartOrder.filter(c => c !== itemCode);
                card.remove();
                calculateTotal();
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
        currentCart = {}; // Clear cart
        cartOrder = []; // Clear cart order
        if (orderSubmitBtn) orderSubmitBtn.textContent = '発注する';
        if (cancelEditBtn) cancelEditBtn.classList.add('hidden');
        if (customItemsList) customItemsList.innerHTML = '';
        calculateTotal();
        if (searchInput) searchInput.value = '';
        renderItems(itemsData); // Clear search filters
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

    // --- Tab Filtering ---
    const switchTab = (tabId) => {
        // Reset all
        tabAll.classList.remove('active');
        tabFavorites.classList.remove('active');
        tabHistory.classList.remove('active');

        document.getElementById(tabId).classList.add('active');

        if (tabId === 'tab-history') {
            itemListContainer.classList.add('hidden');
            searchWrapper.classList.add('hidden');
            cartSummary.classList.add('hidden');
            if (syncFavsWrapper) syncFavsWrapper.classList.add('hidden');
            if (customItemsWrapper) customItemsWrapper.classList.add('hidden');
            historyListContainer.classList.remove('hidden');
            fetchHistory(false); // Try cache first
        } else {
            itemListContainer.classList.remove('hidden');
            searchWrapper.classList.remove('hidden');
            cartSummary.classList.remove('hidden');

            // Sync Favorite Button visibility
            if (syncFavsWrapper) {
                if (tabId === 'tab-favorites') {
                    syncFavsWrapper.classList.remove('hidden');
                } else {
                    syncFavsWrapper.classList.add('hidden');
                }
            }

            if (customItemsWrapper) customItemsWrapper.classList.remove('hidden');
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
    const fetchItems = async (forceFetch = false) => {
        if (!currentUsername) return;

        // Check cache first
        if (!forceFetch) {
            const cachedData = localStorage.getItem('b2b_items_cache');
            const cachedTs = localStorage.getItem('b2b_items_ts');
            const now = Date.now();

            if (cachedData && cachedTs && (now - parseInt(cachedTs) < CACHE_DURATION)) {
                console.log('Using cached item data (valid for 24h)');
                try {
                    // Use setTimeout to avoid blocking main thread for large JSON parse
                    itemsData = JSON.parse(cachedData);
                    
                    // Delay low-priority rendering to prioritize UI responsiveness
                    setTimeout(() => {
                        renderManufacturerChips();
                        renderCategoryChips();
                        renderItems(itemsData);
                        if (announcementBanner) announcementBanner.classList.remove('hidden');
                        loadDraft();
                    }, 0);
                    return; // Exit early if cache is valid
                } catch (e) {
                    console.error('Failed to parse cache:', e);
                }
            }
        }

        showLoading(forceFetch ? '最新データを取得中...' : 'サーバーに接続中...');
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

                // Save to cache
                localStorage.setItem('b2b_items_cache', JSON.stringify(itemsData));
                localStorage.setItem('b2b_items_ts', Date.now().toString());

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
                loadDraft();
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
    const processLoginSuccess = async (announcement, isMaintenance, maintenanceMessage) => {
        loggedUnknownJans.clear(); // サロン切替時に未登録JANの送信済みSetをリセット
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

        // Load favorites from Cloud first, fallback to local
        try {
            const favRes = await fetch(`${CONFIG.API_URL}?action=get_favorites&clientName=${encodeURIComponent(currentClientName)}`);
            const favData = await favRes.json();
            if (favData.status === 'success' && favData.data && favData.data.length > 0) {
                // 有効なコードのみを抽出（指数表示などの破損データを除去し、シングルクォートも剥がす）
                favoriteItems = favData.data
                    .map(code => String(code).replace(/^'/, ''))
                    .filter(code => isValidCode(code));
                localStorage.setItem(getFavsKey(), JSON.stringify(favoriteItems));
                console.log('Loaded favorites from cloud (and filtered corrupted items)');
            } else {
                const savedFavs = localStorage.getItem(getFavsKey());
                favoriteItems = savedFavs ? JSON.parse(savedFavs).filter(code => isValidCode(code)) : [];
            }
        } catch (e) {
            console.warn('Failed to load favorites from cloud, falling back to local', e);
            const savedFavs = localStorage.getItem(getFavsKey());
            favoriteItems = savedFavs ? JSON.parse(savedFavs) : [];
        }

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

        // --- ANTI-FREEZE: Delay fetchItems slightly ---
        console.log(`[DEBUG] Login successful for ${currentClientName}, starting data fetch...`);
        setTimeout(() => {
            fetchItems();
            switchTab('tab-all'); // Explicitly set initial tab state
        }, 300);
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
                    }
                    hideLoading();
                    return;
                }

                currentClientName = (result.clientName || '').trim();
                currentClientType = result.clientType || ''; // '直送' or ''

                await processLoginSuccess(result.announcement, result.isMaintenance, result.maintenanceMessage);
            } else {
                console.error('[DEBUG] Login Failed result:', result);
                alert('ログインに失敗しました: ' + result.message);
            }
        } catch (error) {
            console.error(error);
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
                masterSalonSelect.dataset.maintenanceMessage || ''
            );
        });
    }

    if (masterCancelBtn) {
        masterCancelBtn.addEventListener('click', () => {
            document.getElementById('master-salon-selector').classList.add('hidden');
            if (globalSyncBtn) globalSyncBtn.classList.add('hidden');
            loginForm.classList.remove('hidden');
            currentUsername = '';
            // 切替キャンセル時もクリアしておく
            favoriteItems = [];
            currentCart = {};
            cartOrder = [];
        });
    }

    // --- Logout ---
    logoutBtn.addEventListener('click', () => {
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

    // --- Execute Order Helper ---
    const executeOrderActual = async (orders, isEditing, remarks, staffName = '') => {
        showLoading();
        try {
            const action = isEditing ? 'update_order' : 'order';
            const payload = {
                action: action,
                clientName: currentClientName,
                clientType: currentClientType, // '直送' or ''
                orders: orders,
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
                localStorage.removeItem(getDraftKey());
                if (customItemsList) customItemsList.innerHTML = '';
                resetEditMode();
                fetchHistory(true); // Force refresh history to include the new order
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
        }
    };

    const executeMultiOrderActual = async (orderGroups, updateOrderId = null) => {
        showLoading();
        try {
            const payload = {
                action: 'multi_order',
                orderGroups: orderGroups
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
                alert('発注が完了しました！\\n引き続き発注いただけます。');
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
                localStorage.removeItem(getDraftKey());
                if (customItemsList) customItemsList.innerHTML = '';
                resetEditMode();
                fetchHistory(true);
            } else {
                const errorMsg = result.message || '不明なエラーが発生しました。';
                if (errorMsg.includes('サーバーが混み合っています')) {
                    alert('【混雑中】' + errorMsg + '\\n\\n注文が完了していない可能性があります。数分後に再度お試しください。');
                } else {
                    alert('エラー: ' + errorMsg);
                }
            }
        } catch (error) {
            console.error(error);
            alert('通信エラーが発生しました。\\n（注文が完了していない可能性があります）');
        } finally {
            hideLoading();
        }
    };

    // --- Submit Order (API) ---
    if (orderSubmitBtn) {
        orderSubmitBtn.addEventListener('click', () => {
            const total = parseInt(totalQtySpan.textContent);
            if (total === 0) {
                alert('商品を1点以上選択してください。');
                return;
            }

            const orders = [];

            const isEditing = editingOrderId !== null;

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

    let html5QrcodeScanner = null;
    let lastScannedCode = '';
    let lastScanTime = 0;
    const SCAN_COOLDOWN_MS = 1500; // 1.5秒クールダウン（2秒→短縮）

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

    // スキャン成功時の処理
    const onScanSuccess = (decodedText) => {
        const now = Date.now();
        if (decodedText === lastScannedCode && (now - lastScanTime) < SCAN_COOLDOWN_MS) {
            return;
        }
        lastScannedCode = decodedText;
        lastScanTime = now;

        const normalizedJan = String(decodedText).trim();
        const matchedItem = janToItemMap.get(normalizedJan);

        if (matchedItem) {
            const code = String(matchedItem.code);
            const currentQty = currentCart[code] ? currentCart[code].qty : 0;
            updateFromCart(code, matchedItem.name, currentQty + 1);
            renderCartSidebar();
            syncCardQty(code, currentQty + 1);

            // フィードバック: ビープ音 + 振動
            playBeep(1000, 100);
            if (navigator.vibrate) navigator.vibrate(200);

            // ジャイアントトースト（巨大通知）の表示
            const giantToast = document.getElementById('giant-scan-toast');
            if (giantToast) {
                document.getElementById('giant-toast-name').textContent = matchedItem.name;
                document.getElementById('giant-toast-qty-val').textContent = currentQty + 1;
                
                giantToast.classList.remove('hidden');
                // わずかな遅延を入れてCSSトランジションを発火
                setTimeout(() => giantToast.classList.add('show'), 10);
                
                // カメラ枠をフラッシュ
                if (scannerModal) {
                    scannerModal.classList.remove('scanner-flash');
                    void scannerModal.offsetWidth; // リフロー強制
                    scannerModal.classList.add('scanner-flash');
                }

                clearTimeout(giantToast._timer);
                giantToast._timer = setTimeout(() => {
                    giantToast.classList.remove('show');
                    setTimeout(() => giantToast.classList.add('hidden'), 200); // フェードアウト後に非表示
                }, 1200);
            }

            showScanToast(`${matchedItem.name} を追加 (${currentQty + 1}個)`);
            if (scannerStatus) scannerStatus.textContent = `✅ ${matchedItem.name} を追加しました`;
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

        // iOS Safari: AudioContextのロック解除（ユーザージェスチャー内で初期化）
        if (!audioCtx) {
            try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
        }

        scannerModal.classList.remove('hidden');
        scannerOverlay.classList.remove('hidden');
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
        lastScannedCode = '';
    };

    // イベントリスナー
    if (scanBtn) scanBtn.addEventListener('click', startScanner);
    if (scannerCloseBtn) scannerCloseBtn.addEventListener('click', stopScanner);
    if (scannerOverlay) scannerOverlay.addEventListener('click', stopScanner);

});
