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
// コスト設計:
//   テキスト解析 … 文面に出てくる語で候補を事前フィルタ → 1回2〜3円目安
//   写メ解析     … 事前フィルタ不可のため候補広め＋画像 → 1回5円前後目安（Haiku時）

// モデル選定: まずHaikuで運用し、精度がイマイチなら該当モードだけ 'claude-opus-4-8' に上げる。
// ※ Opusに変える場合は buildClaudePayload_ 内のコメント参照（thinking: adaptive を足すと精度が上がる）
const PARSE_MODEL_TEXT = 'claude-haiku-4-5';   // LINE文面の解析
const PARSE_MODEL_IMAGE = 'claude-haiku-4-5';  // 発注書写メの解析（手書き精度が足りなければここだけOpusへ）

const PARSE_MAX_INPUT_CHARS = 4000;    // LINE文面の上限
const PARSE_MAX_IMAGES = 3;            // 写メの上限枚数
const PARSE_MAX_IMAGE_B64 = 6000000;   // 1枚あたりbase64上限（約4.5MB実体）
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
  'アイスモス[n] = アドミオ [n]アイスモス 90（アリミノ）'
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

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const master = loadMasterForParse_(ss);
  const isImageMode = images.length > 0;
  // テキストのみのときは文面の語で色番候補を事前フィルタしてトークンを節約する。
  // 写メがあるときは中身が読めないためフィルタしない（候補広め）。
  const candidates = buildParseCandidates_(ss, clientName, master, isImageMode ? '' : text);

  const result = callClaudeForParse_(apiKey, text, images, candidates);
  if (result.error) return parseOrderError_(result.error);

  // サーバー側検証: 返ってきたコードがマスタに実在するか。実在すれば名前はマスタ表記で上書き
  const items = [];
  const unmatched = (result.parsed.unmatched || []).slice();
  (result.parsed.items || []).forEach(function (it) {
    const code = String(it.code || '').trim();
    const qty = Math.max(1, Math.min(999, parseInt(it.qty, 10) || 1));
    if (code && master.byCode[code]) {
      items.push({
        source_text: String(it.source_text || ''),
        code: code,
        name: master.byCode[code].name,
        qty: qty,
        confidence: (it.confidence === 'high' || it.confidence === 'low') ? it.confidence : 'medium',
        note: String(it.note || '')
      });
    } else {
      unmatched.push({
        source_text: String(it.source_text || ''),
        qty: qty,
        note: 'AIが返した商品コードがマスタに存在しませんでした'
      });
    }
  });

  return ContentService.createTextOutput(JSON.stringify({
    status: 'success',
    data: { items: items, unmatched: unmatched, candidateCount: candidates.length }
  })).setMimeType(ContentService.MimeType.JSON);
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
        if (!hit) return;
      }
      seen[item.code] = true;
      expanded.push(item);
    });
  });

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

// --- Claude API 呼び出し（構造化出力・1回だけ自動リトライ） ---
function callClaudeForParse_(apiKey, text, images, candidates) {
  const toLine = function (c) { return c.code + '|' + c.name + '|' + c.mfr; };
  const candidateSection =
    '### このサロンの発注履歴・お気に入り（最優先で照合する）\n' +
    candidates.base.map(toLine).join('\n') +
    '\n### サロン使用メーカーのカラー剤色番\n' +
    candidates.expanded.map(toLine).join('\n');

  const isImageMode = images.length > 0;

  const rules = [
    '- 商品コードは必ず候補リストにあるもの（または別名辞書に明記されたコード）だけを使う。それ以外は絶対に創作せず unmatched に入れる',
    '- 数量が読み取れない行は qty=1 とし、confidence を low にして note に「数量未記載」と書く',
    '- 「あれば〜」「おっきいサイズ」のような曖昧な依頼は unmatched に入れ、note に理由を書く',
    '- 挨拶・締めの文（「発注お願いします」等)は無視する。商品行だけを抽出する',
    '- 1行に複数商品（「8と10を一本ずつ」等）があれば商品ごとに分解する',
    '- source_text には元の記載を一字一句そのまま入れる（照合用）',
    '- confidence: high=候補と表記がほぼ一致 / medium=別名・略記からの推定 / low=推測を含む',
    '- 似た名前の別商品（グレーとグレージュ等）に注意。文字列が完全一致しない推定は high にしない'
  ];
  if (isImageMode) {
    rules.push(
      '- 取消線（横線・ぐしゃぐしゃ）で消された行は除外する',
      '- 書き直し・訂正がある場合は訂正後の内容を採用する',
      '- 紙の裏写り・鏡文字・薄い写り込みは無視する',
      '- 印字済みのヘッダー・フッター（会社名・電話番号・登録番号・注意書き）は商品ではない',
      '- 「〃」「同上」は直前の行の商品系列を引き継ぐ',
      '- どうしても判読できない行は unmatched に入れ、note に「判読不能」と書く'
    );
  }

  const systemPrompt = [
    'あなたは美容ディーラーの発注アシスタント。サロンから届いた発注（LINE文面や手書き発注書の写真）を解析し、',
    '候補商品リストの中から該当する商品を特定して、商品コード・数量を抽出する。',
    '',
    '## 厳守ルール',
    rules.join('\n'),
    '',
    '## 別名辞書（サロンの通称 → 正式名）',
    PARSE_ALIAS_HINTS
  ].join('\n');

  const userPrompt = '## 候補商品リスト（コード|商品名|メーカー）\n' + candidateSection +
    '\n\n## サロンからの発注\n' + (text || '（添付の写真を読み取ってください）');

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

  // 画像がある場合は image ブロックを先に並べ、最後にテキスト
  const content = [];
  images.forEach(function (b64) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } });
  });
  content.push({ type: 'text', text: userPrompt });

  const payload = {
    model: isImageMode ? PARSE_MODEL_IMAGE : PARSE_MODEL_TEXT,
    max_tokens: 16000,
    // Opus 4.8 に上げる場合はこの行を有効化すると精度が上がる（Haiku 4.5 では入れない）:
    // thinking: { type: 'adaptive' },
    system: systemPrompt,
    messages: [{ role: 'user', content: content }],
    output_config: { format: { type: 'json_schema', schema: schema } }
  };

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
        if (json.stop_reason === 'refusal') return { error: 'AIが解析を拒否しました。文面を確認してください。' };
        let textBlock = '';
        (json.content || []).forEach(function (b) { if (b.type === 'text' && !textBlock) textBlock = b.text; });
        if (!textBlock) return { error: 'AI応答が空でした。もう一度試してください。' };
        return { parsed: JSON.parse(textBlock) };
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
