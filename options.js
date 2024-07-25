document.addEventListener('DOMContentLoaded', function () {
    // 獲取已保存的設置並顯示在表單中
    chrome.storage.sync.get(['targetLang', 'apiBaseUrl', 'apiKey', 'apiModel', 'useSelectionOnly'], function (items) {
        document.getElementById('targetLang').value = items.targetLang || 'us-en 美式英文';
        document.getElementById('apiBaseUrl').value = items.apiBaseUrl || 'https://api.openai.com/v1/chat/completions';
        document.getElementById('apiKey').value = items.apiKey || '';
        document.getElementById('apiModel').value = items.apiModel || 'gpt-4o-mini';
        document.getElementById('useSelectionOnly').checked = items.useSelectionOnly || true;

    });

    // 保存設置
    document.getElementById('saveButton').addEventListener('click', function () {
        const targetLang = document.getElementById('targetLang').value;
        const apiBaseUrl = document.getElementById('apiBaseUrl').value;
        const apiKey = document.getElementById('apiKey').value;
        const apiModel = document.getElementById('apiModel').value;
        const useSelectionOnly = document.getElementById('useSelectionOnly').checked;

        chrome.storage.sync.set({
            targetLang: targetLang,
            apiBaseUrl: apiBaseUrl,
            apiKey: apiKey,
            apiModel: apiModel,
            useSelectionOnly: useSelectionOnly
        }, function () {
            window.close(); // 直接關閉設置頁面
        });
    });
});