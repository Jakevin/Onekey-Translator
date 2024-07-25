document.addEventListener('DOMContentLoaded', async function () {

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
        }, 3000);
    }

    const sourceText = document.getElementById('sourceText');
    const resultText = document.getElementById('resultText');

    const targetLangView = document.getElementById('targetLang');
    const apiBaseUrlView = document.getElementById('apiBaseUrl');
    const apiKeyView = document.getElementById('apiKey');
    const apiModelView = document.getElementById('apiModel');
    const useSelectionOnlyView = document.getElementById('useSelectionOnly');


    // 獲取已保存的設置並顯示在表單中
    const items = await chrome.storage.sync.get(['targetLang', 'apiBaseUrl', 'apiKey', 'apiModel', 'useSelectionOnly']);
    targetLangView.value = items.targetLang || 'us-en 美式英文';
    apiBaseUrlView.value = items.apiBaseUrl || 'https://api.openai.com/v1/chat/completions';
    apiKeyView.value = items.apiKey || '';
    apiModelView.value = items.apiModel || 'gpt-4o-mini';
    useSelectionOnlyView.checked = items.useSelectionOnly || true;

    // 保存設置
    document.getElementById('saveButton').addEventListener('click', function () {
        const targetLang = targetLangView.value;
        const apiBaseUrl = apiBaseUrlView.value;
        const apiKey = apiKeyView.value;
        const apiModel = apiModelView.value;
        const useSelectionOnly = useSelectionOnlyView.checked;

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

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (changes.selections) {
            console.log('selections changed:', changes.selections.newValue);
            sourceText.value = changes.selections.newValue;
        } else if (changes.translations) {
            console.log('translations changed:', changes.translations.newValue);
            resultText.value = changes.translations.newValue;
        }
    })


    document.getElementById('translatorButton').addEventListener('click', async function () {
        const targetLang = targetLangView.value;
        const apiBaseUrl = apiBaseUrlView.value;
        const apiKey = apiKeyView.value;
        const apiModel = apiModelView.value;

        showToast('翻譯中...');

        const translatedText = await getTranslation(targetLang, apiBaseUrl, apiKey, apiModel, sourceText.value);
        resultText.value = translatedText;
    })

    document.getElementById('copyButton').addEventListener('click', async function () {
        navigator.clipboard.writeText(resultText.value).then(() => {
            showToast('翻譯結果已複製到剪貼簿');
        }).catch(err => {
            console.error('Failed to copy: ', err);
        });
    })
});