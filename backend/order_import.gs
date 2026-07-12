// ==========================================
// 📥 取り込みモード（LINE文面 → 発注ドラフト解析）
// ==========================================
// doPost の action: 'parse_order' から呼ばれる（code.gs にルーティングあり）。
// サロンの履歴・お気に入り・使用メーカーのカラー剤を候補にして、
// Claude API で商品コードにマッチングした結果を返す。
// シートへの書き込みは一切しない（発注確定は既存フローのみ）。
//
// 必要な Script Property:
//   ANTHROPIC_API_KEY … Claude APIキー（プロジェクトの設定 → スクリプト プロパティ）

// モデル選定: まずHaiku（1回1円以下）で運用し、精度がイマイチなら 'claude-opus-4-8' に上げる。
// ※ 'claude-opus-4-8' に変える場合は下の payload に thinking: { type: 'adaptive' } を足すと精度が上がる
//   （Haiku 4.5 は adaptive thinking 非対応のため現在は外してある）
const PARSE_MODEL = 'claude-haiku-4-5';
const PARSE_MAX_INPUT_CHARS = 4000;   // LINE文面の上限
const PARSE_MAX_CANDIDATES = 1500;    // プロンプトに渡す候補商品の上限
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
  'サンドベージュ[n] = クオルシアサンドベージュ[n]（フィヨーレ）',
  'グレージュ[n] = クオルシアグレージュ[n]（フィヨーレ）',
  'OX6/BLオキシ6% = BLカラー OX 6% 2000 パウチ。OX3=3%、OX2=2%',
  'プリフィカ = F.Aidプリフィカ（フィヨーレ）',
  'CD = クリエイティブデザイン（フィヨーレ）',
  'アイスモス[n] = アドミオ [n]アイスモス 90（アリミノ）'
].join('\n');

function handleParseOrder(data) {
  const clientName = String(data.clientName || '').trim();
  const text = String(data.text || '').trim();

  if (!clientName) return parseOrderError_('clientName がありません。');
  if (!text) return parseOrderError_('解析するテキストが空です。');
  if (text.length > PARSE_MAX_INPUT_CHARS) {
    return parseOrderError_('テキストが長すぎます（' + PARSE_MAX_INPUT_CHARS + '文字まで）。分割して取り込んでください。');
  }

  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) return parseOrderError_('ANTHROPIC_API_KEY が未設定です（スクリプト プロパティに追加してください）。');

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const master = loadMasterForParse_(ss);
  const candidates = buildParseCandidates_(ss, clientName, master);

  const result = callClaudeForParse_(apiKey, text, candidates);
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

// --- 候補リスト生成: 履歴 + お気に入り + 履歴メーカーのカラー剤全色番 ---
function buildParseCandidates_(ss, clientName, master) {
  const seen = {};
  const candidates = [];
  const push = function (item, tag) {
    if (!item || seen[item.code]) return;
    seen[item.code] = true;
    candidates.push({ code: item.code, name: item.name, mfr: item.mfr, tag: tag });
  };

  // 1. 発注履歴（過去 PARSE_HISTORY_LOOKBACK_DAYS 日の日付シート + Ordersシート）
  const historyCodes = collectHistoryCodes_(ss, clientName);
  historyCodes.forEach(function (code) { push(master.byCode[code], '履歴'); });

  // 2. お気に入り
  const favSheet = ss.getSheetByName(SHEET_NAMES.FAVORITES);
  if (favSheet) {
    const values = favSheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === clientName) {
        String(values[i][1] || '').split(',').forEach(function (c) {
          push(master.byCode[c.trim().replace(/^'/, '')], 'お気に入り');
        });
        break;
      }
    }
  }

  // 3. 履歴・お気に入りに登場したメーカーのカラー剤を全色番展開
  //    （色番は履歴に無いことが多いが、サロンが使うブランドは履歴から分かる）
  const mfrs = {};
  candidates.forEach(function (c) { if (c.mfr) mfrs[c.mfr] = true; });
  Object.keys(mfrs).forEach(function (mfr) {
    (master.colorByMfr[mfr] || []).forEach(function (item) {
      if (candidates.length < PARSE_MAX_CANDIDATES) push(item, 'カラー剤');
    });
  });

  return candidates.slice(0, PARSE_MAX_CANDIDATES);
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
function callClaudeForParse_(apiKey, text, candidates) {
  const candidateLines = candidates.map(function (c) {
    return c.code + '\t' + c.name + '\t' + c.mfr + '\t' + c.tag;
  }).join('\n');

  const systemPrompt = [
    'あなたは美容ディーラーの発注アシスタント。サロンから届いたLINEの発注文面を解析し、',
    '候補商品リストの中から該当する商品を特定して、商品コード・数量を抽出する。',
    '',
    '## 厳守ルール',
    '- 商品コードは必ず候補リストにあるものだけを使う。リストにない商品は絶対に創作せず unmatched に入れる',
    '- 数量が読み取れない行は qty=1 とし、confidence を low にして note に「数量未記載」と書く',
    '- 「あれば〜」「おっきいサイズ」のような曖昧な依頼は unmatched に入れ、note に理由を書く',
    '- 挨拶・締めの文（「発注お願いします」等)は無視する。商品行だけを抽出する',
    '- 1行に複数商品（「8と10を一本ずつ」等）があれば商品ごとに分解する',
    '- source_text には元の記載を一字一句そのまま入れる（照合用）',
    '- confidence: high=候補と表記がほぼ一致 / medium=別名・略記からの推定 / low=推測を含む',
    '- 候補のtag列: 履歴=このサロンが実際に頼んだ商品（最優先）/ お気に入り / カラー剤=サロン使用メーカーの色番展開',
    '',
    '## 別名辞書（サロンの通称 → 正式名）',
    PARSE_ALIAS_HINTS
  ].join('\n');

  const userPrompt = '## 候補商品リスト（コード\\t商品名\\tメーカー\\t出所）\n' + candidateLines +
    '\n\n## サロンからの発注文面\n' + text;

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
    model: PARSE_MODEL,
    max_tokens: 16000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
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
