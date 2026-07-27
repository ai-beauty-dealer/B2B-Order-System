// ==========================================
// 出荷PDF取込 - 欠品数 / 発注サイト外商品
// ==========================================

const SHIPPING_IMPORT_CONFIG = {
  MENU_NAME: '出荷PDF',
  SIDEBAR_FILE: 'shipping_import_ui',
  SIDEBAR_TITLE: '出荷PDF取込',
  STOCKOUT_COLUMN: 9, // I列
  STOCKOUT_HEADER: '欠品数',
  STOCKOUT_LIST_SHEET: '欠品リスト',
  STOCKOUT_SPREADSHEET_PROPERTY: 'STOCKOUT_SPREADSHEET_ID',
  LOG_SHEET: '_出荷PDF取込ログ',
  DIRECT_CATEGORY: 'サロン直',
  DIRECT_SUFFIX: '直送',
  EXCLUDED_CODES: ['9999001', '9999991'],
  MAX_GROUPS: 1000,
  MAX_ITEMS: 5000
};

/**
 * スプレッドシートを開いた時に出荷PDFメニューを追加する。
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(SHIPPING_IMPORT_CONFIG.MENU_NAME)
    .addItem('PDFを取り込む', 'showShippingImportSidebar')
    .addSeparator()
    .addItem('欠品管理ファイルを作成・確認', 'setupStockoutManagementSpreadsheet')
    .addItem('既存の欠品をリストへ反映', 'syncExistingStockoutsToList')
    .addToUi();
}

/**
 * 初回導入時など、メニューを手動で追加したい時に実行する。
 */
function installShippingImportMenu() {
  onOpen();
}

/**
 * PDF取込サイドバーを表示する。
 */
function showShippingImportSidebar() {
  const template = HtmlService.createTemplateFromFile(SHIPPING_IMPORT_CONFIG.SIDEBAR_FILE);
  const html = template.evaluate()
    .setTitle(SHIPPING_IMPORT_CONFIG.SIDEBAR_TITLE)
    .setWidth(420);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * HTMLテンプレートから別HTMLファイルを読み込む。
 */
function includeShippingImportFile_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * シートを書き換えず、PDFと注文シートの照合結果だけ返す。
 */
function previewShippingImport(payload) {
  const normalized = normalizeShippingPayload_(payload);
  const ss = getShippingSpreadsheet_();
  const plan = buildShippingImportPlan_(ss, normalized);
  const alreadyImported = isShippingFileImported_(ss, normalized.fileHash);

  return {
    ok: true,
    alreadyImported: alreadyImported,
    documentDate: normalized.documentDate,
    fileName: normalized.fileName,
    summary: plan.summary,
    targetSheets: plan.targetPlans.map(function(target) {
      return {
        sheetName: target.sheetName,
        matchedItems: target.matchResult.matchedItems,
        stockoutItems: target.matchResult.stockoutUpdates.length,
        stockoutQty: sumStockoutQty_(target.matchResult.stockoutUpdates),
        externalItems: target.matchResult.externalItems.length,
        externalRowsToAppend: target.externalRows.length,
        willCreateSheet: !target.sheet,
        routingNote: target.routingNote || ''
      };
    })
  };
}

/**
 * 照合結果を通常 / 直送シートへ反映する。
 * - 既存注文: I列へ欠品数
 * - 発注サイト外: 最下部のB:C:Dへ商品コード / 出荷数 / 商品名
 */
function applyShippingImport(payload) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const normalized = normalizeShippingPayload_(payload);
    const ss = getShippingSpreadsheet_();

    if (isShippingFileImported_(ss, normalized.fileHash)) {
      throw new Error('このPDFはすでに反映済みです。同じPDFの二重取込はできません。');
    }

    const plan = buildShippingImportPlan_(ss, normalized);
    const stockoutSs = plan.summary.stockoutItems > 0 ? getStockoutManagementSpreadsheet_() : null;

    plan.targetPlans.forEach(function(target) {
      applyShippingTargetPlan_(target);
    });

    if (stockoutSs) {
      plan.summary.stockoutListRows = appendStockoutList_(stockoutSs, normalized.documentDate, plan.targetPlans);
    }

    SpreadsheetApp.flush();
    appendShippingImportLog_(ss, normalized, plan.summary);

    return {
      ok: true,
      documentDate: normalized.documentDate,
      fileName: normalized.fileName,
      summary: plan.summary
    };
  } finally {
    lock.releaseLock();
  }
}

function getShippingSpreadsheet_() {
  if (typeof SPREADSHEET_ID !== 'undefined' && SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function normalizeShippingPayload_(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('PDF解析データがありません。PDFを選び直してください。');
  }

  const documentDate = normalizeDateString_(payload.documentDate);
  if (!documentDate) {
    throw new Error('PDFの日付を読み取れませんでした。倉庫入出庫一覧表のPDFか確認してください。');
  }

  const sourceGroups = Array.isArray(payload.groups) ? payload.groups : [];
  if (sourceGroups.length === 0) {
    throw new Error('PDFから出荷明細を読み取れませんでした。');
  }
  if (sourceGroups.length > SHIPPING_IMPORT_CONFIG.MAX_GROUPS) {
    throw new Error('PDF内の伝票数が上限を超えています。PDFを日付ごとに分けてください。');
  }

  const excludedCodes = new Set(SHIPPING_IMPORT_CONFIG.EXCLUDED_CODES);
  let itemCount = 0;

  const groups = sourceGroups.map(function(group, groupIndex) {
    const category = normalizeComparableText_(group.category);
    const sourceItems = Array.isArray(group.items) ? group.items : [];
    const items = [];

    sourceItems.forEach(function(item, itemIndex) {
      const code = normalizeProductCode_(item.code);
      if (!code || excludedCodes.has(code)) return;

      const shippedQty = normalizeNonNegativeInteger_(item.shippedQty, '出荷数');
      const inputQty = normalizeNonNegativeInteger_(item.inputQty, '入力数');
      const name = normalizeDisplayText_(item.name);
      if (!name) {
        throw new Error('商品名を読み取れない明細があります。伝票位置: ' + (groupIndex + 1) + '-' + (itemIndex + 1));
      }

      itemCount++;
      items.push({
        code: code,
        name: name,
        shippedQty: shippedQty,
        inputQty: inputQty,
        page: Number(item.page) || 0,
        rowOrder: Number(item.rowOrder) || itemIndex
      });
    });

    return {
      groupIndex: groupIndex,
      category: category,
      direct: category === SHIPPING_IMPORT_CONFIG.DIRECT_CATEGORY,
      slipNumber: normalizeComparableText_(group.slipNumber),
      instructionNumber: normalizeComparableText_(group.instructionNumber),
      salonName: normalizeDisplayText_(group.salonName),
      sendAt: normalizeSendAt_(group.sendAt),
      items: items
    };
  }).filter(function(group) {
    return group.items.length > 0;
  });

  if (itemCount === 0) {
    throw new Error('除外コード以外の商品明細が見つかりませんでした。');
  }
  if (itemCount > SHIPPING_IMPORT_CONFIG.MAX_ITEMS) {
    throw new Error('PDF内の商品数が上限を超えています。PDFを分けてください。');
  }

  const fileName = normalizeDisplayText_(payload.fileName) || documentDate + '.pdf';
  const suppliedHash = String(payload.fileHash || '').trim().toLowerCase();
  const fileHash = /^[a-f0-9]{64}$/.test(suppliedHash)
    ? suppliedHash
    : computeShippingPayloadHash_({ documentDate: documentDate, groups: groups });

  return {
    documentDate: documentDate,
    fileName: fileName,
    fileHash: fileHash,
    groups: groups,
    itemCount: itemCount
  };
}

function buildShippingImportPlan_(ss, payload) {
  const compactDirectSheetName = payload.documentDate + SHIPPING_IMPORT_CONFIG.DIRECT_SUFFIX;
  // 日付と「直送」の間に半角/全角スペースがある既存シートも同じ直送シートとして扱う。
  // 例: 「2026-07-02直送」「2026-07-02 直送」
  const directSheet = findDirectSheet_(ss, payload.documentDate);
  const directSheetName = directSheet ? directSheet.getName() : compactDirectSheetName;
  const normalGroups = payload.groups.filter(function(group) { return !group.direct; });
  const directGroups = payload.groups.filter(function(group) { return group.direct; });

  const targetDefinitions = [
    {
      direct: false,
      sheetName: payload.documentDate,
      sheet: ss.getSheetByName(payload.documentDate),
      groups: normalGroups.concat(directSheet ? [] : directGroups),
      routingNote: !directSheet && directGroups.length > 0 ? '直送シートなし→通常' : ''
    },
    {
      direct: true,
      sheetName: directSheetName,
      sheet: directSheet,
      groups: directSheet ? directGroups : [],
      routingNote: ''
    }
  ].filter(function(target) {
    return target.groups.length > 0;
  });

  const targetPlans = targetDefinitions.map(function(target) {
    const sheet = target.sheet;
    const state = sheet
      ? readOrderSheetState_(sheet)
      : { lastRow: 0, siteRows: [], externalRows: [] };
    const matchResult = matchShippingGroupsToRows_(target.groups, state.siteRows);
    const externalRows = removeAlreadyAppendedExternal_(matchResult.externalItems, state.externalRows);

    return {
      spreadsheet: ss,
      sheet: sheet,
      sheetName: target.sheetName,
      direct: target.direct,
      routingNote: target.routingNote,
      state: state,
      matchResult: matchResult,
      externalRows: externalRows
    };
  });

  // 通常発注をサロン直送で発送したケースの二重登録を防ぐ
  reconcileDirectShippedNormalOrders_(ss, payload.documentDate, targetPlans);

  const summary = {
    pdfItems: payload.itemCount,
    matchedItems: 0,
    stockoutItems: 0,
    stockoutQty: 0,
    stockoutListRows: 0,
    externalItems: 0,
    externalRowsToAppend: 0
  };

  targetPlans.forEach(function(target) {
    summary.matchedItems += target.matchResult.matchedItems;
    summary.stockoutItems += target.matchResult.stockoutUpdates.length;
    summary.stockoutQty += sumStockoutQty_(target.matchResult.stockoutUpdates);
    summary.externalItems += target.matchResult.externalItems.length;
    summary.externalRowsToAppend += target.externalRows.length;
  });

  return {
    targetPlans: targetPlans,
    summary: summary
  };
}

function findDirectSheet_(ss, documentDate) {
  const suffix = SHIPPING_IMPORT_CONFIG.DIRECT_SUFFIX;
  const candidates = [
    documentDate + suffix,
    documentDate + ' ' + suffix,
    documentDate + '　' + suffix
  ];
  for (let i = 0; i < candidates.length; i++) {
    const sheet = ss.getSheetByName(candidates[i]);
    if (sheet) return sheet;
  }
  return null;
}

function readOrderSheetState_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { lastRow: lastRow, siteRows: [], externalRows: [] };
  }

  const values = sheet.getRange(2, 1, lastRow - 1, SHIPPING_IMPORT_CONFIG.STOCKOUT_COLUMN).getValues();
  const siteRows = [];
  const externalRows = [];

  values.forEach(function(row, index) {
    const rowNumber = index + 2;
    const timestamp = row[0];
    const code = normalizeProductCode_(row[1]);
    const qty = Number(row[2]);
    const name = normalizeDisplayText_(row[3]);

    if (!code || !Number.isFinite(qty) || qty < 0) return;

    if (timestamp !== '' && timestamp !== null) {
      siteRows.push({
        rowNumber: rowNumber,
        orderKey: getOrderGroupKey_(timestamp, rowNumber),
        timestampKey: formatTimestampMinute_(timestamp),
        code: code,
        qty: qty,
        name: name,
        salonName: normalizeDisplayText_(row[4])
      });
    } else if (name) {
      externalRows.push({
        rowNumber: rowNumber,
        code: code,
        qty: qty,
        name: name
      });
    }
  });

  return {
    lastRow: lastRow,
    siteRows: siteRows,
    externalRows: externalRows
  };
}

function matchShippingGroupsToRows_(pdfGroups, siteRows) {
  const siteGroupsByKey = {};
  siteRows.forEach(function(row) {
    if (!siteGroupsByKey[row.orderKey]) {
      siteGroupsByKey[row.orderKey] = {
        orderKey: row.orderKey,
        timestampKey: row.timestampKey,
        rows: []
      };
    }
    siteGroupsByKey[row.orderKey].rows.push(row);
  });

  const siteGroups = Object.keys(siteGroupsByKey).map(function(key) {
    return siteGroupsByKey[key];
  });
  const usedOrderKeys = new Set();
  const usedRowNumbers = new Set();
  const stockoutByRow = {};
  const externalItems = [];
  const pendingItems = [];
  let matchedItems = 0;

  function registerMatchedItem_(item, matchedRow, pdfGroup) {
    usedRowNumbers.add(matchedRow.rowNumber);
    matchedItems++;

    const stockoutQty = Math.max(Number(item.inputQty) - Number(item.shippedQty), 0);
    if (stockoutQty > 0) {
      if (!stockoutByRow[matchedRow.rowNumber]) {
        stockoutByRow[matchedRow.rowNumber] = {
          rowNumber: matchedRow.rowNumber,
          code: matchedRow.code,
          productName: matchedRow.name || normalizeDisplayText_(item.name),
          salonName: matchedRow.salonName || normalizeDisplayText_(pdfGroup && pdfGroup.salonName),
          stockoutQty: 0
        };
      }
      stockoutByRow[matchedRow.rowNumber].stockoutQty += stockoutQty;
    }
  }

  pdfGroups.forEach(function(pdfGroup) {
    const candidate = chooseSiteGroup_(pdfGroup, siteGroups, usedOrderKeys);
    if (!candidate) {
      pdfGroup.items.forEach(function(item) {
        pendingItems.push({ group: pdfGroup, item: item });
      });
      return;
    }

    usedOrderKeys.add(candidate.orderKey);
    const availableByCode = {};
    candidate.rows.forEach(function(row) {
      if (!availableByCode[row.code]) availableByCode[row.code] = [];
      availableByCode[row.code].push(row);
    });

    pdfGroup.items.forEach(function(item) {
      const rows = availableByCode[item.code] || [];
      if (rows.length === 0) {
        pendingItems.push({ group: pdfGroup, item: item });
        return;
      }

      let selectedIndex = rows.findIndex(function(row) {
        return Number(row.qty) === Number(item.inputQty);
      });
      if (selectedIndex < 0) selectedIndex = 0;

      const matchedRow = rows.splice(selectedIndex, 1)[0];
      registerMatchedItem_(item, matchedRow, pdfGroup);
    });
  });

  // PDF側で複数の発注が1伝票にまとまっている場合に備え、
  // 伝票・送信時刻で照合できなかった明細をシート全体のコード×個数で再照合する。
  const remainingSiteRows = siteRows.filter(function(row) {
    return !usedRowNumbers.has(row.rowNumber);
  });

  pendingItems.forEach(function(pending) {
    const exactIndex = remainingSiteRows.findIndex(function(row) {
      return row.code === pending.item.code && Number(row.qty) === Number(pending.item.inputQty);
    });

    if (exactIndex >= 0) {
      const matchedRow = remainingSiteRows.splice(exactIndex, 1)[0];
      registerMatchedItem_(pending.item, matchedRow, pending.group);
    } else if (pending.item.shippedQty > 0) {
      externalItems.push(createExternalItem_(pending.group, pending.item));
    }
  });

  return {
    matchedItems: matchedItems,
    stockoutUpdates: Object.keys(stockoutByRow).map(function(rowNumber) {
      return stockoutByRow[rowNumber];
    }),
    externalItems: externalItems,
    unusedSiteRows: siteRows.filter(function(row) {
      return !usedRowNumbers.has(row.rowNumber);
    })
  };
}

/**
 * 通常発注をサロン直送で発送したケースの二重登録防止。
 *
 * PDF上「サロン直」の品は直送シートとだけ照合されるため、元の注文が
 * 通常シートにあると一致せず「サイト外」として直送シートへ追記され、
 * 通常シートの注文と二重になる。
 * ここで、直送側のサイト外品を同じ日の通常シートの未照合注文と突き合わせ、
 * 一致したら直送側への追記を取りやめる（欠品があれば通常シート側へ記録）。
 */
function reconcileDirectShippedNormalOrders_(ss, documentDate, targetPlans) {
  const directPlan = targetPlans.filter(function(p) { return p.direct; })[0];
  if (!directPlan || !directPlan.externalRows || directPlan.externalRows.length === 0) {
    return;
  }

  const normalPlan = targetPlans.filter(function(p) { return !p.direct; })[0];

  // 通常シートの注文行（照合に使う候補）。通常PDFが無い日でもシートは読む。
  let normalRows;
  if (normalPlan) {
    normalRows = (normalPlan.matchResult.unusedSiteRows || []).slice();
  } else {
    const normalSheet = ss.getSheetByName(documentDate);
    if (!normalSheet) return;
    normalRows = readOrderSheetState_(normalSheet).siteRows;
  }

  const usedRowNumbers = {};
  const kept = [];

  directPlan.externalRows.forEach(function(ext) {
    const code = normalizeProductCode_(ext.code);
    const wantQty = Number(ext.inputQty);

    // コード一致＋発注数量一致（欠品があってもinputQty=発注数で照合）
    let matched = null;
    for (let i = 0; i < normalRows.length; i++) {
      const row = normalRows[i];
      if (usedRowNumbers[row.rowNumber]) continue;
      if (row.code !== code) continue;
      if (isFinite(wantQty) && Number(row.qty) !== wantQty) continue;
      matched = row;
      break;
    }

    if (!matched) {
      kept.push(ext); // 通常シートに無い＝本当のサイト外
      return;
    }

    usedRowNumbers[matched.rowNumber] = true;

    // 欠品（発注数 − 出荷数）があれば通常シート側のI列へ記録
    const shortage = Math.max(Number(ext.inputQty) - Number(ext.qty), 0);
    if (shortage > 0 && normalPlan) {
      normalPlan.matchResult.stockoutUpdates.push({
        rowNumber: matched.rowNumber,
        code: matched.code,
        productName: matched.name || normalizeDisplayText_(ext.name),
        salonName: matched.salonName,
        stockoutQty: shortage
      });
    }
  });

  directPlan.externalRows = kept;
  directPlan.matchResult.externalItems = kept.slice();
}

function chooseSiteGroup_(pdfGroup, siteGroups, usedOrderKeys) {
  const unusedGroups = siteGroups.filter(function(group) {
    return !usedOrderKeys.has(group.orderKey);
  });

  const sameMinute = pdfGroup.sendAt
    ? unusedGroups.filter(function(group) { return group.timestampKey === pdfGroup.sendAt; })
    : [];

  if (sameMinute.length > 0) {
    const ranked = sameMinute.map(function(group) {
      return { group: group, score: scoreSiteGroup_(pdfGroup, group) };
    }).sort(function(a, b) { return b.score - a.score; });

    if (ranked[0].score > 0) return ranked[0].group;
  }

  const exactMatches = unusedGroups.filter(function(group) {
    return shippingGroupSignature_(pdfGroup.items, 'inputQty') === shippingGroupSignature_(group.rows, 'qty');
  });

  return exactMatches.length === 1 ? exactMatches[0] : null;
}

function scoreSiteGroup_(pdfGroup, siteGroup) {
  const pdfQty = aggregateCodeQuantity_(pdfGroup.items, 'inputQty');
  const siteQty = aggregateCodeQuantity_(siteGroup.rows, 'qty');
  const pdfCodes = Object.keys(pdfQty);
  const siteCodes = Object.keys(siteQty);
  let score = 0;

  pdfCodes.forEach(function(code) {
    if (siteQty[code] === undefined) return;
    score += 10;
    score += Math.min(pdfQty[code], siteQty[code]);
    if (Number(pdfQty[code]) === Number(siteQty[code])) score += 40;
  });

  if (shippingGroupSignature_(pdfGroup.items, 'inputQty') === shippingGroupSignature_(siteGroup.rows, 'qty')) {
    score += 10000;
  }

  score -= Math.abs(pdfCodes.length - siteCodes.length) * 3;
  return score;
}

function shippingGroupSignature_(items, qtyField) {
  const totals = aggregateCodeQuantity_(items, qtyField);
  return Object.keys(totals).sort().map(function(code) {
    return code + ':' + totals[code];
  }).join('|');
}

function aggregateCodeQuantity_(items, qtyField) {
  const totals = {};
  items.forEach(function(item) {
    const code = normalizeProductCode_(item.code);
    if (!code) return;
    totals[code] = (totals[code] || 0) + Number(item[qtyField] || 0);
  });
  return totals;
}

function createExternalItem_(group, item) {
  return {
    groupIndex: group.groupIndex,
    code: item.code,
    qty: item.shippedQty,
    inputQty: item.inputQty, // 発注数（通常シートとの照合・欠品計算に使う）
    name: item.name,
    page: item.page,
    rowOrder: item.rowOrder
  };
}

function removeAlreadyAppendedExternal_(externalItems, existingExternalRows) {
  const existingCounts = {};
  existingExternalRows.forEach(function(row) {
    const signature = externalRowSignature_(row.code, row.qty, row.name);
    existingCounts[signature] = (existingCounts[signature] || 0) + 1;
  });

  return externalItems.filter(function(item) {
    const signature = externalRowSignature_(item.code, item.qty, item.name);
    if (existingCounts[signature] > 0) {
      existingCounts[signature]--;
      return false;
    }
    return true;
  }).sort(function(a, b) {
    if (a.groupIndex !== b.groupIndex) return a.groupIndex - b.groupIndex;
    if (a.page !== b.page) return a.page - b.page;
    return a.rowOrder - b.rowOrder;
  });
}

function externalRowSignature_(code, qty, name) {
  return normalizeProductCode_(code) + '|' + Number(qty || 0) + '|' + normalizeComparableText_(name);
}

function applyShippingTargetPlan_(target) {
  const sheet = target.sheet || createShippingOrderSheet_(
    target.spreadsheet,
    target.sheetName,
    target.direct
  );
  target.sheet = sheet;
  ensureStockoutColumn_(sheet);

  const lastRowBeforeAppend = sheet.getLastRow();
  if (lastRowBeforeAppend > 1) {
    const stockoutValues = Array.from({ length: lastRowBeforeAppend - 1 }, function() { return ['']; });
    target.matchResult.stockoutUpdates.forEach(function(update) {
      const index = update.rowNumber - 2;
      if (index >= 0 && index < stockoutValues.length) {
        stockoutValues[index][0] = update.stockoutQty;
      }
    });
    sheet.getRange(2, SHIPPING_IMPORT_CONFIG.STOCKOUT_COLUMN, stockoutValues.length, 1)
      .setValues(stockoutValues)
      .setNumberFormat('0');
  }

  if (target.externalRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    const values = target.externalRows.map(function(item) {
      return [item.code, item.qty, item.name];
    });
    sheet.getRange(startRow, 2, values.length, 3).setValues(values);
    sheet.getRange(startRow, 2, values.length, 1).setNumberFormat('@');
    sheet.getRange(startRow, 3, values.length, 1).setNumberFormat('0');
  }
}

function createShippingOrderSheet_(ss, sheetName, direct) {
  if (!ss || typeof ss.insertSheet !== 'function') {
    throw new Error('対象シート「' + sheetName + '」を作成できません。');
  }

  const sheet = ss.insertSheet(sheetName);
  const headers = [[
    'タイムスタンプ', '商品コード', '個数', '商品名', '得意先名',
    'ステータス', '備考', '別注', SHIPPING_IMPORT_CONFIG.STOCKOUT_HEADER
  ]];
  sheet.getRange(1, 1, 1, headers[0].length)
    .setValues(headers)
    .setFontWeight('bold')
    .setBackground(direct ? '#fff2cc' : '#f3f3f3');
  sheet.getRange(1, 2).setNumberFormat('@');
  sheet.getRange(1, 3).setNumberFormat('0');
  sheet.getRange(1, SHIPPING_IMPORT_CONFIG.STOCKOUT_COLUMN).setNumberFormat('0');
  if (typeof sheet.setFrozenRows === 'function') sheet.setFrozenRows(1);
  return sheet;
}

function ensureStockoutColumn_(sheet) {
  if (sheet.getMaxColumns() < SHIPPING_IMPORT_CONFIG.STOCKOUT_COLUMN) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), SHIPPING_IMPORT_CONFIG.STOCKOUT_COLUMN - sheet.getMaxColumns());
  }

  const headerCell = sheet.getRange(1, SHIPPING_IMPORT_CONFIG.STOCKOUT_COLUMN);
  if (sheet.getMaxColumns() >= 8) {
    sheet.getRange(1, 8).copyTo(headerCell, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }
  headerCell.setValue(SHIPPING_IMPORT_CONFIG.STOCKOUT_HEADER).setFontWeight('bold');
}

/**
 * PDF反映で確定した欠品を「欠品リスト」へ追記する。
 * 同じ対象日・商品・サロンは1行に合算する。
 */
function appendStockoutList_(stockoutSs, documentDate, targetPlans) {
  const rows = buildStockoutListRows_(documentDate, targetPlans);
  return appendUniqueStockoutRows_(stockoutSs, rows);
}

function buildStockoutListRows_(documentDate, targetPlans) {
  const date = stockoutDocumentDate_(documentDate);
  const aggregated = {};

  (targetPlans || []).forEach(function(target) {
    const updates = target && target.matchResult && Array.isArray(target.matchResult.stockoutUpdates)
      ? target.matchResult.stockoutUpdates
      : [];
    updates.forEach(function(update) {
      const code = normalizeProductCode_(update.code);
      const productName = normalizeDisplayText_(update.productName);
      const qty = Math.max(Number(update.stockoutQty) || 0, 0);
      const salonName = normalizeDisplayText_(update.salonName);
      if (!code || qty <= 0) return;
      const key = code + '|' + salonName;
      if (!aggregated[key]) {
        aggregated[key] = [code, productName, 0, salonName, date];
      }
      if (!aggregated[key][1] && productName) aggregated[key][1] = productName;
      aggregated[key][2] += qty;
    });
  });

  return Object.keys(aggregated).sort().map(function(key) {
    return aggregated[key];
  });
}

function appendUniqueStockoutRows_(stockoutSs, rows) {
  if (!rows || rows.length === 0) return 0;
  let sheet = stockoutSs.getSheetByName(SHIPPING_IMPORT_CONFIG.STOCKOUT_LIST_SHEET);
  if (!sheet) sheet = createStockoutListSheet_(stockoutSs);
  ensureStockoutListSheetSchema_(sheet);

  const existingRowsBySignature = {};
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 5).getValues().forEach(function(row, index) {
      existingRowsBySignature[stockoutListSignature_(row)] = {
        rowNumber: index + 2,
        productName: normalizeDisplayText_(row[1])
      };
    });
  }

  const newRows = rows.filter(function(row) {
    const signature = stockoutListSignature_(row);
    const existing = existingRowsBySignature[signature];
    if (existing) {
      if (!existing.productName && row[1]) {
        sheet.getRange(existing.rowNumber, 2).setValue(row[1]);
        existing.productName = row[1];
      }
      return false;
    }
    existingRowsBySignature[signature] = { rowNumber: 0, productName: row[1] };
    return true;
  });
  if (newRows.length === 0) return 0;

  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, newRows.length, 5).setValues(newRows);
  sheet.getRange(startRow, 1, newRows.length, 1).setNumberFormat('@');
  sheet.getRange(startRow, 3, newRows.length, 1).setNumberFormat('0');
  sheet.getRange(startRow, 5, newRows.length, 1).setNumberFormat('yyyy/mm/dd');
  return newRows.length;
}

function createStockoutListSheet_(ss) {
  const sheet = ss.insertSheet(SHIPPING_IMPORT_CONFIG.STOCKOUT_LIST_SHEET);
  initializeStockoutListSheet_(sheet);
  return sheet;
}

function initializeStockoutListSheet_(sheet) {
  sheet.getRange(1, 1, 1, 5)
    .setValues([['商品コード', '商品名', '個数', 'サロン名', '欠品日時']])
    .setFontWeight('bold')
    .setBackground('#f4cccc');
  sheet.setFrozenRows(1);
  return sheet;
}

function ensureStockoutListSheetSchema_(sheet) {
  const headers = sheet.getRange(1, 1, 1, Math.min(sheet.getMaxColumns(), 5)).getValues()[0];
  if (normalizeComparableText_(headers[0]) === '商品コード' &&
      normalizeComparableText_(headers[1]) === '個数') {
    sheet.insertColumnsAfter(1, 1);
  }
  sheet.getRange(1, 1, 1, 5)
    .setValues([['商品コード', '商品名', '個数', 'サロン名', '欠品日時']])
    .setFontWeight('bold')
    .setBackground('#f4cccc');
  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * 発注スプレッドシートとは別の「欠品管理」ファイルを作成する。
 * 2回目以降は既存ファイルのURLを表示する。
 */
function setupStockoutManagementSpreadsheet() {
  const ui = SpreadsheetApp.getUi();
  const properties = PropertiesService.getDocumentProperties();
  const existingId = properties.getProperty(SHIPPING_IMPORT_CONFIG.STOCKOUT_SPREADSHEET_PROPERTY);
  let stockoutSs = null;

  if (existingId) {
    try {
      stockoutSs = SpreadsheetApp.openById(existingId);
    } catch (error) {
      properties.deleteProperty(SHIPPING_IMPORT_CONFIG.STOCKOUT_SPREADSHEET_PROPERTY);
    }
  }

  if (!stockoutSs) {
    stockoutSs = SpreadsheetApp.create('欠品管理');
    const firstSheet = stockoutSs.getSheets()[0];
    firstSheet.setName(SHIPPING_IMPORT_CONFIG.STOCKOUT_LIST_SHEET);
    initializeStockoutListSheet_(firstSheet);
    properties.setProperty(SHIPPING_IMPORT_CONFIG.STOCKOUT_SPREADSHEET_PROPERTY, stockoutSs.getId());
  } else if (!stockoutSs.getSheetByName(SHIPPING_IMPORT_CONFIG.STOCKOUT_LIST_SHEET)) {
    createStockoutListSheet_(stockoutSs);
  } else {
    ensureStockoutListSheetSchema_(stockoutSs.getSheetByName(SHIPPING_IMPORT_CONFIG.STOCKOUT_LIST_SHEET));
  }

  ui.alert('欠品管理ファイル', '作成・登録済み\n' + stockoutSs.getUrl(), ui.ButtonSet.OK);
  return stockoutSs.getUrl();
}

function getStockoutManagementSpreadsheet_() {
  const id = PropertiesService.getDocumentProperties()
    .getProperty(SHIPPING_IMPORT_CONFIG.STOCKOUT_SPREADSHEET_PROPERTY);
  if (!id) {
    throw new Error('欠品管理ファイルが未設定。「出荷PDF」→「欠品管理ファイルを作成・確認」を先に実行して。');
  }
  try {
    return SpreadsheetApp.openById(id);
  } catch (error) {
    throw new Error('欠品管理ファイルを開けない。メニューから作成・確認をやり直して。');
  }
}

/**
 * すでに通常・直送シートI列へ反映済みの欠品を一度だけ同期する。
 */
function syncExistingStockoutsToList() {
  const sourceSs = getShippingSpreadsheet_();
  const stockoutSs = getStockoutManagementSpreadsheet_();
  const targetPlans = [];

  sourceSs.getSheets().forEach(function(sheet) {
    const match = sheet.getName().match(/^(20\d{2}-\d{2}-\d{2})(?:直送)?$/);
    if (!match || sheet.getLastRow() < 2 || sheet.getMaxColumns() < SHIPPING_IMPORT_CONFIG.STOCKOUT_COLUMN) return;
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, SHIPPING_IMPORT_CONFIG.STOCKOUT_COLUMN).getValues();
    const updates = [];
    values.forEach(function(row, index) {
      const qty = Math.max(Number(row[8]) || 0, 0);
      const code = normalizeProductCode_(row[1]);
      if (!code || qty <= 0) return;
      updates.push({
        rowNumber: index + 2,
        code: code,
        productName: normalizeDisplayText_(row[3]),
        salonName: normalizeDisplayText_(row[4]),
        stockoutQty: qty
      });
    });
    if (updates.length > 0) {
      targetPlans.push({ documentDate: match[1], updates: updates });
    }
  });

  let added = 0;
  targetPlans.forEach(function(target) {
    added += appendStockoutList_(stockoutSs, target.documentDate, [{
      matchResult: { stockoutUpdates: target.updates }
    }]);
  });
  SpreadsheetApp.flush();
  sourceSs.toast('独立した欠品管理ファイルへ' + added + '行追加した', '欠品リスト', 5);
  return added;
}

function stockoutDocumentDate_(value) {
  const normalized = normalizeDateString_(value);
  const parts = normalized.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function stockoutListSignature_(row) {
  return normalizeProductCode_(row[0]) + '|' +
    Number(row[2] || 0) + '|' +
    normalizeComparableText_(row[3]) + '|' +
    stockoutDateKey_(row[4]);
}

function stockoutDateKey_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.getFullYear() + '-' + pad2_(value.getMonth() + 1) + '-' + pad2_(value.getDate());
  }
  return normalizeDateString_(value);
}

function isShippingFileImported_(ss, fileHash) {
  const sheet = ss.getSheetByName(SHIPPING_IMPORT_CONFIG.LOG_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return false;

  const hashes = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getDisplayValues();
  return hashes.some(function(row) {
    return String(row[0]).trim().toLowerCase() === fileHash;
  });
}

function appendShippingImportLog_(ss, payload, summary) {
  let sheet = ss.getSheetByName(SHIPPING_IMPORT_CONFIG.LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SHIPPING_IMPORT_CONFIG.LOG_SHEET);
    sheet.getRange(1, 1, 1, 8).setValues([[
      '取込日時', 'PDFハッシュ', 'ファイル名', '対象日',
      '照合商品数', '欠品商品数', '欠品合計数', 'サイト外追加数'
    ]]);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
    sheet.hideSheet();
  }

  sheet.appendRow([
    new Date(),
    payload.fileHash,
    payload.fileName,
    payload.documentDate,
    summary.matchedItems,
    summary.stockoutItems,
    summary.stockoutQty,
    summary.externalRowsToAppend
  ]);
}

function sumStockoutQty_(updates) {
  return updates.reduce(function(sum, update) {
    return sum + Number(update.stockoutQty || 0);
  }, 0);
}

function getOrderGroupKey_(timestamp, rowNumber) {
  if (timestamp instanceof Date && !isNaN(timestamp.getTime())) {
    return 'date:' + timestamp.getTime();
  }
  const raw = String(timestamp || '').trim();
  return raw ? 'raw:' + raw : 'row:' + rowNumber;
}

function formatTimestampMinute_(timestamp) {
  if (timestamp instanceof Date && !isNaN(timestamp.getTime())) {
    return Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'MM/dd HH:mm');
  }

  const normalized = normalizeComparableText_(timestamp);
  const match = normalized.match(/(?:\d{4}[\/-])?(\d{1,2})[\/-](\d{1,2}).*?(\d{1,2}):(\d{2})/);
  if (!match) return '';
  return pad2_(match[1]) + '/' + pad2_(match[2]) + ' ' + pad2_(match[3]) + ':' + match[4];
}

function normalizeSendAt_(value) {
  const normalized = normalizeComparableText_(value);
  const match = normalized.match(/(\d{1,2})[\/-](\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!match) return '';
  return pad2_(match[1]) + '/' + pad2_(match[2]) + ' ' + pad2_(match[3]) + ':' + match[4];
}

function normalizeDateString_(value) {
  const normalized = normalizeComparableText_(value);
  const match = normalized.match(/(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (!match) return '';
  return match[1] + '-' + pad2_(match[2]) + '-' + pad2_(match[3]);
}

function normalizeProductCode_(value) {
  return normalizeComparableText_(value).replace(/^'/, '').replace(/\s+/g, '');
}

function normalizeDisplayText_(value) {
  return String(value === null || value === undefined ? '' : value)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeComparableText_(value) {
  return normalizeDisplayText_(value);
}

function normalizeNonNegativeInteger_(value, label) {
  const number = Number(String(value).normalize('NFKC').trim());
  if (!Number.isFinite(number) || number < 0 || Math.floor(number) !== number) {
    throw new Error(label + 'に不正な値があります: ' + value);
  }
  return number;
}

function pad2_(value) {
  return String(value).padStart(2, '0');
}

function computeShippingPayloadHash_(value) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(value),
    Utilities.Charset.UTF_8
  );
  return digest.map(function(byte) {
    const unsigned = byte < 0 ? byte + 256 : byte;
    return unsigned.toString(16).padStart(2, '0');
  }).join('');
}

// Node.jsのローカル検証から純粋関数だけ読み込むための出口。
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeShippingPayload_: normalizeShippingPayload_,
    matchShippingGroupsToRows_: matchShippingGroupsToRows_,
    removeAlreadyAppendedExternal_: removeAlreadyAppendedExternal_,
    applyShippingTargetPlan_: applyShippingTargetPlan_,
    buildShippingImportPlan_: buildShippingImportPlan_,
    findDirectSheet_: findDirectSheet_,
    buildStockoutListRows_: buildStockoutListRows_,
    appendStockoutList_: appendStockoutList_,
    stockoutListSignature_: stockoutListSignature_,
    shippingGroupSignature_: shippingGroupSignature_,
    normalizeSendAt_: normalizeSendAt_,
    normalizeDateString_: normalizeDateString_
  };
}
