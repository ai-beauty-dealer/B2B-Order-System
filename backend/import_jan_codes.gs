/**
 * 【JANコード紐付け専用ツール v3.3 - 最終安定版】
 * 機能: 既存商品のJANコードを一括更新します。
 * 安全策: 数値化による型崩れ防止、空欄上書きのガード、一括書き込み高速化
 */
function importJANCodes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const masterSheet = ss.getSheetByName('ItemMaster');
  const tmpSheet = ss.getSheetByName('TmpJAN');

  if (!masterSheet || !tmpSheet) {
    throw new Error('「ItemMaster」または「TmpJAN」シートが見つかりません。');
  }

  // 1. TmpJANデータの読み込み
  const tmpValues = tmpSheet.getDataRange().getValues();
  const janMap = new Map();
  for (let i = 1; i < tmpValues.length; i++) {
    const code = String(tmpValues[i][0] || '').trim();
    const janVal = tmpValues[i][1];
    
    // 指数表記(4.9E+12)等の崩れを防ぐため、数値の場合はフォーマット指定して文字列化
    const jan = (typeof janVal === 'number') ? 
                Utilities.formatString('%.0f', janVal) : String(janVal || '').trim();
    
    // コードがあり、かつJANコードが空でない場合のみマップに登録
    if (code && jan && jan !== '0') {
      janMap.set(code, jan);
    }
  }

  // 2. ItemMasterデータの一括読み込み
  const masterValues = masterSheet.getDataRange().getValues();
  
  // F列（index 5）をJANコード列として確定。ヘッダーのチェック
  if (masterValues[0].length < 6 || masterValues[0][5] !== 'JANコード') {
    masterSheet.getRange(1, 6).setValue('JANコード').setFontWeight('bold');
  }

  const updatedJanColumnValues = [];
  let updateCount = 0;

  // 3. メモリ上で紐付け判定 (2行目から)
  for (let i = 1; i < masterValues.length; i++) {
    const itemCode = String(masterValues[i][0] || '').trim();
    const currentJan = String(masterValues[i][5] || '').trim();
    
    // TmpJANにデータがあり、かつ現在の値と異なる場合のみ上書き
    let finalJan = currentJan;
    if (janMap.has(itemCode)) {
      const newJan = janMap.get(itemCode);
      if (newJan !== currentJan) {
        finalJan = newJan;
        updateCount++;
      }
    }
    updatedJanColumnValues.push([finalJan]);
  }

  // 4. マスタへの書き出し (バッチ書き込み)
  if (updatedJanColumnValues.length > 0) {
    masterSheet.getRange(2, 6, updatedJanColumnValues.length, 1).setValues(updatedJanColumnValues);
  }

  SpreadsheetApp.getUi().alert(`更新完了！\n\n・マスタと一致し、JANコードを書き換えた商品: ${updateCount} 件`);
}
