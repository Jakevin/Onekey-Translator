let globalTargetElement = null;
let originScrollX = 0;
let originScrollY = 0;
let originPositionX = 0;
let originPositionY = 0;
let scrollingElement = window;
let scrollPropertyX = "pageXOffset";
let scrollPropertyY = "pageYOffset";

let hasButtonShown = false;
const DEBUG = false;

let targetLang = 'us-en 美式英文';
let apiBaseUrl = 'https://api.openai.com/v1/chat/completions';
let apiKey = '';
let apiModel = 'gpt-5-mini';
let hotKey = 'altKey';
let paragraphModeActive = false; // 已不再透過主按鈕點擊切換，僅保留變數以兼容
let paraMinChars = 20;
let keepParaButtons = false; // 是否顯示「…」按鈕（顯示/隱藏）
let translateAllActive = false; // 是否啟用「全部翻譯」捲動監聽
let translateAllTimer = null;
let translateAllRunning = false;

// ===== 唯一配對：每個段落一個 uid，按鈕透過 data-jk-for 指向，避免重複新增 =====
let jkUidSeq = 1;
function ensureElementUid(el) {
    try {
        if (el && el.dataset && !el.dataset.jkUid) {
            el.dataset.jkUid = 'u' + (jkUidSeq++);
        }
    } catch {}
}
function segKey(text) {
    try {
        const s = (text || '').toString();
        let h = 0;
        for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
        return 's' + (h % 1000000007);
    } catch { return 's0'; }
}

// ===== i18n helper =====
function ct(key, subs) {
    try {
        if (!chrome.i18n || !chrome.i18n.getMessage) return key;
        if (subs !== undefined) return chrome.i18n.getMessage(key, subs);
        return chrome.i18n.getMessage(key) || key;
    } catch { return key; }
}

async function loadSettingsFromProfiles() {
    try {
        const base = await chrome.storage.sync.get(['activeProfileId', 'hotKey', 'paraMinChars', 'targetLang']);
        const activeId = base.activeProfileId;
        const hk = base.hotKey;
        const pmc = base.paraMinChars;
        const globalTL = base.targetLang;
        let profile = null;
        if (activeId) {
            const obj = await chrome.storage.sync.get([`profile:${activeId}`]);
            profile = obj[`profile:${activeId}`] || null;
        }
        if (profile) {
            // targetLang 與 profile 無關：優先採用全域設定，其次回退 profile 舊值
            targetLang = globalTL || profile.targetLang || 'us-en 美式英文';
            apiBaseUrl = (profile.api && profile.api.baseUrl) || 'https://api.openai.com/v1/chat/completions';
            apiKey = (profile.api && profile.api.key) || '';
            apiModel = (profile.api && profile.api.model) || 'gpt-5-mini';
            hotKey = hk || 'altKey';
            paraMinChars = (typeof pmc === 'number' && !isNaN(pmc)) ? pmc : 20;
            return;
        }
        // fallback to legacy keys
        const legacy = await chrome.storage.sync.get(['targetLang', 'apiBaseUrl', 'apiKey', 'apiModel', 'hotKey', 'paraMinChars']);
        targetLang = legacy.targetLang || 'us-en 美式英文';
        apiBaseUrl = legacy.apiBaseUrl || 'https://api.openai.com/v1/chat/completions';
        apiKey = legacy.apiKey || '';
        apiModel = legacy.apiModel || 'gpt-5-mini';
        hotKey = legacy.hotKey || 'altKey';
        paraMinChars = (typeof legacy.paraMinChars === 'number' && !isNaN(legacy.paraMinChars)) ? legacy.paraMinChars : 20;
    } catch (e) {
        console.warn('loadSettingsFromProfiles failed, using defaults', e);
    }
}

function loadSettings() {
    // 與 options.js 同步：優先讀取 activeProfile 下的設定
    loadSettingsFromProfiles();
}

// 加載用戶設置
loadSettings()


let mousedownEvent = null
// 統一掃描與額外區塊選擇器
const SELECTORS = {
    base: 'p, li, dd, blockquote, h1, h2, h3, h4, h5, h6, article p, section p, [data-testid="tweetText"]',
    extraRoots: '#ranking-social, .module_aside--content'
};

// ===== 參考 dom.ts 的判斷：集合定義 =====
// 直接翻譯的標籤（塊級語義）
const DOMTS_DIRECT_SET = new Set(['h1','h2','h3','h4','h5','h6','p','li','dd','blockquote','figcaption']);
// 跳過的標籤
const DOMTS_SKIP_SET = new Set(['html','body','script','style','noscript','iframe','input','textarea','select','button','code','pre']);
// 內聯元素集合
const DOMTS_INLINE_SET = new Set(['a','b','strong','span','em','i','u','small','sub','sup','font','mark','cite','q','abbr','time','ruby','bdi','bdo','img','br','wbr','svg']);
const altKeyClick = (kyEvent) => {
    if (DEBUG) console.log('Key:', kyEvent.key);
    if (kyEvent[hotKey]) {
        try {
            const sel = window.getSelection();
            const text = (sel && sel.rangeCount > 0) ? sel.getRangeAt(0).toString().trim() : '';
            let rect = null;
            if (sel && sel.rangeCount > 0 && text) {
                try {
                    const range = sel.getRangeAt(0);
                    const clientRects = range.getClientRects ? Array.from(range.getClientRects()) : [];
                    const nonZero = clientRects.filter(r => (r.width > 0) || (r.height > 0));
                    rect = (nonZero.length > 0) ? nonZero[nonZero.length - 1] : range.getBoundingClientRect();
                } catch { rect = null; }
                translateToPopup(text, rect);
            } else if (mousedownEvent && mousedownEvent.target && mousedownEvent.target.innerText) {
                const fallbackText = (mousedownEvent.target.innerText || '').trim();
                // 以滑鼠位置作為定位
                rect = { right: mousedownEvent.clientX, bottom: mousedownEvent.clientY, width: 1, height: 1 };
                translateToPopup(fallbackText, rect);
            }
        } catch { }
    }
    document.removeEventListener('keydown', altKeyClick);
}



// 在頁面加載時創建翻譯按鈕並綁定事件
document.addEventListener("mousedown", (event) => {
    hideTranslateButton();

    mousedownEvent = event;
    document.addEventListener('keydown', altKeyClick);
    detectSelect(document, (event) => {
        if (DEBUG) console.log('Selecting... showTranslateButton');
        showTranslateButton(event);
    });
});

document.addEventListener("dblclick", (event) => {
    hideTranslateButton();
    mousedownEvent = event;
    showTranslateButton(event, true);
});

document.addEventListener("click", (event) => {
    // triple click
    if (event.detail === 3) {
        showTranslateButton(event, true);
    }
});

// ===== 段落翻譯模式（掃描整頁並在段落後加入按鈕） =====
function createParagraphToggleButton() {
    if (document.getElementById('jk-para-toggle')) return;
    const btn = document.createElement('button');
    btn.id = 'jk-para-toggle';
    btn.textContent = '';
    btn.title = '段落翻譯';
    btn.setAttribute('aria-label', '段落翻譯');
    Object.assign(btn.style, {
        position: 'fixed',
        right: '20px',
        zIndex: '1002',
        width: '40px',
        height: '40px',
        backgroundColor: '#ffffff',
        backgroundImage: 'url(' + chrome.runtime.getURL('icons/icon48.png') + ')',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
        backgroundSize: '24px 24px',
        color: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        padding: '0',
        fontSize: '0',
        cursor: 'pointer',
        boxShadow: '0px 2px 6px rgba(0,0,0,0.2)',
        opacity: '0.5',
        touchAction: 'none'
    });
    // 初始位置等效於 bottom: 90px
    try {
        const initialTop = Math.max(10, window.innerHeight - 90 - 40);
        btn.style.top = initialTop + 'px';
    } catch { }

    // 垂直拖動（Y 軸）
    let dragInfo = null;
    let draggedBeyondThreshold = false;
    const DRAG_THRESHOLD = 3; // px
    const onPointerMove = (ev) => {
        if (!dragInfo) return;
        const dy = ev.clientY - dragInfo.startClientY;
        if (Math.abs(dy) > DRAG_THRESHOLD) draggedBeyondThreshold = true;
        let newTop = dragInfo.startTop + dy;
        const minTop = 10;
        const maxTop = window.innerHeight - btn.offsetHeight - 10;
        newTop = Math.max(minTop, Math.min(maxTop, newTop));
        btn.style.top = newTop + 'px';
        btn.style.bottom = 'auto';
        ev.preventDefault();
    };
    const onPointerUp = (ev) => {
        if (!dragInfo) return;
        try { btn.releasePointerCapture(dragInfo.pointerId); } catch { }
        document.removeEventListener('pointermove', onPointerMove, true);
        document.removeEventListener('pointerup', onPointerUp, true);
        document.removeEventListener('pointercancel', onPointerUp, true);
        dragInfo = null;
    };
    btn.addEventListener('pointerdown', (ev) => {
        // 僅處理左鍵/觸控
        if (ev.button !== undefined && ev.button !== 0) return;
        draggedBeyondThreshold = false;
        const rect = btn.getBoundingClientRect();
        const computedTop = parseFloat(btn.style.top || rect.top);
        dragInfo = {
            startClientY: ev.clientY,
            startTop: isNaN(computedTop) ? rect.top : computedTop,
            pointerId: ev.pointerId
        };
        try { btn.setPointerCapture(ev.pointerId); } catch { }
        document.addEventListener('pointermove', onPointerMove, true);
        document.addEventListener('pointerup', onPointerUp, true);
        document.addEventListener('pointercancel', onPointerUp, true);
    }, true);
    // 取消主按鈕 click 切換功能，改由懸浮選單控制（顯示…／隱藏…／全部翻譯）

    // 滑鼠靠近時顯示功能選單
    btn.addEventListener('mouseenter', () => showParaToggleMenu(btn));
    btn.addEventListener('mouseleave', () => scheduleHideParaToggleMenu());
    document.body.appendChild(btn);
}

function visibleAndBlockLike(el) {
    const style = window.getComputedStyle(el);
    if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
    if (style.display === 'inline') return false;
    if (el.offsetWidth + el.offsetHeight === 0) return false;
    return true;
}

// 嘗試鎖定主要內容容器，避免掃描到網站導覽/頁頭
let _jkContentRoot = null;
function getContentRoot() {
    try {
        // 若尚未鎖定內容根、或仍為 body，嘗試重新偵測
        if (_jkContentRoot && _jkContentRoot.isConnected && _jkContentRoot !== document.body) return _jkContentRoot;
        const candidates = [
            'main[role="main"]', 'main', '[role="main"]',
            '#mw-content-text', '.mw-parser-output', '.mw-body-content',
            '.vector-body', '#content', '#bodyContent',
            '#main-content', '#primary', '#primaryContent', '#primary-content',
            'article'
        ];
        for (const sel of candidates) {
            const el = document.querySelector(sel);
            if (el && (el.innerText || '').trim().length > 0) {
                _jkContentRoot = el;
                return _jkContentRoot;
            }
        }
    } catch { }
    _jkContentRoot = document.body;
    return _jkContentRoot;
}

function isInNonContent(el) {
    try {
        let cur = el;
        while (cur && cur !== document.body) {
            const tag = (cur.tagName || '').toUpperCase();
            if (tag === 'HEADER' || tag === 'NAV' || tag === 'FOOTER') return true;
            const role = (cur.getAttribute && cur.getAttribute('role')) || '';
            if (/^(navigation|banner|complementary|search|menu|menubar|toolbar)$/i.test(role)) return true;
            const cls = (cur.className || '').toString();
            if (/(header|navbar|nav|menu|sidebar|footer|vector-header-container|vector-header|vector-menu|vector-dropdown|vector-unpinned|vector-pinnable|mw-portlet|vector-appearance|vector-user|vector-main-menu|vector-search|mw-header|mw-logo)/i.test(cls)) return true;
            cur = cur.parentElement;
        }
    } catch { }
    return false;
}

function isContentWhitelist(el) {
    try {
        const tag = (el.tagName || '').toUpperCase();
        // 針對標題文字（常為卡片標題）放寬限制
        if (tag && /^H[1-6]$/.test(tag)) return true;
        const dtid = (el.getAttribute && el.getAttribute('data-testid')) || '';
        // Twitter 主要貼文文字容器
        if (/(headline|title|tweetText)/i.test(dtid)) return true;
    } catch { }
    return false;
}

function inViewport(el, margin = 200) {
    try {
        const r = el.getBoundingClientRect();
        if (!r) return false;
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        if (r.width === 0 && r.height === 0) return false;
        return (r.bottom >= -margin) && (r.top <= vh + margin) && (r.right >= -50) && (r.left <= vw + 50);
    } catch {
        return false;
    }
}

function isVisible(el) {
    try {
        const st = window.getComputedStyle(el);
        if (!st || st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') === 0) return false;
        if ((el.offsetWidth + el.offsetHeight) === 0) {
            const r = el.getBoundingClientRect();
            if (!r || (r.width === 0 && r.height === 0)) return false;
        }
        return true;
    } catch { return false; }
}

// ===== dom.ts 檢測邏輯：數字/ID/長度判斷 =====
function checkTextSizeForElement(node) {
    try {
        const txt = (node.textContent || '').trim();
        if (txt.length > 3072) return true;
        if (node.outerHTML && node.outerHTML.length > 4096) return true;
        if (txt.length < 3) return true;
    } catch { }
    return false;
}

function isUserIdentifier(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmedText = text.trim();
    if (!trimmedText) return false;
    // 社交帳號常見格式
    if (/^@\w+/.test(trimmedText)) return true;        // @username
    if (/^u\/\w+/.test(trimmedText)) return true;     // u/username (Reddit)
    // x.com / twitter.com 貼文ID樣式
    if (/^id@https?:\/\/(x\.com|twitter\.com)\/[\w-]+\/status\/\d+/.test(trimmedText)) return true;
    // 關注/Follow 類短語（限短字串，避免誤殺長句）
    if ((/关注|關注|Follow/i.test(trimmedText)) && trimmedText.length < 50) return true;
    // 純由英數底線構成的可能用戶名
    if (/^[A-Za-z0-9_]{1,15}$/.test(trimmedText)) return true;
    // 帶動詞提示的點擊式用戶名，限制長度
    if (/点击|點擊/.test(trimmedText) && trimmedText.length < 50) return true;
    return false;
}

function isNumericContent(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmedText = text.trim();
    if (!trimmedText) return false;
    // 先判定是否為用戶識別
    if (isUserIdentifier(trimmedText)) return true;
    // 包含非數字符且形成多詞內容則視為非純數字
    if (/\s+/.test(trimmedText.replace(/[\d,.\-%+]/g, ''))) return false;
    // 整數
    if (/^-?\d+$/.test(trimmedText)) return true;
    // 千分位
    if (/^-?(\d{1,3}(,\d{3})+)$/.test(trimmedText)) return true;
    // 範圍
    if (/^\d+\s*[-~]\s*\d+$/.test(trimmedText)) return true;
    // 小數
    if (/^-?\d+\.\d+$/.test(trimmedText)) return true;
    // 百分比
    if (/^-?\d+(\.\d+)?%$/.test(trimmedText)) return true;
    // 科學記號
    if (/^-?\d+(\.\d+)?(e[-+]\d+)?$/i.test(trimmedText)) return true;
    // 金額
    if (/^[$€¥£₹₽₩]?\s*-?\d+(,\d{3})*(\.\d+)?$/.test(trimmedText)) return true;
    // 日期（常見數字型）
    if (/^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|\d{1,2}[-/]\d{1,2}[-/]\d{1,2})$/.test(trimmedText)) return true;
    // 時間
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmedText)) return true;
    // 版本號
    if (/^\d+(\.\d+){1,3}(-[a-zA-Z0-9]+)?$/.test(trimmedText)) return true;
    // 社媒ID樣式
    if (/^id@https?:\/\/(x\.com|twitter\.com)\/[\w-]+\/status\/\d+/.test(trimmedText)) return true;
    // 常見數字ID
    if (/^ID[:：]?\s*\d+$/.test(trimmedText)) return true;
    if (/^No[\.:]?\s*\d+$/i.test(trimmedText)) return true;
    // #數字
    if (/^#\d+$/.test(trimmedText)) return true;
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
    } catch { }
    return false;
}

// 通用候選蒐集：以可見、在視窗範圍、字數門檻為準，不依賴站點白名單
function collectGenericTextBlocks(root) {
    const MAX_NODES = 3000; // 上限以避免大頁面卡頓
    const candidates = [];
    let scanned = 0;
    try {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
            acceptNode(node) {
                if (scanned++ > MAX_NODES) return NodeFilter.FILTER_REJECT;
                // 跳過已知不處理的標籤
                const tag = (node.tagName || '').toLowerCase();
                const skip = new Set(['script', 'style', 'noscript', 'input', 'textarea', 'select', 'button', 'code', 'pre', 'svg', 'canvas', 'math', 'form']);
                if (skip.has(tag)) return NodeFilter.FILTER_REJECT;
                // 不翻譯標記
                try { if (node.classList && node.classList.contains('notranslate')) return NodeFilter.FILTER_REJECT; } catch {}
                // 跳過我們自己的 UI
                if (node.closest && (node.closest('#jk-para-toggle') || node.closest('#translate-button') || node.closest('#jk-toast'))) {
                    return NodeFilter.FILTER_REJECT;
                }
                // 跳過隱藏與非內容區域
                const ariaHidden = node.getAttribute && node.getAttribute('aria-hidden');
                if (ariaHidden === 'true') return NodeFilter.FILTER_REJECT;
                if (!isVisible(node)) return NodeFilter.FILTER_SKIP;
                if (!inViewport(node, 250)) return NodeFilter.FILTER_SKIP;
                if (node.isContentEditable) return NodeFilter.FILTER_REJECT;
                // 與基礎 selector 重疊的讓既有流程處理
                if (node.matches && node.matches(SELECTORS.base)) return NodeFilter.FILTER_SKIP;
                // 領域過濾：非內容區但有標題白名單可放行，其餘略過（避免導覽/側欄過多噪音）
                if (!isContentWhitelist(node) && isInNonContent(node)) return NodeFilter.FILTER_SKIP;
                // 文字長度門檻
                const text = (node.innerText || '').trim();
                if (text.length < paraMinChars) return NodeFilter.FILTER_SKIP;
                // 若子孫已包含明確段落（p/li/blockquote/h*），則跳過祖先，讓基礎流程處理
                try {
                    if (node.querySelector('p, li, blockquote, h1, h2, h3, h4, h5, h6, dd')) {
                        return NodeFilter.FILTER_SKIP;
                    }
                } catch {}
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let cur = walker.currentNode;
        while (cur && scanned <= MAX_NODES) {
            if (cur !== root) candidates.push(cur);
            cur = walker.nextNode();
        }
    } catch { }
    // 去除包含關係（保留最深層）
    const set = new Set(candidates);
    return candidates.filter(n => {
        let p = n.parentElement;
        while (p && p !== document.body) {
            if (set.has(p)) return false;
            p = p.parentElement;
        }
        return true;
    });
}

function isEligibleParagraph(el) {
    if (!el) return false;
    if (el.closest('#jk-para-toggle')) return false;
    if (el.closest('#translate-button')) return false;
    if (el.closest('#jk-toast')) return false;
    // 不翻譯標記
    try { if (el.classList && el.classList.contains('notranslate')) return false; } catch { }
    // 顯式標記為隱藏的節點不處理
    try {
        const ariaHidden = el.getAttribute && el.getAttribute('aria-hidden');
        if (ariaHidden === 'true') return false;
    } catch { }
    // 字數先行評估
    const text = (el.innerText || '').trim();
    const isLongEnough = text.length >= paraMinChars;
    // 過長/過短文本直接略過（對超長容器改以分段優先）
    if (checkTextSizeForElement(el)) return false;
    // 純數字/使用者識別符等不宜翻譯內容
    try { if (isMainlyNumericContent(el)) return false; } catch { }
    // 允許白名單元素（如卡片標題 h1~h6 或 data-testid 含 headline/title），即使位於 header/nav 也保留
    const whitelisted = isContentWhitelist(el);
    if (!whitelisted) {
        // 排除頁頭/導航/側邊欄等非內容區塊
        if (isInNonContent(el)) return false;
    }
    // 避免在已插入的翻譯容器內再次標註（會導致滾動後出現「...」）
    if (el.closest('.jk-para-translation')) return false;
    if (el.isContentEditable) return false;
    const tag = (el.tagName || '').toLowerCase();
    const skip = new Set(['script', 'style', 'noscript', 'input', 'textarea', 'select', 'button', 'code', 'pre', 'svg', 'canvas', 'math', 'form']);
    if (skip.has(tag)) return false;
    // 允許的語義型標籤，即使被站方樣式設定為 inline 也放行
    const allowInlineTags = new Set(['p', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dd']);
    // 若不在白名單且非語義型標籤，則需為 block-like 才處理，避免在一般 inline 文字中插入按鈕
    if (!whitelisted && !allowInlineTags.has(tag) && !visibleAndBlockLike(el)) return false;
    if (!inViewport(el, 250)) return false;
    return isLongEnough;
}

// ===== 參考 dom.ts 的判斷：核心方法 =====
function ctShouldSkipNode(node, tag) {
    try {
        if (DOMTS_SKIP_SET.has(tag)) return true;
        if (node.classList && node.classList.contains('notranslate')) return true;
        if (node.isContentEditable) return true;
        if (checkTextSizeForElement(node)) return true;
        if (isMainlyNumericContent(node)) return true;
    } catch {}
    return false;
}

function ctIsButton(node, tag) {
    return tag === 'button' || (tag === 'span' && node.parentNode && (node.parentNode.tagName || '').toLowerCase() === 'button');
}

function ctHandleButtonTranslation(node) {
    // 在本擴充中，按鈕不插入段落翻譯按鈕，統一跳過。
    return;
}

function ctDetectChildMeta(parent) {
    let child = parent && parent.firstChild;
    while (child) {
        if (child.nodeType === Node.ELEMENT_NODE && !DOMTS_INLINE_SET.has((child.nodeName || '').toLowerCase())) {
            return false;
        }
        child = child.nextSibling;
    }
    return true;
}

function ctIsInlineElement(node, tag) {
    return DOMTS_INLINE_SET.has(tag) || node.nodeType === Node.TEXT_NODE || ctDetectChildMeta(node);
}

function ctFindTranslatableParent(node) {
    if (!node || !node.parentNode) return node;
    const res = ctGrabNode(node.parentNode);
    return res || node;
}

function ctHandleFirstLineText(node) {
    // 若首個子文本節點存在非空文字，視為可翻譯容器；否則略過
    let child = node && node.firstChild;
    while (child) {
        if (child.nodeType === Node.TEXT_NODE && (child.textContent || '').trim()) {
            return node;
        }
        child = child.nextSibling;
    }
    return false;
}

function ctGrabNode(node) {
    if (!node) return false;
    if (node instanceof Text) {
        const parentOrSelf = ctFindTranslatableParent(node);
        if (parentOrSelf && parentOrSelf !== node) return parentOrSelf;
        return false;
    }
    if (!node.tagName) return false;
    const curTag = (node.tagName || '').toLowerCase();

    if (ctShouldSkipNode(node, curTag)) return false;

    // 站點相容邏輯（簡化版）：略過，靠通用啟發式與白名單

    if (DOMTS_DIRECT_SET.has(curTag)) return node;

    if (ctIsButton(node, curTag)) {
        ctHandleButtonTranslation(node);
        return false;
    }

    if (ctIsInlineElement(node, curTag)) {
        return ctFindTranslatableParent(node);
    }

    if (curTag === 'div' || curTag === 'label') {
        return ctHandleFirstLineText(node);
    }

    return false;
}

function ctGrabAllNode(rootNode) {
    if (!rootNode) return [];
    const result = [];
    try {
        const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (node instanceof Text) return NodeFilter.FILTER_ACCEPT;
                if (!(node instanceof Element)) return NodeFilter.FILTER_SKIP;
                const tag = (node.tagName || '').toLowerCase();
                if (DOMTS_SKIP_SET.has(tag) || (node.classList && (node.classList.contains('sr-only') || node.classList.contains('notranslate')))) {
                    return NodeFilter.FILTER_REJECT;
                }
                // 初次全域翻譯時跳過 header/footer（避免大量噪音）
                if (tag === 'header' || tag === 'footer') return NodeFilter.FILTER_REJECT;

                // 是否含有效文本/子元素
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
            const translateNode = ctGrabNode(current);
            if (translateNode) {
                result.push(translateNode);
                // 不可靠的子樹跳過在原始版本也存在；此處交由後續去重
            }
        }
    } catch {}
    // 去重
    return Array.from(new Set(result));
}

function annotateParagraphs() {
    // 清理：若先前誤插在翻譯區塊內的按鈕，立即移除
    try {
        document.querySelectorAll('.jk-para-translation .jk-para-btn').forEach(b => b.remove());
    } catch { }
    // 額外清理：若任何「…」出現在非內容區塊，移除之
    try {
        document.querySelectorAll('.jk-para-btn').forEach(b => {
            if (isInNonContent(b)) b.remove();
        });
    } catch { }
    // 修正：若先前已標記 data-jk-annotated 但沒有關聯按鈕且也未翻譯，移除標記以便重新標註（例如之前因 slot/overflow 放置失敗）
    try {
        document.querySelectorAll('[data-jk-annotated="1"]').forEach(el => {
            try {
                // 若內部沒有按鈕/翻譯，且其關聯錨點/宿主旁亦無按鈕，且文件層級也不存在 data-jk-for 指向它，才視為需要清除標記
                const hasBtn = (function(){
                    try {
                        if (el.querySelector('.jk-para-btn') || el.querySelector('.jk-para-translation')) return true;
                        ensureElementUid(el);
                        const uid = el && el.dataset && el.dataset.jkUid;
                        if (uid && document.querySelector(`.jk-para-btn[data-jk-for="${uid}"]`)) return true;
                        const anchor = computeInsertionAnchor(el);
                        if (anchor && anchor.dataset && anchor.dataset.jkHasBtn === '1') return true;
                        const an = anchor && anchor.nextElementSibling;
                        if (an && an.classList && an.classList.contains('jk-para-btn')) return true;
                        const host = findSlottedCustomHost(anchor) || findSlottedCustomHost(el);
                        if (host && host.dataset && host.dataset.jkHasBtn === '1') return true;
                        const hn = host && host.nextElementSibling;
                        if (hn && hn.classList && hn.classList.contains('jk-para-btn')) return true;
                    } catch {}
                    return false;
                })();
                if (!hasBtn) {
                    delete el.dataset.jkAnnotated;
                }
            } catch { }
        });
    } catch { }

    const root = getContentRoot();
    // 以 dom.ts 的抓取邏輯為主，合併主要內容與額外容器的候選
    const extraRoots = Array.from(document.querySelectorAll(SELECTORS.extraRoots));
    try { document.querySelectorAll('.md, [slot="comment"], [id$="-rtjson-content"]').forEach(n => extraRoots.push(n)); } catch {}
    // 基礎 selector 命中的節點也以 ctGrabNode 規則歸一化，確保與 dom.ts 一致
    const baseNodesRaw = [root, ...extraRoots].flatMap(r => Array.from(r.querySelectorAll(SELECTORS.base)));
    const baseNodes = baseNodesRaw.map(n => ctGrabNode(n)).filter(Boolean);
    const candidates = [
        ...ctGrabAllNode(root),
        ...extraRoots.flatMap(r => ctGrabAllNode(r)),
        ...baseNodes
    ];
    // 去重與深度優先（深層元素先處理）
    const seen = new Set();
    const nodes = Array.from(candidates.filter(n => { if (seen.has(n)) return false; seen.add(n); return true; })).reverse();
    let count = 0;
    const BATCH_LIMIT = 300; // 單次批次上限，避免大頁面卡頓
    nodes.forEach(el => {
        if (count > BATCH_LIMIT) return; // 批次上限避免過多注入
        if (!isEligibleParagraph(el)) return;
        if (isAnnotated(el)) return; // 已處理過，避免重複
        ensureElementUid(el);
        try {
            const uid = el.dataset && el.dataset.jkUid;
            if (uid) {
                const exists = document.querySelector(`.jk-para-btn[data-jk-for="${uid}"]`);
                if (exists) return;
            }
        } catch {}
        // 若任意子孫已經有段落按鈕/翻譯或已標註，略過此祖先
        try {
            if (el.querySelector('.jk-para-btn') || el.querySelector('.jk-para-translation') || el.querySelector('[data-jk-annotated="1"]') || el.querySelector('[data-jk-has-btn="1"]')) return;
        } catch { }

        // 針對會以外側插入的情形，若錨點/宿主已經存在按鈕，則跳過
        const anchor = computeInsertionAnchor(el);
        try {
            const host = findSlottedCustomHost(anchor) || findSlottedCustomHost(el);
            if ((anchor && anchor.dataset && anchor.dataset.jkHasBtn === '1') ||
                (anchor && anchor.nextElementSibling && anchor.nextElementSibling.classList && anchor.nextElementSibling.classList.contains('jk-para-btn')) ||
                (host && host.dataset && host.dataset.jkHasBtn === '1') ||
                (host && host.nextElementSibling && host.nextElementSibling.classList && host.nextElementSibling.classList.contains('jk-para-btn'))) {
                return;
            }
        } catch {}

        // 針對包含 <br><br> 的段落，於每個段末插入按鈕；否則在整體末尾插一次
        const inserted = annotateElementSegments(el, (btn) => { count++; });
        if (inserted) { markAnnotated(el); return; }
        // 若已存在翻譯結果，避免在其後再次補上一顆「...」按鈕
        if (!inserted) {
            if (el.querySelector('.jk-para-translation')) {
                return; // 已翻譯的段落不再補按鈕，避免顯示在翻譯結果之後
            }
            // 再次保險：若文件中已存在針對此容器的按鈕，跳過
            try {
                const uid2 = el.dataset && el.dataset.jkUid;
                if (uid2 && document.querySelector(`.jk-para-btn[data-jk-for="${uid2}"]`)) return;
            } catch {}
            const btn = createParaButton(el, null);
            placeParaButton(el, btn);
            count++;
            markAnnotated(el);
        }
    });
}

// 在段落模式時，隨滾動/尺寸變化持續標註可見段落
let paraScrollTimer = null;
let paraMutationObs = null;
let paraMutDebounce = null;
// 已標註元素標記，避免重複插入
function isAnnotated(el) {
    try { return el && el.dataset && el.dataset.jkAnnotated === '1'; } catch { return false; }
}
function markAnnotated(el) {
    try { if (el && el.dataset) el.dataset.jkAnnotated = '1'; } catch { }
}
function enableParagraphAutoAnnotate() {
    const handler = () => {
        if (paraScrollTimer) return;
        paraScrollTimer = setTimeout(() => {
            paraScrollTimer = null;
            if (paragraphModeActive) annotateParagraphs();
        }, 150);
    };
    window.addEventListener('scroll', handler, { passive: true });
    window.addEventListener('resize', handler, { passive: true });
    // 立刻跑一次，確保目前視窗內的元素被處理
    annotateParagraphs();
    // 保存以便關閉時移除
    enableParagraphAutoAnnotate._handler = handler;

    // 監看 DOM 變更（Reddit/動態載入相容）
    try {
        if (!paraMutationObs) {
            paraMutationObs = new MutationObserver(() => {
                if (paraMutDebounce) clearTimeout(paraMutDebounce);
                paraMutDebounce = setTimeout(() => {
                    paraMutDebounce = null;
                    if (paragraphModeActive) annotateParagraphs();
                }, 200);
            });
            paraMutationObs.observe(document.body, { childList: true, subtree: true });
        }
    } catch { }
}
function disableParagraphAutoAnnotate() {
    const h = enableParagraphAutoAnnotate._handler;
    if (h) {
        window.removeEventListener('scroll', h);
        window.removeEventListener('resize', h);
        enableParagraphAutoAnnotate._handler = null;
    }
    if (paraScrollTimer) { clearTimeout(paraScrollTimer); paraScrollTimer = null; }
    if (paraMutationObs) { try { paraMutationObs.disconnect(); } catch {} paraMutationObs = null; }
    if (paraMutDebounce) { clearTimeout(paraMutDebounce); paraMutDebounce = null; }
}

function createParaButton(containerEl, segText) {
    ensureElementUid(containerEl);
    const btn = document.createElement('button');
    btn.className = 'jk-para-btn';
    btn.type = 'button';
    btn.textContent = '...';
    btn.setAttribute('draggable', 'false');
    if (segText) btn.dataset.segText = segText;
    // 建立唯一對應：一般段落用容器 uid；分段則加上 segKey，避免同一容器多段重疊
    try {
        const baseUid = containerEl && containerEl.dataset && containerEl.dataset.jkUid;
        const key = segText ? (baseUid + '|' + segKey(segText)) : baseUid;
        if (key) btn.dataset.jkFor = key;
    } catch {}
    const swallow = (ev) => {
        try { ev.preventDefault(); } catch { }
        try { ev.stopPropagation(); } catch { }
        try { ev.stopImmediatePropagation(); } catch { }
        return false;
    };
    // 防止位於 <a> 內部時觸發導向
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'auxclick', 'contextmenu']
        .forEach(type => btn.addEventListener(type, swallow, true));
    btn.addEventListener('click', async (ev) => {
        // 再次保險阻擋
        swallow(ev);
        await handleParagraphTranslate(containerEl, btn);
    }, false);
    return btn;
}

// 嚴格攔截：在文件層級攔截針對 jk-para-btn 的事件，避免 <a> 導向
function setupStrictInterceptors() {
    const types = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'auxclick', 'contextmenu'];
    types.forEach(t => {
        document.addEventListener(t, (ev) => {
            const target = ev.target;
            if (!target) return;
            const btn = target.closest && target.closest('.jk-para-btn');
            if (btn) {
                if (t === 'click') {
                    // 僅取消預設（例如 <a> 導向），但不阻斷傳遞，確保我們的 bubble click 處理器可執行
                    try { ev.preventDefault(); } catch { }
                } else {
                    try { ev.preventDefault(); } catch { }
                    try { ev.stopPropagation(); } catch { }
                    try { ev.stopImmediatePropagation(); } catch { }
                }
            }
        }, true);
    });
}

// 回傳是否有依段落切分並插入（true 表示至少插入一顆）
function annotateElementSegments(el, onInsert) {
    ensureElementUid(el);
    let consecutiveBr = 0;
    let firstBrOfPair = null;
    let segmentTextLen = 0;
    let segmentText = '';
    let insertedAny = false;
    // 僅當實際遇到 <br><br> 段落切分時，才在收尾補上一顆按鈕
    // 這可避免在沒有段落切分的容器（如 ul/div）上，於已插入翻譯後再次出現「...」。
    let hadDoubleBrBoundary = false;
    const children = Array.from(el.childNodes);
    for (let i = 0; i < children.length; i++) {
        const node = children[i];
        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') {
            if (consecutiveBr === 0) firstBrOfPair = node;
            consecutiveBr++;
            if (consecutiveBr >= 2) {
                // 段落邊界
                hadDoubleBrBoundary = true;
                if (segmentTextLen >= paraMinChars) {
                    // 若前一個節點已為翻譯結果，代表該段已翻譯，略過再插入「...」
                    let prev = firstBrOfPair ? firstBrOfPair.previousSibling : null;
                    while (prev && prev.nodeType === Node.TEXT_NODE && (prev.textContent || '').trim() === '') {
                        prev = prev.previousSibling;
                    }
                    const hasTranslatedBefore = prev && prev.nodeType === Node.ELEMENT_NODE && prev.classList && prev.classList.contains('jk-para-translation');
                    // 分段唯一鍵（基於容器 uid + 段落文字摘要）
                    const uid = el && el.dataset && el.dataset.jkUid;
                    const key = uid ? (uid + '|' + segKey(segmentText.trim())) : null;
                    const exists = key ? document.querySelector(`.jk-para-btn[data-jk-for="${key}"]`) : null;
                    if (!hasTranslatedBefore && !exists) {
                        const btn = createParaButton(el, segmentText.trim());
                        // 若為 slotted/裁切/inline 環境，改用外側安全錨點；否則就近插入
                        try {
                            const st = window.getComputedStyle(el);
                            const isInline = st && st.display === 'inline';
                            if (findSlottedCustomHost(el) || isInline || isClampedOrOverflowed(el)) {
                                placeParaButton(el, btn);
                            } else {
                                el.insertBefore(btn, firstBrOfPair);
                            }
                        } catch {
                            placeParaButton(el, btn);
                        }
                        if (onInsert) onInsert(btn);
                        insertedAny = true;
                    }
                }
                // reset for next segment
                consecutiveBr = 0;
                firstBrOfPair = null;
                segmentTextLen = 0;
                segmentText = '';
            }
        } else if (node.nodeType === Node.TEXT_NODE) {
            const t = (node.textContent || '').trim();
            segmentTextLen += t.length;
            if (t) segmentText += (segmentText ? ' ' : '') + t;
            consecutiveBr = 0;
            firstBrOfPair = null;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            // 對一般元素，使用其文字內容長度估算
            const t = (node.textContent || '').trim();
            segmentTextLen += t.length;
            if (t) segmentText += (segmentText ? ' ' : '') + t;
            consecutiveBr = 0;
            firstBrOfPair = null;
        } else {
            consecutiveBr = 0;
            firstBrOfPair = null;
        }
    }
    // 收尾：最後一段（僅在有偵測到 <br><br> 段落切分時補上）
    if (hadDoubleBrBoundary && segmentTextLen >= paraMinChars) {
        // 若末尾已存在翻譯結果，略過再插入「...」
        let lastEl = el.lastElementChild;
        const tailIsTranslated = lastEl && lastEl.classList && lastEl.classList.contains('jk-para-translation');
        if (!tailIsTranslated) {
            const btn = createParaButton(el, segmentText.trim());
            placeParaButton(el, btn);
            if (onInsert) onInsert(btn);
            insertedAny = true;
        }
    }
    return insertedAny;
}

function isClampedOrOverflowed(el) {
    try {
        const st = window.getComputedStyle(el);
        if (!st) return false;
        const ovx = st.overflowX, ovy = st.overflowY;
        const hasHiddenOverflow = /hidden|clip/i.test(ovx) || /hidden|clip/i.test(ovy);
        const isWebkitBox = (st.display || '').includes('-webkit-box');
        const clamp = (st.webkitLineClamp || st['-webkit-line-clamp'] || '').toString();
        const hasClamp = clamp && clamp !== 'none' && clamp !== '0';
        const overflowed = (el.scrollHeight - el.clientHeight > 2) || (el.scrollWidth - el.clientWidth > 2);
        return hasHiddenOverflow || isWebkitBox || hasClamp || overflowed;
    } catch { return false; }
}

function computeInsertionAnchor(containerEl) {
    try {
        const st = window.getComputedStyle(containerEl);
        if (st && st.display === 'inline') return containerEl;
        if (isClampedOrOverflowed(containerEl)) return findSafeInsertionAnchor(containerEl);
    } catch {}
    return containerEl;
}

function findSafeInsertionAnchor(el) {
    let cur = el;
    let last = el;
    for (let i = 0; i < 4 && cur && cur !== document.body; i++) {
        const st = window.getComputedStyle(cur);
        const ovx = st && st.overflowX || '';
        const ovy = st && st.overflowY || '';
        const hidden = /hidden|clip/i.test(ovx) || /hidden|clip/i.test(ovy);
        const isClamped = (st && (st.display || '').includes('-webkit-box')) || (st && (st.webkitLineClamp && st.webkitLineClamp !== 'none' && st.webkitLineClamp !== '0'));
        if (!hidden && !isClamped) { last = cur; }
        if (cur.tagName === 'A') { last = cur; break; }
        cur = cur.parentElement;
    }
    return last || el;
}

function findSlottedCustomHost(el) {
    try {
        let cur = el;
        for (let i = 0; i < 6 && cur && cur !== document.body; i++) {
            if (cur.getAttribute && cur.getAttribute('slot')) {
                const host = cur.parentElement;
                if (host && host.tagName && host.tagName.includes('-')) {
                    return host;
                }
            }
            cur = cur.parentElement;
        }
    } catch {}
    return null;
}

// 判斷元素是否已經存在關聯的「…」按鈕或翻譯結果
function hasAssociatedParaBtn(el) {
    try {
        if (!el) return false;
        // 1) 內部是否已有按鈕或翻譯結果
        if ((el.querySelector && el.querySelector('.jk-para-btn')) || (el.querySelector && el.querySelector('.jk-para-translation'))) {
            return true;
        }
        // 2) 內部是否已有已標註的子孫
        if (el.querySelector && el.querySelector('[data-jk-annotated="1"]')) return true;
        if (el.querySelector && el.querySelector('[data-jk-has-btn="1"]')) return true;
        // 3) 外側錨點或宿主旁是否已有按鈕/標記
        const anchor = computeInsertionAnchor(el);
        if (anchor && anchor.dataset && anchor.dataset.jkHasBtn === '1') return true;
        const an = anchor && anchor.nextElementSibling;
        if (an && an.classList && an.classList.contains('jk-para-btn')) return true;
        const host = findSlottedCustomHost(anchor) || findSlottedCustomHost(el);
        if (host && host.dataset && host.dataset.jkHasBtn === '1') return true;
        const hn = host && host.nextElementSibling;
        if (hn && hn.classList && hn.classList.contains('jk-para-btn')) return true;
    } catch { }
    return false;
}

function placeParaButton(containerEl, btn) {
    try {
        const st = window.getComputedStyle(containerEl);

        // 決定預設錨點
        let anchor = containerEl;
        if (st && st.display === 'inline') {
            // inline 文字：插在外側
            anchor = containerEl;
        } else if (isClampedOrOverflowed(containerEl)) {
            // 被裁切/多行截斷：找較安全的外側錨點
            anchor = findSafeInsertionAnchor(containerEl) || containerEl;
        }

        // 若目標（或其本身）帶有 slot 屬性，且其父層為自訂元素（可能為 Shadow Host），
        // 直接把按鈕插到宿主元素之外，避免被 slot/overflow 裁切後看不到。
        try {
            // 優先找距離最近的 slotted custom host（從 anchor 或 containerEl 向上尋找）
            const host = findSlottedCustomHost(anchor) || findSlottedCustomHost(containerEl);
            if (host) {
                // 標記避免重複
                try { if (host && host.dataset) host.dataset.jkHasBtn = '1'; } catch {}
                host.insertAdjacentElement('afterend', btn);
                return;
            }
        } catch {}

        // 若上層存在裁切容器，嘗試將錨點提升到不裁切的祖先
        try {
            let cur = anchor;
            let lastSafe = anchor;
            for (let i = 0; i < 6 && cur && cur !== document.body; i++) {
                if (!isClampedOrOverflowed(cur)) lastSafe = cur;
                cur = cur.parentElement;
            }
            if (lastSafe !== anchor) anchor = lastSafe;
        } catch {}

        // 一般情況插在錨點外側，避免破壞排版
        try { if (anchor && anchor.dataset) anchor.dataset.jkHasBtn = '1'; } catch {}
        anchor.insertAdjacentElement('afterend', btn);
    } catch {
        try { containerEl.appendChild(btn); } catch { }
    }
}

function removeParagraphButtons() {
    document.querySelectorAll('.jk-para-btn').forEach(b => b.remove());
    // 同步清除標記，允許再次標註
    try { document.querySelectorAll('[data-jk-annotated="1"]').forEach(el => { try { delete el.dataset.jkAnnotated; } catch {} }); } catch {}
    try { document.querySelectorAll('[data-jk-has-btn="1"]').forEach(el => { try { delete el.dataset.jkHasBtn; } catch {} }); } catch {}
}

function getCleanContainerText(container) {
    try {
        const clone = container.cloneNode(true);
        try { clone.querySelectorAll('.jk-para-btn, .jk-para-translation').forEach(n => n.remove()); } catch { }
        return (clone.innerText || '').trim();
    } catch (e) {
        // Fallback：避免將 UI 文案帶入
        const raw = (container.innerText || '').trim();
        return raw.replace(/\u2026|\.\.\.|翻譯中…/g, '').trim();
    }
}

async function handleParagraphTranslate(container, btn) {
    try {
        btn.disabled = true;
        const originalText = btn.textContent;

        // 防呆：若容器位於非內容區（頁首/導覽/側欄），通常不進行翻譯；
        // 但若屬於白名單（如 h1~h6/headline），仍允許翻譯，符合「長標題可翻譯」需求。
        const nonContent = isInNonContent(container);
        const whitelisted = isContentWhitelist(container);
        if (nonContent && !whitelisted) {
            btn.textContent = originalText;
            btn.disabled = false;
            return;
        }

        await loadSettingsFromProfiles();

        // 先取得要翻譯的文字，再變更按鈕文案，避免把 UI 文字算進來源
        const src = (btn && btn.dataset && btn.dataset.segText)
            ? btn.dataset.segText
            : getCleanContainerText(container);
        btn.textContent = '翻譯中…';
        if (!src) { btn.textContent = originalText; btn.disabled = false; return; }

        chrome.runtime.sendMessage({ selections: src });
        const tmCtx = await new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage({ type: 'tm:get', limit: 8 }, (res) => {
                    resolve(res && res.ok ? { pairs: res.pairs || [] } : { pairs: [] });
                });
            } catch (e) {
                resolve({ pairs: [] });
            }
        });
        const translated = await getTranslation(targetLang, apiBaseUrl, apiKey, apiModel, src, tmCtx);
        if (!translated) { btn.textContent = '重試'; btn.disabled = false; return; }
        chrome.runtime.sendMessage({ translations: translated });
        // Record to TM
        try { chrome.runtime.sendMessage({ type: 'tm:add', src: src, tgt: translated }); } catch { }

        const wrap = document.createElement('div');
        wrap.className = 'jk-para-translation';
        wrap.textContent = translated;
        if (btn && btn.dataset && btn.dataset.segText) {
            btn.insertAdjacentElement('afterend', wrap);
        } else {
            container.appendChild(wrap);
        }
        // 成功翻譯後移除按鍵，避免重複翻譯同一段
        try { btn.remove(); } catch { }
    } catch (e) {
        console.error(e);
        btn.textContent = '重試';
    } finally {
        btn.disabled = false;
    }
}

function showTranslateButton(event, isDoubleClick = false) {
    loadSettings()

    let translateButton = document.getElementById('translate-button');
    if (!translateButton) {
        translateButton = document.createElement('button');
        translateButton.id = 'translate-button';
        translateButton.textContent = '翻譯';
        translateButton.style.backgroundImage = 'url(' + chrome.runtime.getURL('icons/icon48.png') + ')';
        translateButton.style.backgroundSize = 'contain';
        translateButton.style.width = '32px';
        translateButton.style.height = '32px';
        translateButton.style.position = 'absolute';
        translateButton.style.zIndex = '1000';
        translateButton.style.backgroundColor = '#FFF';
        translateButton.style.color = '#FFFFFF00';
        translateButton.style.border = 'none';
        translateButton.style.borderRadius = '5px';
        translateButton.style.padding = '5px';
        translateButton.style.cursor = 'pointer';
        translateButton.style.fontSize = '12px';
        translateButton.style.boxShadow = '0px 2px 4px rgba(0, 0, 0, 0.2)';
        if (isDoubleClick) {
            translateButton.addEventListener("mousedown", translateDoubleClickInput)
        } else {
            translateButton.addEventListener("mousedown", translateFocusedInput);
        }
        // 避免未定位先顯示導致(0,0)閃現
        translateButton.style.display = 'none';
        document.body.appendChild(translateButton);
    }

    const activeElement = document.activeElement;
    if (activeElement) {

        const OffsetXValue = 10, OffsetYValue = 20;
        let xBias = OffsetXValue, yBias = OffsetYValue;

        const selection = window.getSelection();
        let range = null;
        if (selection && selection.rangeCount > 0) {
            range = selection.getRangeAt(0).cloneRange();
        }
        if (DEBUG) console.log('Range:', range);

        let xPosition = xBias;
        let yPosition = yBias;

        if (range && !selection.isCollapsed) {
            // 先嘗試使用最後一個非零 client rect（對三擊整段選取特別有效）
            let rect = null;
            try {
                const clientRects = range.getClientRects ? Array.from(range.getClientRects()) : [];
                const nonZero = clientRects.filter(r => (r.width > 0) || (r.height > 0));
                rect = (nonZero.length > 0) ? nonZero[nonZero.length - 1] : null;
                if (!rect) rect = range.getBoundingClientRect();
            } catch (e) {
                rect = null;
            }
            if (rect && ((rect.width > 0) || (rect.height > 0))) {
                const tooltipX = rect.right + window.scrollX - 15;
                const tooltipY = rect.bottom + window.scrollY - 15;
                xPosition += tooltipX;
                yPosition += tooltipY;
            } else {
                // 仍無有效矩形 → fallback 到事件座標
                const ex = (event && typeof event.clientX === 'number') ? event.clientX : 0;
                const ey = (event && typeof event.clientY === 'number') ? event.clientY : 0;
                xPosition += ex + window.scrollX;
                yPosition += ey + window.scrollY;
            }
        } else {
            // 無有效 Range（如 input/textarea）或尚未就緒 → 使用事件座標 + 滾動位移
            const ex = (event && typeof event.clientX === 'number') ? event.clientX : 0;
            const ey = (event && typeof event.clientY === 'number') ? event.clientY : 0;
            xPosition += ex + window.scrollX;
            yPosition += ey + window.scrollY;
        }

        originScrollX = scrollingElement[scrollPropertyX];
        originScrollY = scrollingElement[scrollPropertyY];
        originPositionX = xPosition;
        originPositionY = yPosition;

        let distanceX = originScrollX - scrollingElement[scrollPropertyX];
        let distanceY = originScrollY - scrollingElement[scrollPropertyY];

        translateButton.style.top = `${originPositionY + distanceY}px`;
        translateButton.style.left = `${originPositionX + distanceX}px`;
        // 位置已計算完成，再顯示
        translateButton.style.display = 'block';

        hasButtonShown = true;
    }
}

function hideTranslateButton() {
    if (hasButtonShown) {
        const translateButton = document.getElementById('translate-button');
        if (translateButton) {
            document.body.removeChild(translateButton);
        }
        hasButtonShown = false;
    }
}

async function translateDoubleClickInput() {
    const sel = window.getSelection();
    const text = (sel && sel.rangeCount > 0) ? sel.getRangeAt(0).toString().trim() : '';
    if (text.length === 0) {
        hideTranslateButton();
        return;
    }
    // 以懸浮視窗顯示雙擊/三擊翻譯結果（不修改原頁內容）
    let rect = null;
    try {
        const range = sel.getRangeAt(0);
        const clientRects = range.getClientRects ? Array.from(range.getClientRects()) : [];
        const nonZero = clientRects.filter(r => (r.width > 0) || (r.height > 0));
        rect = (nonZero.length > 0) ? nonZero[nonZero.length - 1] : null;
        if (!rect) rect = range.getBoundingClientRect();
    } catch { rect = null; }
    await translateToPopup(text, rect);
    hideTranslateButton();
}

async function translateFocusedInput() {
    if (DEBUG) console.log('Translating focused selection to popup...');
    const sel = window.getSelection();
    const text = (sel && sel.rangeCount > 0) ? sel.getRangeAt(0).toString().trim() : '';
    if (text && text.length > 0) {
        let rect = null;
        try {
            const range = sel.getRangeAt(0);
            const clientRects = range.getClientRects ? Array.from(range.getClientRects()) : [];
            const nonZero = clientRects.filter(r => (r.width > 0) || (r.height > 0));
            rect = (nonZero.length > 0) ? nonZero[nonZero.length - 1] : range.getBoundingClientRect();
        } catch { rect = null; }
        await translateToPopup(text, rect);
    }
    hideTranslateButton();
}

async function translateShiftInput(targetElement, text) {
    chrome.runtime.sendMessage({ selections: text });

    // 加載用戶設置（從 options.js Profiles）
    await loadSettingsFromProfiles();

    const tmCtx = await new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ type: 'tm:get', limit: 8 }, (res) => {
                resolve(res && res.ok ? { pairs: res.pairs || [] } : { pairs: [] });
            });
        } catch (e) {
            resolve({ pairs: [] });
        }
    });
    const translatedText = await getTranslation(targetLang, apiBaseUrl, apiKey, apiModel, text, tmCtx);
    if (DEBUG) console.log('Translated text:', translatedText);
    chrome.runtime.sendMessage({ translations: translatedText });
    try { chrome.runtime.sendMessage({ type: 'tm:add', src: text, tgt: translatedText }); } catch { }

    // 創建一個新的 span 元素
    const span = document.createElement('div');
    span.style.borderLeft = '4px solid #0088d2'
    span.style.paddingLeft = '12px'

    span.className = 'highlight';
    // Safer insertion to avoid XSS/DOM breakage
    span.textContent = translatedText;
    try {
        targetElement.appendChild(span);
    } catch (e) {
        // Fallback to non-destructive append
        try { targetElement.insertAdjacentElement('beforeend', span); } catch { }
    }
}

// ===== 懸浮視窗（顯示選取翻譯；用於雙擊/三擊情境） =====
async function translateToPopup(text, anchorRect) {
    chrome.runtime.sendMessage({ selections: text });
    try { showResultPopup(ct('msg_translating') || '翻譯中…', anchorRect); } catch { showResultPopup('翻譯中…', anchorRect); }
    await loadSettingsFromProfiles();
    const tmCtx = await new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ type: 'tm:get', limit: 8 }, (res) => {
                resolve(res && res.ok ? { pairs: res.pairs || [] } : { pairs: [] });
            });
        } catch (e) { resolve({ pairs: [] }); }
    });
    const translatedText = await getTranslation(targetLang, apiBaseUrl, apiKey, apiModel, text, tmCtx);
    chrome.runtime.sendMessage({ translations: translatedText });
    try { chrome.runtime.sendMessage({ type: 'tm:add', src: text, tgt: translatedText }); } catch { }
    showResultPopup(translatedText, anchorRect);
}

function showResultPopup(text, anchorRect) {
    // 準備背景遮罩（點擊背景關閉）
    let backdrop = document.getElementById('jk-float-backdrop');
    if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.id = 'jk-float-backdrop';
        document.body.appendChild(backdrop);
        backdrop.addEventListener('click', () => {
            try { const p = document.getElementById('jk-float-popup'); if (p) p.remove(); } catch { }
            try { backdrop.style.display = 'none'; } catch { }
        }, { passive: true });
    }

    let popup = document.getElementById('jk-float-popup');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'jk-float-popup';
        popup.innerHTML = `
            <div class=\"jk-float-header\">\n                <span class=\"jk-float-title\">${ct('popup_title') || '翻譯結果'}</span>\n                <button id=\"jk-float-close\" title=\"${ct('popup_close') || '關閉'}\">×</button>\n            </div>\n            <div class=\"jk-float-body\"></div>
        `;
        document.body.appendChild(popup);
        const closeBtn = popup.querySelector('#jk-float-close');
        closeBtn.addEventListener('click', () => {
            try { popup.remove(); } catch { }
            try { backdrop.style.display = 'none'; } catch { }
        });
        // 啟用拖曳
        enablePopupDrag(popup);
    } else {
        // 若已存在但缺少標題列，重建結構
        if (!popup.querySelector('.jk-float-header') || !popup.querySelector('.jk-float-body')) {
            popup.innerHTML = `
                <div class=\"jk-float-header\">\n                    <span class=\"jk-float-title\">${ct('popup_title') || '翻譯結果'}</span>\n                    <button id=\"jk-float-close\" title=\"${ct('popup_close') || '關閉'}\">×</button>\n                </div>\n                <div class=\"jk-float-body\"></div>
            `;
            const closeBtn2 = popup.querySelector('#jk-float-close');
            closeBtn2.addEventListener('click', () => {
                try { popup.remove(); } catch { }
                try { backdrop.style.display = 'none'; } catch { }
            });
            enablePopupDrag(popup);
        }
    }
    const body = popup.querySelector('.jk-float-body');
    body.textContent = text || '';

    // 定位：預設在選取矩形右下；若無矩形，置於視窗中央
    let top, left;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const margin = 8;
    popup.style.visibility = 'hidden';
    popup.style.display = 'block';
    const pr = popup.getBoundingClientRect();
    const pw = pr.width || 320;
    const ph = pr.height || 160;
    if (anchorRect && (anchorRect.width > 0 || anchorRect.height > 0)) {
        top = Math.min(anchorRect.bottom + margin + window.scrollY, vh - ph - margin + window.scrollY);
        left = Math.min(Math.max(margin, anchorRect.right + margin + window.scrollX - pw), vw - pw - margin + window.scrollX);
    } else {
        top = (vh - ph) / 2 + window.scrollY;
        left = (vw - pw) / 2 + window.scrollX;
    }
    popup.style.top = `${Math.max(margin + window.scrollY, top)}px`;
    popup.style.left = `${Math.max(margin + window.scrollX, left)}px`;
    popup.style.visibility = 'visible';
    backdrop.style.display = 'block';
}

function enablePopupDrag(popup) {
    try {
        const header = popup.querySelector('.jk-float-header');
        if (!header) return;
        header.style.cursor = 'move';
        let dragging = false;
        let startX = 0, startY = 0;
        let origLeft = 0, origTop = 0;
        const onPointerMove = (ev) => {
            if (!dragging) return;
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            const vw = (document.documentElement.clientWidth || window.innerWidth || 0);
            const vh = (document.documentElement.clientHeight || window.innerHeight || 0);
            let nextLeft = origLeft + dx;
            let nextTop = origTop + dy;
            // 邊界限制
            const rect = popup.getBoundingClientRect();
            nextLeft = Math.min(Math.max(4, nextLeft), vw - rect.width - 4);
            nextTop = Math.min(Math.max(4, nextTop), vh - rect.height - 4);
            popup.style.left = `${nextLeft + window.scrollX}px`;
            popup.style.top = `${nextTop + window.scrollY}px`;
            ev.preventDefault();
        };
        const onPointerUp = (ev) => {
            dragging = false;
            try { header.releasePointerCapture(ev.pointerId); } catch { }
            document.removeEventListener('pointermove', onPointerMove, true);
            document.removeEventListener('pointerup', onPointerUp, true);
            document.removeEventListener('pointercancel', onPointerUp, true);
        };
        header.addEventListener('pointerdown', (ev) => {
            if (ev.button !== undefined && ev.button !== 0) return;
            const r = popup.getBoundingClientRect();
            dragging = true;
            startX = ev.clientX; startY = ev.clientY;
            origLeft = r.left; origTop = r.top;
            try { header.setPointerCapture(ev.pointerId); } catch { }
            document.addEventListener('pointermove', onPointerMove, true);
            document.addEventListener('pointerup', onPointerUp, true);
            document.addEventListener('pointercancel', onPointerUp, true);
            ev.preventDefault();
        }, true);
    } catch { }
}

function detectSelect(targetElement, actionAfterSelect) {
    let moved = false;

    const detectMouseMove = () => {
        moved = true;
    };

    const detectMouseUp = (event) => {
        if (moved) {
            if (typeof actionAfterSelect === "function") actionAfterSelect(event);
        }
        targetElement.removeEventListener("mousemove", detectMouseMove);
        targetElement.removeEventListener("mouseup", detectMouseUp);
    };

    targetElement.addEventListener("mousemove", detectMouseMove);
    targetElement.addEventListener("mouseup", detectMouseUp);
}

function getSelections() {
    let selection = window.getSelection();
    if (DEBUG) console.log('Selection:', selection);

    let text = "";
    let position;
    if (selection.rangeCount > 0) {
        text = selection.toString().trim();

        const lastRange = selection.getRangeAt(selection.rangeCount - 1);
        if (lastRange.endContainer !== document.documentElement) {
            let rect = selection.getRangeAt(selection.rangeCount - 1).getBoundingClientRect();
            position = [rect.left, rect.top];
        }
    }
    return { text, position };
}

// 顯示 Toast 消息
function showToast(message) {
    let toast = document.getElementById('jk-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'jk-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = 'show';
    setTimeout(() => {
        toast.className = toast.className.replace('show', '');
    }, 1000);
}

// 添加 Toast 的 CSS
const style = document.createElement('style');
style.innerHTML = `
#jk-toast {
    visibility: hidden;
    min-width: 250px;
    margin-left: -125px;
    background-color: #AA333333;
    color: #fff;
    text-align: center;
    border-radius: 2px;
    padding: 5px;
    position: fixed;
    z-index: 1001;
    left: 50%;
    bottom: 30px;
    font-size: 17px;
    border-radius: 10px;
}

#jk-toast.show {
    visibility: visible;
    -webkit-animation: fadein 0.5s, fadeout 0.5s 2.5s;
    animation: fadein 0.5s, fadeout 0.5s 2.5s;
}

@-webkit-keyframes fadein {
    from {bottom: 0; opacity: 0;} 
    to {bottom: 30px; opacity: 1;}
}

@keyframes fadein {
    from {bottom: 0; opacity: 0;}
    to {bottom: 30px; opacity: 1;}
}

@-webkit-keyframes fadeout {
    from {bottom: 30px; opacity: 1;} 
    to {bottom: 0; opacity: 0;}
}

@keyframes fadeout {
    from {bottom: 30px; opacity: 1;}
    to {bottom: 0; opacity: 0;}
}

/* 懸浮翻譯視窗 */
#jk-float-popup {
    position: absolute;
    z-index: 1004;
    /* 自動依內容寬度收縮，最多 50vw */
    width: auto;
    max-width: 50vw;
    max-height: 50vh;
    display: inline-block;
    box-sizing: border-box;
    background: #fff;
    color: #111;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.18);
    overflow: hidden;
}
/* 行動裝置（窄視窗）放寬上限到 80vw */
@media (max-width: 640px) {
  #jk-float-popup { max-width: 80vw; }
}
#jk-float-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1003;
    background: rgba(0,0,0,0); /* 透明背景，僅用於攔截點擊關閉 */
    display: none;
}
.jk-float-header { cursor: move; }
.jk-float-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    font-size: 12px;
}
.jk-float-title { color: #475569; }
#jk-float-close {
    appearance: none;
    border: none;
    background: transparent;
    color: #64748b;
    font-size: 16px;
    cursor: pointer;
}
#jk-float-close:hover { color: #0f172a; }
.jk-float-body {
    padding: 10px 12px;
    white-space: pre-wrap;
    line-height: 1.5;
    /* 讓長字也可換行，避免撐破 50vw 上限 */
    word-break: break-word;
    overflow-wrap: anywhere;
    font-size: 14px;
    max-height: calc(50vh - 40px);
    overflow: auto;
}

/* 段落模式 */
.jk-para-btn {
    appearance: none;
    background: transparent;
    border: none;
    padding: 0;
    margin-left: 6px;
    font-size: 12px;
    line-height: 1;
    color: #1a73e8;
    text-decoration: underline;
    cursor: pointer;
    opacity: 0.8;
}
.jk-para-btn:hover { color: #0b5bd3; opacity: 1; }
.jk-para-translation {
    margin-top: 6px;
    border-left: 4px solid #0088d2;
    padding-left: 12px;
    white-space: pre-wrap;
}
`;
document.head.appendChild(style);

// 建立段落切換按鈕
createParagraphToggleButton();
setupStrictInterceptors();

// ===== 段落切換按鈕的功能選單（維持…／全部翻譯） =====
let paraMenuHideTimer = null;
function showParaToggleMenu(anchorBtn) {
    let menu = document.getElementById('jk-para-menu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'jk-para-menu';
        Object.assign(menu.style, {
            position: 'fixed',
            zIndex: '1003',
            background: 'rgba(32,32,32,0.9)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '8px',
            padding: '6px',
            fontSize: '12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
        });
        const keepBtn = document.createElement('button');
        keepBtn.id = 'jk-keep-dots';
        keepBtn.type = 'button';
        keepBtn.textContent = keepParaButtons ? ct('menu_hide_dots') : ct('menu_show_dots');
        Object.assign(keepBtn.style, {
            padding: '4px 6px',
            cursor: 'pointer',
            border: 'none',
            borderRadius: '6px',
            background: '#e2e8f0',
            color: '#111'
        });
        keepBtn.addEventListener('click', () => {
            keepParaButtons = !keepParaButtons;
            keepBtn.textContent = keepParaButtons ? ct('menu_hide_dots') : ct('menu_show_dots');
            if (keepParaButtons) {
                // 顯示…：立即標註一次並啟用滾動/縮放自動補點
                paragraphModeActive = true;
                try { annotateParagraphs(); } catch { }
                try { enableParagraphAutoAnnotate(); } catch { }
            } else {
                // 隱藏…：關閉自動補點並移除所有既有「…」
                paragraphModeActive = false;
                try { disableParagraphAutoAnnotate(); } catch { }
                try { removeParagraphButtons(); } catch { }
                // 同時若正在自動「全部翻譯」，也停止
                try { disableTranslateAllWatcher(); } catch { }
                const allBtn = document.getElementById('jk-translate-all');
                if (allBtn) allBtn.textContent = ct('menu_translate_all');
            }
        });

        const allBtn = document.createElement('button');
        allBtn.id = 'jk-translate-all';
        allBtn.type = 'button';
        allBtn.textContent = translateAllActive ? ct('menu_stop_translate_all') : ct('menu_translate_all');
        Object.assign(allBtn.style, {
            padding: '4px 6px',
            cursor: 'pointer',
            border: 'none',
            borderRadius: '6px',
            background: '#1a73e8',
            color: '#fff'
        });
        allBtn.addEventListener('click', async () => {
            if (!translateAllActive) {
                enableTranslateAllWatcher();
                allBtn.textContent = ct('menu_stop_translate_all');
                showToast(ct('toast_start_auto_translate'));
            } else {
                disableTranslateAllWatcher();
                allBtn.textContent = ct('menu_translate_all');
                showToast(ct('toast_stop_auto_translate'));
            }
        });

        menu.appendChild(keepBtn);
        menu.appendChild(allBtn);
        menu.addEventListener('mouseenter', () => clearTimeout(paraMenuHideTimer));
        menu.addEventListener('mouseleave', () => scheduleHideParaToggleMenu());
        document.body.appendChild(menu);
    } else {
        const keepBtn = document.getElementById('jk-keep-dots');
        if (keepBtn) keepBtn.textContent = keepParaButtons ? ct('menu_hide_dots') : ct('menu_show_dots');
        const allBtn = document.getElementById('jk-translate-all');
        if (allBtn) allBtn.textContent = translateAllActive ? ct('menu_stop_translate_all') : ct('menu_translate_all');
        clearTimeout(paraMenuHideTimer);
    }
    // 依據按鈕位置放置選單：顯示在按鈕「上方」並水平置中
    try {
        const r = anchorBtn.getBoundingClientRect();
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        // 先以隱形顯示量測，避免寬高為 0 造成定位漂移
        const prevVis = menu.style.visibility;
        const prevDisp = menu.style.display;
        menu.style.visibility = 'hidden';
        menu.style.display = 'flex';
        menu.style.top = '-10000px';
        menu.style.left = '-10000px';
        const rectMenu = menu.getBoundingClientRect();
        const menuW = rectMenu.width || 140;
        const menuH = rectMenu.height || 60;
        let top = r.top - menuH - 8;
        if (top < 10) top = 10;
        let left = r.left + (r.width - menuW) / 2;
        left = Math.max(10, Math.min(left, vw - menuW - 10));
        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
        // 顯示
        menu.style.visibility = prevVis || 'visible';
        menu.style.display = 'flex';
    } catch { }
    // 使用 flex 顯示以確保按鈕垂直排列
    menu.style.display = 'flex';
}

function scheduleHideParaToggleMenu() {
    clearTimeout(paraMenuHideTimer);
    paraMenuHideTimer = setTimeout(() => {
        const menu = document.getElementById('jk-para-menu');
        if (menu) menu.style.display = 'none';
    }, 250);
}

async function translateAllParagraphButtons() {
    // 先標註目前可見段落，確保有「…」可翻譯（不再依賴主按鈕狀態）
    try { annotateParagraphs(); } catch { }

    // 取得快照並限制在視窗內可見的段落
    const allButtons = Array.from(document.querySelectorAll('.jk-para-btn'));
    const visibleButtons = allButtons.filter(btn => {
        const container = btn.parentElement || document.body;
        return inViewport(container, 0);
    });
    if (visibleButtons.length === 0) {
        showToast(ct('toast_no_visible_paras'));
        return;
    }
    try {
        showToast(ct('toast_start_translating_n', [String(visibleButtons.length)]));
    } catch {
        showToast(`開始翻譯 ${visibleButtons.length} 段…`);
    }
    for (let i = 0; i < visibleButtons.length; i++) {
        const btn = visibleButtons[i];
        if (!btn.isConnected) continue; // 可能已翻譯移除
        const container = btn.parentElement || document.body;
        try {
            await handleParagraphTranslate(container, btn);
        } catch (e) {
            // 忽略單筆失敗，繼續
        }
        // 避免過度打 API，稍作延遲
        await new Promise(r => setTimeout(r, 100));
    }
    showToast(ct('toast_translate_all_done'));
}

// 啟用/停用「全部翻譯」的捲動監聽（自動補點 + 自動翻譯）
function enableTranslateAllWatcher() {
    if (translateAllActive) return;
    translateAllActive = true;
    const handler = async () => {
        if (translateAllTimer) return;
        translateAllTimer = setTimeout(async () => {
            translateAllTimer = null;
            await translateAllVisibleOnce();
        }, 150);
    };
    window.addEventListener('scroll', handler, { passive: true });
    window.addEventListener('resize', handler, { passive: true });
    enableTranslateAllWatcher._handler = handler;
    // 啟用時先跑一次
    translateAllVisibleOnce();
}

function disableTranslateAllWatcher() {
    const h = enableTranslateAllWatcher._handler;
    if (h) {
        window.removeEventListener('scroll', h);
        window.removeEventListener('resize', h);
        enableTranslateAllWatcher._handler = null;
    }
    if (translateAllTimer) { clearTimeout(translateAllTimer); translateAllTimer = null; }
    translateAllActive = false;
}

async function translateAllVisibleOnce() {
    if (translateAllRunning) return;
    translateAllRunning = true;
    try {
        try { annotateParagraphs(); } catch { }
        const allButtons = Array.from(document.querySelectorAll('.jk-para-btn'));
        const visibleButtons = allButtons.filter(btn => {
            const container = btn.parentElement || document.body;
            return inViewport(container, 0);
        });
        for (let i = 0; i < visibleButtons.length; i++) {
            const btn = visibleButtons[i];
            if (!btn.isConnected) continue;
            const container = btn.parentElement || document.body;
            try {
                await handleParagraphTranslate(container, btn);
            } catch { }
            await new Promise(r => setTimeout(r, 80));
        }
    } finally {
        translateAllRunning = false;
    }
}
