// ==========================================
// 🛠️ B2B Order System - Backend (GAS)
// ==========================================

const SPREADSHEET_ID = '1dpMtNXhwRRPObS42bJ9BuGL4vMsOkYkQgyeTP1rG_i4'; // ★ここにご自身のスプレッドシートIDを貼り付けてください！
// スプレッドシートのIDは、URLの「/d/」と「/edit」の間の文字列（例: 1abc...xyz）です。

// --- 設定 ---
const SHEET_NAMES = {
  MASTER: 'ItemMaster',
  CLIENT: 'ClientMaster',
  ORDERS: 'Orders',
  SETTINGS: 'Settings',
  FAVORITES: 'Favorites',
  UNKNOWN_JAN: 'UnknownJAN'
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
          const rawCode = String(row[0]).replace(/^'/, '').trim();
          
          // --- 指数表記（e+）や中身が壊れたコードは読み込み時点で完全に除外する ---
          if (rawCode && row[1] && !rawCode.toLowerCase().includes('e+')) {
              items.push({ 
                code: rawCode, 
                name: row[1], 
                category: row[2] || '',
                manufacturer: row[3] || '',
                special: row[4] || '',
                jan: row[5] || '' 
              });
          }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: items }))
        .setMimeType(ContentService.MimeType.JSON);
    } else if (action === 'history') {
      const clientName = e.parameter.clientName;
      if (!clientName) throw new Error("clientName parameter is required for history.");
      
      const history = [];
      const MAX_HISTORY_ITEMS = 50; // 最新50件まで取得
      const MAX_LOOKBACK_DAYS = 31; // 過去31日分まで遡る
      
      // 1. 11時以降の注文は「明日（または月曜）」のシートに書かれるため、
      // 検索開始日を getTargetDateStr(today) を基準にして遡るように修正
      const today = new Date();
      const nextOrderDateStr = getTargetDateStr(today);
      const startDay = new Date(nextOrderDateStr);
      
      for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
          const d = new Date(startDay.getTime());
          d.setDate(startDay.getDate() - i);
          
          // 通常用と直送用の日付文字列を生成
          const dateStr = Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
          const targetSheetNames = [dateStr, dateStr + '直送'];
          
          for (const sheetName of targetSheetNames) {
              const sheet = ss.getSheetByName(sheetName);
              if (sheet) {
                  const values = sheet.getDataRange().getValues();
                  // 逆順（新しい順）にスキャン
                  for (let j = values.length - 1; j >= 1; j--) {
                      const row = values[j];
                      if (String(row[4]) === clientName || String(row[4]).startsWith(clientName + ' ')) {
                          const orderDate = new Date(row[0]);
                          history.push({
                              orderId: orderDate.getTime(),
                              date: Utilities.formatDate(orderDate, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm"),
                              code: row[1],
                              qty: row[2],
                              name: row[3],
                              status: row[5] || '',
                              clientName: String(row[4])
                          });
                      }
                      if (history.length >= MAX_HISTORY_ITEMS) break;
                  }
              }
              if (history.length >= MAX_HISTORY_ITEMS) break;
          }
          if (history.length >= MAX_HISTORY_ITEMS) break;
      }

      // 2. Ordersシート（例外的な古い履歴など）もチェックが必要なら最後に追加
      if (history.length < MAX_HISTORY_ITEMS) {
          const ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
          if (ordersSheet) {
              const values = ordersSheet.getDataRange().getValues();
              for (let j = values.length - 1; j >= 1; j--) {
                  const row = values[j];
                  if (String(row[4]) === clientName || String(row[4]).startsWith(clientName + ' ')) {
                      const orderDate = new Date(row[0]);
                      history.push({
                          orderId: orderDate.getTime(),
                          date: Utilities.formatDate(orderDate, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm"),
                          code: row[1],
                          qty: row[2],
                          name: row[3],
                          status: row[5] || '',
                          clientName: String(row[4])
                      });
                  }
                  if (history.length >= MAX_HISTORY_ITEMS) break;
              }
          }
      }

      // 最終的なソート（念のため）
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
            favs = String(values[i][1] || '').split(',').map(s => s.trim().replace(/^'/, '')).filter(x => x);
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
    try {
        if (!e.postData || !e.postData.contents) throw new Error("No POST data received.");
        const postData = JSON.parse(e.postData.contents);
        const action = postData.action;

        // ── ロック不要なアクション（先に処理） ──
        if (action === 'log_unknown_jan') return handleLogUnknownJan(postData);

        // ── ロックが必要なアクション ──
        const lock = LockService.getScriptLock();
        try {
            if (!lock.tryLock(30000)) {
                throw new Error("サーバーが混み合っています。少し時間をおいてから再度お試しください。");
            }

            if (action === 'login') return handleLogin(postData);
            else if (action === 'order') return handleOrder(postData);
            else if (action === 'multi_order') return handleMultiOrder(postData);
            else if (action === 'update_order') return handleUpdateOrder(postData);
            else if (action === 'cancel_order') return handleCancelOrder(postData);
            else if (action === 'save_favorites') return handleSaveFavorites(postData);
            else if (action === 'sync_all_history_to_favorites') {
                const result = syncAllHistoryToFavorites(postData.extraData);
                return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: result }))
                  .setMimeType(ContentService.MimeType.JSON);
            }
            else throw new Error("Invalid action parameter for POST.");

        } finally {
            lock.releaseLock();
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
    
    // ヘッダーをスキップし、A列:ID, B列:PW, C列:得意先名, D列:種別 を想定して検索
    let clientName = null;
    let clientType = ''; // D列（空なら通常、'直送' なら直送）
    let authSuccess = false;

    for(let i=1; i<values.length; i++) {
        if(String(values[i][0]) === String(username) && String(values[i][1]) === String(password)) {
            authSuccess = true;
            clientName = values[i][2]; // C列の得意先名
            const rawType = String(values[i][3] || '').trim().toUpperCase();
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
     const staffName = data.staffName ? data.staffName.trim() : '';
     const displayName = staffName ? `${clientName} ${staffName}様` : clientName;

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
     let orderSummaryForLINE = `${clientType === CLIENT_TYPE_DIRECT ? '【直送発注】' : '【新規発注】'}\nサロン名: ${displayName}\n\n`;

     orders.forEach(order => {
         if(order.qty > 0) {
             const isSpecial = specialCodes.has(String(order.code)) || String(order.code).startsWith('CUSTOM_ITEM_');
             // F:ステータス, G:備考, H:別注
             const row = [timestamp, order.code, order.qty, order.name, displayName, '', remarks, isSpecial ? '別注' : ''];
             
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

// --- 一括複数発注処理 (Multi-Order) ---
function handleMultiOrder(data) {
     const groups = data.orderGroups; // [ { clientName, staffName, clientType, orders, remarks }, ... ]
     const orderId = data.orderId; // Optional, for edit mode
     if (!groups || !Array.isArray(groups) || groups.length === 0) {
         throw new Error("Invalid multi-order data format.");
     }

     const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
     const timestamp = orderId ? new Date(parseInt(orderId)) : new Date();

     // If editing, clear existing orders for this orderId and current client context
     if (orderId) {
         const clientTypeForDelete = groups[0].clientType || '';
         const dateStr = getTargetDateStr(timestamp);
         const targetSheetName = dateStr + clientTypeForDelete;
         let sheetToClear = ss.getSheetByName(targetSheetName);
         if (!sheetToClear) sheetToClear = ss.getSheetByName(SHEET_NAMES.ORDERS);
         
         if (sheetToClear) {
             const values = sheetToClear.getDataRange().getValues();
             const headers = values[0];
             const newValuesBeforeSpecial = [headers];
             // In edit mode, we delete all items matching orderId and the base clientName
             // We assume the first group's clientName base is the original one
             const baseClientName = String(groups[0].clientName).split(' ')[0]; // E.g., "SalonA"
             
             for (let i = 1; i < values.length; i++) {
                 const row = values[i];
                 const isTarget = ((String(row[4]) === baseClientName || String(row[4]).startsWith(baseClientName + ' ')) && new Date(row[0]).getTime() === parseInt(orderId));
                 if (isTarget) {
                     if (String(row[5] || '').trim() === '完了') {
                         throw new Error("この発注はすでに確定しているため、内容の変更はできません。");
                     }
                 } else {
                     newValuesBeforeSpecial.push(row);
                 }
             }
             sheetToClear.clearContents();
             if (newValuesBeforeSpecial.length > 0) {
                 sheetToClear.getRange(1, 1, newValuesBeforeSpecial.length, newValuesBeforeSpecial[0].length).setValues(newValuesBeforeSpecial);
             }
         }
     }

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

     let combinedLineSummary = "";

     groups.forEach((group, index) => {
         const clientName = group.clientName;
         const staffName = group.staffName ? group.staffName.trim() : '';
         const displayName = staffName ? `${clientName} ${staffName}様` : clientName;
         const orders = group.orders;
         const remarks = group.remarks || '';
         const clientType = group.clientType || '';

         if (!orders || orders.length === 0) return;

         const dateStr = getTargetDateStr(timestamp);
         const sheet = getOrCreateOrderSheet(ss, dateStr, clientType);

         // シート内の「別注セクション」の開始位置（H列）を特定
         const lastRow = sheet.getLastRow();
         let firstSpecialRow = lastRow + 1;
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
         let groupSummary = `${clientType === CLIENT_TYPE_DIRECT ? '【直送発注】' : '【新規発注】'}\nサロン名: ${displayName}\n\n`;

         orders.forEach(order => {
             if(order.qty > 0) {
                 const isSpecial = specialCodes.has(String(order.code)) || String(order.code).startsWith('CUSTOM_ITEM_');
                 const row = [timestamp, order.code, order.qty, order.name, displayName, '', remarks, isSpecial ? '別注' : ''];
                 
                 if (isSpecial) specialRows.push(row);
                 else normalRows.push(row);

                 groupSummary += `・${order.name}: ${order.qty}点\n`;
             }
         });

         if (normalRows.length > 0) {
             sheet.insertRowsBefore(firstSpecialRow, normalRows.length);
             sheet.getRange(firstSpecialRow, 1, normalRows.length, normalRows[0].length).setValues(normalRows);
         }
         if (specialRows.length > 0) {
             const bottomRow = sheet.getLastRow() + 1;
             sheet.getRange(bottomRow, 1, specialRows.length, specialRows[0].length).setValues(specialRows);
         }
         
         if (remarks) groupSummary += `\n【備考】\n${remarks}`;
         
         if (index > 0) combinedLineSummary += "\n----------------------\n";
         combinedLineSummary += groupSummary;
     });

     if (combinedLineSummary) {
         sendNotification(combinedLineSummary);
     }

     return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Multi-Order recorded successfully' }))
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
     const headers = values[0];
     const newValues = [headers];
     let deletedCount = 0;
     let canceledItems = [];
     let actualDisplayName = clientName;
     
     // 配列上で処理（1行目はヘッダーなのでi=1から）
     for(let i = 1; i < values.length; i++) {
          const row = values[i];
          const isTarget = ((String(row[4]) === clientName || String(row[4]).startsWith(clientName + ' ')) && new Date(row[0]).getTime() === parseInt(orderId));
          
          if(isTarget) {
               // ステータスチェック: すでに「完了」なら操作不可
               if (String(row[5] || '').trim() === '完了') {
                    throw new Error("この発注はすでに確定（発注済み）しているため、キャンセルできません。");
               }
               // row[3]=商品名, row[2]=数量
               actualDisplayName = row[4];
               canceledItems.push(`・${row[3]} × ${row[2]}`);
               deletedCount++;
          } else {
               newValues.push(row);
          }
     }
     
     // 一括書き込み
     if (deletedCount > 0) {
          sheet.clearContents();
          sheet.getRange(1, 1, newValues.length, newValues[0].length).setValues(newValues);
          
          let message = `【キャンセル通知】\nサロン名: ${actualDisplayName}\n内容:\n${canceledItems.join('\n')}\n（注文ID: ${orderId}）`;
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

     // 1. Collect existing status and filter rows in memory
     const values = sheet.getDataRange().getValues();
     const headers = values[0];
     const newValuesBeforeSpecial = [headers];
      const statusMap = {}; // code -> status
      let actualDisplayName = clientName;
      
      for(let i = 1; i < values.length; i++) {
           const row = values[i];
           const isTarget = ((String(row[4]) === clientName || String(row[4]).startsWith(clientName + ' ')) && new Date(row[0]).getTime() === parseInt(orderId));
          
          if(isTarget) {
               // ステータスチェック: すでに「完了」なら操作不可
               if (String(row[5] || '').trim() === '完了') {
                    throw new Error("この発注はすでに確定（発注済み）しているため、内容の変更はできません。");
               }
               const code = String(row[1]);
               const status = row[5]; // Column F: Status
               if (status) {
                   statusMap[code] = status || '';
               }
               actualDisplayName = row[4];
               // Target rows are NOT added back to newValuesBeforeSpecial yet
          } else {
               newValuesBeforeSpecial.push(row);
          }
     }

     // 2. Clear and rewrite sheet (except for new rows to be inserted)
     sheet.clearContents();
     if (newValuesBeforeSpecial.length > 0) {
          sheet.getRange(1, 1, newValuesBeforeSpecial.length, newValuesBeforeSpecial[0].length).setValues(newValuesBeforeSpecial);
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
     let orderSummaryForLINE = `${clientType === CLIENT_TYPE_DIRECT ? '【直送発注内容変更】' : '【発注内容変更】'}\nサロン名: ${actualDisplayName}\n\n`;

     orders.forEach(order => {
         if(order.qty > 0) {
             const strCode = String(order.code);
             const isSpecial = specialCodesUpd.has(strCode) || strCode.startsWith('CUSTOM_ITEM_');
             const existingStatus = typeof statusMap[strCode] === 'string' ? statusMap[strCode] : '';
             const row = [originalTimestamp, order.code, order.qty, order.name, actualDisplayName, existingStatus, remarks, isSpecial ? '別注' : ''];
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

// --- お気に入り保存処理 (Self-Healing Mode) ---
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
     
     // 強制的にB列を「プレーンテキスト(@)」として定義（保存時の指数表記化を完全に防ぐ）
     sheet.getRange("B:B").setNumberFormat("@");

     const values = sheet.getDataRange().getValues();
     // 既存のデータを削除（重複防止）
     for (let i = values.length - 1; i >= 1; i--) {
         if (values[i][0] === clientName) {
             sheet.deleteRow(i + 1);
         }
     }
     
     // 【ガード】保存直前に再度指数表記が含まれていないかチェックし、正常なものだけを連結
     const cleanFavs = favorites.filter(code => {
         const str = String(code).trim().replace(/^'/, '');
         return str !== '' && !str.toLowerCase().includes('e+');
     });
     
     const favString = cleanFavs.join(',');
     // 先頭にシングルクォートを付けて強制的に文字列として書き込む
     sheet.appendRow([clientName, "'" + favString]);
     
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

// ------------------------------------------
// 🧹 メンテナンスツール: データクリーンアップ
// ------------------------------------------

/**
 * お気に入りシート内の破損データ（指数表記など）をクリーンアップし、
 * すべてのコードに強制的にシングルクォートを付与して文字列として保護します。
 */
function cleanupFavoritesData() {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAMES.FAVORITES);
    if (!sheet) return "Favorites sheet not found.";

    const values = sheet.getDataRange().getValues();
    const newValues = [values[0]]; // ヘッダーを保持

    let fixCount = 0;

    for (let i = 1; i < values.length; i++) {
        const clientName = values[i][0];
        const rawFavs = String(values[i][1] || '');
        
        // 1. カンマで分割し、指数表記(e+)を含まない有効なコードのみを抽出
        const codes = rawFavs.split(',').map(s => s.trim().replace(/^'/, ''));
        const cleanCodes = codes.filter(code => {
            if (!code) return false;
            if (code.toLowerCase().includes('e+')) {
                fixCount++;
                return false;
            }
            if (code.length > 20) {
                fixCount++;
                return false;
            }
            return true;
        });

        // 2. 正規化されたコードを再度カンマで繋ぎ、先頭に ' を付けて保存
        if (cleanCodes.length > 0) {
            newValues.push([clientName, "'" + cleanCodes.join(',')]);
        }
    }

    // シートを上書き
    sheet.clearContents();
    sheet.getRange(1, 1, newValues.length, newValues[0].length).setValues(newValues);
    
    return `クリーンアップ完了: ${fixCount}件の破損データを修正/除去しました。`;
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

// ------------------------------------------
// 🧹 メンテナンスツール: 履歴からお気に入りを一括同期
// ------------------------------------------

/**
 * 🧹 全得意先の発注履歴（スプレッドシート）＋ 導入履歴（JSONから送付）をマージしてお気に入りを生成
 * @param {Object} introHistory - アプリ側から送られた history_favorites.json の内容 { Salon: [Code, ...] }
 */
function syncAllHistoryToFavorites(introHistory = null) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheets = ss.getSheets();
  const dateSheetRegex = /^\d{4}-\d{2}-\d{2}(直送)?$/;
  
  // 1. 全履歴から (サロン名 -> Set of 商品コード) のマップを作成
  const ordersMap = new Map();

  // (A) スプレッドシート履歴をスキャン
  sheets.forEach(sheet => {
    const name = sheet.getName();
    if (dateSheetRegex.test(name) || name === SHEET_NAMES.ORDERS) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const code = String(data[i][1] || '').trim().replace(/^'/, '');
        const salon = String(data[i][4] || '').trim();
        if (code && salon && !code.toLowerCase().includes('e+')) {
          if (!ordersMap.has(salon)) ordersMap.set(salon, new Set());
          ordersMap.get(salon).add(code);
        }
      }
    }
  });

  // (B) 導入履歴 (JSON) をマージ
  if (introHistory && typeof introHistory === 'object') {
    for (const salon in introHistory) {
      const codes = introHistory[salon];
      if (Array.isArray(codes)) {
        if (!ordersMap.has(salon)) ordersMap.set(salon, new Set());
        const set = ordersMap.get(salon);
        codes.forEach(c => {
          const s = String(c).trim().replace(/^'/, '');
          if (s && !s.toLowerCase().includes('e+')) set.add(s);
        });
      }
    }
  }

  // 2. 現在のお気に入りデータを読み込む
  let favSheet = ss.getSheetByName(SHEET_NAMES.FAVORITES);
  if (!favSheet) {
    favSheet = ss.insertSheet(SHEET_NAMES.FAVORITES);
    favSheet.appendRow(['得意先名', 'お気に入りコード(カンマ区切り)']);
    favSheet.getRange("B:B").setNumberFormat("@");
  }
  
  const favData = favSheet.getDataRange().getValues();
  const finalFavs = new Map();

  for (let i = 1; i < favData.length; i++) {
    const salon = String(favData[i][0]).trim();
    const codes = String(favData[i][1] || '').split(',').map(s => s.trim().replace(/^'/, '')).filter(c => c && !c.toLowerCase().includes('e+'));
    if (salon) finalFavs.set(salon, new Set(codes));
  }

  // 3. マージ実行
  ordersMap.forEach((codes, salon) => {
    if (!finalFavs.has(salon)) finalFavs.set(salon, new Set());
    const currentSet = finalFavs.get(salon);
    codes.forEach(c => currentSet.add(c));
  });

  // 4. 書き出し
  const writeData = [[favData[0][0], favData[0][1]]];
  finalFavs.forEach((codes, salon) => {
    if (salon && codes.size > 0) {
      writeData.push([salon, "'" + Array.from(codes).join(',')]);
    }
  });

  favSheet.clearContents();
  favSheet.getRange(1, 1, writeData.length, 2).setValues(writeData);
  favSheet.getRange("B:B").setNumberFormat("@");

  return `${writeData.length - 1} サロン分のお気に入りを同期完了（導入実績＋発注履歴）`;
}

// ------------------------------------------
// 📝 未登録JANコードログ記録
// ------------------------------------------

/**
 * バーコードスキャンでItemMasterに存在しないJANコードが検出された際にログを記録。
 * 同一JANは1行のみ。サロン名はSet方式で追記（重複なし）。
 * 新規JAN検出時のみDiscord/LINE通知を送信。
 */
function handleLogUnknownJan(data) {
    const janCode = String(data.janCode || '').trim();
    const clientName = String(data.clientName || '').trim();
    if (!janCode) throw new Error("janCode is required.");

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_NAMES.UNKNOWN_JAN);

    // シートがなければ作成
    if (!sheet) {
        sheet = ss.insertSheet(SHEET_NAMES.UNKNOWN_JAN);
        sheet.appendRow(['最終スキャン日時', 'JANコード', 'スキャンしたサロン名', 'ステータス']);
        sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#fce4ec');
        sheet.setFrozenRows(1);
    }

    const values = sheet.getDataRange().getValues();
    const now = new Date();
    let found = false;

    // 逆順走査（直近追加分にヒットしやすい）
    for (let i = values.length - 1; i >= 1; i--) {
        if (String(values[i][1]).trim() === janCode) {
            // 既存行: サロン名をSet方式で追記（重複サロン名を防止）
            const existingSalons = String(values[i][2] || '').split(',').map(s => s.trim()).filter(Boolean);
            const salonSet = new Set(existingSalons);
            if (clientName) salonSet.add(clientName);
            sheet.getRange(i + 1, 1).setValue(now);  // A列: 最終スキャン日時を更新
            sheet.getRange(i + 1, 3).setValue(Array.from(salonSet).join(', ')); // C列: サロン名
            found = true;
            break;
        }
    }

    if (!found) {
        // 新規行を追加
        sheet.appendRow([now, janCode, clientName || '不明', '']);

        // 初回のみ通知
        const msg = `【AI秘書】未登録JANコード検出🔍\nJAN: ${janCode}\nサロン: ${clientName || '不明'}\n→ ItemMasterへの追加をご確認ください`;
        sendNotification(msg);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
        .setMimeType(ContentService.MimeType.JSON);
}

