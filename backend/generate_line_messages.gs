/**
 * LINE用メッセージリスト作成スクリプト
 * ClientMasterシートの情報を読み取り、指定の文章にIDとPWを埋め込んだテキストを
 * Googleドキュメントとして自動生成します。
 */
function generateLineMessages() {
  // エディタから手動実行する前提。紐づいているシート自身を使う
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('ClientMaster');
  
  if (!sheet) {
    Logger.log("ClientMasterシートが見つかりません。");
    SpreadsheetApp.getUi().alert("エラー: ClientMasterシートが見つかりません。");
    return;
  }
  
  const values = sheet.getDataRange().getValues();
  let output = "";
  
  const template = `お世話になります。
この度web発注システムをリリースしましたのでご連絡させていただきました。
現在LINEでご注文をいただいておりましたが、今月中にweb発注システムへの移行をお願い致します。
使い方のマニュアルに関しましては別途PDFで送らせていただきます。
1番簡単な注文の仕方はバーコード発注になります。
商品名で検索のタブの横にカメラマークがありますのでこちらを起動していただいて、商品のバーコードを読み込んでいただくと発注カートに追加される仕組みとなります。
同一商品を複数発注したい時はバーコードを読んでいただくと下に商品の個数を変更出来るタブがありますので、そちらで数量変更をお願い致します。
発注スケジュールに関しては現在と同じになりますので、今まで通りこちらからご連絡させていただきますのでwebでのご発注をお願い致します。
ご不明点ございましたら、いつでもご連絡いただければと思います。

【ログイン情報】
ID: {{ID}}
PW: {{PW}}
URL: https://ai-beauty-dealer.github.io/B2B-Order-System/`;

  let count = 0;

  // 1行目はヘッダーなので i=1 からスタート
  // 前提: A列(0)=ID, B列(1)=PW, C列(2)=得意先名, D列(3)=種別
  for (let i = 1; i < values.length; i++) {
    const id = String(values[i][0] || '').trim();
    const pw = String(values[i][1] || '').trim(); // 共通の "actim" になっている想定
    const name = String(values[i][2] || '').trim();
    const type = String(values[i][3] || '').trim().toUpperCase();
    
    // 得意先名が存在し、かつ「マスター」権限ではないアカウントのみを対象とする
    if (name && type !== 'MASTER' && type !== 'マスター') {
      output += `=========================================\n`;
      output += `宛先: ${name} 様\n`;
      output += `=========================================\n`;
      
      // IDとPWをテンプレートに埋め込む
      let personalizedMessage = template.replace('{{ID}}', id).replace('{{PW}}', pw);
      output += personalizedMessage + "\n\n\n";
      count++;
    }
  }
  
  if (count === 0) {
    SpreadsheetApp.getUi().alert("送信対象のサロンが見つかりませんでした。");
    return;
  }
  
  // Googleドキュメントを新規作成してテキストを流し込む
  const docName = '【LINE送信リスト】Web発注システム案内_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm');
  const doc = DocumentApp.create(docName);
  doc.getBody().setText(output);
  
  const docUrl = doc.getUrl();
  Logger.log("ドキュメント作成完了: " + docUrl);
  
  // スプレッドシートの画面に完了メッセージとURLを表示
  const ui = SpreadsheetApp.getUi();
  ui.alert(
    '作成完了',
    `${count}件のサロン宛のメッセージリストを作成しました。\n\n以下のURL（Googleドキュメント）から内容をコピーしてLINEにお使いください。\n\n${docUrl}`,
    ui.ButtonSet.OK
  );
}
