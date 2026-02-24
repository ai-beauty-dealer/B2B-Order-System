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

    // State
    let currentClientName = '';
    let itemsData = [];

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

        if (items.length === 0) {
            itemListContainer.innerHTML = '<p>商品が見つかりません。</p>';
            return;
        }

        items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'item-card';
            card.innerHTML = `
                <div class="item-info">
                    <span class="item-code">${item.code}</span>
                    <h3 class="item-name">${item.name}</h3>
                </div>
                <div class="order-controls">
                    <button type="button" class="btn-qty minus">-</button>
                    <input type="number" class="qty-input" data-code="${item.code}" data-name="${item.name}" value="0" min="0">
                    <button type="button" class="btn-qty plus">+</button>
                </div>
            `;

            // Attach Events for this card
            const input = card.querySelector('.qty-input');
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
            // Setup for GAS doGet
            const response = await fetch(CONFIG.API_URL);
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
                currentClientName = result.clientName;
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
        currentClientName = '';
        orderContainer.classList.add('hidden');
        loginContainer.classList.remove('hidden');
        loginForm.reset();
        itemListContainer.innerHTML = '';
        totalQtySpan.textContent = '0';
        searchInput.value = '';
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
