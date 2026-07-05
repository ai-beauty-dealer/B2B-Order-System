// ==========================================
// 🛠️ B2B Order System - Master Updater (v4.1)
// ==========================================

/**
 * 【マスタ一括更新・登録】
 * シート「TmpNewItems」から「ItemMaster」へデータを同期します。
 * 未登録（新規）のコードのみを抽出し、シートの一番下（末尾）に追記します。
 * 既存の行は上書きせず、並び順も保持されます。
 * 新規追加されたアイテムには、G列に「追加日」を記録します。
 */
function syncMasterItems() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const masterSheet = ss.getSheetByName('ItemMaster');
  const tmpSheet = ss.getSheetByName('TmpNewItems');

  if (!masterSheet || !tmpSheet) {
    throw new Error('「ItemMaster」または「TmpNewItems」シートが見つかりません。');
  }

  // 1. TmpNewItemsデータの読み込み (A:コード, B:名, C:カテゴリ, D:メーカー, E:別注, F:JAN)
  const tmpValues = tmpSheet.getDataRange().getValues();
  const incomingItems = [];
  for (let i = 1; i < tmpValues.length; i++) {
    const code = String(tmpValues[i][0] || '').trim();
    if (code) {
      incomingItems.push({
        code: code,
        name: String(tmpValues[i][1] || '').trim(),
        category: String(tmpValues[i][2] || '').trim(),
        manufacturer: String(tmpValues[i][3] || '').trim(),
        special: String(tmpValues[i][4] || '').trim(), // E:別注
        jan: String(tmpValues[i][5] || '').trim()      // F:JAN
      });
    }
  }

  if (incomingItems.length === 0) {
    SpreadsheetApp.getUi().alert('TmpNewItemsにデータがありません。');
    return;
  }

  // 2. ItemMasterデータの読み込み（既存コードの確認用）
  const masterRange = masterSheet.getDataRange();
  const masterValues = masterRange.getValues();
  const masterHeaders = masterValues[0];
  
  // マップ作成 (商品コード -> 存在確認用)
  const masterMap = new Map();
  for (let i = 1; i < masterValues.length; i++) {
    const code = String(masterValues[i][0]).trim();
    if (code) masterMap.set(code, true);
  }

  // 3. 同期処理（未登録のデータのみ抽出）
  const newRows = [];
  const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy/MM/dd");

  incomingItems.forEach(item => {
    if (!masterMap.has(item.code)) {
      // 新規追加データのみ配列にストック (A-G列)
      // A:Code, B:Name, C:Cat, D:Manu, E:Special, F:JAN, G:追加日
      newRows.push([item.code, item.name, item.category, item.manufacturer, item.special, item.jan, todayStr]);
      masterMap.set(item.code, true); // 重複追加防止
    }
  });

  if (newRows.length === 0) {
    SpreadsheetApp.getUi().alert('追加する新しいデータ（未登録の商品）はありませんでした。');
    return;
  }

  // 4. マスタへの書き出し（一番下へ追記）
  // ヘッダーが短い場合はG列のタイトルを追加
  if (masterHeaders.length < 7) {
    masterSheet.getRange(1, 7).setValue('追加日').setFontWeight('bold');
  }

  // 既存の最終行の下から、新しいデータを一括で書き込む
  const lastRow = masterSheet.getLastRow();
  masterSheet.getRange(lastRow + 1, 1, newRows.length, 7).setValues(newRows);

  // 追加された行を目立たせる（背景色を薄い黄色にするなどの工夫・任意）
  // masterSheet.getRange(lastRow + 1, 1, newRows.length, 7).setBackground('#fff2cc');

  // 5. グローバルキャッシュ強制更新のためのバージョン記録
  forceGlobalCacheRefresh(newRows.length);
}

/**
 * 【キャッシュ強制更新のトリガー】
 * マスタを手動で直接編集した際など、得意先全員の端末キャッシュを強制的に破棄・再取得させたい場合に
 * この関数を単独で実行してください。
 */
function forceGlobalCacheRefresh(addedCount = 0) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  const timestampStr = now.getTime().toString();
  const displayDateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm");
  
  // システム内部（PropertiesService）にタイムスタンプを保存
  PropertiesService.getScriptProperties().setProperty('ITEMS_VERSION', timestampStr);
  
  // 管理者目視用にSettingsシートにも書き出す
  const settingsSheet = ss.getSheetByName('Settings');
  if (settingsSheet) {
    settingsSheet.getRange('E1').setValue('マスタ最終同期日時');
    settingsSheet.getRange('E1').setFontWeight('bold').setBackground('#f3f3f3');
    settingsSheet.getRange('F1').setValue(displayDateStr);
  }

  const msg = addedCount > 0 
    ? `同期完了！\n未登録の新規データ ${addedCount} 件を追加しました。\n（システムバージョンも ${displayDateStr} に更新されました）`
    : `システムバージョンを ${displayDateStr} に更新しました！\n得意先が次回アクセスした際、自動的に最新データが読み込まれます。`;

  SpreadsheetApp.getUi().alert(msg);
}

// ==========================================
// 📋 カテゴリのプルダウン設定（表記ゆれ防止）
// ==========================================

/**
 * ItemMaster と TmpNewItems の「カテゴリ列(C列)」に
 * プルダウン（データ入力規則）を設定する。
 * 新商品を追加するとき、手打ちせず一覧から選べるようになる。
 *
 * カテゴリを増やしたいときは、下の CATEGORIES に1行足して、
 * この関数をもう一度実行するだけ。
 *
 * 実行方法: Apps Scriptエディタで関数「setupCategoryDropdown」を選んで▷実行。
 */
function setupCategoryDropdown() {
  // ▼ 選べるカテゴリ一覧（現状の分を採用。「カラー」は「カラー関連」に統一済み）
  const CATEGORIES = [
    'カラー関連',
    'パーマ関連',
    'パーマ液関連',
    '2剤/ブリーチ',
    'シャンプー',
    'トリートメント',
    'システムTR',
    'スタイリング関連',
    'スキャルプ関連',
    'コスメ関連',
    '業務用商品',
    '在庫小物',
    '小物関連',
    'バイカルテ',
    'モルティナ',
    'その他'
  ];

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(CATEGORIES, true) // true = ▼プルダウン表示
    .setAllowInvalid(true)  // 既存データは壊さない（一覧外は警告マークだけ）
    .setHelpText('カテゴリは▼から選んでください（新カテゴリを増やすなら setupCategoryDropdown のCATEGORIESに追記）')
    .build();

  let applied = [];
  ['ItemMaster', 'TmpNewItems'].forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const lastRow = Math.max(sheet.getMaxRows() - 1, 1);
    // C列（カテゴリ）の2行目以降に適用
    sheet.getRange(2, 3, lastRow, 1).setDataValidation(rule);
    applied.push(name);
  });

  SpreadsheetApp.getUi().alert(
    '✅ カテゴリのプルダウンを設定しました。\n\n' +
    '対象: ' + applied.join(' / ') + ' のC列（カテゴリ）\n' +
    '新商品を追加するとき、▼から選べます。'
  );
}
