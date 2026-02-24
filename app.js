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

    // --- Utility Functions ---
    const showLoading = () => loadingOverlay.classList.remove('hidden');
    const hideLoading = () => loadingOverlay.classList.add('hidden');

    const calculateTotal = () => {
        let total = 0;
        document.querySelectorAll('.qty-input').forEach(input => {
            total += parseInt(input.value) || 0;
        });
        totalQtySpan.textContent = total;
    };

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
                    const searchTerm = searchInput.value.toLowerCase();
                    const filtered = itemsData.filter(i => i.name.toLowerCase().includes(searchTerm));
                    renderItems(filtered);
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

        historyData.forEach(hist => {
            const card = document.createElement('div');
            card.className = 'history-card';
            card.innerHTML = `
                <div class="history-date">${hist.date}</div>
                <div class="history-detail">${hist.name} × ${hist.qty}</div>
            `;
            historyListContainer.appendChild(card);
        });
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
        const searchTerm = e.target.value.toLowerCase();
        const filteredItems = itemsData.filter(item =>
            item.name.toLowerCase().includes(searchTerm)
        );
        renderItems(filteredItems);
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

        if (!confirm(`${total}点の商品を発注します。よろしいですか？`)) return;

        showLoading();
        try {
            const response = await fetch(CONFIG.API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'order',
                    clientName: currentClientName,
                    orders: orders
                })
            });

            const result = await response.json();

            if (result.status === 'success') {
                alert('発注が完了しました！\n引き続き発注いただけます。');
                // Reset inputs
                document.querySelectorAll('.qty-input').forEach(input => input.value = 0);
                calculateTotal();
                searchInput.value = '';
                renderItems(itemsData); // Re-render to clear search
            } else {
                alert('発注に失敗しました: ' + result.message);
            }
        } catch (error) {
            console.error(error);
            alert('通信エラーが発生しました。発注が完了していない可能性があります。');
        } finally {
            hideLoading();
        }
    });
});
