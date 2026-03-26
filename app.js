// v2.11.8 (HISTORY-SYNC)


document.addEventListener('DOMContentLoaded', () => {
    console.log('--- B2B Order System v2.11.8 (HISTORY-SYNC) Loaded ---');

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
    const syncMsgArea = document.getElementById('sync-msg');

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

    const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in ms

    // --- Utility Functions ---
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

        const historyCodes = historyFavoritesData[currentClientName];
        console.log('[SyncFavs] historyCodes count:', historyCodes ? historyCodes.length : 'NOT FOUND');

        if (!historyCodes || historyCodes.length === 0) {
            showSyncMsg('このサロンの導入履歴データが見つかりません。', 'error');
            return;
        }

        let addedCount = 0;
        historyCodes.forEach(code => {
            const strCode = String(code); // 型を文字列に統一
            if (!favoriteItems.includes(strCode)) {
                favoriteItems.push(strCode);
                addedCount++;
            }
        });

        if (addedCount > 0) {
            localStorage.setItem(getFavsKey(), JSON.stringify(favoriteItems));
            saveFavoritesToCloud();
            showSyncMsg(`${addedCount}件の商品をお気に入りに追加しました！`, 'success');
            renderItems(itemsData); // Re-render to show stars
        } else {
            showSyncMsg('すべてのお気に入りは既に同期済みです。', 'info');
        }
    };

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
        let displayItems = items;
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
            itemListContainer.innerHTML = '<p>商品が見つかりません。</p>';
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
        displayItems.forEach(item => {
            const strCode = String(item.code);
            const isFav = favoriteItems.includes(strCode);
            const card = createItemRow(item, isFav);
            itemListContainer.appendChild(card);
        });
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
                <span class="item-code">${item.code}</span>
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
                favoriteItems.push(strCode);
                favBtn.classList.add('active');
                favBtn.textContent = '★';
            }
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
                fetchHistory(); // Refresh
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
            currentCart[item.code] = { qty: parseInt(item.qty), name: item.name };
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
    const fetchHistory = async () => {
        showLoading();
        try {
            const url = `${CONFIG.API_URL}?action=history&clientName=${encodeURIComponent(currentClientName)}`;
            const response = await fetch(url);
            const result = await response.json();

            if (result.status === 'success') {
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
            fetchHistory();
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
        if (rawSearch.trim() === '') {
            renderItems(itemsData);
        } else {
            // Split by space for AND search
            const searchTokens = rawSearch.trim().split(/[\s　]+/);

            const filteredItems = itemsData.filter(item => {
                const normalizedName = normalizeForSearch(item.name);
                const normalizedCode = normalizeForSearch(item.code);
                const searchableText = normalizedName + normalizedCode;

                // Return true only if ALL tokens are found (AND search)
                return searchTokens.every(token => {
                    const normalizedToken = normalizeForSearch(token);
                    if (!normalizedToken) return true; // skip purely symbolic space
                    return searchableText.includes(normalizedToken);
                });
            });
            renderItems(filteredItems);
        }

        // Note: Re-rendering clears inputs. In a real app we'd preserve state, 
        // but for MVP it's safer to filter before picking quantities.
        calculateTotal();
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
                    itemsData = JSON.parse(cachedData);
                    renderManufacturerChips();
                    renderCategoryChips();
                    renderItems(itemsData);
                    if (announcementBanner) announcementBanner.classList.remove('hidden');
                    loadDraft();
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

                itemsData = result.data;

                // Save to cache
                localStorage.setItem('b2b_items_cache', JSON.stringify(itemsData));
                localStorage.setItem('b2b_items_ts', Date.now().toString());

                renderManufacturerChips();
                renderCategoryChips();
                renderItems(itemsData);

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
                favoriteItems = favData.data;
                localStorage.setItem(getFavsKey(), JSON.stringify(favoriteItems));
                console.log('Loaded favorites from cloud');
            } else {
                const savedFavs = localStorage.getItem(getFavsKey());
                favoriteItems = savedFavs ? JSON.parse(savedFavs) : [];
            }
        } catch (e) {
            console.warn('Failed to load favorites from cloud, falling back to local', e);
            const savedFavs = localStorage.getItem(getFavsKey());
            favoriteItems = savedFavs ? JSON.parse(savedFavs) : [];
        }

        // Switch screen
        loginContainer.classList.add('hidden');
        orderContainer.classList.remove('hidden');

        // --- ANTI-FREEZE: Delay fetchItems slightly ---
        console.log('Login successful, starting data fetch in 300ms...');
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
                // Remember Me logic
                if (rememberMeCheckbox && rememberMeCheckbox.checked) {
                    localStorage.setItem('b2b_saved_username', username);
                    localStorage.setItem('b2b_remember_me', 'true');
                } else {
                    localStorage.removeItem('b2b_saved_username');
                    localStorage.setItem('b2b_remember_me', 'false');
                }

                currentUsername = username;

                // --- Master Account Logic ---
                if (result.isMaster) {
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

                        // Save these temporarily to pass to the processLoginSuccess later
                        selectEl.dataset.announcement = result.announcement || '';
                        selectEl.dataset.isMaintenance = result.isMaintenance || false;
                        selectEl.dataset.maintenanceMessage = result.maintenanceMessage || '';
                    }
                    hideLoading();
                    return;
                }

                currentClientName = result.clientName;
                currentClientType = result.clientType || ''; // '直送' or ''

                await processLoginSuccess(result.announcement, result.isMaintenance, result.maintenanceMessage);
            } else {
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
            
            currentClientName = clientData.name;
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
    const executeOrderActual = async (orders, isEditing, remarks) => {
        showLoading();
        try {
            const action = isEditing ? 'update_order' : 'order';
            const payload = {
                action: action,
                clientName: currentClientName,
                clientType: currentClientType, // '直送' or ''
                orders: orders,
                remarks: remarks
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

    // --- Submit Order (API) ---
    if (orderSubmitBtn) {
        orderSubmitBtn.addEventListener('click', () => {
            const total = parseInt(totalQtySpan.textContent);
            if (total === 0) {
                alert('商品を1点以上選択してください。');
                return;
            }

            const orders = [];

            // Check if Confirmation Screen elements exist safely
            if (confirmationContainer && confirmItemList) {
                confirmItemList.innerHTML = ''; // Reset list

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
                        row.innerHTML = `<span class="confirm-item-name">${data.name}</span><span class="confirm-item-qty">${data.qty}点</span>`;
                        confirmItemList.appendChild(row);
                    }
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
        });
    }

    // Actually Execute Order from Confirmation Screen
    if (modalConfirmBtn) {
        modalConfirmBtn.addEventListener('click', async () => {
            if (confirmationContainer) {
                confirmationContainer.classList.add('hidden');
                orderContainer.classList.remove('hidden'); // Return immediately so loading overlay shows here
            }

            const orders = [];
            Object.entries(currentCart).forEach(([code, data]) => {
                if (data.qty > 0) {
                    orders.push({
                        code: code,
                        name: data.name,
                        qty: data.qty
                    });
                }
            });

            const remarks = orderRemarks ? orderRemarks.value.trim() : '';
            const isEditing = editingOrderId !== null;
            executeOrderActual(orders, isEditing, remarks);
        });
    }

    // --- Initial Fetch ---
    fetchHistoryFavorites();
});
