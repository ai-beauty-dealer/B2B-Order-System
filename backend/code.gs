// ==========================================
// 🛠️ B2B Order System - Backend (GAS)
// ==========================================

const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE'; // ★ここにご自身のスプレッドシートIDを貼り付けてください！
// スプレッドシートのIDは、URLの「/d/」と「/edit」の間の文字列（例: 1abc...xyz）です。

// --- 設定 ---
const SHEET_NAMES = {
  MASTER: 'ItemMaster',
  CLIENT: 'ClientMaster',
  ORDERS: 'Orders'
};
const CLIENT_TYPE_DIRECT = '直送'; // D列に入力するフラグ

// --- サブ関数: 締め時間に基づいた保存先の日付文字列を生成 ---
function getTargetDateStr(date) {
  // 日本時間で計算（タイムゾーンに注意）
  // date は JavaScript の Date オブジェクト
  const d = new Date(date.getTime());
  
  const hours = d.getHours();
  const day = d.getDay(); // 0 (日) ～ 6 (土)

  // 11時以降なら翌日扱い
  if (hours >= 11) {
    d.setDate(d.getDate() + 1);
  }

  // 土日の場合は月曜日に集約
  // もし上記の判定で土曜になったら月曜(+2)へ、日曜になったら月曜(+1)へ
  let newDay = d.getDay();
  if (newDay === 6) { // 土曜
    d.setDate(d.getDate() + 2);
  } else if (newDay === 0) { // 日曜
    d.setDate(d.getDate() + 1);
  }

  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

// --- サブ関数: 指定された日付のシートを取得または作成 ---
// clientType が '直送' の場合、シート名が 'YYYY-MM-DD直送' になる
function getOrCreateOrderSheet(ss, dateStr, clientType) {
  const sheetName = (clientType === CLIENT_TYPE_DIRECT) ? dateStr + '直送' : dateStr;
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    // ヘッダーを追加（A:タイムスタンプ B:商品コード C:個数 D:商品名 E:得意先名 F:ステータス G:備考 H:別注）
    sheet.appendRow(['タイムスタンプ', '商品コード', '個数', '商品名', '得意先名', 'ステータス', '備考', '別注']);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground(
      clientType === CLIENT_TYPE_DIRECT ? '#fff2cc' : '#f3f3f3'
    );
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// 1. GET リクエスト処理 (商品マスタ または 発注履歴 の取得)
function doGet(e) {
  try {
    const action = e.parameter.action || 'items';
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
                manufacturer: row[3] || '',
                special: row[4] || ''  // E列: '別注' など
              });
          }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: items }))
        .setMimeType(ContentService.MimeType.JSON);
        
    } else if (action === 'history') {
      const clientName = e.parameter.clientName;
      if (!clientName) throw new Error("clientName parameter is required for history.");
      
      const history = [];
      const sheets = ss.getSheets();
      
      // yyyy-MM-dd 形式、または yyyy-MM-dd直送 形式のシート名を正規表現で判定
      const dateSheetRegex = /^\d{4}-\d{2}-\d{2}(直送)?$/;

      sheets.forEach(sheet => {
        const sheetName = sheet.getName();
        if (dateSheetRegex.test(sheetName) || sheetName === SHEET_NAMES.ORDERS) {
          const values = sheet.getDataRange().getValues();
          // A: Timestamp, B: Code, C: Qty, D: Name, E: ClientName
          for (let i = values.length - 1; i >= 1; i--) {
            const row = values[i];
            if (row[4] === clientName) {
              const orderDate = new Date(row[0]);
              history.push({
                orderId: orderDate.getTime(),
                date: Utilities.formatDate(orderDate, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm"),
                code: row[1],
                qty: row[2],
                name: row[3]
              });
            }
          }
        }
      });

      // 日時順（降順）にソート
      history.sort((a, b) => b.orderId - a.orderId);

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

// 2. POST リクエスト処理
function doPost(e) {
    try {
        if (!e.postData || !e.postData.contents) throw new Error("No POST data received.");
        const postData = JSON.parse(e.postData.contents);
        const action = postData.action;

        if (action === 'login') return handleLogin(postData);
        else if (action === 'order') return handleOrder(postData);
        else if (action === 'cancel_order') return handleCancelOrder(postData);
        else if (action === 'update_order') return handleUpdateOrder(postData);
        else throw new Error("Invalid action parameter.");
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
    
    // ヘッダーをスキップし、A列:ID, B列:PW, C列:得意先名, D列:種別 を想定して検索
    let clientName = null;
    let clientType = ''; // D列（空なら通常、'直送' なら直送）
    let authSuccess = false;

    for(let i=1; i<values.length; i++) {
        if(String(values[i][0]) === String(username) && String(values[i][1]) === String(password)) {
            authSuccess = true;
            clientName = values[i][2]; // C列の得意先名
            clientType = String(values[i][3] || '').trim(); // D列のサロン種別
            break;
        }
    }

    if(authSuccess) {
         return ContentService.createTextOutput(JSON.stringify({ 
             status: 'success', 
             message: 'Login successful', 
             clientName: clientName,
             clientType: clientType  // '直送' or ''
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
     const clientName = data.clientName;
     const orders = data.orders;
     const remarks = data.remarks || '';
     const clientType = data.clientType || '';

     if(!clientName || !orders || !Array.isArray(orders) || orders.length === 0) {
         throw new Error("Invalid order data format.");
     }

     const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
     const timestamp = new Date();
     const dateStr = getTargetDateStr(timestamp);
     const sheet = getOrCreateOrderSheet(ss, dateStr, clientType);

     // --- 1. ItemMasterから別注商品コードのセットを取得 ---
     const specialCodes = new Set();
     try {
         const masterSheet = ss.getSheetByName(SHEET_NAMES.MASTER);
         if (masterSheet) {
             const masterValues = masterSheet.getDataRange().getValues();
             for (let i = 1; i < masterValues.length; i++) {
                 const row = masterValues[i];
                 if (row[0] && String(row[4] || '').trim() !== '') {
                     specialCodes.add(String(row[0]));
                 }
             }
         }
     } catch(e) { console.warn('別注商品の取得に失敗:', e); }

     // --- 2. シート内の「別注セクション」の開始位置（H列）を特定 ---
     const lastRow = sheet.getLastRow();
     let firstSpecialRow = lastRow + 1; // デフォルトは末尾
     if (lastRow > 1) {
         const colHValues = sheet.getRange(1, 8, lastRow, 1).getValues();
         for (let i = 1; i < colHValues.length; i++) {
             if (String(colHValues[i][0]).trim() === '別注') {
                 firstSpecialRow = i + 1;
                 break;
             }
         }
     }

     const normalRows = [];
     const specialRows = [];
     let orderSummaryForLINE = `${clientType === CLIENT_TYPE_DIRECT ? '【直送発注】' : '【新規発注】'}\nサロン名: ${clientName}\n\n`;

     orders.forEach(order => {
         if(order.qty > 0) {
             const isSpecial = specialCodes.has(String(order.code)) || String(order.code).startsWith('CUSTOM_ITEM_');
             // F:ステータス, G:備考, H:別注
             const row = [timestamp, order.code, order.qty, order.name, clientName, '', remarks, isSpecial ? '別注' : ''];
             
             if (isSpecial) {
                 specialRows.push(row);
             } else {
                 normalRows.push(row);
             }
             orderSummaryForLINE += `・${order.name}: ${order.qty}点\n`;
         }
     });

     // --- 3. 配置（通常商品は別注エリアの前に挿入、別注商品は常に最下部） ---
     if (normalRows.length > 0) {
         sheet.insertRowsBefore(firstSpecialRow, normalRows.length);
         sheet.getRange(firstSpecialRow, 1, normalRows.length, normalRows[0].length).setValues(normalRows);
         // 通常商品を挿入したため、以降の最下部位置を更新
         firstSpecialRow += normalRows.length; 
     }

     if (specialRows.length > 0) {
         const bottomRow = sheet.getLastRow() + 1;
         sheet.getRange(bottomRow, 1, specialRows.length, specialRows[0].length).setValues(specialRows);
     }
     
     if (remarks) orderSummaryForLINE += `\n【備考】\n${remarks}`;
     sendLineNotification(orderSummaryForLINE);

     return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Order recorded successfully' }))
       .setMimeType(ContentService.MimeType.JSON);
}

// --- 注文キャンセル処理 ---
function handleCancelOrder(data) {
     const clientName = data.clientName;
     const orderId = data.orderId; // Epoch time
     const clientType = data.clientType || '';

     const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
     const orderDate = new Date(parseInt(orderId));
     const dateStr = getTargetDateStr(orderDate);
     
     // 直送シートを優先して探し、なければ通常シートを探す
     let sheet = ss.getSheetByName(dateStr + '直送');
     if (!sheet) sheet = ss.getSheetByName(dateStr);
     if (!sheet) sheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
     if (!sheet) throw new Error("Order sheet for this date not found.");

     const values = sheet.getDataRange().getValues();
     let deletedCount = 0;
     for(let i = values.length - 1; i >= 1; i--) {
          const row = values[i];
          if(row[4] === clientName && new Date(row[0]).getTime() === parseInt(orderId)) {
               sheet.deleteRow(i + 1);
               deletedCount++;
          }
     }

     return ContentService.createTextOutput(JSON.stringify({ 
          status: deletedCount > 0 ? 'success' : 'error', 
          message: deletedCount > 0 ? 'Order canceled' : 'Order not found' 
     })).setMimeType(ContentService.MimeType.JSON);
}

// --- 注文変更処理 ---
function handleUpdateOrder(data) {
     const clientName = data.clientName;
     const orderId = data.orderId;
     const orders = data.orders;
     const remarks = data.remarks || '';
     const clientType = data.clientType || '';

     const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
     const originalTimestamp = new Date(parseInt(orderId));
     const dateStr = getTargetDateStr(originalTimestamp);
     
     // 直送シートを優先して探し、なければ通常シートを探す
     let sheet = ss.getSheetByName(dateStr + '直送');
     if (!sheet) sheet = ss.getSheetByName(dateStr);
     if (!sheet) sheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
     if (!sheet) throw new Error("Order sheet not found.");

     // 1. Delete old rows
     const values = sheet.getDataRange().getValues();
     for(let i = values.length - 1; i >= 1; i--) {
          const row = values[i];
          if(row[4] === clientName && new Date(row[0]).getTime() === parseInt(orderId)) {
               sheet.deleteRow(i + 1);
          }
     }

     // 2. Append new rows（絶対的末尾配置対応）
     const specialCodesUpd = new Set();
     try {
         const masterSheet = ss.getSheetByName(SHEET_NAMES.MASTER);
         if (masterSheet) {
             const masterValues = masterSheet.getDataRange().getValues();
             for (let i = 1; i < masterValues.length; i++) {
                 const row = masterValues[i];
                 if (row[0] && String(row[4] || '').trim() !== '') {
                     specialCodesUpd.add(String(row[0]));
                 }
             }
         }
     } catch(e) { console.warn('別注商品取得失敗:', e); }

     // 挿入位置（別注セクションの開始行）を特定
     const lastRowUpd = sheet.getLastRow();
     let firstSpecialRowUpd = lastRowUpd + 1;
     if (lastRowUpd > 1) {
         const colHValuesUpd = sheet.getRange(1, 8, lastRowUpd, 1).getValues();
         for (let i = 1; i < colHValuesUpd.length; i++) {
             if (String(colHValuesUpd[i][0]).trim() === '別注') {
                 firstSpecialRowUpd = i + 1;
                 break;
             }
         }
     }

     const normalRowsUpd = [];
     const specialRowsUpd = [];
     let orderSummaryForLINE = `${clientType === CLIENT_TYPE_DIRECT ? '【直送発注内容変更】' : '【発注内容変更】'}\nサロン名: ${clientName}\n\n`;

     orders.forEach(order => {
         if(order.qty > 0) {
             const isSpecial = specialCodesUpd.has(String(order.code)) || String(order.code).startsWith('CUSTOM_ITEM_');
             const row = [originalTimestamp, order.code, order.qty, order.name, clientName, '', remarks, isSpecial ? '別注' : ''];
             if (isSpecial) {
                 specialRowsUpd.push(row);
             } else {
                 normalRowsUpd.push(row);
             }
             orderSummaryForLINE += `・${order.name}: ${order.qty}点\n`;
         }
     });

     if (normalRowsUpd.length > 0) {
         sheet.insertRowsBefore(firstSpecialRowUpd, normalRowsUpd.length);
         sheet.getRange(firstSpecialRowUpd, 1, normalRowsUpd.length, normalRowsUpd[0].length).setValues(normalRowsUpd);
         firstSpecialRowUpd += normalRowsUpd.length;
     }
     if (specialRowsUpd.length > 0) {
         const bottomRowUpd = sheet.getLastRow() + 1;
         sheet.getRange(bottomRowUpd, 1, specialRowsUpd.length, specialRowsUpd[0].length).setValues(specialRowsUpd);
     }
     
     if (remarks) orderSummaryForLINE += `\n【備考】\n${remarks}`;
     sendLineNotification(orderSummaryForLINE);

     return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Order updated' }))
       .setMimeType(ContentService.MimeType.JSON);
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
