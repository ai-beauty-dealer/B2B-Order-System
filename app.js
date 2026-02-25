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

    // State
    let currentUsername = ''; // Use username for unique localstorage key
    let currentClientName = '';
    let itemsData = [];
    let favoriteItems = []; // Array of item codes
    let currentFilter = 'all'; // 'all' or 'favorites'
    let editingOrderId = null; // Store orderId if editing an existing order

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

    const showLoading = () => loadingOverlay.classList.remove('hidden');
    const hideLoading = () => loadingOverlay.classList.add('hidden');

    const calculateTotal = () => {
        let total = 0;
        document.querySelectorAll('.qty-input').forEach(input => {
            total += parseInt(input.value) || 0;
        });
        totalQtySpan.textContent = total;
    };

    // --- Draft Feature ---
    const saveDraft = () => {
        if (!currentUsername) return;
        const draftData = {};
        document.querySelectorAll('.qty-input').forEach(input => {
            const qty = parseInt(input.value) || 0;
            if (qty > 0) {
                draftData[input.dataset.code] = qty;
            }
        });

        localStorage.setItem(`b2b_draft_${currentUsername}`, JSON.stringify(draftData));
        alert('入力中の数量を一時保存しました。');
    };

    const loadDraft = () => {
        if (!currentUsername) return;
        const savedDraft = localStorage.getItem(`b2b_draft_${currentUsername}`);
        if (!savedDraft) return;

        try {
            const draftData = JSON.parse(savedDraft);
            if (Object.keys(draftData).length > 0) {
                if (confirm('前回の一時保存データがあります。復元しますか？')) {
                    Object.entries(draftData).forEach(([code, qty]) => {
                        const input = document.querySelector(`.qty-input[data-code="${code}"]`);
                        if (input) {
                            input.value = qty;
                        }
                    });
                    calculateTotal();
                }
            }
        } catch (e) { /* ignore invalid data */ }
    };

    saveDraftBtn.addEventListener('click', saveDraft);

    // --- Render Items ---
    const renderItems = (items) => {
        itemListContainer.innerHTML = ''; // Clear current

        // Filter by current tab selection before rendering
        let displayItems = items;
        if (currentFilter === 'favorites') {
            displayItems = items.filter(item => favoriteItems.includes(item.code));
        }

        if (displayItems.length === 0) {
            itemListContainer.innerHTML = '<p>商品が見つかりません。</p>';
            return;
        }

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
                    <input type="number" class="qty-input" data-code="${item.code}" data-name="${item.name}" value="0" min="0">
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

            card.querySelector('.minus').addEventListener('click', () => {
                let val = parseInt(input.value) || 0;
                if (val > 0) { input.value = val - 1; calculateTotal(); }
            });
            card.querySelector('.plus').addEventListener('click', () => {
                let val = parseInt(input.value) || 0;
                input.value = val + 1; calculateTotal();
            });
            input.addEventListener('change', () => {
                let val = parseInt(input.value) || 0;
                if (val < 0) input.value = 0;
                calculateTotal();
            });

            itemListContainer.appendChild(card);
        });
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

    // --- Start Editing Order ---
    const startEditingOrder = (orderId, items) => {
        editingOrderId = orderId;

        // Switch back to 'all' tab first so the items are rendered
        switchTab('tab-all');
        window.scrollTo(0, 0);

        // Reset all inputs to 0 first
        document.querySelectorAll('.qty-input').forEach(input => input.value = 0);

        // Restore quantities from the history items
        items.forEach(item => {
            const input = document.querySelector(`.qty-input[data-code="${item.code}"]`);
            if (input) {
                input.value = item.qty;
            }
        });

        calculateTotal();

        // Update UI for Edit Mode
        orderSubmitBtn.textContent = '変更を保存する';
        cancelEditBtn.classList.remove('hidden');
    };

    // --- Cancel Edit Mode ---
    cancelEditBtn.addEventListener('click', () => {
        resetEditMode();
    });

    const resetEditMode = () => {
        editingOrderId = null;
        orderSubmitBtn.textContent = '発注する';
        cancelEditBtn.classList.add('hidden');
        document.querySelectorAll('.qty-input').forEach(input => input.value = 0);
        calculateTotal();
        searchInput.value = '';
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
            historyListContainer.classList.remove('hidden');
            fetchHistory();
        } else {
            itemListContainer.classList.remove('hidden');
            searchWrapper.classList.remove('hidden');
            cartSummary.classList.remove('hidden');
            historyListContainer.classList.add('hidden');

            // Re-render items based on all/favs
            currentFilter = tabId === 'tab-favorites' ? 'favorites' : 'all';
            searchInput.value = ''; // Reset search focus
            renderItems(itemsData);
        }
    };

    tabAll.addEventListener('click', () => switchTab('tab-all'));
    tabFavorites.addEventListener('click', () => switchTab('tab-favorites'));
    tabHistory.addEventListener('click', () => switchTab('tab-history'));

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

    // --- Fetch Items from API ---
    const fetchItems = async () => {
        showLoading();
        try {
            // Setup for GAS doGet with item parameter (default behavior)
            const url = `${CONFIG.API_URL}?action=items`;
            const response = await fetch(url);
            const result = await response.json();

            if (result.status === 'success') {
                itemsData = result.data;
                renderItems(itemsData);

                // Attempt to load draft after rendering the items list once
                if (currentFilter === 'all') { // Only prompt on initial load
                    loadDraft();
                }
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
                // Fetch items on successful login
                fetchItems();
            } else {
                alert('ログインに失敗しました: ' + result.message);
            }
        } catch (error) {
            console.error(error);
            alert('通信に失敗しました。');
        } finally {
            hideLoading();
        }
    });

    // --- Logout ---
    logoutBtn.addEventListener('click', () => {
        currentUsername = '';
        currentClientName = '';
        favoriteItems = [];

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

    // --- Submit Order (API) ---
    orderSubmitBtn.addEventListener('click', async () => {
        const total = parseInt(totalQtySpan.textContent);
        if (total === 0) {
            alert('商品を1点以上選択してください。');
            return;
        }

        // Collect order data
        const orders = [];
        document.querySelectorAll('.qty-input').forEach(input => {
            const qty = parseInt(input.value) || 0;
            if (qty > 0) {
                orders.push({
                    code: input.dataset.code,
                    name: input.dataset.name,
                    qty: qty
                });
            }
        });

        const isEditing = editingOrderId !== null;
        const confirmMsg = isEditing
            ? `${total}点で発注内容を変更します。よろしいですか？`
            : `${total}点の商品を発注します。よろしいですか？`;

        if (!confirm(confirmMsg)) return;

        showLoading();
        try {
            const requestBody = {
                action: isEditing ? 'update_order' : 'order',
                clientName: currentClientName,
                orders: orders
            };

            if (isEditing) {
                requestBody.orderId = editingOrderId;
            }

            const response = await fetch(CONFIG.API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(requestBody)
            });

            const result = await response.json();

            if (result.status === 'success') {
                alert(isEditing ? '発注内容を変更しました。' : '発注が完了しました！\n引き続き発注いただけます。');

                // Clear draft upon successful order
                localStorage.removeItem(`b2b_draft_${currentUsername}`);

                resetEditMode();
            } else {
                alert('失敗しました: ' + result.message);
            }
        } catch (error) {
            console.error(error);
            alert('通信エラーが発生しました。発注が完了していない可能性があります。');
        } finally {
            hideLoading();
        }
    });
});
