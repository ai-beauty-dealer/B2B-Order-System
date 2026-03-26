// ==========================================
// 🛠️ B2B Order System - Master Updater (v3.0)
// ==========================================

/**
 * 【マスタ一括更新・登録】
 * シート「TmpNewItems」から「ItemMaster」へデータを同期します。
 * 新しいコードは追記、既存のコードは情報を更新します。
 */
function syncMasterItems() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const masterSheet = ss.getSheetByName('ItemMaster');
  const tmpSheet = ss.getSheetByName('TmpNewItems');

  if (!masterSheet || !tmpSheet) {
    throw new Error('「ItemMaster」または「TmpNewItems」シートが見つかりません。');
  }

  // 1. TmpNewItemsデータの読み込み (A:コード, B:名, C:カテゴリ, D:メーカー, E:JAN)
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
        jan: String(tmpValues[i][4] || '').trim()
      });
    }
  }

  if (incomingItems.length === 0) {
    SpreadsheetApp.getUi().alert('TmpNewItemsにデータがありません。');
    return;
  }

  // 2. ItemMasterデータの読み込み
  const masterRange = masterSheet.getDataRange();
  const masterValues = masterRange.getValues();
  const masterHeaders = masterValues[0];
  
  // マップ作成 (商品コード -> masterValuesのインデックス)
  const masterMap = new Map();
  for (let i = 1; i < masterValues.length; i++) {
    const code = String(masterValues[i][0]).trim();
    if (code) masterMap.set(code, i);
  }

  // 3. 同期処理
  let addedCount = 0;
  let updatedCount = 0;

  incomingItems.forEach(item => {
    if (masterMap.has(item.code)) {
      // 既存更新
      const rowIndex = masterMap.get(item.code);
      masterValues[rowIndex][1] = item.name;         // B: 商品名
      masterValues[rowIndex][2] = item.category;     // C: カテゴリ
      masterValues[rowIndex][3] = item.manufacturer; // D: メーカー
      masterValues[rowIndex][5] = item.jan;          // F: JAN
      updatedCount++;
    } else {
      // 新規追加 (A-F列を埋める)
      // A:Code, B:Name, C:Cat, D:Manu, E:Special(空), F:JAN
      masterValues.push([item.code, item.name, item.category, item.manufacturer, '', item.jan]);
      addedCount++;
    }
  });

  // 4. マスタへの書き出し (バッチ処理)
  // ヘッダーが短い場合はF列まで拡張
  if (masterHeaders.length < 6) {
    masterSheet.getRange(1, 1, 1, 6).setValues([['商品コード', '商品名', 'カテゴリ', 'メーカー', '別注/特注等', 'JANコード']]);
  } else {
    masterSheet.getRange(1, 6).setValue('JANコード').setFontWeight('bold');
  }

  masterSheet.getRange(1, 1, masterValues.length, 6).setValues(masterValues.map(row => row.slice(0, 6)));

  SpreadsheetApp.getUi().alert(`同期完了！\n新規追加: ${addedCount}件\n情報更新: ${updatedCount}件`);
}
