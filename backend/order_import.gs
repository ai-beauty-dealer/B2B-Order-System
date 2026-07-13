// ==========================================
// 📥 取り込みモード（LINE文面・発注書写メ → 発注ドラフト解析）
// ==========================================
// doPost の action: 'parse_order' から呼ばれる（code.gs にルーティングあり）。
// サロンの履歴・お気に入り・使用メーカーのカラー剤を候補にして、
// Claude API で商品コードにマッチングした結果を返す。
// シートへの書き込みは一切しない（発注確定は既存フローのみ）。
//
// 必要な Script Property:
//   ANTHROPIC_API_KEY … Claude APIキー（プロジェクトの設定 → スクリプト プロパティ）
//
// コスト設計（二段階方式）:
//   テキスト解析 … 文面の語で候補を事前フィルタ＋Haikuでマッチング → 1回2〜3円目安
//   写メ解析     … ①Opusで文字起こし（画像だけ・候補リストなし＝安い）
//                  ②起こしたテキストをHaikuでマッチング（事前フィルタ有効）
//                  → 合計1枚5円前後。読みの品質はOpus、照合コストはHaiku
const PARSE_MODEL_TEXT = 'claude-haiku-4-5';   // マッチング（商品コード特定）
const PARSE_MODEL_IMAGE = 'claude-opus-4-8';   // 写メの文字起こし（手書きOCR。ここはケチらない）

const PARSE_MAX_INPUT_CHARS = 4000;    // LINE文面の上限
const PARSE_MAX_IMAGES = 3;            // 写メの上限枚数
const PARSE_MAX_IMAGE_B64 = 6000000;   // 1枚あたりbase64上限（約4.5MB実体）
const PARSE_MAX_IMAGE_OUTPUT_TOKENS = 16000; // 標準発注書の大量行を途中で切らない
const PARSE_MAX_CANDIDATES_TEXT = 600;  // テキスト解析時の候補上限（事前フィルタ後）
const PARSE_MAX_CANDIDATES_IMAGE = 1200; // 写メ解析時の候補上限
const PARSE_HISTORY_LOOKBACK_DAYS = 62; // 履歴を遡る日数（発注サイト未使用サロンも拾えるよう広め）

// 別名辞書（正本: docs/取り込みモード_別名辞書.md。確定した行だけここに反映する）
const PARSE_ALIAS_HINTS = [
  'エタロラ = ルビオナエタロラ（ルベル）',
  'ハニニコ = ハホニコ（メーカー名）。インナー1L=レブリインナー1000(807201)、アウター1L=レブリアウター1000(807202)',
  'テラカラー = 商品マスタ未登録の取寄せ品。マッチさせず未マッチとして返す',
  'アジアンカラー = アジアンカラーフェス（アリミノ）',
  'プライム = Nカラーストーリープライム（アリミノ）',
  'イノア = iNOA（ロレアル）。8.82等の小数表記はiNOAの色番',
  'BL/BLカラー = BLカラー（フィヨーレ）。色番だけの記載（8GA等）はBLカラーの場合が多い',
  'サンドベージュ[n] = クオルシアサンドベージュ[n]（フィヨーレ）。グレージュ[n]=クオルシアグレージュ[n]。グレーとグレージュは別商品なので混同しない',
  'OX6/BLオキシ6% = BLカラー OX 6% 2000 パウチ。OX3=3%、OX2=2%',
  'プリフィカ = F.Aidプリフィカ（フィヨーレ）',
  'CD = クリエイティブデザイン（フィヨーレ）',
  'アイスモス[n] = アドミオ [n]アイスモス 90（アリミノ）',
  'クオルシア パイプリーチ/パイブリーチ = クオルシア ハイブリーチ（フィヨーレ。写真OCRの誤読）'
].join('\n');

function handleParseOrder(data) {
  const clientName = String(data.clientName || '').trim();
  const text = String(data.text || '').trim();
  const images = Array.isArray(data.images) ? data.images : [];

  if (!clientName) return parseOrderError_('clientName がありません。');
  if (!text && images.length === 0) return parseOrderError_('文面か写真のどちらかを入れてください。');
  if (text.length > PARSE_MAX_INPUT_CHARS) {
    return parseOrderError_('テキストが長すぎます（' + PARSE_MAX_INPUT_CHARS + '文字まで）。分割して取り込んでください。');
  }
  if (images.length > PARSE_MAX_IMAGES) {
    return parseOrderError_('写真は' + PARSE_MAX_IMAGES + '枚までです。分けて取り込んでください。');
  }
  for (let i = 0; i < images.length; i++) {
    if (typeof images[i] !== 'string' || !images[i]) return parseOrderError_('写真データが不正です。');
    if (images[i].length > PARSE_MAX_IMAGE_B64) return parseOrderError_('写真が大きすぎます。アプリを最新版にして撮り直してください。');
  }

  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) return parseOrderError_('ANTHROPIC_API_KEY が未設定です（スクリプト プロパティに追加してください）。');

  const requestId = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  const debug = {
    requestId: requestId,
    imageCount: images.length,
    inputTextLength: text.length,
    transcriptLines: 0,
    directResolved: 0,
    directUnresolved: 0,
    candidateCount: 0,
    matched: 0,
    unmatched: 0
  };
  logParseStage_(requestId, 'start', {
    clientName: clientName,
    imageCount: images.length,
    inputTextLength: text.length
  });

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const master = loadMasterForParse_(ss);

  // 写メがある場合はまずOpusで文字起こしし、以降はテキストとして扱う（二段階方式）
  let effectiveText = text;
  let transcript = '';
  if (images.length > 0) {
    const ocr = transcribeOrderImages_(apiKey, images);
    if (ocr.error) {
      logParseStage_(requestId, 'ocr_error', { error: ocr.error });
      return parseOrderError_(ocr.error + '（ログID: ' + requestId + '）');
    }
    transcript = ocr.text;
    debug.transcriptLines = countNonEmptyLines_(transcript);
    logParseStage_(requestId, 'ocr_complete', {
      transcriptLength: transcript.length,
      transcriptLines: debug.transcriptLines,
      transcript: transcript.slice(0, 30000)
    });
    effectiveText = (text ? text + '\n' : '') + transcript;
    if (!effectiveText.trim()) {
      logParseStage_(requestId, 'ocr_empty', {});
      return parseOrderError_('写真から発注内容を読み取れませんでした。撮り直すか、文面を貼り付けてください。（ログID: ' + requestId + '）');
    }
  }

  // 標準発注書の「CODE 商品コード」はAIマッチングより先に商品マスタへ直接照合する。
  // コードだけで決めず、同じ行の商品名も近い場合だけ確定して誤読コードを防ぐ。
  const direct = resolvePrintedCodeLines_(effectiveText, master);
  const directItems = direct.items;
  effectiveText = direct.unresolvedText;
  debug.directResolved = directItems.length;
  debug.directUnresolved = countNonEmptyLines_(effectiveText);
  logParseStage_(requestId, 'direct_match', {
    resolved: debug.directResolved,
    unresolved: debug.directUnresolved,
    unresolvedText: effectiveText.slice(0, 30000)
  });

  // 全行をコードで確定できた場合はHaikuを呼ばず、画像OCRの1回だけで返す。
  if (!effectiveText.trim()) {
    debug.matched = directItems.length;
    logParseStage_(requestId, 'complete', debug);
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      data: { items: directItems, unmatched: [], candidateCount: 0, transcript: transcript, debug: debug }
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // 文字起こし済みテキストの語で色番候補を事前フィルタしてトークンを節約する
  const candidates = buildParseCandidates_(ss, clientName, master, effectiveText);
  debug.candidateCount = candidates.base.length + candidates.expanded.length;
  logParseStage_(requestId, 'candidates', {
    base: candidates.base.length,
    expanded: candidates.expanded.length,
    total: debug.candidateCount
  });

  const result = callClaudeForParse_(apiKey, effectiveText, candidates);
  if (result.error) {
    logParseStage_(requestId, 'match_error', { error: result.error });
    return parseOrderError_(result.error + '（ログID: ' + requestId + '）');
  }

  // 候補リストの「正規化した商品名 → 商品」索引（コード転記ミスの自動補正に使う）
  const candByName = {};
  candidates.base.concat(candidates.expanded).forEach(function (c) {
    const key = normalizeForMatch_(c.name);
    if (!key) return;
    candByName[key] = candByName.hasOwnProperty(key) ? 'DUP' : c; // 同名複数は補正に使わない
  });

  // サーバー側検証:
  //  1. コードがマスタに実在するか
  //  2. AIが答えた商品名とコードが一致しているか（小型モデルは隣の行のコードを書き写すことがある）
  //     不一致なら「商品名」を信じて候補からコードを自動補正。補正先が特定できなければ low に落とす
  const items = directItems.slice();
  const unmatched = [];
  const rawUnmatched = (result.parsed.unmatched || []).slice();
  const allCandidates = candidates.base.concat(candidates.expanded);
  (result.parsed.items || []).forEach(function (it) {
    let code = String(it.code || '').trim();
    const qty = Math.max(1, Math.min(999, parseInt(it.qty, 10) || 1));
    let confidence = (it.confidence === 'high' || it.confidence === 'low') ? it.confidence : 'medium';
    let note = String(it.note || '');

    const claimedKey = normalizeForMatch_(String(it.name || ''));
    let masterItem = master.byCode[code] || null;

    if (claimedKey && masterItem && normalizeForMatch_(masterItem.name) !== claimedKey) {
      // コードと商品名が食い違っている → 商品名側から正しいコードを引き直す
      const fix = candByName[claimedKey];
      if (fix && fix !== 'DUP') {
        code = fix.code;
        masterItem = fix;
        note = (note ? note + '・' : '') + 'コード転記ミスを自動補正';
      } else {
        confidence = 'low';
        note = (note ? note + '・' : '') + 'コードと商品名が不一致の可能性（要確認）';
      }
    } else if (claimedKey && !masterItem) {
      // コード自体が存在しない → 商品名から復元を試みる
      const fix = candByName[claimedKey];
      if (fix && fix !== 'DUP') {
        code = fix.code;
        masterItem = fix;
        note = (note ? note + '・' : '') + 'コード転記ミスを自動補正';
      }
    }

    if (code && masterItem) {
      items.push({
        source_text: String(it.source_text || ''),
        code: code,
        name: masterItem.name,
        qty: qty,
        confidence: confidence,
        note: note
      });
    } else {
      unmatched.push({
        source_text: String(it.source_text || ''),
        qty: qty,
        note: 'AIが返した商品コードがマスタに存在しませんでした'
      });
    }
  });

  // Haikuが未マッチにしても、容量・型番が一致する十分近い候補が1件だけなら救済する。
  rawUnmatched.forEach(function (it) {
    const sourceText = String(it.source_text || '');
    const fix = findUniqueFuzzyCandidate_(sourceText, allCandidates);
    if (fix) {
      items.push({
        source_text: sourceText,
        code: fix.code,
        name: fix.name,
        qty: Math.max(1, Math.min(999, parseInt(it.qty, 10) || 1)),
        confidence: 'medium',
        note: '写真OCRの誤読を商品候補から自動補正（要確認）'
      });
    } else {
      unmatched.push(it);
    }
  });

  debug.matched = items.length;
  debug.unmatched = unmatched.length;
  logParseStage_(requestId, 'complete', debug);

  return ContentService.createTextOutput(JSON.stringify({
    status: 'success',
    data: { items: items, unmatched: unmatched, candidateCount: debug.candidateCount, transcript: transcript, debug: debug }
  })).setMimeType(ContentService.MimeType.JSON);
}

function countNonEmptyLines_(text) {
  return String(text || '').split(/\r?\n/).filter(function (line) { return line.trim(); }).length;
}

function logParseStage_(requestId, stage, details) {
  try {
    console.log('[OrderImportDebug] ' + JSON.stringify({
      requestId: requestId,
      stage: stage,
      details: details || {}
    }));
  } catch (e) {
    console.log('[OrderImportDebug] ' + requestId + ' ' + stage);
  }
}

// --- 写メ→文字起こし（Opus。候補リストを渡さないので画像枚数分だけの低コスト） ---
function transcribeOrderImages_(apiKey, images) {
  const systemPrompt = [
    'あなたは美容ディーラーの発注書読み取り係。手書きの発注書・メモの写真から、発注内容だけを書き起こす。',
    '',
    '## 厳守ルール',
    '- 通常の手書きメモは「商品名（書いてあるまま）×数量」を1行1商品で。例: 8GA×2',
    '- QR付き標準発注書では、右の数量欄に手書き数字がある商品行だけを出力する。数量欄が空の行は出力しない',
    '- 標準発注書の商品名の下にある「CODE 704999」は商品コード。旧版で数字だけの場合も、商品名直下の5〜10桁数字は商品コードとして扱う',
    '- 商品コードがある行は必ず「CODE 704999 | 商品名×数量」の形式で出力する。コードは商品名より優先して一桁ずつ正確に読む',
    '- コードが判読できない場合は「CODE ? | 商品名×数量」とし、推測した数字を書かない',
    '- ブランド名・メーカー名の行があれば、続く色番の行頭に付ける。例: BLカラー 9CB×5',
    '- 「〃」「同上」は直前の行の商品系列を引き継いで展開する',
    '- 取消線（横線・ぐしゃぐしゃ）で消された行は出力しない',
    '- 書き直し・訂正がある場合は訂正後だけを出力する',
    '- 紙の裏写り・鏡文字・薄い写り込みは無視する',
    '- 印字済みのヘッダー・フッター（会社名・サロン名・電話番号・登録番号・注意書き）は出力しない',
    '- サイズ表記（1000ml、80g等）が書いてあれば商品名に含める',
    '- 数量が読めない場合は「×?」とする。文字が判読できない部分は「〓」に置き換える',
    '- 余計な説明・前置きは一切書かない。書き起こした行だけを出力する'
  ].join('\n');

  const content = [];
  images.forEach(function (b64) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } });
  });
  content.push({ type: 'text', text: 'この発注書の発注内容を書き起こしてください。' });

  const payload = {
    model: PARSE_MODEL_IMAGE,
    // OCRは推理より転記量を優先。thinkingは出力枠を消費するため使わない。
    max_tokens: PARSE_MAX_IMAGE_OUTPUT_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: content }]
  };

  const res = fetchClaude_(apiKey, payload);
  if (res.error) return res;
  return { text: res.text.trim() };
}

function parseOrderError_(message) {
  return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

// --- 商品マスタ読み込み（コード→商品、メーカー別カラー剤の索引つき） ---
function loadMasterForParse_(ss) {
  const sheet = ss.getSheetByName(SHEET_NAMES.MASTER);
  if (!sheet) throw new Error("Sheet '" + SHEET_NAMES.MASTER + "' not found.");
  const values = sheet.getDataRange().getValues();
  const byCode = {};
  const colorByMfr = {}; // manufacturer -> [{code,name,mfr}]（カラー関連・2剤/ブリーチのみ）
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const code = String(row[0]).replace(/^'/, '').trim();
    if (!code || !row[1] || code.toLowerCase().indexOf('e+') !== -1) continue;
    const item = {
      code: code,
      name: String(row[1]),
      category: String(row[2] || ''),
      mfr: String(row[3] || '')
    };
    byCode[code] = item;
    if (item.category === 'カラー関連' || item.category === '2剤/ブリーチ') {
      if (!colorByMfr[item.mfr]) colorByMfr[item.mfr] = [];
      colorByMfr[item.mfr].push(item);
    }
  }
  return { byCode: byCode, colorByMfr: colorByMfr };
}

// --- 照合用正規化: 半角カナ→全角、全角英数→半角、小文字化、区切り除去 ---
function normalizeForMatch_(str) {
  if (!str) return '';
  let s = String(str);
  // 全角英数→半角
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９．]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  // 半角カナ→全角（濁点結合）
  const dakuten = { 'ｶ': 'ガ', 'ｷ': 'ギ', 'ｸ': 'グ', 'ｹ': 'ゲ', 'ｺ': 'ゴ', 'ｻ': 'ザ', 'ｼ': 'ジ', 'ｽ': 'ズ', 'ｾ': 'ゼ', 'ｿ': 'ゾ', 'ﾀ': 'ダ', 'ﾁ': 'ヂ', 'ﾂ': 'ヅ', 'ﾃ': 'デ', 'ﾄ': 'ド', 'ﾊ': 'バ', 'ﾋ': 'ビ', 'ﾌ': 'ブ', 'ﾍ': 'ベ', 'ﾎ': 'ボ', 'ｳ': 'ヴ' };
  const handakuten = { 'ﾊ': 'パ', 'ﾋ': 'ピ', 'ﾌ': 'プ', 'ﾍ': 'ペ', 'ﾎ': 'ポ' };
  const plain = { 'ｱ': 'ア', 'ｲ': 'イ', 'ｳ': 'ウ', 'ｴ': 'エ', 'ｵ': 'オ', 'ｶ': 'カ', 'ｷ': 'キ', 'ｸ': 'ク', 'ｹ': 'ケ', 'ｺ': 'コ', 'ｻ': 'サ', 'ｼ': 'シ', 'ｽ': 'ス', 'ｾ': 'セ', 'ｿ': 'ソ', 'ﾀ': 'タ', 'ﾁ': 'チ', 'ﾂ': 'ツ', 'ﾃ': 'テ', 'ﾄ': 'ト', 'ﾅ': 'ナ', 'ﾆ': 'ニ', 'ﾇ': 'ヌ', 'ﾈ': 'ネ', 'ﾉ': 'ノ', 'ﾊ': 'ハ', 'ﾋ': 'ヒ', 'ﾌ': 'フ', 'ﾍ': 'ヘ', 'ﾎ': 'ホ', 'ﾏ': 'マ', 'ﾐ': 'ミ', 'ﾑ': 'ム', 'ﾒ': 'メ', 'ﾓ': 'モ', 'ﾔ': 'ヤ', 'ﾕ': 'ユ', 'ﾖ': 'ヨ', 'ﾗ': 'ラ', 'ﾘ': 'リ', 'ﾙ': 'ル', 'ﾚ': 'レ', 'ﾛ': 'ロ', 'ﾜ': 'ワ', 'ｦ': 'ヲ', 'ﾝ': 'ン', 'ｧ': 'ァ', 'ｨ': 'ィ', 'ｩ': 'ゥ', 'ｪ': 'ェ', 'ｫ': 'ォ', 'ｯ': 'ッ', 'ｬ': 'ャ', 'ｭ': 'ュ', 'ｮ': 'ョ', 'ｰ': 'ー' };
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const next = s[i + 1];
    if (next === 'ﾞ' && dakuten[c]) { out += dakuten[c]; i++; continue; }
    if (next === 'ﾟ' && handakuten[c]) { out += handakuten[c]; i++; continue; }
    out += plain[c] || c;
  }
  // ひらがな→カタカナ
  out = out.replace(/[ぁ-ゖ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0x60); });
  return out.toLowerCase().replace(/[\s　\-\_\/\\.,:;･・]/g, '');
}

// --- 文面から照合トークンを抽出（英数字の型番・カタカナ語） ---
function extractMatchTokens_(text) {
  const norm = normalizeForMatch_(text);
  const tokens = {};
  // 英数字トークン（8ga, rv8, 8.82→882 等。長さ2以上）
  (norm.match(/[a-z0-9]{2,}/g) || []).forEach(function (t) { tokens[t] = true; });
  // カタカナ語（2文字以上）
  (norm.match(/[ァ-ヶー]{2,}/g) || []).forEach(function (t) { tokens[t] = true; });
  return Object.keys(tokens);
}

// 「CODE 704999 | 商品名×1」の行を、商品マスタで直接解決する。
// 数量・コード・商品名の3点が揃わない行はHaiku側へ残す。
function resolvePrintedCodeLines_(text, master) {
  const items = [];
  const unresolved = [];
  String(text || '').split(/\r?\n/).forEach(function (rawLine) {
    const line = String(rawLine || '').replace(/[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    }).trim();
    if (!line) return;

    const codeMatch = line.match(/(?:^|[\s|\uFF5C])CODE\s*[:\uFF1A#-]?\s*([0-9]{5,10})(?=$|[\s|\uFF5C])/i);
    const qtyMatch = line.match(/[xX\xD7\u2715*\uFF0A]\s*([0-9?\uFF1F]+)\s*(?:\u672C|\u500B|\u7BB1|\u888B)?\s*$/i);
    if (!codeMatch || !qtyMatch || !master || !master.byCode) {
      unresolved.push(line);
      return;
    }

    const code = String(codeMatch[1]);
    const printedName = line
      .replace(codeMatch[0], ' ')
      .replace(qtyMatch[0], ' ')
      .replace(/[|\uFF5C]/g, ' ')
      .trim();
    const resolved = findPrintedCodeCandidate_(code, printedName, master.byCode);
    if (!resolved) {
      unresolved.push(line);
      return;
    }
    const masterItem = resolved.item;
    const exactName = normalizeForMatch_(printedName) === normalizeForMatch_(masterItem.name);

    const qtyUnknown = /[?\uFF1F]/.test(qtyMatch[1]);
    const qty = qtyUnknown ? 1 : Math.max(1, Math.min(999, parseInt(qtyMatch[1], 10) || 1));
    let note = '印字商品コードで照合';
    if (resolved.codeCorrected) note = '印字コード1桁誤読を商品名で補正';
    else if (!exactName) note = '印字商品コードで照合（商品名表記ゆれ）';
    if (qtyUnknown) note += '・数量未記載';
    items.push({
      source_text: line,
      code: masterItem.code,
      name: masterItem.name,
      qty: qty,
      confidence: qtyUnknown ? 'low' : (exactName && !resolved.codeCorrected ? 'high' : 'medium'),
      note: note
    });
  });
  return { items: items, unresolvedText: unresolved.join('\n') };
}

// 読み取ったコード自身と1桁だけ違うコードを比較し、商品名で一意に決める。
// 容量や濃度が合わない候補はfuzzyProductScore_側で0点になる。
function findPrintedCodeCandidate_(readCode, printedName, byCode) {
  if (!readCode || !byCode) return null;
  const candidateCodes = {};
  candidateCodes[readCode] = true;
  for (let i = 0; i < readCode.length; i++) {
    for (let digit = 0; digit <= 9; digit++) {
      const value = String(digit);
      if (value === readCode[i]) continue;
      candidateCodes[readCode.slice(0, i) + value + readCode.slice(i + 1)] = true;
    }
  }

  const ranked = [];
  Object.keys(candidateCodes).forEach(function (code) {
    const item = byCode[code];
    if (!item) return;
    // コードを書き換える場合は、容量・濃度・色番などの全数値が合う候補だけに限る。
    if (code !== readCode && !haveSameNumberTokens_(printedName, item.name)) return;
    const exactName = normalizeForMatch_(printedName) === normalizeForMatch_(item.name);
    const score = exactName ? 1 : fuzzyProductScore_(printedName, item.name);
    if (score > 0) ranked.push({ item: item, score: score });
  });
  ranked.sort(function (a, b) { return b.score - a.score; });
  if (!ranked.length || ranked[0].score < 0.52) return null;
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < 0.10) return null;
  return {
    item: ranked[0].item,
    score: ranked[0].score,
    codeCorrected: ranked[0].item.code !== readCode
  };
}

function haveSameNumberTokens_(a, b) {
  const numbers = function (value) {
    return (normalizeForMatch_(value).match(/[0-9]+(?:\.[0-9]+)?/g) || []).sort().join('|');
  };
  const left = numbers(a);
  const right = numbers(b);
  return left && right && left === right;
}

// 写真OCRで数文字だけ崩れた商品名を、追加APIなしで候補へ戻す。
// 数量は比較から外し、型番・容量の数字が食い違う商品は対象にしない。
function stripQuantityForFuzzyMatch_(line) {
  return normalizeForMatch_(String(line || '').replace(/[xX\xD7\u2715*\uFF0A]\s*[0-9?\uFF1F]+\s*(?:\u672C|\u500B|\u7BB1|\u888B)?\s*$/i, ''));
}

function bigramDiceScore_(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const counts = {};
  for (let i = 0; i < a.length - 1; i++) {
    const gram = a.slice(i, i + 2);
    counts[gram] = (counts[gram] || 0) + 1;
  }
  let overlap = 0;
  for (let j = 0; j < b.length - 1; j++) {
    const gram = b.slice(j, j + 2);
    if (counts[gram]) { overlap++; counts[gram]--; }
  }
  return (2 * overlap) / (a.length + b.length - 2);
}

function foldKanaMarksForFuzzy_(str) {
  const map = {
    '\u30AC': '\u30AB', '\u30AE': '\u30AD', '\u30B0': '\u30AF', '\u30B2': '\u30B1', '\u30B4': '\u30B3',
    '\u30B6': '\u30B5', '\u30B8': '\u30B7', '\u30BA': '\u30B9', '\u30BC': '\u30BB', '\u30BE': '\u30BD',
    '\u30C0': '\u30BF', '\u30C2': '\u30C1', '\u30C5': '\u30C4', '\u30C7': '\u30C6', '\u30C9': '\u30C8',
    '\u30D0': '\u30CF', '\u30D3': '\u30D2', '\u30D6': '\u30D5', '\u30D9': '\u30D8', '\u30DC': '\u30DB',
    '\u30D1': '\u30CF', '\u30D4': '\u30D2', '\u30D7': '\u30D5', '\u30DA': '\u30D8', '\u30DD': '\u30DB',
    '\u30F4': '\u30A6'
  };
  return String(str || '').replace(/[\u30AC-\u30F4]/g, function (c) { return map[c] || c; });
}

function isFuzzyProductMatch_(sourceLine, productName) {
  return fuzzyProductScore_(sourceLine, productName) >= 0.72;
}

function fuzzyProductScore_(sourceLine, productName) {
  const source = stripQuantityForFuzzyMatch_(sourceLine);
  const product = normalizeForMatch_(productName);
  if (source.length < 8 || product.length < 8) return 0;

  const sourceNums = source.match(/[0-9]+(?:\.[0-9]+)?/g) || [];
  const productNums = product.match(/[0-9]+(?:\.[0-9]+)?/g) || [];
  if (sourceNums.length && productNums.length) {
    const hasSameNumber = sourceNums.some(function (n) { return productNums.indexOf(n) !== -1; });
    if (!hasSameNumber) return 0;
  }

  return bigramDiceScore_(foldKanaMarksForFuzzy_(source), foldKanaMarksForFuzzy_(product));
}

function findUniqueFuzzyCandidate_(sourceLine, candidates) {
  let best = null;
  let bestScore = 0;
  let secondScore = 0;
  (candidates || []).forEach(function (item) {
    const score = fuzzyProductScore_(sourceLine, item.name);
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = item;
    } else if (score > secondScore) {
      secondScore = score;
    }
  });
  return bestScore >= 0.86 && bestScore - secondScore >= 0.08 ? best : null;
}

// --- 候補リスト生成: 履歴 + お気に入り + 履歴メーカーのカラー剤色番 ---
// filterText が渡されたら（テキスト解析時）、色番展開分は文面に出てくる語を含む商品だけに絞る
function buildParseCandidates_(ss, clientName, master, filterText) {
  const seen = {};
  const base = [];      // 履歴・お気に入り（常に全量入れる）
  const expanded = [];  // カラー剤色番の展開分（絞り込み対象）
  const pushBase = function (item) {
    if (!item || seen[item.code]) return;
    seen[item.code] = true;
    base.push(item);
  };

  // 1. 発注履歴（過去 PARSE_HISTORY_LOOKBACK_DAYS 日の日付シート + Ordersシート）
  const historyCodes = collectHistoryCodes_(ss, clientName);
  historyCodes.forEach(function (code) { pushBase(master.byCode[code]); });

  // 2. お気に入り
  const favSheet = ss.getSheetByName(SHEET_NAMES.FAVORITES);
  if (favSheet) {
    const values = favSheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === clientName) {
        String(values[i][1] || '').split(',').forEach(function (c) {
          pushBase(master.byCode[c.trim().replace(/^'/, '')]);
        });
        break;
      }
    }
  }

  // 3. メーカーを履歴での登場数順に並べ、カラー剤色番を展開
  const mfrCount = {};
  base.forEach(function (c) { if (c.mfr) mfrCount[c.mfr] = (mfrCount[c.mfr] || 0) + 1; });
  const rankedMfrs = Object.keys(mfrCount).sort(function (a, b) { return mfrCount[b] - mfrCount[a]; });

  const tokens = filterText ? extractMatchTokens_(filterText) : null;
  const fuzzyLines = filterText ? String(filterText).split(/\r?\n/).filter(function (line) {
    return stripQuantityForFuzzyMatch_(line).length >= 8;
  }) : [];
  const maxTotal = filterText ? PARSE_MAX_CANDIDATES_TEXT : PARSE_MAX_CANDIDATES_IMAGE;

  rankedMfrs.forEach(function (mfr) {
    (master.colorByMfr[mfr] || []).forEach(function (item) {
      if (seen[item.code]) return;
      if (base.length + expanded.length >= maxTotal) return;
      if (tokens) {
        // 文面の語（型番・カタカナ）を商品名に含むものだけ通す
        const normName = normalizeForMatch_(item.name);
        let hit = false;
        for (let i = 0; i < tokens.length; i++) {
          if (normName.indexOf(tokens[i]) !== -1) { hit = true; break; }
        }
        if (!hit) {
          for (let j = 0; j < fuzzyLines.length; j++) {
            if (isFuzzyProductMatch_(fuzzyLines[j], item.name)) { hit = true; break; }
          }
        }
        if (!hit) return;
      }
      seen[item.code] = true;
      expanded.push(item);
    });
  });

  // 履歴にないメーカーの初回注文も、長い商品名と容量が近ければ補欠候補へ入れる。
  // 色番だけの短い記載は対象外なので、別メーカーの同色番を広げすぎない。
  if (filterText && base.length + expanded.length < maxTotal) {
    Object.keys(master.colorByMfr).forEach(function (mfr) {
      if (base.length + expanded.length >= maxTotal) return;
      (master.colorByMfr[mfr] || []).forEach(function (item) {
        if (seen[item.code] || base.length + expanded.length >= maxTotal) return;
        let hit = false;
        for (let i = 0; i < fuzzyLines.length; i++) {
          if (isFuzzyProductMatch_(fuzzyLines[i], item.name)) { hit = true; break; }
        }
        if (!hit) return;
        seen[item.code] = true;
        expanded.push(item);
      });
    });
  }

  return { base: base, expanded: expanded, length: base.length + expanded.length };
}

// --- 履歴コード収集（doGet action=history と同じシート構造を読む・コードだけ） ---
function collectHistoryCodes_(ss, clientName) {
  const codes = [];
  const seen = {};
  const add = function (code) {
    const c = String(code).replace(/^'/, '').trim();
    if (c && !seen[c]) { seen[c] = true; codes.push(c); }
  };

  const today = new Date();
  const startDay = new Date(getTargetDateStr(today));
  for (let i = 0; i < PARSE_HISTORY_LOOKBACK_DAYS; i++) {
    const d = new Date(startDay.getTime());
    d.setDate(startDay.getDate() - i);
    const dateStr = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    [dateStr, dateStr + '直送'].forEach(function (sheetName) {
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) return;
      const values = sheet.getDataRange().getValues();
      for (let j = 1; j < values.length; j++) {
        const rowClient = String(values[j][4]);
        if (rowClient === clientName || rowClient.indexOf(clientName + ' ') === 0) add(values[j][1]);
      }
    });
  }

  const ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  if (ordersSheet) {
    const values = ordersSheet.getDataRange().getValues();
    for (let j = values.length - 1; j >= 1 && codes.length < 200; j--) {
      const rowClient = String(values[j][4]);
      if (rowClient === clientName || rowClient.indexOf(clientName + ' ') === 0) add(values[j][1]);
    }
  }
  return codes;
}

// --- テキスト→商品マッチング（構造化出力） ---
function callClaudeForParse_(apiKey, text, candidates) {
  const toLine = function (c) { return c.code + '|' + c.name + '|' + c.mfr; };
  const candidateSection =
    '### このサロンの発注履歴・お気に入り（最優先で照合する）\n' +
    candidates.base.map(toLine).join('\n') +
    '\n### サロン使用メーカーのカラー剤色番\n' +
    candidates.expanded.map(toLine).join('\n');

  const rules = [
    '- 商品コードは必ず候補リストにあるもの（または別名辞書に明記されたコード）だけを使う。それ以外は絶対に創作せず unmatched に入れる',
    '- code と name は候補リストの**同じ行**からセットでそのまま書き写す。1行ズレた転記（CB/5のつもりでCB/3の行のコードを書く等）は厳禁。書く前にその行のコードと名前を再確認する',
    '- 数量が読み取れない行・「×?」の行は qty=1 とし、confidence を low にして note に「数量未記載」と書く',
    '- 「あれば〜」「おっきいサイズ」のような曖昧な依頼は unmatched に入れ、note に理由を書く',
    '- 「〓」（判読不能文字）を含む行は unmatched に入れ、note に「判読不能」と書く',
    '- 挨拶・締めの文（「発注お願いします」等)は無視する。商品行だけを抽出する',
    '- 1行に複数商品（「8と10を一本ずつ」等）があれば商品ごとに分解する',
    '- source_text には元の記載を一字一句そのまま入れる（照合用）',
    '- confidence: high=候補と表記がほぼ一致 / medium=別名・略記からの推定 / low=推測を含む',
    '- 似た名前の別商品（グレーとグレージュ等）に注意。文字列が完全一致しない推定は high にしない',
    '- 写真OCRでは「ハ/パ」「ブ/プ」「リ/ソ」など数文字だけ誤ることがある。容量・型番が一致し、候補名との違いが数文字だけならOCR誤読として medium で照合する'
  ];

  const systemPrompt = [
    'あなたは美容ディーラーの発注アシスタント。サロンから届いた発注文面を解析し、',
    '候補商品リストの中から該当する商品を特定して、商品コード・数量を抽出する。',
    '',
    '## 厳守ルール',
    rules.join('\n'),
    '',
    '## 別名辞書（サロンの通称 → 正式名）',
    PARSE_ALIAS_HINTS
  ].join('\n');

  const userPrompt = '## 候補商品リスト（コード|商品名|メーカー）\n' + candidateSection +
    '\n\n## サロンからの発注\n' + text;

  const schema = {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source_text: { type: 'string' },
            code: { type: 'string' },
            name: { type: 'string' },
            qty: { type: 'integer' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            note: { type: 'string' }
          },
          required: ['source_text', 'code', 'name', 'qty', 'confidence', 'note'],
          additionalProperties: false
        }
      },
      unmatched: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source_text: { type: 'string' },
            qty: { type: 'integer' },
            note: { type: 'string' }
          },
          required: ['source_text', 'qty', 'note'],
          additionalProperties: false
        }
      }
    },
    required: ['items', 'unmatched'],
    additionalProperties: false
  };

  const payload = {
    model: PARSE_MODEL_TEXT,
    max_tokens: 16000,
    // マッチング側を Opus 4.8 に上げる場合はこの行を有効化すると精度が上がる（Haiku 4.5 では入れない）:
    // thinking: { type: 'adaptive' },
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    output_config: { format: { type: 'json_schema', schema: schema } }
  };

  const res = fetchClaude_(apiKey, payload);
  if (res.error) return res;
  try {
    return { parsed: JSON.parse(res.text) };
  } catch (e) {
    return { error: 'AI応答の解析に失敗しました: ' + e };
  }
}

// --- Claude API 共通呼び出し（1回だけ自動リトライ。成功時は最初のtextブロックを返す） ---
function fetchClaude_(apiKey, payload) {
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    let response;
    try {
      response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
    } catch (e) {
      if (attempt === 0) { Utilities.sleep(3000); continue; }
      return { error: 'AI解析の通信に失敗しました: ' + e };
    }
    const status = response.getResponseCode();
    const body = response.getContentText();

    if (status === 200) {
      try {
        const json = JSON.parse(body);
        if (json.stop_reason === 'refusal') return { error: 'AIが解析を拒否しました。内容を確認してください。' };
        if (json.stop_reason === 'max_tokens') {
          return { error: 'AIの出力上限に達しました。写真を1枚ずつ分けて読み込んでください。' };
        }
        let textBlock = '';
        (json.content || []).forEach(function (b) { if (b.type === 'text' && !textBlock) textBlock = b.text; });
        if (!textBlock) {
          return { error: 'AI応答が空でした（終了理由: ' + (json.stop_reason || '不明') + '）。もう一度試してください。' };
        }
        return { text: textBlock };
      } catch (e) {
        return { error: 'AI応答の解析に失敗しました: ' + e };
      }
    }

    // 429 / 500 / 529 は1回だけリトライ
    if ((status === 429 || status >= 500) && attempt === 0) {
      Utilities.sleep(5000);
      continue;
    }
    let msg = 'AI解析に失敗しました（HTTP ' + status + '）';
    try { msg += ': ' + (JSON.parse(body).error || {}).message; } catch (e) { /* keep */ }
    return { error: msg };
  }
  return { error: 'AI解析に失敗しました（リトライ上限）。' };
}
