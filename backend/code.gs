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
// 1. GET リクエスト処理 (商品マスタ または 発注履歴 の取得)
// ==========================================
function doGet(e) {
  try {
    const action = e.parameter.action || 'items'; // default is fetching items
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    
    if (action === 'items') {
      const sheet = ss.getSheetByName(SHEET_NAMES.MASTER);
      if (!sheet) throw new Error(`Sheet '${SHEET_NAMES.MASTER}' not found.`);
      
      const values = sheet.getDataRange().getValues();
      const items = [];
      for (let i = 1; i < values.length; i++) {
          const row = values[i];
          if (row[0] && row[1]) {
              items.push({ 
                code: row[0], 
                name: row[1], 
                category: row[2] || '',
                manufacturer: row[3] || ''
              });
          }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: items }))
        .setMimeType(ContentService.MimeType.JSON);
        
    } else if (action === 'history') {
      const clientName = e.parameter.clientName;
      if (!clientName) throw new Error("clientName parameter is required for history.");
      
      const sheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
      if (!sheet) throw new Error(`Sheet '${SHEET_NAMES.ORDERS}' not found.`);
      
      const values = sheet.getDataRange().getValues();
      const history = [];
      
      // A: Timestamp, B: Code, C: Qty, D: Name, E: ClientName
      // Read from latest to oldest
      for (let i = values.length - 1; i >= 1; i--) {
          const row = values[i];
          if (row[4] === clientName) {
              const orderDate = new Date(row[0]);
              history.push({
                  orderId: orderDate.getTime(), // Use epoch time as unique ID
                  date: Utilities.formatDate(orderDate, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm"),
                  code: row[1],
                  qty: row[2],
                  name: row[3]
              });
          }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: history }))
        .setMimeType(ContentService.MimeType.JSON);
    } else {
        throw new Error("Invalid action parameter for GET.");
    }

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ==========================================
// 2. POST リクエスト処理 (ログイン / 発注記録 / キャンセル / 変更)
// ==========================================
function doPost(e) {
    try {
        // GASのdoPostで生JSONを受け取る場合は e.postData.contents をパースする
        if (!e.postData || !e.postData.contents) {
             throw new Error("No POST data received.");
        }
        const postData = JSON.parse(e.postData.contents);
        const action = postData.action; // 'login' or 'order' or 'cancel_order' or 'update_order'

        if (action === 'login') {
             return handleLogin(postData);
        } else if (action === 'order') {
             return handleOrder(postData);
        } else if (action === 'cancel_order') {
             return handleCancelOrder(postData);
        } else if (action === 'update_order') {
             return handleUpdateOrder(postData);
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
     const remarks = data.remarks || ''; // 備考

     if(!clientName || !orders || !Array.isArray(orders) || orders.length === 0) {
         throw new Error("Invalid order data format.");
     }

     const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
     const sheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
     
     if(!sheet) throw new Error("Orders sheet not found.");

     // 「タイムスタンプ, 商品コード, 個数, 商品名, 得意先名, 備考」 の形式で書き込み
     const timestamp = new Date(); // GAS実行サーバーの時間
     const rowsToAdd = [];
     
     let orderSummaryForLINE = `【新規発注】\nサロン名: ${clientName}\n\n`;

     orders.forEach(order => {
         if(order.qty > 0) {
             // Append: A:タイムスタンプ, B:商品コード, C:個数, D:商品名, E:得意先名, F:備考
             rowsToAdd.push([
                 timestamp,
                 order.code,
                 order.qty,
                 order.name,
                 clientName,
                 remarks // F列に備考を追加
             ]);
             orderSummaryForLINE += `・${order.name}: ${order.qty}点\n`;
         }
     });

     if(rowsToAdd.length > 0) {
         // 一度に書き込む方がAPIコール数が減り高速
         const startRow = sheet.getLastRow() + 1;
         sheet.getRange(startRow, 1, rowsToAdd.length, rowsToAdd[0].length).setValues(rowsToAdd);
     }
     
     // 備考があればLINE通知に追加
     if (remarks) orderSummaryForLINE += `\n【備考】\n${remarks}`;
     sendLineNotification(orderSummaryForLINE);

     return ContentService.createTextOutput(JSON.stringify({ 
         status: 'success', 
         message: 'Order recorded successfully' 
     })).setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------
// 注文キャンセル処理
// ------------------------------------------
function handleCancelOrder(data) {
     const clientName = data.clientName;
     const orderId = data.orderId;

     if(!clientName || !orderId) {
         throw new Error("Invalid cancel data format.");
     }

     const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
     const sheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
     if(!sheet) throw new Error("Orders sheet not found.");

     const values = sheet.getDataRange().getValues();
     
     // Note: We need to delete from the bottom up to avoid shifting row indices
     let deletedCount = 0;
     for(let i = values.length - 1; i >= 1; i--) {
          const row = values[i];
          // Match by ClientName and Epoch Time (orderId)
          if(row[4] === clientName && new Date(row[0]).getTime() === parseInt(orderId)) {
               // i is 0-indexed array, getRange is 1-indexed (row 1 is header, so i=1 is row 2)
               sheet.deleteRow(i + 1);
               deletedCount++;
          }
     }

     if(deletedCount > 0) {
          return ContentService.createTextOutput(JSON.stringify({ 
               status: 'success', 
               message: 'Order canceled successfully' 
          })).setMimeType(ContentService.MimeType.JSON);
     } else {
          return ContentService.createTextOutput(JSON.stringify({ 
               status: 'error', 
               message: 'Order to cancel not found' 
          })).setMimeType(ContentService.MimeType.JSON);
     }
}

// ------------------------------------------
// 注文変更（再発注）処理
// ------------------------------------------
function handleUpdateOrder(data) {
     const clientName = data.clientName;
     const orderId = data.orderId;
     const orders = data.orders;
     const remarks = data.remarks || ''; // 備考

     if(!clientName || !orderId || !orders || !Array.isArray(orders) || orders.length === 0) {
         throw new Error("Invalid update data format.");
     }

     const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
     const sheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
     if(!sheet) throw new Error("Orders sheet not found.");

     // 1. Delete old rows
     const values = sheet.getDataRange().getValues();
     for(let i = values.length - 1; i >= 1; i--) {
          const row = values[i];
          if(row[4] === clientName && new Date(row[0]).getTime() === parseInt(orderId)) {
               sheet.deleteRow(i + 1);
          }
     }

     // 2. Append new rows using the ORIGINAL timestamp (orderId)
     const originalTimestamp = new Date(parseInt(orderId));
     const rowsToAdd = [];
     
     let orderSummaryForLINE = `【発注内容変更】\nサロン名: ${clientName}\n\n`;

     orders.forEach(order => {
         if(order.qty > 0) {
             rowsToAdd.push([
                 originalTimestamp, // <-- Use the old timestamp
                 order.code,
                 order.qty,
                 order.name,
                 clientName,
                 remarks // F列に備考を追加
             ]);
             orderSummaryForLINE += `・${order.name}: ${order.qty}点\n`;
         }
     });

     if(rowsToAdd.length > 0) {
         const startRow = sheet.getLastRow() + 1;
         sheet.getRange(startRow, 1, rowsToAdd.length, rowsToAdd[0].length).setValues(rowsToAdd);
     }
     
     if (remarks) orderSummaryForLINE += `\n【備考】\n${remarks}`;
     sendLineNotification(orderSummaryForLINE);

     return ContentService.createTextOutput(JSON.stringify({ 
         status: 'success', 
         message: 'Order updated successfully' 
     })).setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------
// LINE通知処理
// ------------------------------------------
function sendLineNotification(message) {
    try {
        const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
        const groupId = PropertiesService.getScriptProperties().getProperty('GROUP_ID');

        // Only send if properties are set, otherwise silently skip
        if (!token || !groupId) {
            console.log("LINE Notification skipped: Credentials not found in Script Properties.");
            return;
        }

        const url = 'https://api.line.me/v2/bot/message/push';
        const payload = {
            to: groupId,
            messages: [{ type: 'text', text: message }]
        };

        const options = {
            method: 'post',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            payload: JSON.stringify(payload)
        };

        UrlFetchApp.fetch(url, options);
    } catch (error) {
        console.error("Failed to send LINE Notification: " + error.toString());
    }
}
