// background.js

chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })

    chrome.contextMenus.create({
        id: "translate",
        title: "翻譯選取的文字",
        contexts: ["selection"]
    });
});



// In-memory per-tab translation memory: { [tabId]: [{ src, tgt }] }
const TM = new Map();

function getTabIdFromSender(sender) {
    try {
        return sender && sender.tab && typeof sender.tab.id === 'number' ? sender.tab.id : null;
    } catch (e) {
        return null;
    }
}

function tmAdd(tabId, src, tgt, limit = 50) {
    if (!tabId || !src || !tgt) return;
    const arr = TM.get(tabId) || [];
    arr.push({ src, tgt });
    // Cap memory to last N items
    if (arr.length > limit) arr.splice(0, arr.length - limit);
    TM.set(tabId, arr);
}

function tmGet(tabId, count = 8) {
    const arr = TM.get(tabId) || [];
    if (count <= 0) return [];
    return arr.slice(Math.max(0, arr.length - count));
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Side panel state (existing behavior)
    if (request.selections) {
        chrome.storage.local.set({ selections: request.selections }, () => {
            console.log('selections saved:', request.selections);
        });
    } else if (request.translations) {
        chrome.storage.local.set({ translations: request.translations }, () => {
            console.log('translations saved:', request.translations);
        });
    }

    // Translation memory API
    if (request && request.type === 'tm:add') {
        const tabId = getTabIdFromSender(sender);
        tmAdd(tabId, request.src, request.tgt);
        sendResponse && sendResponse({ ok: true });
        return; // not async
    }
    if (request && request.type === 'tm:get') {
        const tabId = getTabIdFromSender(sender);
        const limit = typeof request.limit === 'number' ? request.limit : 8;
        const pairs = tmGet(tabId, limit);
        sendResponse && sendResponse({ ok: true, pairs });
        return; // not async
    }
});

// Clear TM when tab is reloaded or closed
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
        TM.delete(tabId);
    }
});
chrome.tabs.onRemoved.addListener((tabId) => {
    TM.delete(tabId);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    try { console.log('Context menu clicked:', info, tab); } catch {}
    if (info && info.menuItemId === "translate" && info.selectionText) {
        chrome.storage.local.set({ menuSelections: info.selectionText }, () => {
            try { console.log('menuSelections saved:', info.selectionText); } catch {}
        });
    }
});
