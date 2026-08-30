(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.LineOrderMatch = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const IGNORE_LINE_PATTERNS = [
        /^(いつも)?(お世話になっております|ありがとうございます)$/,
        /^(発注|注文)?(を)?お願いします$/,
        /^(よろしく|宜しく)(お願いします)?$/,
        /^(以上|以上です)$/
    ];
    const UNIT_PATTERN = '(?:本|個|箱|袋|セット|ヶ|ケ|つ|パック|pk|p)';

    const productCode = (product) => String(product && (product.code ?? product.product_code) || '').replace(/^'/, '').trim();
    const productName = (product) => String(product && (product.name ?? product.product_name) || '').trim();
    const productCodeVariants = (product) => {
        const code = productCode(product);
        return /^\d{6}$/.test(code) ? [code, `0${code}`] : [code];
    };

    const normalizeOrderName = (value) => String(value || '')
        .normalize('NFKC')
        .replace(/[ぁ-ゖ]/g, (character) => String.fromCharCode(character.charCodeAt(0) + 0x60))
        .toLowerCase()
        .replace(/ナンバー/g, 'no')
        .replace(/番/g, '')
        .replace(/[\s　\-―‐_\/\\.,:;：・･()（）【】\[\]「」『』]/g, '');

    const applyAliases = (normalized) => {
        let value = normalized;
        value = value.replace(/アジアンカラー(?!フェス)/g, 'アジアンカラーフェス');
        value = value.replace(/^(?:n)?プライム/, 'nカラーストーリープライム');
        value = value.replace(/^blカラー(?=[0-9])/, 'blカラーラディーチェ');
        value = value.replace(/^(?:クオルシア)?(?:紫|ムラサキ)シャンプー/, 'クオルシアカラーシャンプーパープル');
        value = value.replace(/^クオルシア紫/, 'クオルシアカラーシャンプーパープル');
        value = value.replace(/^ラメラメ(?:no)?(?=[123])/, 'ザラメラメno');
        return value;
    };

    const parseOrderLine = (rawLine) => {
        const sourceText = String(rawLine || '').trim();
        if (!sourceText) return { ignored: true, source_text: sourceText };
        const ignoreComparable = sourceText
            .normalize('NFKC')
            .toLowerCase()
            .replace(/[!！?？。\s　]+$/g, '')
            .replace(/[\s　]/g, '');
        if (IGNORE_LINE_PATTERNS.some((pattern) => pattern.test(ignoreComparable))) {
            return { ignored: true, source_text: sourceText };
        }

        const normalizedWidth = sourceText.normalize('NFKC').replace(/^[\s　]*[・●■□◆◇▶▷※\-]+\s*/, '').trim();
        const quantityPattern = new RegExp(`(?:[×xX✕*]\\s*(\\d{1,3})|(\\d{1,3})\\s*${UNIT_PATTERN}|(?:数量|qty)\\s*[:：]?\\s*(\\d{1,3}))\\s*$`, 'i');
        let match = normalizedWidth.match(quantityPattern);
        if (!match) match = normalizedWidth.match(/\s+(\d{1,3})\s*$/);
        const quantity = match ? Number(match[1] || match[2] || match[3]) : null;
        const nameText = (match ? normalizedWidth.slice(0, match.index) : normalizedWidth)
            .replace(/[\s　]*(?:を|で)\s*$/, '')
            .trim();

        return {
            ignored: false,
            source_text: sourceText,
            name_text: nameText,
            normalized_name: applyAliases(normalizeOrderName(nameText)),
            quantity: Number.isInteger(quantity) && quantity >= 1 && quantity <= 999 ? quantity : null
        };
    };

    const bigrams = (value) => {
        const result = [];
        for (let index = 0; index < value.length - 1; index += 1) result.push(value.slice(index, index + 2));
        return result;
    };

    const diceScore = (left, right) => {
        if (left === right) return 1;
        if (left.length < 2 || right.length < 2) return 0;
        const counts = new Map();
        bigrams(left).forEach((gram) => counts.set(gram, (counts.get(gram) || 0) + 1));
        let overlap = 0;
        bigrams(right).forEach((gram) => {
            if ((counts.get(gram) || 0) > 0) {
                overlap += 1;
                counts.set(gram, counts.get(gram) - 1);
            }
        });
        return (2 * overlap) / (left.length + right.length - 2);
    };

    const modelTokens = (value) => value.match(/[a-z]*\d+[a-z%]*/g) || [];
    const conflictingModelToken = (query, product) => {
        const queryTokens = modelTokens(query);
        if (!queryTokens.length) return false;
        const productTokens = modelTokens(product);
        return queryTokens.some((token) => !productTokens.includes(token));
    };

    const scoreOrderCandidate = (query, product) => {
        const name = product.normalized_name || normalizeOrderName(productName(product));
        if (!query || !name) return 0;
        if (query === name) return 1;
        if (name.includes(query) || query.includes(name)) return 0.96;
        if (conflictingModelToken(query, name)) return 0;
        return diceScore(query, name);
    };

    const rankCandidates = (query, products) => products
        .map((product) => {
            const rawScore = scoreOrderCandidate(query, product);
            return {
                product,
                raw_score: rawScore,
                ranked_score: rawScore + (product.favorite ? 0.04 : 0)
            };
        })
        .filter((candidate) => candidate.raw_score >= 0.34)
        .sort((left, right) => right.ranked_score - left.ranked_score
            || productCode(left.product).localeCompare(productCode(right.product)));

    const matchOrderLine = (parsedLine, products) => {
        if (parsedLine.ignored) return { ...parsedLine, status: 'ignored' };
        const explicitCode = parsedLine.name_text.match(/(?:code|コード|商品コード)\s*[:#-]?\s*([0-9]{5,10})/i)
            || parsedLine.name_text.match(/^([0-9]{5,10})$/);
        if (explicitCode) {
            const product = products.find((item) => productCodeVariants(item).includes(String(explicitCode[1])));
            if (product) {
                return {
                    ...parsedLine,
                    status: parsedLine.quantity ? 'matched' : 'needs_input',
                    product,
                    confidence: 'high',
                    reason: product.favorite ? 'お気に入り・商品コード一致' : '全商品・商品コード一致',
                    candidates: [product]
                };
            }
        }

        const ranked = rankCandidates(parsedLine.normalized_name, products);
        const best = ranked[0];
        const second = ranked[1];
        const margin = best ? best.raw_score - (second?.raw_score || 0) : 0;
        const unique = best && (
            best.raw_score >= 0.99
            || (best.raw_score >= 0.94 && margin >= 0.02)
            || (best.raw_score >= 0.76 && margin >= 0.08)
        );
        if (unique) {
            const aliasUsed = normalizeOrderName(parsedLine.name_text) !== parsedLine.normalized_name;
            const source = best.product.favorite ? 'お気に入り' : '全商品';
            const reason = aliasUsed ? `${source}・別名一致` : best.raw_score >= 0.94 ? `${source}一致` : `${source}・近似一致`;
            return {
                ...parsedLine,
                status: parsedLine.quantity ? 'matched' : 'needs_input',
                product: best.product,
                confidence: best.raw_score >= 0.94 && !aliasUsed ? 'high' : 'medium',
                reason,
                candidates: ranked.slice(0, 3).map((candidate) => candidate.product)
            };
        }
        return {
            ...parsedLine,
            status: 'needs_choice',
            product: null,
            confidence: 'low',
            reason: ranked.length ? '候補が複数あります' : '一致する商品がありません',
            candidates: ranked.slice(0, 3).map((candidate) => candidate.product)
        };
    };

    const matchOrderLineWithFallback = (parsedLine, favoriteProducts, allProducts) => {
        const favoriteResult = matchOrderLine(parsedLine, favoriteProducts);
        if (favoriteResult.status === 'ignored' || favoriteResult.product || allProducts === favoriteProducts) return favoriteResult;
        const allResult = matchOrderLine(parsedLine, allProducts);
        if (allResult.product) return allResult;
        return {
            ...allResult,
            reason: allResult.candidates.length ? 'お気に入り優先・全商品から候補' : '全商品に一致しません'
        };
    };

    const parseLineOrderText = (text, favoriteProducts, allProducts = favoriteProducts) => {
        const startedAt = performance.now();
        const lines = String(text || '').slice(0, 4000).split(/\r?\n/);
        const parsed = lines.map(parseOrderLine);
        return {
            entries: parsed.filter((line) => !line.ignored)
                .map((line) => matchOrderLineWithFallback(line, favoriteProducts, allProducts)),
            ignored: parsed.filter((line) => line.ignored).length,
            elapsed_ms: performance.now() - startedAt
        };
    };

    const searchProducts = (searchText, products, limit = 50) => {
        const query = applyAliases(normalizeOrderName(searchText));
        if (!query) return [];
        const codeQuery = query.match(/\d{5,10}/)?.[0] || query;
        const exactCodes = products.filter((product) => productCodeVariants(product).includes(codeQuery));
        if (exactCodes.length) return exactCodes.slice(0, Math.max(1, limit));

        return products
            .map((product) => {
                const code = productCodeVariants(product).find((variant) => variant.includes(codeQuery)) || productCode(product);
                const name = product.normalized_name || normalizeOrderName(productName(product));
                let score = 0;
                if (code.includes(codeQuery)) score = 4;
                else if (name === query) score = 3.5;
                else if (name.startsWith(query)) score = 3;
                else if (name.includes(query)) score = 2.5 + Math.min(query.length / Math.max(name.length, 1), 0.49);
                else if (query.length >= 3 && !conflictingModelToken(query, name)) score = diceScore(query, name);
                return { product, score, ranked_score: score + (product.favorite ? 0.2 : 0) };
            })
            .filter((candidate) => candidate.score >= (query.length >= 3 ? 0.42 : 2.5))
            .sort((left, right) => right.ranked_score - left.ranked_score
                || productName(left.product).localeCompare(productName(right.product), 'ja'))
            .slice(0, Math.max(1, limit))
            .map((candidate) => candidate.product);
    };

    return {
        normalizeOrderName,
        parseOrderLine,
        parseLineOrderText,
        matchOrderLine,
        matchOrderLineWithFallback,
        searchProducts,
        productCode,
        productCodeVariants,
        productName
    };
}));
