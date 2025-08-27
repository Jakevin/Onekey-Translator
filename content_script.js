let globalTargetElement = null;
let originScrollX = 0;
let originScrollY = 0;
let originPositionX = 0;
let originPositionY = 0;
let scrollingElement = window;
let scrollPropertyX = "pageXOffset";
let scrollPropertyY = "pageYOffset";

let hasButtonShown = false;

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
const altKeyClick = (kyEvent) => {
    console.log('Key:', kyEvent.key);
    if (kyEvent[hotKey]) {
        console.log('当前悬停的文本:', mousedownEvent.target.innerText);
        translateShiftInput(mousedownEvent.target, mousedownEvent.target.innerText);
    }
    document.removeEventListener('keydown', altKeyClick);
}



// 在頁面加載時創建翻譯按鈕並綁定事件
document.addEventListener("mousedown", (event) => {
    hideTranslateButton();

    mousedownEvent = event;
    document.addEventListener('keydown', altKeyClick);
    detectSelect(document, (event) => {
        console.log('Selecting... showTranslateButton');
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

function isEligibleParagraph(el) {
    if (!el) return false;
    if (el.closest('#jk-para-toggle')) return false;
    if (el.closest('#translate-button')) return false;
    if (el.closest('#jk-toast')) return false;
    // 避免在已插入的翻譯容器內再次標註（會導致滾動後出現「...」）
    if (el.closest('.jk-para-translation')) return false;
    if (el.isContentEditable) return false;
    const tag = (el.tagName || '').toLowerCase();
    const skip = new Set(['script', 'style', 'noscript', 'input', 'textarea', 'select', 'button', 'code', 'pre', 'svg', 'canvas', 'math']);
    if (skip.has(tag)) return false;
    if (!visibleAndBlockLike(el)) return false;
    if (!inViewport(el, 250)) return false;
    const text = (el.innerText || '').trim();
    return text.length >= paraMinChars;
}

function annotateParagraphs() {
    // 清理：若先前誤插在翻譯區塊內的按鈕，立即移除
    try {
        document.querySelectorAll('.jk-para-translation .jk-para-btn').forEach(b => b.remove());
    } catch { }

    const nodeList = document.querySelectorAll('p, li, blockquote, h1, h2, h3, h4, h5, h6, article p, section p, div');
    // 以最深層優先，避免祖先與子節點重複插入
    const nodes = Array.from(nodeList).reverse();
    let count = 0;
    const BATCH_LIMIT = 300; // 單次批次上限，避免大頁面卡頓
    nodes.forEach(el => {
        if (count > BATCH_LIMIT) return; // 批次上限避免過多注入
        if (!isEligibleParagraph(el)) return;
        // 若任意子孫已經有段落按鈕，略過此祖先
        if (el.querySelector('.jk-para-btn')) return;

        // 針對包含 <br><br> 的段落，於每個段末插入按鈕；否則在整體末尾插一次
        const inserted = annotateElementSegments(el, (btn) => { count++; });
        // 若已存在翻譯結果，避免在其後再次補上一顆「...」按鈕
        if (!inserted) {
            if (el.querySelector('.jk-para-translation')) {
                return; // 已翻譯的段落不再補按鈕，避免顯示在翻譯結果之後
            }
            const btn = createParaButton(el, null);
            el.appendChild(btn);
            count++;
        }
    });
}

// 在段落模式時，隨滾動/尺寸變化持續標註可見段落
let paraScrollTimer = null;
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
}
function disableParagraphAutoAnnotate() {
    const h = enableParagraphAutoAnnotate._handler;
    if (h) {
        window.removeEventListener('scroll', h);
        window.removeEventListener('resize', h);
        enableParagraphAutoAnnotate._handler = null;
    }
    if (paraScrollTimer) { clearTimeout(paraScrollTimer); paraScrollTimer = null; }
}

function createParaButton(containerEl, segText) {
    const btn = document.createElement('button');
    btn.className = 'jk-para-btn';
    btn.type = 'button';
    btn.textContent = '...';
    btn.setAttribute('draggable', 'false');
    if (segText) btn.dataset.segText = segText;
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
                    if (!hasTranslatedBefore) {
                        const btn = createParaButton(el, segmentText.trim());
                        el.insertBefore(btn, firstBrOfPair);
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
            el.appendChild(btn);
            if (onInsert) onInsert(btn);
            insertedAny = true;
        }
    }
    return insertedAny;
}

function removeParagraphButtons() {
    document.querySelectorAll('.jk-para-btn').forEach(b => b.remove());
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
        console.log('Range:', range);

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
    await translateShiftInput(mousedownEvent.target, text);
    hideTranslateButton();
}

async function translateFocusedInput() {
    console.log('Translating focused input...');
    await loadSettingsFromProfiles();

    let selection = getSelections();
    console.log('Selection:', selection);
    if (selection.text && selection.text.length > 0) {
        chrome.runtime.sendMessage({ selections: selection.text });

        const tmCtx = await new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage({ type: 'tm:get', limit: 8 }, (res) => {
                    resolve(res && res.ok ? { pairs: res.pairs || [] } : { pairs: [] });
                });
            } catch (e) {
                resolve({ pairs: [] });
            }
        });
        const translatedText = await getTranslation(targetLang, apiBaseUrl, apiKey, apiModel, selection.text, tmCtx);
        console.log('Translated text:', translatedText);
        chrome.runtime.sendMessage({ translations: translatedText });
        try { chrome.runtime.sendMessage({ type: 'tm:add', src: selection.text, tgt: translatedText }); } catch { }

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
    console.log('Translated text:', translatedText);
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
    console.log('Selection:', selection);

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
