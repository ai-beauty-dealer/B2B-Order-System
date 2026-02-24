// ==========================================
// 🛠️ B2B Order System - Backend (GAS)
// ==========================================

const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE'; // ★構築時にスプレッドシートのIDを入力する

// --- 設定 ---
const SHEET_NAMES = {
  MASTER: 'ItemMaster',
  CLIENT: 'ClientMaster',
  ORDERS: 'Orders'
};

// ==========================================
// 1. GET リクエスト処理 (商品マスタの取得)
// ==========================================
function doGet(e) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAMES.MASTER);
    
    if (!sheet) {
      throw new Error(`Sheet '${SHEET_NAMES.MASTER}' not found.`);
    }

    // A列: 商品コード(不要だが取得はする), B列: 商品名 を想定
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    
    // ヘッダー行(1行目)を除外して構築
    const items = [];
    for (let i = 1; i < values.length; i++) {
        const row = values[i];
        if (row[0] && row[1]) {
            items.push({
                code: row[0],
                name: row[1]
            });
        }
    }

    const result = {
      status: 'success',
      data: items
    };

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    const result = {
      status: 'error',
      message: error.toString()
    };
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ==========================================
// 2. POST リクエスト処理 (ログイン / 発注記録)
// ==========================================
function doPost(e) {
    try {
        // GASのdoPostで生JSONを受け取る場合は e.postData.contents をパースする
        const postData = JSON.parse(e.postData.contents);
        const action = postData.action; // 'login' or 'order'

        if (action === 'login') {
             return handleLogin(postData);
        } else if (action === 'order') {
             return handleOrder(postData);
        } else {
             throw new Error("Invalid action parameter.");
        }

    } catch (error) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
          .setMimeType(ContentService.MimeType.JSON);
    }
}

// --- ログイン処理 ---
function handleLogin(data) {
    const username = data.username;
    const password = data.password;

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAMES.CLIENT);
    
    if(!sheet) throw new Error("Client sheet not found.");

    const values = sheet.getDataRange().getValues();
    
    // ヘッダーをスキップし、A列:ID, B列:PW, C列:得意先名 を想定して検索
    let clientName = null;
    let authSuccess = false;

    for(let i=1; i<values.length; i++) {
        if(String(values[i][0]) === String(username) && String(values[i][1]) === String(password)) {
            authSuccess = true;
            clientName = values[i][2]; // C列の得意先名
            break;
        }
    }

    if(authSuccess) {
         return ContentService.createTextOutput(JSON.stringify({ 
             status: 'success', 
             message: 'Login successful', 
             clientName: clientName 
         })).setMimeType(ContentService.MimeType.JSON);
    } else {
         return ContentService.createTextOutput(JSON.stringify({ 
             status: 'error', 
             message: 'Invalid username or password' 
         })).setMimeType(ContentService.MimeType.JSON);
    }
}

// --- 発注処理 ---
function handleOrder(data) {
     const clientName = data.clientName; // ログイン時に取得した得意先名
     const orders = data.orders; // 発注データの配列 [{code: "A", name: "商品A", qty: 2}, ...]

     if(!clientName || !orders || !Array.isArray(orders) || orders.length === 0) {
         throw new Error("Invalid order data format.");
     }

     const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
     const sheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
     
     if(!sheet) throw new Error("Orders sheet not found.");

     // 「タイムスタンプ, 商品コード, 個数, 商品名, 得意先名」 の形式で書き込み
     const timestamp = new Date(); // GAS実行サーバーの時間
     const rowsToAdd = [];

     orders.forEach(order => {
         if(order.qty > 0) {
             // Append: A:タイムスタンプ, B:商品コード, C:個数, D:商品名, E:得意先名
             rowsToAdd.push([
                 timestamp,
                 order.code,
                 order.qty,
                 order.name,
                 clientName
             ]);
         }
     });

     if(rowsToAdd.length > 0) {
         // 一度に書き込む方がAPIコール数が減り高速
         const startRow = sheet.getLastRow() + 1;
         sheet.getRange(startRow, 1, rowsToAdd.length, rowsToAdd[0].length).setValues(rowsToAdd);
     }

     return ContentService.createTextOutput(JSON.stringify({ 
         status: 'success', 
         message: 'Order recorded successfully' 
     })).setMimeType(ContentService.MimeType.JSON);
}
