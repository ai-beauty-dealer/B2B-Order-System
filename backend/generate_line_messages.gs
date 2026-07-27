/**
 * @deprecated 統合ツールv0.6.5の「サロン別の案内文を作る」へ移行済み。
 * 固定文面やパスワードをGoogleドキュメントへ書き出さないため、
 * この旧GASは案内だけを表示して終了する。
 */
function generateLineMessages() {
  SpreadsheetApp.getUi().alert(
    'この機能は使用停止',
    '統合ツールの設定タブにある「サロン別の案内文を作る」を使用してください。\n' +
    '新しい機能はパスワードをGoogleドキュメントやログへ保存しません。',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
