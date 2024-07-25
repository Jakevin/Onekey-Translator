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
let apiModel = 'gpt-4o-mini';
let useSelectionOnly = true;


function loadSettings() {
    // 加載用戶設置
    chrome.storage.sync.get(['targetLang', 'apiBaseUrl', 'apiKey', 'apiModel', 'useSelectionOnly'], function (items) {
        targetLang = items.targetLang || 'us-en 美式英文';
        apiBaseUrl = items.apiBaseUrl || 'https://api.openai.com/v1/chat/completions';
        apiKey = items.apiKey || '';
        apiModel = items.apiModel || 'gpt-4o-mini';
        useSelectionOnly = items.useSelectionOnly || true;
    });
}

// 加載用戶設置
loadSettings()

// 在頁面加載時創建翻譯按鈕並綁定事件
document.addEventListener("mousedown", () => {
    hideTranslateButton();
    detectSelect(document, (event) => {
        console.log('Selecting... showTranslateButton');
        showTranslateButton(event);
    });
});

// document.addEventListener("dblclick", (event) => {
//     showTranslateButton(event, true);
// });

document.addEventListener("click", (event) => {
    // triple click
    if (event.detail === 3 && !useSelectionOnly) {
        showTranslateButton(event, true);
    }
});

function showTranslateButton(event, isDoubleClick = false) {
    loadSettings()

    if (isDoubleClick) {
        translateFocusedInput();
        return
    }

    let translateButton = document.getElementById('translate-button');
    if (!translateButton) {
        translateButton = document.createElement('button');
        translateButton.id = 'translate-button';
        translateButton.textContent = '翻譯';
        translateButton.style.position = 'absolute';
        translateButton.style.zIndex = '1000';
        translateButton.style.backgroundColor = '#333';
        translateButton.style.color = '#fff';
        translateButton.style.border = 'none';
        translateButton.style.borderRadius = '5px';
        translateButton.style.padding = '5px';
        translateButton.style.cursor = 'pointer';
        translateButton.style.fontSize = '12px';
        translateButton.style.boxShadow = '0px 2px 4px rgba(0, 0, 0, 0.2)';
        translateButton.addEventListener("mousedown", translateFocusedInput);
        document.body.appendChild(translateButton);
    }

    const activeElement = document.activeElement;
    if (activeElement) {
        const OffsetXValue = 10, OffsetYValue = 20;
        let xBias = OffsetXValue, yBias = OffsetYValue;

        let xPosition = event.x + xBias;
        let yPosition = event.y + yBias;

        originScrollX = scrollingElement[scrollPropertyX];
        originScrollY = scrollingElement[scrollPropertyY];
        originPositionX = xPosition;
        originPositionY = yPosition;

        let distanceX = originScrollX - scrollingElement[scrollPropertyX];
        let distanceY = originScrollY - scrollingElement[scrollPropertyY];

        translateButton.style.top = `${originPositionY + distanceY}px`;
        translateButton.style.left = `${originPositionX + distanceX}px`;
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

async function translateFocusedInput() {
    console.log('Translating focused input...');
    // 加載用戶設置
    const items = await chrome.storage.sync.get(['targetLang', 'apiBaseUrl', 'apiKey', 'apiModel', 'useSelectionOnly'])
    targetLang = items.targetLang || 'us-en 美式英文';
    apiBaseUrl = items.apiBaseUrl || 'https://api.openai.com/v1/chat/completions';
    apiKey = items.apiKey || '';
    apiModel = items.apiModel || 'gpt-4o-mini';
    useSelectionOnly = items.useSelectionOnly || true;


    let selection = getSelections();
    if (selection.text && selection.text.length > 0) {
        chrome.runtime.sendMessage({ selections: selection.text });

        const translatedText = await getTranslation(targetLang, apiBaseUrl, apiKey, apiModel, selection.text);
        console.log('Translated text:', translatedText);

        navigator.clipboard.writeText(translatedText).then(() => {
            chrome.runtime.sendMessage({ translations: translatedText });

            showToast('翻譯結果已複製到剪貼簿');
        }).catch(err => {
            console.error('Failed to copy: ', err);
        });
    }
    hideTranslateButton();
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
`;
document.head.appendChild(style);