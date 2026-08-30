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

    const warpPerspective = (sourceCanvas, corners, outputWidth = 1100, outputHeight = 1556) => {
        if (!sourceCanvas || !validCornerOrder(corners, sourceCanvas.width, sourceCanvas.height)) {
            throw new TypeError('用紙の四隅が不正です');
        }
        const output = document.createElement('canvas');
        output.width = outputWidth;
        output.height = outputHeight;
        const outputContext = output.getContext('2d', { willReadFrequently: true });
        const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
        const sourceData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
        const outputData = outputContext.createImageData(outputWidth, outputHeight);
        const destination = [[0, 0], [outputWidth - 1, 0], [outputWidth - 1, outputHeight - 1], [0, outputHeight - 1]];
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
        if (!manifest || manifest.schema_version !== '1.0') throw new TypeError('発注書レイアウト版が不正です');
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
        buildContactSheet,
        cropRowDataUrl,
        validateRecognition,
        buildReviewRows
    };
}));
