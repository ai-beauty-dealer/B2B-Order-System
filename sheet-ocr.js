(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.SheetOrderOcr = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const QR_PREFIX = 'B2BORDER2';
    const LEGACY_QR_PREFIX = 'B2BORDER';
    const MARK_TYPES = new Set(['arabic_digit', 'japanese_tally', 'blank', 'unclear']);
    const CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low']);

    const makeSheetId = () => {
        const random = typeof crypto !== 'undefined' && crypto.getRandomValues
            ? Array.from(crypto.getRandomValues(new Uint32Array(2)), (value) => value.toString(36)).join('')
            : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        return `SO-${Date.now().toString(36)}-${random}`.slice(0, 67);
    };

    const makeQrValue = (sheetId, pageNo) => {
        if (!/^SO-[A-Za-z0-9_-]{12,64}$/.test(String(sheetId || ''))) throw new TypeError('発注書IDが不正です');
        if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > 6) throw new TypeError('ページ番号が不正です');
        return `${QR_PREFIX}|${sheetId}|${pageNo}`;
    };

    const parseQrValue = (value) => {
        const parts = String(value || '').trim().split('|');
        if (parts.length !== 3 || parts[0] !== QR_PREFIX || !/^SO-[A-Za-z0-9_-]{12,64}$/.test(parts[1])) return null;
        const pageNo = Number(parts[2]);
        if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > 6) return null;
        return { sheet_id: parts[1], page_no: pageNo };
    };

    // 画像取込対応QRへ切り替わる直前の旧QRは、選択中サロンとの一致だけを端末で確認する。
    // 固定レイアウトの登録有無は非公開のサーバー側で照合し、未登録用紙を誤認しない。
    const parseLegacyQrValue = (value, expectedClientName) => {
        const parts = String(value || '').trim().split('|');
        if (parts.length !== 2 || parts[0] !== LEGACY_QR_PREFIX) return null;
        const clientName = String(parts[1] || '').trim();
        if (!clientName || clientName !== String(expectedClientName || '').trim()) return null;
        return { legacy_qr: `${LEGACY_QR_PREFIX}|${clientName}`, page_no: 1, legacy: true };
    };

    const normalizedBoxToPixels = (bbox, width, height) => {
        if (!Array.isArray(bbox) || bbox.length !== 4) throw new TypeError('bboxは4要素が必要です');
        return {
            x: Math.max(0, Math.round((Number(bbox[0]) / 10000) * width)),
            y: Math.max(0, Math.round((Number(bbox[1]) / 10000) * height)),
            width: Math.max(1, Math.round((Number(bbox[2]) / 10000) * width)),
            height: Math.max(1, Math.round((Number(bbox[3]) / 10000) * height))
        };
    };

    const solveLinearSystem = (matrix, vector) => {
        const size = vector.length;
        const augmented = matrix.map((row, index) => [...row, vector[index]]);
        for (let column = 0; column < size; column++) {
            let pivot = column;
            for (let row = column + 1; row < size; row++) {
                if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
            }
            if (Math.abs(augmented[pivot][column]) < 1e-12) throw new Error('四隅から変換行列を作れません');
            [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
            const divisor = augmented[column][column];
            for (let col = column; col <= size; col++) augmented[column][col] /= divisor;
            for (let row = 0; row < size; row++) {
                if (row === column) continue;
                const factor = augmented[row][column];
                for (let col = column; col <= size; col++) augmented[row][col] -= factor * augmented[column][col];
            }
        }
        return augmented.map((row) => row[size]);
    };

    const computeHomography = (fromPoints, toPoints) => {
        if (!Array.isArray(fromPoints) || !Array.isArray(toPoints) || fromPoints.length !== 4 || toPoints.length !== 4) {
            throw new TypeError('fromPointsとtoPointsは4点ずつ必要です');
        }
        const matrix = [];
        const vector = [];
        for (let index = 0; index < 4; index++) {
            const [x, y] = fromPoints[index];
            const [u, v] = toPoints[index];
            matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
            vector.push(u);
            matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
            vector.push(v);
        }
        return [...solveLinearSystem(matrix, vector), 1];
    };

    const projectPoint = (homography, point) => {
        const [x, y] = point;
        const denominator = homography[6] * x + homography[7] * y + homography[8];
        if (Math.abs(denominator) < 1e-12) throw new Error('射影先を計算できません');
        return [
            (homography[0] * x + homography[1] * y + homography[2]) / denominator,
            (homography[3] * x + homography[4] * y + homography[5]) / denominator
        ];
    };

    const validCornerOrder = (corners, width, height) => {
        if (!Array.isArray(corners) || corners.length !== 4) return false;
        const points = corners.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
        if (!points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return false;
        const sums = points.map((point) => point.x + point.y);
        if (sums[0] !== Math.min(...sums) || sums[2] !== Math.max(...sums)) return false;
        if (points[1].x <= points[0].x || points[2].y <= points[1].y || points[3].y <= points[0].y) return false;
        let area = 0;
        points.forEach((point, index) => {
            const next = points[(index + 1) % 4];
            area += point.x * next.y - next.x * point.y;
        });
        return Math.abs(area / 2) > width * height * 0.12;
    };

    // 位置合わせマーク4つ（左上→右上→右下→左下）の中心を、ページ正規化座標(0〜10000)で返す。
    // 紙の物理的な角ではなく、商品セルと同じ印刷で刷られたマークを基準にするので、
    // プリンタの拡縮・オフセットが座標に効かない。
    const ANCHOR_KEYS = ['tl', 'tr', 'br', 'bl'];
    const getPageAnchors = (page) => {
        const anchors = page && page.anchors;
        if (!anchors || ANCHOR_KEYS.some((key) => !Array.isArray(anchors[key]) || anchors[key].length !== 4)) {
            throw new Error('位置合わせマークの無い旧発注書です。発注書を再印刷してください（数量は手入力）。');
        }
        const centers = ANCHOR_KEYS.map((key) => {
            const box = anchors[key].map(Number);
            if (!box.every((value) => Number.isFinite(value)) || box[2] < 1 || box[3] < 1) throw new TypeError('位置合わせマークの座標が不正です');
            return [box[0] + box[2] / 2, box[1] + box[3] / 2];
        });
        if (!(centers[0][0] < centers[1][0] && centers[3][0] < centers[2][0] && centers[0][1] < centers[3][1] && centers[1][1] < centers[2][1])) {
            throw new TypeError('位置合わせマークの並びが不正です');
        }
        return centers;
    };

    // 写真上のタップ点を、周囲の暗い画素の重心へ吸着させる。マークの中心を狙う精度を上げ、
    // 暗い画素が無い（紙の角・白地をタップした）場合は null を返して止める。
    // 近くのQRや文字に引っ張られないよう、重心へ窓を移しながら数回絞り込む（mean-shift）。
    // 窓がほぼ全部暗い（机や影をタップ）場合もマークではないので null。
    const snapToDarkCentroid = (imageData, point, radius = 40, threshold = 110, minDarkPixels = 30) => {
        if (!imageData || !imageData.data || !imageData.width || !imageData.height) throw new TypeError('画像データが不正です');
        const { width, height, data } = imageData;
        let cx = Number(point && point.x);
        let cy = Number(point && point.y);
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) throw new TypeError('タップ座標が不正です');
        const centroidIn = (centerX, centerY, windowRadius) => {
            const x0 = Math.max(0, Math.round(centerX - windowRadius));
            const x1 = Math.min(width - 1, Math.round(centerX + windowRadius));
            const y0 = Math.max(0, Math.round(centerY - windowRadius));
            const y1 = Math.min(height - 1, Math.round(centerY + windowRadius));
            let sumX = 0;
            let sumY = 0;
            let count = 0;
            for (let y = y0; y <= y1; y++) {
                for (let x = x0; x <= x1; x++) {
                    const index = (y * width + x) * 4;
                    const luminance = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
                    if (luminance < threshold) {
                        sumX += x;
                        sumY += y;
                        count++;
                    }
                }
            }
            const total = (x1 - x0 + 1) * (y1 - y0 + 1);
            return count ? { x: sumX / count, y: sumY / count, count, total } : { x: centerX, y: centerY, count: 0, total };
        };
        let result = centroidIn(cx, cy, radius);
        if (result.count < minDarkPixels || result.count > result.total * 0.85) return null;
        const tightRadius = Math.max(12, Math.round(radius * 0.6));
        for (let step = 0; step < 6; step++) {
            const next = centroidIn(result.x, result.y, tightRadius);
            if (next.count < minDarkPixels) break;
            const moved = Math.hypot(next.x - result.x, next.y - result.y);
            result = next;
            if (moved < 0.5) break;
        }
        if (result.count < minDarkPixels) return null;
        return { x: result.x, y: result.y, darkPixels: result.count };
    };

    // タップ4点を、targetPoints（ページ正規化座標）へ写像して正面画像を作る。
    // targetPoints省略時はページ四隅（旧: 紙の四隅基準。テスト用に残す）。
    const warpPerspective = (sourceCanvas, corners, outputWidth = 1100, outputHeight = 1556, targetPoints = null) => {
        if (!sourceCanvas || !validCornerOrder(corners, sourceCanvas.width, sourceCanvas.height)) {
            throw new TypeError('位置合わせマークの指定が不正です');
        }
        const output = document.createElement('canvas');
        output.width = outputWidth;
        output.height = outputHeight;
        const outputContext = output.getContext('2d', { willReadFrequently: true });
        const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
        const sourceData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
        const outputData = outputContext.createImageData(outputWidth, outputHeight);
        const destination = Array.isArray(targetPoints) && targetPoints.length === 4
            ? targetPoints.map((point) => [point[0] / 10000 * outputWidth, point[1] / 10000 * outputHeight])
            : [[0, 0], [outputWidth - 1, 0], [outputWidth - 1, outputHeight - 1], [0, outputHeight - 1]];
        const map = computeHomography(destination, corners.map((point) => [point.x, point.y]));
        const src = sourceData.data;
        const dst = outputData.data;
        for (let y = 0; y < outputHeight; y++) {
            const numeratorXBase = map[1] * y + map[2];
            const numeratorYBase = map[4] * y + map[5];
            const denominatorBase = map[7] * y + map[8];
            for (let x = 0; x < outputWidth; x++) {
                const denominator = map[6] * x + denominatorBase;
                const sourceX = Math.max(0, Math.min(sourceCanvas.width - 1, Math.round((map[0] * x + numeratorXBase) / denominator)));
                const sourceY = Math.max(0, Math.min(sourceCanvas.height - 1, Math.round((map[3] * x + numeratorYBase) / denominator)));
                const sourceIndex = (sourceY * sourceCanvas.width + sourceX) * 4;
                const outputIndex = (y * outputWidth + x) * 4;
                dst[outputIndex] = src[sourceIndex];
                dst[outputIndex + 1] = src[sourceIndex + 1];
                dst[outputIndex + 2] = src[sourceIndex + 2];
                dst[outputIndex + 3] = 255;
            }
        }
        outputContext.putImageData(outputData, 0, 0);
        return output;
    };

    const getManifestPage = (manifest, pageNo, expectedClientName) => {
        if (!manifest || ['1.0', '1.1'].indexOf(String(manifest.schema_version)) === -1) throw new TypeError('発注書レイアウト版が不正です');
        if (String(manifest.client_name || '') !== String(expectedClientName || '')) throw new Error('選択中のサロンと発注書が一致しません');
        const page = Array.isArray(manifest.pages)
            ? manifest.pages.find((entry) => Number(entry.page_no) === Number(pageNo))
            : null;
        if (!page || !Array.isArray(page.products) || page.products.length === 0) throw new Error('発注書ページが見つかりません');
        return page;
    };

    const buildContactSheet = (rectifiedCanvas, products) => {
        if (!rectifiedCanvas || !Array.isArray(products) || products.length === 0) throw new TypeError('数量セルがありません');
        const tileWidth = 180;
        const tileHeight = 100;
        const columns = Math.min(4, products.length);
        const rows = Math.ceil(products.length / columns);
        const canvas = document.createElement('canvas');
        canvas.width = columns * tileWidth;
        canvas.height = rows * tileHeight;
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        products.forEach((product, index) => {
            const column = index % columns;
            const row = Math.floor(index / columns);
            const x = column * tileWidth;
            const y = row * tileHeight;
            const source = normalizedBoxToPixels(product.qty_bbox, rectifiedCanvas.width, rectifiedCanvas.height);
            context.fillStyle = '#122f2b';
            context.fillRect(x + 3, y + 3, tileWidth - 6, 23);
            context.fillStyle = '#fff';
            context.font = '800 12px Menlo, monospace';
            context.fillText(product.cell_id, x + 10, y + 19);
            context.strokeStyle = '#64748b';
            context.strokeRect(x + 3, y + 3, tileWidth - 6, tileHeight - 6);
            // マスの内側だけを送る。隣のマスを写すとGeminiが隣の数字を読んでしまう（2026-09-06 v2.40.1で逆効果を確認）。
            // 隣の行からのはみ出し線は、端末側の flagEdgeSpill で除外する。
            context.drawImage(
                rectifiedCanvas,
                source.x,
                source.y,
                source.width,
                source.height,
                x + 9,
                y + 31,
                tileWidth - 18,
                tileHeight - 39
            );
        });
        return canvas;
    };

    // 数量欄のインク分布。枠線を避けて内側を測り、上端・下端の帯と中央帯に分けて暗い画素の割合を返す。
    // 中央がほぼ空で上端か下端だけに線があるなら、隣の行の数字がはみ出したもの（2026-09-06 ひとみ美容室で「4」の縦線を「1」と誤読）。
    const analyzeCellInk = (imageData, bbox) => {
        if (!imageData || !imageData.data) throw new TypeError('画像データが不正です');
        const box = normalizedBoxToPixels(bbox, imageData.width, imageData.height);
        const inset = Math.max(2, Math.round(Math.min(box.width, box.height) * 0.12));
        const x0 = box.x + inset;
        const x1 = Math.min(imageData.width, box.x + box.width - inset);
        const y0 = box.y + inset;
        const y1 = Math.min(imageData.height, box.y + box.height - inset);
        const height = y1 - y0;
        if (x1 - x0 < 4 || height < 6) return { top: 0, core: 0, bottom: 0, total: 0 };
        const luminances = [];
        for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
                const index = (y * imageData.width + x) * 4;
                luminances.push(0.299 * imageData.data[index] + 0.587 * imageData.data[index + 1] + 0.114 * imageData.data[index + 2]);
            }
        }
        const sorted = luminances.slice().sort((a, b) => a - b);
        const paper = sorted[Math.floor(sorted.length * 0.5)];
        const threshold = paper - 60;
        const bandTop = y0 + Math.round(height * 0.25);
        const bandBottom = y1 - Math.round(height * 0.25);
        const counts = { top: 0, core: 0, bottom: 0 };
        const sizes = { top: 0, core: 0, bottom: 0 };
        let i = 0;
        for (let y = y0; y < y1; y++) {
            const band = y < bandTop ? 'top' : y >= bandBottom ? 'bottom' : 'core';
            for (let x = x0; x < x1; x++, i++) {
                sizes[band]++;
                if (luminances[i] < threshold) counts[band]++;
            }
        }
        return {
            top: sizes.top ? counts.top / sizes.top : 0,
            core: sizes.core ? counts.core / sizes.core : 0,
            bottom: sizes.bottom ? counts.bottom / sizes.bottom : 0,
            total: luminances.length ? (counts.top + counts.core + counts.bottom) / luminances.length : 0
        };
    };

    // 記入ありと読まれた行のうち、インクが上端か下端の帯だけにある行は隣の行のはみ出しとみなし、
    // 数量0（除外）にする。行は残すので、本当に記入があれば人が数量を入れ直せる。
    // （黄色の要確認に留めると手で0にする手間が増える、と実機UTで指摘。2026-09-06）
    const flagEdgeSpill = (rows, imageData, products) => {
        const productMap = new Map((products || []).map((product) => [String(product.cell_id), product]));
        rows.forEach((row) => {
            const product = productMap.get(String(row.cell_id));
            if (!product || !product.qty_bbox || !row.quantity) return;
            const ink = analyzeCellInk(imageData, product.qty_bbox);
            const edgeOnly = ink.core < 0.01 && (ink.top > 0.02 || ink.bottom > 0.02);
            if (edgeOnly) {
                row.spill = ink.top >= ink.bottom ? 'top' : 'bottom';
                row.spill_reading = row.raw_reading || String(row.quantity);
                row.confidence = 'low';
                row.quantity = 0;
            }
        });
        return rows;
    };

    const cropRowDataUrl = (rectifiedCanvas, bbox) => {
        const source = normalizedBoxToPixels(bbox, rectifiedCanvas.width, rectifiedCanvas.height);
        const width = 540;
        const height = Math.max(74, Math.round(width * source.height / source.width));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, width, height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(rectifiedCanvas, source.x, source.y, source.width, source.height, 0, 0, width, height);
        return canvas.toDataURL('image/jpeg', 0.88);
    };

    const validateRecognition = (payload, products) => {
        if (!payload || !Array.isArray(payload.cells)) throw new TypeError('認識結果にcells配列がありません');
        const productMap = new Map(products.map((product) => [String(product.cell_id), product]));
        const seen = new Set();
        const cells = payload.cells.map((cell) => {
            const cellId = String(cell && cell.cell_id || '');
            const markType = String(cell && cell.mark_type || '');
            const confidence = String(cell && cell.confidence || '');
            const quantity = cell && cell.quantity !== null ? Number(cell.quantity) : null;
            if (!productMap.has(cellId) || seen.has(cellId)) throw new RangeError('認識結果のセルIDが不正です');
            if (!MARK_TYPES.has(markType) || !CONFIDENCE_LEVELS.has(confidence)) throw new TypeError('認識結果の分類が不正です');
            if (quantity !== null && (!Number.isInteger(quantity) || quantity < 0 || quantity > 999)) throw new RangeError('認識数量が不正です');
            seen.add(cellId);
            return {
                cell_id: cellId,
                mark_type: markType,
                raw_reading: String(cell.raw_reading || '').slice(0, 32),
                quantity,
                confidence
            };
        });
        if (seen.size !== productMap.size) throw new Error('認識結果のセル数が不足しています');
        return cells;
    };

    const buildReviewRows = (products, cells, items) => {
        const productMap = new Map(products.map((product) => [String(product.cell_id), product]));
        const itemMap = new Map((items || []).map((item) => [String(item.code).replace(/^'/, ''), item]));
        return cells
            .filter((cell) => cell.mark_type !== 'blank')
            .map((cell) => {
                const product = productMap.get(cell.cell_id);
                const item = product ? itemMap.get(String(product.product_code)) : null;
                if (!product || !item) throw new Error('商品マスタと発注書の対応が見つかりません');
                return {
                    ...cell,
                    code: String(product.product_code),
                    name: String(item.name || ''),
                    row_bbox: product.row_bbox,
                    quantity: Number.isInteger(cell.quantity) && cell.quantity > 0 ? cell.quantity : null
                };
            });
    };

    return {
        QR_PREFIX,
        makeSheetId,
        makeQrValue,
        parseQrValue,
        parseLegacyQrValue,
        normalizedBoxToPixels,
        computeHomography,
        projectPoint,
        validCornerOrder,
        warpPerspective,
        getManifestPage,
        getPageAnchors,
        snapToDarkCentroid,
        analyzeCellInk,
        flagEdgeSpill,
        buildContactSheet,
        cropRowDataUrl,
        validateRecognition,
        buildReviewRows
    };
}));
