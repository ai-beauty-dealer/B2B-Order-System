document.addEventListener('DOMContentLoaded', () => {
    const RENDER_PROMPT_HTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: #64748b; background: white; border-radius: 12px; margin: 20px 0; border: 1px dashed #cbd5e1;">
            <span style="font-size: 3rem; display: block; margin-bottom: 16px;">🏢</span>
            <p style="font-size: 1.2rem; margin-bottom: 8px; font-weight: bold; color: var(--text-color);">メーカーを選択してください</p>
            <p style="font-size: 0.95rem; line-height: 1.6;">商品数が非常に多いため、<br>まずは上のボタンからメーカーを絞り込んでください。<br>（※ 上部の検索バーから直接商品名で探すことも可能です）</p>
        </div>
    `;
    // UI Elements
    const loginForm = document.getElementById('login-form');
    const loginContainer = document.getElementById('login-container');
    const orderContainer = document.getElementById('order-container');
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

    // State
    let currentUsername = ''; // Use username for unique localstorage key
    let currentClientName = '';
    let itemsData = [];
    let favoriteItems = []; // Array of item codes
    let currentFilter = 'all'; // 'all' or 'favorites'
    let currentManufacturerFilter = 'all'; // 'all' or manufacturer name
    let currentCategoryFilter = 'all'; // 'all' or specific category name
    let editingOrderId = null; // Store orderId if editing an existing order
    let currentCart = {}; // Store qtys to survive re-rendering

    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const saveDraftBtn = document.getElementById('save-draft-btn');

    // --- Utility Functions ---
    // Normalize string for fuzzy search (half-width, katakana, lowercase, no spaces)
    const normalizeForSearch = (str) => {
        if (!str) return '';
        str = String(str); // Prevent TypeError if input is a Number

        // 1. Full-width Alphanumeric to Half-width (more explicit unicode range)
        let normalized = str.replace(/[\uFF01-\uFF5E]/g, (s) => {
            return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
        });

        // 2. Hiragana to Katakana (explicit unicode range)
        normalized = normalized.replace(/[\u3041-\u3096]/g, (s) => {
            return String.fromCharCode(s.charCodeAt(0) + 0x0060);
        });

        // 3. Half-width Katakana to Full-width Katakana
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

        // Sort keys by length descending so ｶﾞ is matched before ｶ
        const keys = Object.keys(kanaMap).sort((a, b) => b.length - a.length);
        const reg = new RegExp('(' + keys.join('|') + ')', 'g');
        normalized = normalized.replace(reg, (match) => {
            return kanaMap[match] || match;
        });

        // 4. Lowercase and remove all spaces/symbols
        return normalized.toLowerCase().replace(/[\s　\-\_\/\.,:;]/g, '');
    };

    let loadingOverlayNode = null;

    const showLoading = () => {
        if (!loadingOverlayNode) {
            loadingOverlayNode = document.createElement('div');
            loadingOverlayNode.id = 'loading-overlay';
            const spinner = document.createElement('div');
            spinner.className = 'spinner';
            loadingOverlayNode.appendChild(spinner);
            document.body.appendChild(loadingOverlayNode);

            // Force synchronous layout to guarantee it paints before thread locks
            void loadingOverlayNode.offsetHeight;
        }
    };

    const hideLoading = () => {
        if (loadingOverlayNode) {
            // Yield to browser paint cycle before destroying to prevent visual lockups
            requestAnimationFrame(() => {
                if (loadingOverlayNode && loadingOverlayNode.parentNode) {
                    loadingOverlayNode.parentNode.removeChild(loadingOverlayNode);
                }
                loadingOverlayNode = null;
            });
        }
    };

    // --- UI Helpers (Non-blocking) ---
    const showToast = (message, type = 'info') => {
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            background: ${type === 'danger' ? '#ef4444' : '#0f172a'};
            color: white; padding: 12px 24px; border-radius: 4px; z-index: 10000;
            font-weight: bold; box-shadow: 0 4px 6px rgba(0,0,0,0.2);
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    };

    const showConfirm = (message, callback) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5); display: flex; align-items: center;
            justify-content: center; z-index: 10001;
        `;
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: white; padding: 24px; border-radius: 4px; max-width: 90%;
            width: 320px; text-align: center;
        `;
        dialog.innerHTML = `
            <p style="margin-bottom: 20px; font-weight: bold; line-height: 1.5;">${message.replace(/\n/g, '<br>')}</p>
            <div style="display: flex; gap: 10px;">
                <button id="custom-cancel" style="flex: 1; padding: 10px; border: 1px solid #ccc; background: #eee; border-radius: 4px;">キャンセル</button>
                <button id="custom-ok" style="flex: 1; padding: 10px; border: none; background: #2563eb; color: white; border-radius: 4px; font-weight: bold;">OK</button>
            </div>
        `;
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        dialog.querySelector('#custom-cancel').onclick = () => { overlay.remove(); };
        dialog.querySelector('#custom-ok').onclick = () => { overlay.remove(); callback(); };
    };

    const calculateTotal = () => {
        let total = 0;
        Object.values(currentCart).forEach(item => {
            total += item.qty || 0;
        });
        totalQtySpan.textContent = total;
    };

    // --- Draft Feature ---
    const saveDraft = () => {
        if (!currentUsername) return;
        localStorage.setItem(`b2b_draft_${currentUsername}`, JSON.stringify(currentCart));
        showToast('入力内容を一時保存しました。');
    };

    const loadDraft = () => {
        if (!currentUsername) return;
        const savedDraft = localStorage.getItem(`b2b_draft_${currentUsername}`);
        if (!savedDraft) return;

        try {
            const draftData = JSON.parse(savedDraft);
            if (Object.keys(draftData).length > 0) {
                showConfirm('前回の一時保存データがあります。復元しますか？', () => {
                    // Backwards compatibility check
                    const isOldFormat = typeof Object.values(draftData)[0] === 'number';
                    if (isOldFormat) {
                        currentCart = {};
                        Object.entries(draftData).forEach(([code, qty]) => {
                            const matchedItem = itemsData.find(i => String(i.code) === String(code));
                            if (matchedItem) {
                                currentCart[code] = { qty: qty, name: matchedItem.name };
                            } else if (code.startsWith('CUSTOM_ITEM')) {
                                currentCart[code] = { qty: qty, name: '（商品名未入力）' };
                            }
                        });
                    } else {
                        currentCart = draftData;
                    }
                    // Since we're in 'all' tab visually showing the prompt, 
                    // a draft load might want to actually SHOW the items. 
                    // But for stability, we just restore the cart and total.
                    calculateTotal();
                    showToast('データを復元しました。');
                });
            }
        } catch (e) { /* ignore invalid data */ }
    };

    if (saveDraftBtn) {
        saveDraftBtn.addEventListener('click', saveDraft);
    }

    // --- Render Items ---
    const renderItems = (items) => {
        itemListContainer.innerHTML = ''; // Clear current

        // Filter by current tab selection before rendering
        let displayItems = items;
        if (currentFilter === 'favorites') {
            displayItems = displayItems.filter(item => favoriteItems.includes(item.code));
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

        // --- PERFORMANCE OPTIMIZATION (Phase 2 LIMIT) ---
        // Even with DocumentFragment, creating 10,000 DOM nodes at once freezes the browser.
        // Limit the maximum number of rendered items to 200 to guarantee snappy performance.
        const MAX_RENDER_LIMIT = 200;
        const itemsToRender = displayItems.slice(0, MAX_RENDER_LIMIT);

        const fragment = document.createDocumentFragment();

        itemsToRender.forEach(item => {
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

            // Attach Events for this card
            const input = card.querySelector('.qty-input');
            const favBtn = card.querySelector('.btn-fav');

            // Favorite toggle
            favBtn.addEventListener('click', () => {
                if (favoriteItems.includes(item.code)) {
                    // Remove
                    favoriteItems = favoriteItems.filter(c => c !== item.code);
                    favBtn.classList.remove('active');
                    favBtn.textContent = '☆';
                } else {
                    // Add
                    favoriteItems.push(item.code);
                    favBtn.classList.add('active');
                    favBtn.textContent = '★';
                }
                // Save to local storage
                localStorage.setItem(`b2b_favs_${currentUsername}`, JSON.stringify(favoriteItems));

                // If we are on the favorites tab, re-render to hide removed item instantly
                // Note: Re-rendering clears quantity inputs. For MVP this is acceptable.
                if (currentFilter === 'favorites') {
                    // Re-apply search filter if there's any text in the input
                    const rawSearch = searchInput.value;
                    if (rawSearch.trim() === '') {
                        renderItems(itemsData);
                    } else {
                        const searchTokens = rawSearch.trim().split(/[\s　]+/);
                        const filtered = itemsData.filter(item => {
                            const normalizedName = normalizeForSearch(item.name);
                            const normalizedCode = normalizeForSearch(item.code);
                            const searchableText = normalizedName + normalizedCode;
                            return searchTokens.every(token => searchableText.includes(normalizeForSearch(token)));
                        });
                        renderItems(filtered);
                    }
                }
            });

            const updateCart = (val) => {
                if (val > 0) currentCart[item.code] = { qty: val, name: item.name };
                else delete currentCart[item.code];
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

            fragment.appendChild(card);
        });

        if (displayItems.length > MAX_RENDER_LIMIT) {
            const limitMsg = document.createElement('div');
            limitMsg.style.textAlign = 'center';
            limitMsg.style.padding = '20px';
            limitMsg.style.color = '#64748b';
            limitMsg.style.backgroundColor = '#f8fafc';
            limitMsg.style.borderRadius = 'var(--radius-md)';
            limitMsg.style.marginTop = '20px';
            limitMsg.style.marginBottom = '20px';
            limitMsg.innerHTML = `<strong>※表示上限（${MAX_RENDER_LIMIT}件）に達しました。</strong><br>さらにカテゴリで絞り込むか、商品名で検索してください。<br>（該当件数: ${displayItems.length}件）`;
            fragment.appendChild(limitMsg);
        }

        itemListContainer.appendChild(fragment);
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

            showConfirm('この発注をキャンセルします。よろしいですか？', () => {
                cancelOrder(e.target.dataset.orderId);
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
                    orderId: orderId
                })
            });
            const result = await response.json();
            if (result.status === 'success') {
                showToast('発注をキャンセルしました。');
                fetchHistory(); // Refresh
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
                currentCart[itemCode] = { qty: val, name: customName };
            } else {
                delete currentCart[itemCode];
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
                showToast('先に特注商品の「商品名や規格」を入力してください。', 'danger');
                return;
            }
            let val = parseInt(qtyInput.value) || 0;
            val += 1; qtyInput.value = val; updateCart(val); calculateTotal();
        });

        qtyInput.addEventListener('change', () => {
            let val = parseInt(qtyInput.value) || 0;
            if (val < 0) val = 0;
            if (val > 0 && !nameInput.value.trim()) {
                showToast('先に特注商品の「商品名や規格」を入力してください。', 'danger');
                val = 0;
            }
            qtyInput.value = val;
            updateCart(val);
            calculateTotal();
        });

        removeBtn.addEventListener('click', () => {
            if (confirm('この特注商品を削除しますか？')) {
                delete currentCart[itemCode];
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

        // Restore quantities from the history items into cart
        items.forEach(item => {
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
        if (orderSubmitBtn) orderSubmitBtn.textContent = '発注する';
        if (cancelEditBtn) cancelEditBtn.classList.add('hidden');
        if (customItemsList) customItemsList.innerHTML = '';
        calculateTotal();
        if (searchInput) searchInput.value = '';

        if (currentManufacturerFilter === 'all') {
            itemListContainer.innerHTML = RENDER_PROMPT_HTML;
        } else {
            renderItems(itemsData); // Clear search filters
        }
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
        // Reset all
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

            // Re-render items based on all/favs
            currentFilter = tabId === 'tab-favorites' ? 'favorites' : 'all';
            currentManufacturerFilter = 'all';
            currentCategoryFilter = 'all';
            searchInput.value = ''; // Reset search focus
            renderManufacturerChips();

            if (currentFilter === 'all') {
                // --- CRITICAL PC FREEZE FIX (RENDER AVOIDANCE) ---
                categoryChipsContainer.innerHTML = '';
                itemListContainer.innerHTML = RENDER_PROMPT_HTML;
            } else {
                renderCategoryChips();
                renderItems(itemsData);
            }
        }
    };

    if (tabAll) tabAll.addEventListener('click', () => switchTab('tab-all'));
    if (tabFavorites) tabFavorites.addEventListener('click', () => switchTab('tab-favorites'));
    if (tabHistory) tabHistory.addEventListener('click', () => switchTab('tab-history'));

    // --- Search Logic ---
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        const rawSearch = e.target.value;

        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            if (rawSearch.trim() === '') {
                if (currentManufacturerFilter === 'all') {
                    itemListContainer.innerHTML = RENDER_PROMPT_HTML;
                } else {
                    renderItems(itemsData);
                }
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
        }, 300); // 300ms debounce to prevent UI freezes on rapid typing/autofill
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
        const fragment = document.createDocumentFragment();
        const allChip = document.createElement('div');
        allChip.className = `manufacturer-chip ${currentManufacturerFilter === 'all' ? 'active' : ''}`;
        allChip.textContent = 'すべてのメーカー';
        allChip.addEventListener('click', () => {
            currentManufacturerFilter = 'all';
            currentCategoryFilter = 'all'; // Reset category when switching manufacturer
            renderManufacturerChips();
            categoryChipsContainer.innerHTML = ''; // Clear category chips since 'all' is selected
            if (searchInput) searchInput.value = '';

            itemListContainer.innerHTML = RENDER_PROMPT_HTML;
        });
        fragment.appendChild(allChip);

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
            fragment.appendChild(chip);
        });
        manufacturerChipsContainer.appendChild(fragment);
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
        const fragment = document.createDocumentFragment();
        const allChip = document.createElement('div');
        allChip.className = `category-chip ${currentCategoryFilter === 'all' ? 'active' : ''}`;
        allChip.textContent = 'すべて';
        allChip.addEventListener('click', () => {
            currentCategoryFilter = 'all';
            renderCategoryChips(); // Re-render chips to update active state
            if (searchInput) searchInput.value = ''; // Reset search focus

            if (currentManufacturerFilter === 'all') {
                itemListContainer.innerHTML = RENDER_PROMPT_HTML;
            } else {
                renderItems(itemsData);
            }
        });
        fragment.appendChild(allChip);

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
            fragment.appendChild(chip);
        });
        categoryChipsContainer.appendChild(fragment);
    };

    // --- Fetch Items from API (with Caching) ---
    const fetchItems = async (forceRefresh = false) => {
        console.log('[Debug] fetchItems started. forceRefresh:', forceRefresh);
        showLoading();
        try {
            const CACHE_KEY = 'b2b_master_data';
            const TIME_KEY = 'b2b_master_timestamp';
            const ONE_DAY_MS = 24 * 60 * 60 * 1000;

            // Check cache if not forcing refresh
            if (!forceRefresh) {
                console.log('[Debug] Checking local cache...');
                const cachedData = localStorage.getItem(CACHE_KEY);
                const cachedTime = localStorage.getItem(TIME_KEY);

                if (cachedData && cachedTime) {
                    const age = Date.now() - parseInt(cachedTime, 10);
                    if (age < ONE_DAY_MS) {
                        console.log('[Debug] Cache is valid. Age:', age, 'ms');
                        try {
                            itemsData = JSON.parse(cachedData);
                            console.log('[Debug] Cache parsed successfully. Items count:', itemsData.length);

                            console.log('[Debug] Rendering Manufacturer Chips...');
                            renderManufacturerChips();

                            // --- CRITICAL PC FREEZE FIX (RENDER AVOIDANCE) ---
                            // Do NOT render categories or items from cache on initial load. 
                            console.log('[Debug] Rendering Initial Prompt (Cache)...');
                            categoryChipsContainer.innerHTML = '';
                            itemListContainer.innerHTML = RENDER_PROMPT_HTML;

                            if (announcementBanner) {
                                announcementBanner.classList.remove('hidden');
                            }
                            if (currentFilter === 'all') {
                                loadDraft();
                            }
                            console.log('[Debug] Cache render complete. Hiding loading overlay.');
                            hideLoading();
                            return; // Exit early since we used cache
                        } catch (renderError) {
                            console.error('[Error] Failed during cache rendering:', renderError);
                            showToast('画面の描画中にエラーが発生しました。開発者ツールのConsoleを確認してください。', 'danger');
                        }
                    } else {
                        console.log('[Debug] Cache expired (older than 24h). Fetching fresh data...');
                    }
                } else {
                    console.log('[Debug] No cache found. Fetching fresh data...');
                }
            } else {
                console.log('[Debug] Force refresh requested. Fetching fresh data...');
            }

            console.log('[Debug] Fetching from GAS API...');
            const url = `${CONFIG.API_URL}?action=items`;
            const response = await fetch(url);
            console.log('[Debug] Response received. Parsing JSON...');
            const result = await response.json();

            if (result.status === 'success') {
                console.log('[Debug] API fetch success. Items count:', result.data.length);
                itemsData = result.data;

                // Save to Cache
                try {
                    console.log('[Debug] Saving to localStorage...');
                    localStorage.setItem(CACHE_KEY, JSON.stringify(itemsData));
                    localStorage.setItem(TIME_KEY, Date.now().toString());
                    console.log('[Debug] Saved to localStorage.');
                } catch (e) {
                    console.warn('[Warning] Could not save to localStorage (quota exceeded?).', e);
                }

                try {
                    console.log('[Debug] Rendering Manufacturer Chips (API data)...');
                    renderManufacturerChips();

                    // --- CRITICAL PC FREEZE FIX (RENDER AVOIDANCE) ---
                    // Do NOT render categories or items on initial load. The sheer DOM size of 11K items 
                    // instantly freezes the PC Chromium engine.
                    categoryChipsContainer.innerHTML = '';
                    itemListContainer.innerHTML = RENDER_PROMPT_HTML;
                    console.log('[Debug] Rendered initial manufacturer prompt.');

                    // Show Announcement banner
                    if (announcementBanner) {
                        announcementBanner.classList.remove('hidden');
                    }

                    // Attempt to load draft after rendering the items list once
                    if (currentFilter === 'all') { // Only prompt on initial load
                        loadDraft();
                    }
                    console.log('[Debug] API data render complete.');
                } catch (renderError) {
                    console.error('[Error] Failed during API rendering:', renderError);
                    showToast('画面の描画中にエラーが発生しました。', 'danger');
                }
            } else {
                console.error('[Error] API returned failure status:', result.message);
                showToast('商品データの取得に失敗しました: ' + result.message, 'danger');
            }
        } catch (error) {
            console.error('[Error] Network or fatal error in fetchItems:', error);
            showToast('通信エラーが発生しました。再度お試しください。', 'danger');
        } finally {
            console.log('[Debug] fetchItems finally block reached. Hiding loading overlay.');
            hideLoading();
        }
    };

    // Wire up the manual refresh button
    const refreshDataBtn = document.getElementById('refresh-data-btn');
    if (refreshDataBtn) {
        refreshDataBtn.addEventListener('click', () => {
            showConfirm('最新の商品データをダウンロードしますか？（少し時間がかかります）', () => {
                fetchItems(true); // pass forceRefresh = true
            });
        });
    }

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
                currentUsername = username;
                currentClientName = result.clientName;

                // Load favorites
                const savedFavs = localStorage.getItem(`b2b_favs_${currentUsername}`);
                if (savedFavs) {
                    try {
                        favoriteItems = JSON.parse(savedFavs);
                    } catch (e) { favoriteItems = []; }
                } else {
                    favoriteItems = [];
                }

                // Switch screen
                loginContainer.classList.add('hidden');
                orderContainer.classList.remove('hidden');

                // --- CRITICAL PC FREEZE FIX ---
                // 1. Unfocus any input fields to prevent virtual keyboard/autofill locks
                if (document.activeElement) {
                    document.activeElement.blur();
                }
                window.scrollTo(0, 0); // Reset scroll position

                // 2. Force a synchronous DOM reflow to guarantee the login screen disappears instantly
                void loginContainer.offsetHeight;

                // 3. Yield the thread to the browser's paint cycle before fetching heavy data
                requestAnimationFrame(() => {
                    setTimeout(async () => {
                        await fetchItems();
                    }, 50);
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
                showToast(isEditing ? '発注内容を変更しました。' : '発注が完了しました！\n引き続き発注いただけます。');
                localStorage.removeItem(`b2b_draft_${currentUsername}`);

                // Clear custom item fields safely
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

    // --- Submit Order (API) ---
    if (orderSubmitBtn) {
        orderSubmitBtn.addEventListener('click', () => {
            const total = parseInt(totalQtySpan.textContent);
            if (total === 0) {
                showToast('商品を1点以上選択してください。', 'danger');
                return;
            }

            const orders = [];

            // Check if Confirmation Screen elements exist safely
            if (confirmationContainer && confirmItemList) {
                confirmItemList.innerHTML = ''; // Reset list

                Object.entries(currentCart).forEach(([code, data]) => {
                    if (data.qty > 0) {
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
});
