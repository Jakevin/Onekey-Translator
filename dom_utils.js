// Lightweight port of dom.ts text-detection helpers for MV3 (no bundler)
// Exposes: window.DomUtils with grabAllNode, grabNode, checkTextSize, isMainlyNumericContent
// Style: 4 spaces indent; single quotes; semicolons.

(function () {
    'use strict';

    // Directly translatable block-like tags
    const directSet = new Set([
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'p', 'li', 'dd', 'blockquote', 'figcaption'
    ]);

    // Tags to skip
    const skipSet = new Set([
        'html', 'body', 'script', 'style', 'noscript', 'iframe',
        'input', 'textarea', 'select', 'button', 'code', 'pre'
    ]);

    // Inline elements set
    const inlineSet = new Set([
        'a', 'b', 'strong', 'span', 'em', 'i', 'u', 'small', 'sub', 'sup',
        'font', 'mark', 'cite', 'q', 'abbr', 'time', 'ruby', 'bdi', 'bdo',
        'img', 'br', 'wbr', 'svg'
    ]);

    function checkTextSize(node) {
        try {
            const txt = (node.textContent || '').trim();
            if (txt.length > 3072) return true;
            if (node.outerHTML && node.outerHTML.length > 4096) return true;
            if (txt.length < 3) return true;
        } catch (e) { /* noop */ }
        return false;
    }

    function isUserIdentifier(text) {
        if (!text || typeof text !== 'string') return false;
        const trimmedText = text.trim();
        if (!trimmedText) return false;
        if (/^@\w+/.test(trimmedText)) return true;               // @username
        if (/^u\/\w+/.test(trimmedText)) return true;            // Reddit: u/username
        if (/^id@https?:\/\/(x\.com|twitter\.com)\/[\w-]+\/status\/\d+/.test(trimmedText)) return true;
        if ((/关注|關注|Follow/i.test(trimmedText)) && trimmedText.length < 50) return true;
        if (/^[A-Za-z0-9_]{1,15}$/.test(trimmedText)) return true; // simple username pattern
        if (/点击|點擊/.test(trimmedText) && trimmedText.length < 50) return true;
        return false;
    }

    function isNumericContent(text) {
        if (!text || typeof text !== 'string') return false;
        const trimmedText = text.trim();
        if (!trimmedText) return false;
        if (isUserIdentifier(trimmedText)) return true;
        if (/\s+/.test(trimmedText.replace(/[\d,.\-%+]/g, ''))) return false;
        if (/^-?\d+$/.test(trimmedText)) return true;                                         // integer
        if (/^-?(\d{1,3}(,\d{3})+)$/.test(trimmedText)) return true;                         // thousand sep
        if (/^\d+\s*[-~]\s*\d+$/.test(trimmedText)) return true;                           // range
        if (/^-?\d+\.\d+$/.test(trimmedText)) return true;                                  // decimal
        if (/^-?\d+(\.\d+)?%$/.test(trimmedText)) return true;                              // percentage
        if (/^-?\d+(\.\d+)?(e[-+]\d+)?$/i.test(trimmedText)) return true;                  // scientific
        if (/^[$€¥£₹₽₩]?\s*-?\d+(,\d{3})*(\.\d+)?$/.test(trimmedText)) return true;       // currency
        if (/^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|\d{1,2}[-/]\d{1,2}[-/]\d{1,2})$/.test(trimmedText)) return true; // date
        if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmedText)) return true;                      // time
        if (/^\d+(\.\d+){1,3}(-[a-zA-Z0-9]+)?$/.test(trimmedText)) return true;            // version
        if (/^id@https?:\/\/(x\.com|twitter\.com)\/[\w-]+\/status\/\d+/.test(trimmedText)) return true; // id@x.com/...
        if (/^ID[:：]?\s*\d+$/.test(trimmedText)) return true;
        if (/^No[\.:]?\s*\d+$/i.test(trimmedText)) return true;
        if (/^#\d+$/.test(trimmedText)) return true;                                         // #123
        return false;
    }

    function isMainlyNumericContent(node) {
        if (!node) return false;
        try {
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
            const texts = [];
            let t;
            while ((t = walker.nextNode())) {
                const s = (t.textContent || '').trim();
                if (s) texts.push(s);
            }
            if (texts.length === 0) return false;
            if (texts.length === 1 && isNumericContent(texts[0])) return true;
            if (texts.every(isNumericContent)) return true;
        } catch (e) { /* noop */ }
        return false;
    }

    function shouldSkipNode(node, tag) {
        try {
            if (skipSet.has(tag)) return true;
            if (node.classList && node.classList.contains('notranslate')) return true;
            if (node.isContentEditable) return true;
            if (checkTextSize(node)) return true;
            if (isMainlyNumericContent(node)) return true;
        } catch (e) { /* noop */ }
        return false;
    }

    function isSkippable(node) {
        if (!node || !node.tagName) return false;
        const tag = (node.tagName || '').toLowerCase();
        return shouldSkipNode(node, tag);
    }

    function isContentWhitelist(el) {
        try {
            const tag = (el && el.tagName ? el.tagName : '').toUpperCase();
            if (tag && /^H[1-6]$/.test(tag)) return true;
            const dtid = (el && el.getAttribute && el.getAttribute('data-testid')) || '';
            if (/(headline|title|tweetText)/i.test(dtid)) return true;
        } catch (e) { /* noop */ }
        return false;
    }

    function isButton(node, tag) {
        return tag === 'button' || (tag === 'span' && node.parentNode && (node.parentNode.tagName || '').toLowerCase() === 'button');
    }

    function handleButtonTranslation(node) {
        // No-op in this extension: buttons are not paragraph targets
        return;
    }

    function detectChildMeta(parent) {
        let child = parent && parent.firstChild;
        while (child) {
            if (child.nodeType === Node.ELEMENT_NODE && !inlineSet.has((child.nodeName || '').toLowerCase())) {
                return false;
            }
            child = child.nextSibling;
        }
        return true;
    }

    function isInlineElement(node, tag) {
        return inlineSet.has(tag) || node.nodeType === Node.TEXT_NODE || detectChildMeta(node);
    }

    function findTranslatableParent(node) {
        if (!node || !node.parentNode) return node;
        const res = grabNode(node.parentNode);
        return res || node;
    }

    function handleFirstLineText(node) {
        let child = node && node.firstChild;
        while (child) {
            if (child.nodeType === Node.TEXT_NODE && (child.textContent || '').trim()) {
                return node;
            }
            child = child.nextSibling;
        }
        return false;
    }

    function grabNode(node) {
        if (!node) return false;
        if (node instanceof Text) {
            const parentOrSelf = findTranslatableParent(node);
            if (parentOrSelf && parentOrSelf !== node) return parentOrSelf;
            return false;
        }
        if (!node.tagName) return false;
        const curTag = (node.tagName || '').toLowerCase();

        if (shouldSkipNode(node, curTag)) return false;

        // site-specific compatibility intentionally omitted in this MV3 port

        if (directSet.has(curTag)) return node;

        if (isButton(node, curTag)) {
            handleButtonTranslation(node);
            return false;
        }

        if (isInlineElement(node, curTag)) {
            return findTranslatableParent(node);
        }

        if (curTag === 'div' || curTag === 'label') {
            return handleFirstLineText(node);
        }

        return false;
    }

    function grabAllNode(rootNode) {
        if (!rootNode) return [];
        const result = [];
        try {
            const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    if (node instanceof Text) return NodeFilter.FILTER_ACCEPT;
                    if (!(node instanceof Element)) return NodeFilter.FILTER_SKIP;
                    const tag = (node.tagName || '').toLowerCase();
                    if (skipSet.has(tag) || (node.classList && (node.classList.contains('sr-only') || node.classList.contains('notranslate')))) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    if (tag === 'header' || tag === 'footer') return NodeFilter.FILTER_REJECT;
                    let hasText = false, hasElement = false, hasNonEmptyElement = false;
                    const cn = node.childNodes || [];
                    for (let i = 0; i < cn.length; i++) {
                        const child = cn[i];
                        if (child.nodeType === Node.ELEMENT_NODE) {
                            hasElement = true;
                            if ((child.textContent || '').trim()) hasNonEmptyElement = true;
                        }
                        if (child.nodeType === Node.TEXT_NODE && (child.textContent || '').trim()) hasText = true;
                    }
                    if (hasNonEmptyElement) return NodeFilter.FILTER_SKIP;
                    if (hasText && !hasElement) return NodeFilter.FILTER_ACCEPT;
                    if (node.childNodes && node.childNodes.length > 0) return NodeFilter.FILTER_SKIP;
                    return NodeFilter.FILTER_REJECT;
                }
            });
            let current;
            while ((current = walker.nextNode())) {
                const translateNode = grabNode(current);
                if (translateNode) {
                    result.push(translateNode);
                }
            }
        } catch (e) { /* noop */ }
        return Array.from(new Set(result));
    }

    window.DomUtils = {
        grabAllNode: grabAllNode,
        grabNode: grabNode,
        checkTextSize: checkTextSize,
        isMainlyNumericContent: isMainlyNumericContent,
        isSkippable: isSkippable,
        isContentWhitelist: isContentWhitelist,
        inlineSet: inlineSet,
        directSet: directSet,
        skipSet: skipSet
    };
})();
