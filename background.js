// background.js

chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })

});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.selections) {
        chrome.storage.local.get('selectedText', (result) => {
            chrome.storage.local.set({ selections: request.selections }, () => {
                console.log('selections saved:', request.selections);
            });
        });
    } else if (request.translations) {
        chrome.storage.local.get('translationText', (result) => {
            chrome.storage.local.set({ translations: request.translations }, () => {
                console.log('translations saved:', request.translations);
            });
        });
    }
});