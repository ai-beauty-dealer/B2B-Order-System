// ==========================================
// 🛠️ B2B Order System - Backend (GAS)
// ==========================================

const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE'; // ★ここにご自身のスプレッドシートIDを貼り付けてください！
// スプレッドシートのIDは、URLの「/d/」と「/edit」の間の文字列（例: 1abc...xyz）です。

// --- 設定 ---
const SHEET_NAMES = {
  MASTER: 'ItemMaster',
  CLIENT: 'ClientMaster',
  ORDERS: 'Orders',
  SETTINGS: 'Settings',
  FAVORITES: 'Favorites'
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
                name: row[3],
                status: row[5] || ''
              });
            }
          }
        }
      });

      // 日時順（降順）にソート
      history.sort((a, b) => b.orderId - a.orderId);

      return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: history }))
        .setMimeType(ContentService.MimeType.JSON);
    } else if (action === 'get_favorites') {
      const clientName = e.parameter.clientName;
      if (!clientName) throw new Error("clientName parameter is required");
      
      let favs = [];
      const sheet = ss.getSheetByName(SHEET_NAMES.FAVORITES);
      if (sheet) {
        const values = sheet.getDataRange().getValues();
        for (let i = 1; i < values.length; i++) {
          if (values[i][0] === clientName) {
            favs = String(values[i][1] || '').split(',').map(s => s.trim()).filter(x => x);
            break;
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: favs }))
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
    const lock = LockService.getScriptLock();
    try {
        // 最大30秒間、他の処理が終わるのを待機
        if (!lock.tryLock(30000)) {
            throw new Error("サーバーが混み合っています。少し時間をおいてから再度お試しください。");
        }

        if (!e.postData || !e.postData.contents) throw new Error("No POST data received.");
        const postData = JSON.parse(e.postData.contents);
        const action = postData.action;

        if (action === 'login') return handleLogin(postData);
        else if (action === 'order') return handleOrder(postData);
        else if (action === 'update_order') return handleUpdateOrder(postData);
        else if (action === 'cancel_order') return handleCancelOrder(postData);
        else if (action === 'save_favorites') return handleSaveFavorites(postData);
        else throw new Error("Invalid action parameter for POST.");

    } catch (error) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
            .setMimeType(ContentService.MimeType.JSON);
    } finally {
        // 処理が終わったら必ずロックを解放
        lock.releaseLock();
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
            const rawType = String(values[i][3] || '').trim();
            if (rawType === 'マスター' || rawType === 'MASTER') {
                clientType = 'MASTER';
            } else if (rawType === CLIENT_TYPE_DIRECT) {
                clientType = CLIENT_TYPE_DIRECT;
            } else {
                clientType = '';
            }
            break;
        }
    }

    if(authSuccess) {
         let allClients = [];
         if (clientType === 'MASTER') {
             for(let j=1; j<values.length; j++) {
                 const type = String(values[j][3] || '').trim();
                 if (type !== 'マスター' && type !== 'MASTER' && String(values[j][2])) {
                     allClients.push({
                         name: values[j][2],
                         type: type === CLIENT_TYPE_DIRECT ? CLIENT_TYPE_DIRECT : ''
                     });
                 }
             }
         }

         // 設定情報を取得 (A1: お知らせ見出し, B1: お知らせ内容, C1: メンテフラグ, D1: メンテメッセージ)
         let announcement = "";
         let isMaintenance = false;
         let maintenanceMessage = "";
         try {
             const settingsSheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
             if (settingsSheet) {
                 const title = String(settingsSheet.getRange("A1").getValue() || "").trim();
                 const content = String(settingsSheet.getRange("B1").getValue() || "").trim();
                 if (title && content) {
                     announcement = "【" + title + "】 " + content;
                 } else {
                     announcement = title || content;
                 }

                 isMaintenance = String(settingsSheet.getRange("C1").getValue() || "").trim().toUpperCase() === "ON";
                 maintenanceMessage = String(settingsSheet.getRange("D1").getValue() || "").trim();
             }
         } catch(e) { console.warn("Settings fetch failed:", e); }

         return ContentService.createTextOutput(JSON.stringify({ 
             status: 'success', 
             message: 'Login successful', 
             clientName: clientName,
             clientType: clientType,
             isMaster: (clientType === 'MASTER'),
             allClients: allClients,
             announcement: announcement,
             isMaintenance: isMaintenance,
             maintenanceMessage: maintenanceMessage
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
     sendNotification(orderSummaryForLINE);

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
     
     const targetSheetName = dateStr + clientType;
     let sheet = ss.getSheetByName(targetSheetName);
     
     if (!sheet) {
         // 指定されたシートがない場合、通常・直送のクロスオーバーを避けるため、一律Ordersに逃がす
         console.warn("Sheet not found, falling back to Orders:", targetSheetName);
         sheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
     }
     
     if (!sheet) throw new Error("対象の注文データが見つかりません。シート名: " + targetSheetName);
     console.log("Using sheet for cancel:", sheet.getName(), "clientType:", clientType);

     const values = sheet.getDataRange().getValues();
     let deletedCount = 0;
     let canceledItems = [];
     
     // 削除前に内容を収集（1行目はヘッダーなのでi=1から）
     for(let i = 1; i < values.length; i++) {
          const row = values[i];
          // row[0]=タイムスタンプ, row[4]=クライアント名
          if(row[4] === clientName && new Date(row[0]).getTime() === parseInt(orderId)) {
               // ステータスチェック: すでに「完了」なら操作不可
               if (String(row[5] || '').trim() === '完了') {
                    throw new Error("この発注はすでに確定（発注済み）しているため、キャンセルできません。");
               }
               // row[3]=商品名, row[2]=数量
               canceledItems.push(`・${row[3]} × ${row[2]}`);
          }
     }

     // 行の削除（逆順で削除）
     for(let i = values.length - 1; i >= 1; i--) {
          const row = values[i];
          if(row[4] === clientName && new Date(row[0]).getTime() === parseInt(orderId)) {
               sheet.deleteRow(i + 1);
               deletedCount++;
          }
     }

     if (deletedCount > 0) {
          let message = `【キャンセル通知】\nサロン名: ${clientName}\n内容:\n${canceledItems.join('\n')}\n（注文ID: ${orderId}）`;
          sendNotification(message);
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
     
     const targetSheetName = dateStr + clientType;
     let sheet = ss.getSheetByName(targetSheetName);

     if (!sheet) {
         console.warn("Sheet not found, falling back to Orders:", targetSheetName);
         sheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
     }
     
     if (!sheet) throw new Error("対象の注文データが見つかりません。操作用シート名: " + targetSheetName);
     console.log("Using sheet for update:", sheet.getName(), "clientType:", clientType);

     // 1. Collect existing status and then Delete old rows
     const values = sheet.getDataRange().getValues();
     const statusMap = {}; // code -> status
     for(let i = values.length - 1; i >= 1; i--) {
          const row = values[i];
          if(row[4] === clientName && new Date(row[0]).getTime() === parseInt(orderId)) {
               // ステータスチェック: すでに「完了」なら操作不可
               if (String(row[5] || '').trim() === '完了') {
                    throw new Error("この発注はすでに確定（発注済み）しているため、内容の変更はできません。");
               }
               const code = String(row[1]);
               const status = row[5]; // Column F: Status
               if (status) {
                   statusMap[code] = status || '';
               }
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
             const strCode = String(order.code);
             const isSpecial = specialCodesUpd.has(strCode) || strCode.startsWith('CUSTOM_ITEM_');
             const existingStatus = typeof statusMap[strCode] === 'string' ? statusMap[strCode] : '';
             const row = [originalTimestamp, order.code, order.qty, order.name, clientName, existingStatus, remarks, isSpecial ? '別注' : ''];
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
     sendNotification(orderSummaryForLINE);

     return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Order updated' }))
       .setMimeType(ContentService.MimeType.JSON);
}

// --- お気に入り保存処理 ---
function handleSaveFavorites(data) {
     const clientName = data.clientName;
     const favorites = data.favorites; // array of strings
     if(!clientName || !Array.isArray(favorites)) throw new Error("Invalid request");
     
     const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
     let sheet = ss.getSheetByName(SHEET_NAMES.FAVORITES);
     
     if (!sheet) {
         sheet = ss.insertSheet(SHEET_NAMES.FAVORITES);
         sheet.appendRow(['得意先名', 'お気に入りコード(カンマ区切り)']);
     }
     
     const values = sheet.getDataRange().getValues();
     // 既存のデータを削除（重複防止）
     for (let i = values.length - 1; i >= 1; i--) {
         if (values[i][0] === clientName) {
             sheet.deleteRow(i + 1);
         }
     }
     
     // 新しいデータを追加
     const favString = favorites.join(',');
     sheet.appendRow([clientName, favString]);
     
     return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------
// 通知処理（LINE & Discord）
// ------------------------------------------

/**
 * 汎用通知関数: LINEへの送信を試み、エラーがあればDiscordへ、または両方に送る
 */
function sendNotification(message) {
    // 1. LINE通知 (現在制限中のためエラーになる可能性が高い)
    const lineSuccess = sendLineNotification(message);

    // 2. Discord通知 (バックアップまたは常時送信用)
    sendDiscordNotification(message);
}

function sendLineNotification(message) {
    try {
        const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
        const groupId = PropertiesService.getScriptProperties().getProperty('GROUP_ID');

        if (!token || !groupId) {
            console.log("LINE Notification skipped: Credentials not found.");
            return false;
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
            payload: JSON.stringify(payload),
            muteHttpExceptions: true // 429エラーなどをログに残すために追加
        };

        const response = UrlFetchApp.fetch(url, options);
        const responseCode = response.getResponseCode();
        
        if (responseCode !== 200) {
            console.error(`LINE API Error: ${responseCode} - ${response.getContentText()}`);
            return false;
        }
        
        return true;
    } catch (error) {
        console.error("Failed to send LINE Notification: " + error.toString());
        return false;
    }
}

function sendDiscordNotification(message) {
    try {
        const webhookUrl = PropertiesService.getScriptProperties().getProperty('DISCORD_WEBHOOK_URL');
        if (!webhookUrl) {
            console.log("Discord Notification skipped: DISCORD_WEBHOOK_URL not found in Script Properties.");
            return;
        }

        const payload = {
            content: message
        };

        const options = {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify(payload)
        };

        UrlFetchApp.fetch(webhookUrl, options);
        console.log("✅ Discord message sent successfully.");
    } catch (error) {
        console.error("Failed to send Discord Notification: " + error.toString());
    }
}

// ------------------------------------------
// 🤖 AI秘書: 通知機能
// ------------------------------------------

/**
 * 1. 朝7時の未発注通知
 * ClientMasterのE列（発注曜日）を確認し、本日発注予定で未着のサロンを通知
 */
function checkMorningOrders() {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const clientSheet = ss.getSheetByName(SHEET_NAMES.CLIENT);
    if (!clientSheet) return;

    const today = new Date();
    const dayOfWeek = today.getDay(); // 0:日, 1:月, ...
    
    // 1. 日曜日は通知を送らない
    if (dayOfWeek === 0) {
        console.log("Sunday: Skipping morning order check.");
        return;
    }

    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    const todayName = dayNames[dayOfWeek];
    const dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), "yyyy-MM-dd");

    // 2. チェック対象の曜日を決定（月曜日の統合チェックを削除し、当日の曜日のみに修正）
    const targetDays = [todayName];

    const clients = clientSheet.getDataRange().getValues();
    const todayOrderClients = []; // 発注予定のサロン

    // 3. 発注予定のサロンを抽出 (A:ID, B:PW, C:名, D:種別, E:曜日)
    for (let i = 1; i < clients.length; i++) {
        const schedule = String(clients[i][4] || '');
        const isTarget = targetDays.some(d => schedule.includes(d));
        
        if (isTarget) {
            todayOrderClients.push({
                name: clients[i][2],
                type: String(clients[i][3] || '').trim()
            });
        }
    }

    if (todayOrderClients.length === 0) return;

    // 4. すでに届いている注文を確認
    const registeredNormal = getOrderedClientNames(ss, dateStr);
    const registeredDirect = getOrderedClientNames(ss, dateStr + CLIENT_TYPE_DIRECT);
    const allRegistered = new Set([...registeredNormal, ...registeredDirect]);

    // 5. 未着のサロンをリストアップ
    const missing = todayOrderClients.filter(c => !allRegistered.has(c.name));

    if (missing.length > 0) {
        let msg = `【AI秘書】朝のアラート☀️\n本日（${todayName}）発注予定ですが、まだ届いていないサロン様が ${missing.length} 件あります。\n\n`;
        missing.forEach(c => {
            msg += `・${c.name}${c.type === CLIENT_TYPE_DIRECT ? '(直送)' : ''}\n`;
        });
        sendNotification(msg);
    }
}

/**
 * 2. 10時半の未完了通知
 * ステータスが「完了」になっていない注文をすべて通知
 */
function checkIncompleteOrders() {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const today = new Date();
    const dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), "yyyy-MM-dd");

    let incompleteItems = [];

    // 通常シートと直送シートの両方をチェック
    [dateStr, dateStr + CLIENT_TYPE_DIRECT].forEach(sheetName => {
        const sheet = ss.getSheetByName(sheetName);
        if (!sheet) return;

        const values = sheet.getDataRange().getValues();
        for (let i = 1; i < values.length; i++) {
            const salonName = String(values[i][4] || '').trim();
            const itemName = String(values[i][3] || '').trim();
            if (!salonName || !itemName) continue; // データがない空行はスキップ

            const status = String(values[i][5] || '').trim(); // F列: ステータス
            if (status !== '完了') {
                incompleteItems.push({
                    salon: salonName,
                    item: itemName,
                    sheet: sheetName.includes('直送') ? '直送' : '通常'
                });
            }
        }
    });

    if (incompleteItems.length > 0) {
        let msg = `【AI秘書】処理漏れアラート⚠️\n本日分の注文で、まだ「完了」になっていない項目が ${incompleteItems.length} 件あります。\n\n`;
        // 重複を除いてサロン単位でまとめる
        const summary = {};
        incompleteItems.forEach(x => {
            if (!summary[x.salon]) summary[x.salon] = [];
            summary[x.salon].push(x.item);
        });

        for (const salon in summary) {
            msg += `▼${salon}\n`;
            summary[salon].forEach(item => msg += ` ・${item}\n`);
            msg += `\n`;
        }
        sendNotification(msg);
    }
}

// ヘルパー: 指定シートから注文済みのサロン名一覧を取得
function getOrderedClientNames(ss, sheetName) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return [];
    const values = sheet.getDataRange().getValues();
    const names = new Set();
    for (let i = 1; i < values.length; i++) {
        if (values[i][4]) names.add(values[i][4]);
    }
    return Array.from(names);
}

/**
 * 3. 朝8時の別注商品通知
 * すべての注文シート（日付形式 & Orders）を走査し、
 * ステータスが「完了」でない「別注」商品をリストアップして通知
 */
function checkMorningSpecialOrders() {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheets = ss.getSheets();
    const dateSheetRegex = /^\d{4}-\d{2}-\d{2}(直送)?$/;
    
    const specialPendingItems = []; // { salon: string, item: string, date: string }

    sheets.forEach(sheet => {
        const sheetName = sheet.getName();
        // 日付シートまたはOrdersシートが対象
        if (dateSheetRegex.test(sheetName) || sheetName === SHEET_NAMES.ORDERS) {
            const values = sheet.getDataRange().getValues();
            // A:日時, B:コード, C:個数, D:商品名, E:サロン名, F:ステータス, G:備考, H:別注
            for (let i = 1; i < values.length; i++) {
                const status = String(values[i][5] || '').trim();
                const isSpecial = String(values[i][7] || '').trim() === '別注';
                
                // 別注かつ未完了のものを抽出
                if (isSpecial && status !== '完了') {
                    const orderDate = values[i][0] instanceof Date ? 
                        Utilities.formatDate(values[i][0], Session.getScriptTimeZone(), "MM/dd") : "不明";
                        
                    specialPendingItems.push({
                        salon: String(values[i][4] || '不明').trim(),
                        item: String(values[i][3] || '不明').trim(),
                        date: orderDate
                    });
                }
            }
        }
    });

    if (specialPendingItems.length > 0) {
        let msg = `【AI秘書】別注商品のリマインド🔔\n未完了の別注商品が ${specialPendingItems.length} 件あります。確認をお願いします。\n\n`;
        
        // サロンごとにまとめる
        const summary = {};
        specialPendingItems.forEach(x => {
            if (!summary[x.salon]) summary[x.salon] = [];
            summary[x.salon].push(`${x.item} (${x.date})`);
        });

        for (const salon in summary) {
            msg += `▼${salon}\n`;
            summary[salon].forEach(detail => msg += ` ・${detail}\n`);
            msg += `\n`;
        }
        
        sendNotification(msg);
        console.log("Morning special orders alert sent.");
    } else {
        console.log("No pending special orders found.");
    }
}

