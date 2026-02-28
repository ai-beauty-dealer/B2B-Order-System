document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const loginForm = document.getElementById('login-form');
    const loginContainer = document.getElementById('login-container');
    const orderContainer = document.getElementById('order-container');
    const logoutBtn = document.getElementById('logout-btn');
    const totalQtySpan = document.getElementById('total-qty');
    const orderSubmitBtn = document.getElementById('order-submit-btn');
    const searchInput = document.getElementById('search-input');
    const itemListContainer = document.getElementById('item-list');
    const loadingOverlay = document.getElementById('loading-overlay');
    const tabAll = document.getElementById('tab-all');
    const tabFavorites = document.getElementById('tab-favorites');
    const tabHistory = document.getElementById('tab-history');
    const historyListContainer = document.getElementById('history-list');
    const searchWrapper = document.getElementById('search-wrapper');
    const cartSummary = document.querySelector('.cart-summary');

    // Screen Elements
    const confirmationContainer = document.getElementById('confirmation-container');
    const confirmItemList = document.getElementById('confirm-item-list');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalConfirmBtn = document.getElementById('modal-confirm-btn');

    // Phase 3 Elements
    const announcementBanner = document.getElementById('announcement-banner');
    const categoryChipsContainer = document.getElementById('category-chips-container');
    const orderRemarks = document.getElementById('order-remarks');

    // Custom Item Elements
    const addCustomItemBtn = document.getElementById('add-custom-item-btn');
    const customItemsList = document.getElementById('custom-items-list');

    // Hierarchical Filter Elements
    const manufacturerChipsContainer = document.getElementById('manufacturer-chips-container');

    // Draft Restore Button (non-blocking)
    const restoreDraftBtn = document.getElementById('restore-draft-btn');

    // State
    let currentUsername = '';
    let currentClientName = '';
    let itemsData = [];
    let favoriteItems = [];
    let currentFilter = 'all';
    let currentManufacturerFilter = 'all';
    let currentCategoryFilter = 'all';
    let editingOrderId = null;
    let currentCart = {};

    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const saveDraftBtn = document.getElementById('save-draft-btn');

    // --- Utility Functions ---
    const normalizeForSearch = (str) => {
        if (!str) return '';
        str = String(str);
        let normalized = str.replace(/[\uFF01-\uFF5E]/g, (s) => {
            return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
        });
        normalized = normalized.replace(/[\u3041-\u3096]/g, (s) => {
            return String.fromCharCode(s.charCodeAt(0) + 0x0060);
        });
        const kanaMap = {
            'ｶﾞ': 'ガ', 'ｷﾞ': 'ギ', 'ｸﾞ': 'グ', 'ｹﾞ': 'ゲ', 'ｺﾞ': 'ゴ',
            'ｻﾞ': 'ザ', 'ｼﾞ': 'ジ', 'ｽﾞ': 'ズ', 'ｾﾞ': 'ゼ', 'ｿﾞ': 'ゾ',
            'ﾀﾞ': 'ダ', 'ﾁﾞ': 'ヂ', 'ﾂﾞ': 'ヅ', 'ﾃﾞ': 'デ', 'ﾄﾞ': 'ド',
            'ﾊﾞ': 'バ', 'ﾋﾞ': 'ビ', 'ﾌﾞ': 'ブ', 'ﾍﾞ': 'ベ', 'ﾎﾞ': 'ボ',
            'ﾊﾟ': 'パ', 'ﾋﾟ': 'ピ', 'ﾌﾟ': 'プ', 'ﾍﾟ': 'ペ', 'ﾎﾟ': 'ポ',
            'ｳﾞ': 'ヴ', 'ﾜﾞ': 'ヷ', 'ｦﾞ': 'ヺ',
            'ｱ': 'ア', 'ｲ': 'イ', 'ｳ': 'ウ', 'ｴ': 'エ', 'ｵ': 'オ',
            'ｶ': 'カ', 'ｷ': 'キ', 'ｸ': 'ク', 'ｹ': 'ケ', 'ｺ': 'コ',
            'ｻ': 'サ', 'ｼ': 'シ', 'ｽ': 'ス', 'ｾ': 'セ', 'ｿ': 'ソ',
            'ﾀ': 'タ', 'ﾁ': 'チ', 'ﾂ': 'ツ', 'ﾃ': 'テ', 'ﾄ': 'ト',
            'ﾅ': 'ナ', 'ﾆ': 'ニ', 'ﾇ': 'ヌ', 'ﾈ': 'ネ', 'ﾉ': 'ノ',
            'ﾊ': 'ハ', 'ﾋ': 'ヒ', 'ﾌ': 'フ', 'ﾍ': 'ヘ', 'ﾎ': 'ホ',
            'ﾏ': 'マ', 'ﾐ': 'ミ', 'ﾑ': 'ム', 'ﾒ': 'メ', 'ﾓ': 'モ',
            'ﾔ': 'ヤ', 'ﾕ': 'ユ', 'ﾖ': 'ヨ',
            'ﾗ': 'ラ', 'ﾘ': 'リ', 'ﾙ': 'ル', 'ﾚ': 'レ', 'ﾛ': 'ロ',
            'ﾜ': 'ワ', 'ｦ': 'ヲ', 'ﾝ': 'ン',
            'ｧ': 'ァ', 'ｨ': 'ィ', 'ｩ': 'ゥ', 'ｪ': 'ェ', 'ｫ': 'ォ',
            'ｯ': 'ッ', 'ｬ': 'ャ', 'ｭ': 'ュ', 'ｮ': 'ョ',
            'ｰ': 'ー', '･': '・', '､': '、', 'ﾟ': '゜', 'ﾞ': '゛'
        };
        const keys = Object.keys(kanaMap).sort((a, b) => b.length - a.length);
        const reg = new RegExp('(' + keys.join('|') + ')', 'g');
        normalized = normalized.replace(reg, (match) => kanaMap[match] || match);
        return normalized.toLowerCase().replace(/[\s　\-\_\/\.,;:]/g, '');
    };

    // --- Loading Helpers ---
    const showLoading = () => loadingOverlay.classList.remove('hidden');
    const hideLoading = () => loadingOverlay.classList.add('hidden');

    // --- Non-blocking UI Helpers (replaces alert/confirm) ---
    const showToast = (message, type = 'info') => {
        const toast = document.createElement('div');
        const bg = type === 'danger' ? '#ef4444' : (type === 'success' ? '#10b981' : '#0f172a');
        toast.style.cssText = `
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            background: ${bg}; color: white; padding: 12px 24px;
            border-radius: 8px; z-index: 10000; font-weight: 600;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2); max-width: 90%;
            text-align: center; font-size: 0.9rem;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    };

    const showConfirm = (message, onConfirm) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5); display: flex; align-items: center;
            justify-content: center; z-index: 10001;
        `;
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: white; padding: 28px 24px; border-radius: 12px;
            max-width: 90%; width: 340px; text-align: center;
            box-shadow: 0 10px 25px rgba(0,0,0,0.2);
        `;
        dialog.innerHTML = `
            <p style="margin-bottom: 24px; font-weight: 600; line-height: 1.6; color: #0f172a;">${message.replace(/\n/g, '<br>')}</p>
            <div style="display: flex; gap: 12px;">
                <button id="confirm-cancel" style="flex: 1; padding: 12px; border: 1px solid #e2e8f0; background: #f8fafc; border-radius: 8px; font-size: 0.9rem; cursor: pointer;">キャンセル</button>
                <button id="confirm-ok" style="flex: 1; padding: 12px; border: none; background: #2563eb; color: white; border-radius: 8px; font-size: 0.9rem; font-weight: 600; cursor: pointer;">OK</button>
            </div>
        `;
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        dialog.querySelector('#confirm-cancel').onclick = () => overlay.remove();
        dialog.querySelector('#confirm-ok').onclick = () => { overlay.remove(); onConfirm(); };
    };

    const calculateTotal = () => {
        let total = 0;
        Object.values(currentCart).forEach(item => { total += item.qty || 0; });
        totalQtySpan.textContent = total;
    };

    // --- Draft Feature ---
    const saveDraft = () => {
        if (!currentUsername) return;
        localStorage.setItem(`b2b_draft_${currentUsername}`, JSON.stringify(currentCart));
        showToast('入力中の数量を一時保存しました。', 'success');
    };

    // Check for saved draft, show button silently (no popup)
    const checkDraft = () => {
        if (!currentUsername) return;
        const savedDraft = localStorage.getItem(`b2b_draft_${currentUsername}`);
        if (!savedDraft) { if (restoreDraftBtn) restoreDraftBtn.style.display = 'none'; return; }
        try {
            const draftData = JSON.parse(savedDraft);
            if (Object.keys(draftData).length > 0) {
                if (restoreDraftBtn) restoreDraftBtn.style.display = 'inline-block';
            }
        } catch (e) { /* ignore */ }
    };

    // Wire the restore button (user manually triggers)
    if (restoreDraftBtn) {
        restoreDraftBtn.addEventListener('click', () => {
            const savedDraft = localStorage.getItem(`b2b_draft_${currentUsername}`);
            if (!savedDraft) return;
            showConfirm('前回の一時保存データを復元しますか？', () => {
                try {
                    const draftData = JSON.parse(savedDraft);
                    const isOldFormat = typeof Object.values(draftData)[0] === 'number';
                    if (isOldFormat) {
                        const itemsMap = new Map(itemsData.map(i => [String(i.code), i.name]));
                        currentCart = {};
                        Object.entries(draftData).forEach(([code, qty]) => {
                            currentCart[code] = { qty, name: itemsMap.get(String(code)) || '（商品名未入力）' };
                        });
                    } else {
                        currentCart = draftData;
                    }
                    calculateTotal();
                    showToast('データを復元しました。', 'success');
                    restoreDraftBtn.style.display = 'none';
                } catch (e) { showToast('復元に失敗しました。', 'danger'); }
            });
        });
    }

    if (saveDraftBtn) saveDraftBtn.addEventListener('click', saveDraft);

    // --- Render Items ---
    const renderItems = (items) => {
        itemListContainer.innerHTML = '';

        let displayItems = items;
        if (currentFilter === 'favorites') {
            displayItems = displayItems.filter(item => favoriteItems.includes(item.code));
        }
        if (currentManufacturerFilter !== 'all') {
            displayItems = displayItems.filter(item => item.manufacturer === currentManufacturerFilter);
        }
        if (currentCategoryFilter !== 'all') {
            displayItems = displayItems.filter(item => item.category === currentCategoryFilter);
        }

        // Gate: require manufacturer+category selection (search bypasses this)
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

        const fragment = document.createDocumentFragment();
        displayItems.forEach(item => {
            const isFav = favoriteItems.includes(item.code);
            const card = document.createElement('div');
            card.className = 'item-card';
            card.innerHTML = `
                <div class="item-info">
                    <span class="item-code">${item.code}</span>
                    <h3 class="item-name">
                        <button type="button" class="btn-fav ${isFav ? 'active' : ''}" data-code="${item.code}">
                            ${isFav ? '★' : '☆'}
                        </button>
                        ${item.name}
                    </h3>
                </div>
                <div class="order-controls">
                    <button type="button" class="btn-qty minus">-</button>
                    <input type="number" class="qty-input" data-code="${item.code}" data-name="${item.name}" value="${currentCart[item.code] ? currentCart[item.code].qty : 0}" min="0">
                    <button type="button" class="btn-qty plus">+</button>
                </div>
            `;

            const input = card.querySelector('.qty-input');
            const favBtn = card.querySelector('.btn-fav');

            favBtn.addEventListener('click', () => {
                if (favoriteItems.includes(item.code)) {
                    favoriteItems = favoriteItems.filter(c => c !== item.code);
                    favBtn.classList.remove('active');
                    favBtn.textContent = '☆';
                } else {
                    favoriteItems.push(item.code);
                    favBtn.classList.add('active');
                    favBtn.textContent = '★';
                }
                localStorage.setItem(`b2b_favs_${currentUsername}`, JSON.stringify(favoriteItems));
                if (currentFilter === 'favorites') {
                    const rawSearch = searchInput.value;
                    if (rawSearch.trim() === '') {
                        renderItems(itemsData);
                    } else {
                        const tokens = rawSearch.trim().split(/[\s　]+/);
                        renderItems(itemsData.filter(i => tokens.every(t => (normalizeForSearch(i.name) + normalizeForSearch(i.code)).includes(normalizeForSearch(t)))));
                    }
                }
            });

            const updateCart = (val) => {
                if (val > 0) currentCart[item.code] = { qty: val, name: item.name };
                else delete currentCart[item.code];
            };

            card.querySelector('.minus').addEventListener('click', () => {
                let val = parseInt(input.value) || 0;
                if (val > 0) { val--; input.value = val; updateCart(val); calculateTotal(); }
            });
            card.querySelector('.plus').addEventListener('click', () => {
                let val = (parseInt(input.value) || 0) + 1;
                input.value = val; updateCart(val); calculateTotal();
            });
            input.addEventListener('change', () => {
                let val = parseInt(input.value) || 0;
                if (val < 0) { val = 0; input.value = 0; }
                updateCart(val); calculateTotal();
            });

            fragment.appendChild(card);
        });
        itemListContainer.appendChild(fragment);
    };

    // --- Render History ---
    const renderHistory = (historyData) => {
        historyListContainer.innerHTML = '';
        if (historyData.length === 0) {
            historyListContainer.innerHTML = '<p>発注履歴がありません。</p>';
            return;
        }
        const groupedHistory = {};
        historyData.forEach(hist => {
            if (!groupedHistory[hist.date]) groupedHistory[hist.date] = [];
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

            const card = document.createElement('div');
            card.className = 'history-group-card';
            card.innerHTML = `
                <div class="history-header">
                    <div>
                        <div class="history-date">${date}</div>
                        <div class="history-summary">計 ${totalItems}点</div>
                    </div>
                    <div class="history-toggle">▼</div>
                </div>
                <div class="history-body hidden">
                    ${detailsHtml}
                    <div class="history-actions">
                        <button class="btn-secondary edit-order-btn" data-order-id="${items[0].orderId}">変更</button>
                        <button class="btn-danger cancel-order-btn" data-order-id="${items[0].orderId}">キャンセル</button>
                    </div>
                </div>
            `;

            const header = card.querySelector('.history-header');
            const body = card.querySelector('.history-body');
            const toggleIcon = card.querySelector('.history-toggle');
            header.addEventListener('click', () => {
                const isHidden = body.classList.toggle('hidden');
                toggleIcon.textContent = isHidden ? '▼' : '▲';
            });

            const cancelBtn = card.querySelector('.cancel-order-btn');
            const editBtn = card.querySelector('.edit-order-btn');

            cancelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showConfirm('この発注をキャンセルします。よろしいですか？', () => {
                    cancelOrder(e.target.dataset.orderId);
                });
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
                body: JSON.stringify({ action: 'cancel_order', clientName: currentClientName, orderId })
            });
            const result = await response.json();
            if (result.status === 'success') {
                showToast('発注をキャンセルしました。', 'success');
                fetchHistory();
            } else {
                showToast('失敗しました: ' + result.message, 'danger');
            }
        } catch (error) {
            console.error(error);
            showToast('通信エラーが発生しました。', 'danger');
        } finally {
            hideLoading();
        }
    };

    // --- Custom Item Logic ---
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
        const removeBtn = card.querySelector('.btn-remove-custom');

        const updateCart = (val) => {
            if (val > 0) {
                currentCart[itemCode] = { qty: val, name: nameInput.value.trim() || '（商品名未入力）' };
            } else {
                delete currentCart[itemCode];
            }
        };

        nameInput.addEventListener('input', () => {
            const val = parseInt(qtyInput.value) || 0;
            if (val > 0) updateCart(val);
        });
        card.querySelector('.minus').addEventListener('click', () => {
            let val = parseInt(qtyInput.value) || 0;
            if (val > 0) { val--; qtyInput.value = val; updateCart(val); calculateTotal(); }
        });
        card.querySelector('.plus').addEventListener('click', () => {
            if (!nameInput.value.trim()) {
                showToast('先に特注商品の「商品名や規格」を入力してください。', 'danger');
                return;
            }
            let val = (parseInt(qtyInput.value) || 0) + 1;
            qtyInput.value = val; updateCart(val); calculateTotal();
        });
        qtyInput.addEventListener('change', () => {
            let val = parseInt(qtyInput.value) || 0;
            if (val < 0) val = 0;
            if (val > 0 && !nameInput.value.trim()) {
                showToast('先に特注商品の「商品名や規格」を入力してください。', 'danger');
                val = 0;
            }
            qtyInput.value = val; updateCart(val); calculateTotal();
        });
        removeBtn.addEventListener('click', () => {
            showConfirm('この特注商品を削除しますか？', () => {
                delete currentCart[itemCode];
                card.remove();
                calculateTotal();
            });
        });

        customItemsList.appendChild(card);
        if (!code) nameInput.focus();
    };

    if (addCustomItemBtn) addCustomItemBtn.addEventListener('click', () => addCustomItemUI());

    // --- Start Editing Order ---
    const startEditingOrder = (orderId, items) => {
        editingOrderId = orderId;
        currentCart = {};
        items.forEach(item => {
            currentCart[item.code] = { qty: parseInt(item.qty), name: item.name };
        });
        switchTab('tab-all');
        window.scrollTo(0, 0);
        calculateTotal();
        if (orderSubmitBtn) orderSubmitBtn.textContent = '変更を保存する';
        if (cancelEditBtn) cancelEditBtn.classList.remove('hidden');
    };

    if (cancelEditBtn) cancelEditBtn.addEventListener('click', () => resetEditMode());

    const resetEditMode = () => {
        editingOrderId = null;
        currentCart = {};
        if (orderSubmitBtn) orderSubmitBtn.textContent = '発注する';
        if (cancelEditBtn) cancelEditBtn.classList.add('hidden');
        if (customItemsList) customItemsList.innerHTML = '';
        calculateTotal();
        if (searchInput) searchInput.value = '';
        renderItems(itemsData);
    };

    // --- Fetch History ---
    const fetchHistory = async () => {
        showLoading();
        try {
            const url = `${CONFIG.API_URL}?action=history&clientName=${encodeURIComponent(currentClientName)}`;
            const response = await fetch(url);
            const result = await response.json();
            if (result.status === 'success') {
                renderHistory(result.data);
            } else {
                showToast('履歴の取得に失敗しました: ' + result.message, 'danger');
            }
        } catch (error) {
            console.error(error);
            showToast('通信エラーが発生しました。', 'danger');
        } finally {
            hideLoading();
        }
    };

    // --- Tab Filtering ---
    const switchTab = (tabId) => {
        tabAll.classList.remove('active');
        tabFavorites.classList.remove('active');
        tabHistory.classList.remove('active');
        document.getElementById(tabId).classList.add('active');

        if (tabId === 'tab-history') {
            itemListContainer.classList.add('hidden');
            searchWrapper.classList.add('hidden');
            cartSummary.classList.add('hidden');
            historyListContainer.classList.remove('hidden');
            fetchHistory();
        } else {
            itemListContainer.classList.remove('hidden');
            searchWrapper.classList.remove('hidden');
            cartSummary.classList.remove('hidden');
            historyListContainer.classList.add('hidden');

            currentFilter = tabId === 'tab-favorites' ? 'favorites' : 'all';
            currentManufacturerFilter = 'all';
            currentCategoryFilter = 'all';
            searchInput.value = '';
            renderManufacturerChips();
            renderCategoryChips();
            renderItems(itemsData);
        }
    };

    if (tabAll) tabAll.addEventListener('click', () => switchTab('tab-all'));
    if (tabFavorites) tabFavorites.addEventListener('click', () => switchTab('tab-favorites'));
    if (tabHistory) tabHistory.addEventListener('click', () => switchTab('tab-history'));

    // --- Search Logic (debounced) ---
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const rawSearch = e.target.value;
            if (rawSearch.trim() === '') {
                renderItems(itemsData);
            } else {
                const searchTokens = rawSearch.trim().split(/[\s　]+/);
                const filteredItems = itemsData.filter(item => {
                    const searchableText = normalizeForSearch(item.name) + normalizeForSearch(item.code);
                    return searchTokens.every(token => {
                        const normalizedToken = normalizeForSearch(token);
                        if (!normalizedToken) return true;
                        return searchableText.includes(normalizedToken);
                    });
                });
                renderItems(filteredItems);
            }
            calculateTotal();
        }, 200);
    });

    // --- Render Manufacturer Chips ---
    const renderManufacturerChips = () => {
        if (!manufacturerChipsContainer) return;
        manufacturerChipsContainer.innerHTML = '';
        const manufacturers = [...new Set(itemsData.map(item => item.manufacturer))].filter(Boolean);
        if (manufacturers.length === 0) { manufacturerChipsContainer.style.display = 'none'; return; }
        manufacturerChipsContainer.style.display = 'flex';

        const allChip = document.createElement('div');
        allChip.className = `manufacturer-chip ${currentManufacturerFilter === 'all' ? 'active' : ''}`;
        allChip.textContent = 'すべてのメーカー';
        allChip.addEventListener('click', () => {
            currentManufacturerFilter = 'all';
            currentCategoryFilter = 'all';
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
                currentCategoryFilter = 'all';
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
        const filteredByManufacturer = currentManufacturerFilter === 'all'
            ? itemsData
            : itemsData.filter(item => item.manufacturer === currentManufacturerFilter);
        const categories = [...new Set(filteredByManufacturer.map(item => item.category))].filter(Boolean);
        if (categories.length === 0) return;

        const allChip = document.createElement('div');
        allChip.className = `category-chip ${currentCategoryFilter === 'all' ? 'active' : ''}`;
        allChip.textContent = 'すべて';
        allChip.addEventListener('click', () => {
            currentCategoryFilter = 'all';
            renderCategoryChips();
            if (searchInput) searchInput.value = '';
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

    // --- Fetch Items (with LocalStorage Caching) ---
    const fetchItems = async (forceRefresh = false) => {
        showLoading();
        try {
            const CACHE_KEY = 'b2b_master_data';
            const TIME_KEY = 'b2b_master_timestamp';
            const ONE_DAY_MS = 24 * 60 * 60 * 1000;

            if (!forceRefresh) {
                const cachedData = localStorage.getItem(CACHE_KEY);
                const cachedTime = localStorage.getItem(TIME_KEY);
                if (cachedData && cachedTime) {
                    const age = Date.now() - parseInt(cachedTime, 10);
                    if (age < ONE_DAY_MS) {
                        itemsData = JSON.parse(cachedData);
                        renderManufacturerChips();
                        renderCategoryChips();
                        renderItems(itemsData);
                        if (announcementBanner) announcementBanner.classList.remove('hidden');
                        if (currentFilter === 'all') checkDraft();
                        hideLoading();
                        return;
                    }
                }
            }

            const url = `${CONFIG.API_URL}?action=items`;
            const response = await fetch(url);
            const result = await response.json();

            if (result.status === 'success') {
                itemsData = result.data;
                try {
                    localStorage.setItem(CACHE_KEY, JSON.stringify(itemsData));
                    localStorage.setItem(TIME_KEY, Date.now().toString());
                } catch (e) {
                    console.warn('Could not save to localStorage.', e);
                }
                renderManufacturerChips();
                renderCategoryChips();
                renderItems(itemsData);
                if (announcementBanner) announcementBanner.classList.remove('hidden');
                if (currentFilter === 'all') checkDraft();
            } else {
                showToast('商品データの取得に失敗しました: ' + result.message, 'danger');
            }
        } catch (error) {
            console.error(error);
            showToast('通信エラーが発生しました。再度お試しください。', 'danger');
        } finally {
            hideLoading();
        }
    };

    // Manual Refresh Button
    const refreshDataBtn = document.getElementById('refresh-data-btn');
    if (refreshDataBtn) {
        refreshDataBtn.addEventListener('click', () => {
            showConfirm('最新の商品データをダウンロードしますか？（少し時間がかかります）', () => {
                fetchItems(true);
            });
        });
    }

    // --- Login ---
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        if (!username || !password) return;

        showLoading();
        try {
            const response = await fetch(CONFIG.API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                redirect: 'follow',
                body: JSON.stringify({ action: 'login', username, password })
            });
            const result = await response.json();

            if (result.status === 'success') {
                currentUsername = username;
                currentClientName = result.clientName;

                const savedFavs = localStorage.getItem(`b2b_favs_${currentUsername}`);
                try { favoriteItems = savedFavs ? JSON.parse(savedFavs) : []; } catch (e) { favoriteItems = []; }

                // Switch screen
                loginContainer.classList.add('hidden');
                orderContainer.classList.remove('hidden');

                // Yield to browser paint before heavy data fetch
                requestAnimationFrame(() => {
                    setTimeout(() => { fetchItems(); }, 100);
                });
            } else {
                showToast('ログインに失敗しました: ' + result.message, 'danger');
            }
        } catch (error) {
            console.error(error);
            showToast('通信に失敗しました。', 'danger');
        } finally {
            hideLoading();
        }
    });

    // --- Logout ---
    logoutBtn.addEventListener('click', () => {
        currentUsername = '';
        currentClientName = '';
        favoriteItems = [];
        currentCart = {};
        if (customItemsList) customItemsList.innerHTML = '';
        orderContainer.classList.add('hidden');
        loginContainer.classList.remove('hidden');
        loginForm.reset();
        itemListContainer.innerHTML = '';
        historyListContainer.innerHTML = '';
        totalQtySpan.textContent = '0';
        searchInput.value = '';
        if (restoreDraftBtn) restoreDraftBtn.style.display = 'none';
    });

    // --- Submit Order ---
    const executeOrderActual = async (orders, isEditing, remarks) => {
        showLoading();
        try {
            const action = isEditing ? 'update_order' : 'order';
            const payload = { action, clientName: currentClientName, orders, remarks };
            const requestBody = isEditing ? { ...payload, orderId: String(editingOrderId) } : payload;

            const response = await fetch(CONFIG.API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                redirect: 'follow',
                body: JSON.stringify(requestBody)
            });
            const result = await response.json();

            if (result.status === 'success') {
                showToast(isEditing ? '発注内容を変更しました。' : '発注が完了しました！', 'success');
                localStorage.removeItem(`b2b_draft_${currentUsername}`);
                if (customItemsList) customItemsList.innerHTML = '';
                resetEditMode();
            } else {
                showToast('失敗しました: ' + result.message, 'danger');
            }
        } catch (error) {
            console.error(error);
            showToast('通信エラーが発生しました。発注が完了していない可能性があります。', 'danger');
        } finally {
            hideLoading();
        }
    };

    if (orderSubmitBtn) {
        orderSubmitBtn.addEventListener('click', () => {
            const total = parseInt(totalQtySpan.textContent);
            if (total === 0) { showToast('商品を1点以上選択してください。', 'danger'); return; }

            const orders = [];
            if (confirmationContainer && confirmItemList) {
                confirmItemList.innerHTML = '';
                Object.entries(currentCart).forEach(([code, data]) => {
                    if (data.qty > 0) {
                        orders.push({ code, name: data.name, qty: data.qty });
                        const row = document.createElement('div');
                        row.className = 'confirm-item-row';
                        row.innerHTML = `<span class="confirm-item-name">${data.name}</span><span class="confirm-item-qty">${data.qty}点</span>`;
                        confirmItemList.appendChild(row);
                    }
                });
                if (orderRemarks) orderRemarks.value = '';
                orderContainer.classList.add('hidden');
                confirmationContainer.classList.remove('hidden');
                window.scrollTo(0, 0);
            } else {
                Object.entries(currentCart).forEach(([code, data]) => {
                    if (data.qty > 0) orders.push({ code, name: data.name, qty: data.qty });
                });
                const isEditing = editingOrderId !== null;
                showConfirm(`${total}点の商品を${isEditing ? '変更' : '発注'}します。よろしいですか？`, () => {
                    executeOrderActual(orders, isEditing);
                });
            }
        });
    }

    if (modalCancelBtn) {
        modalCancelBtn.addEventListener('click', () => {
            if (confirmationContainer) {
                confirmationContainer.classList.add('hidden');
                orderContainer.classList.remove('hidden');
            }
        });
    }

    if (modalConfirmBtn) {
        modalConfirmBtn.addEventListener('click', async () => {
            if (confirmationContainer) {
                confirmationContainer.classList.add('hidden');
                orderContainer.classList.remove('hidden');
            }
            const orders = [];
            Object.entries(currentCart).forEach(([code, data]) => {
                if (data.qty > 0) orders.push({ code, name: data.name, qty: data.qty });
            });
            const remarks = orderRemarks ? orderRemarks.value.trim() : '';
            executeOrderActual(orders, editingOrderId !== null, remarks);
        });
    }
});
