# Repository Guidelines
請使用台灣繁體中文回應 !重要

## 專案結構與模組
- `manifest.json`：擴充功能設定（MV3）與權限。
- `background.js`：Service Worker；側邊欄與右鍵選單整合。
- `content_script.js`：頁內 UI、選取偵測、快捷鍵與懸浮按鈕。
- `translate.js`：呼叫 API、處理回應與引號清理。
- `options.html`、`options.js`：設定頁、Profile 管理與剪貼簿功能。
- `icons/`、`img/`：擴充圖示與教學素材。

## 開發、建置與執行
- 本機載入：`chrome://extensions` → 開發人員模式 → 載入未封裝 → 選取此專案資料夾。
- 打包範例：`zip -r onekey-translator.zip manifest.json background.js content_script.js dom_utils.js translate.js options.html options.js icons _locales`
- 手測清單：
  - 文字選取後顯示「翻譯」按鈕並可運作。
  - 雙擊/三擊選取時計算座標與按鈕定位正確。
  - 右鍵「翻譯選取的文字」可更新側邊面板內容。
  - 設定頁可建立/重新命名/刪除 Profile；可翻譯並複製結果。

## 程式風格與命名
- 語言：原生 JavaScript（MV3），不使用打包器。
- 縮排：4 空白；一律使用分號。
- 引號：JS 使用單引號；JSON 使用雙引號。
- 命名：`camelCase` 用於變數/函式；檔名小寫且具描述性（如 `content_script.js`）。
- 樣式：頁面樣式置於 `options.html`；頁內僅少量必要的行內樣式。

## 測試指引
- 框架：無；以瀏覽器手動測試為主。
- 場景：一般頁面與可編輯區、快捷鍵、側邊同步、長頁面捲動、OpenAI 與 Azure 端點、Toast 顯示。
- 覆蓋目標：上述使用流程皆可順利完成。

## Commit 與 PR
- Commit：遵循 Conventional Commits（例：`feat: 新增側邊面板`、`fix: 修正選取座標`）。
- PR：提供描述、關聯 Issue、UI 截圖/GIF、測試步驟與瀏覽器版本。

## 安全與設定
- 金鑰：勿硬編碼；統一以 `chrome.storage.sync` 儲存。
- 端點：OpenAI 用 `Authorization: Bearer`；Azure 用 `api-key`。
- Base URL：避免結尾斜線（例如 `https://api.openai.com/v1/chat/completions`）。
- 段落門檻：`paraMinChars` 可於設定頁調整（預設 20）。

## content_script.js 分析與維護
- 職責：偵測選取/點擊，顯示「翻譯」按鈕，呼叫 `getTranslation`，並插入結果。
- 設定來源：透過 `chrome.storage.sync.get(['targetLang','apiBaseUrl','apiKey','apiModel','hotKey'])` 讀取；預設值見檔頭常數。
- 事件流程：
  - `mousedown`：隱藏舊按鈕 → 綁定 `keydown`（依 `hotKey` 觸發）→ 追蹤滑動選取並在 `mouseup` 後呼叫 `showTranslateButton`。
  - `dblclick`/三擊：直接 `showTranslateButton(isDoubleClick=true)`，按鈕改走雙擊翻譯路徑。
  - `keydown`（熱鍵）：對 `mousedown` 時的 `target` 執行 `translateShiftInput(target,text)`。
  - 按鈕 `mousedown`：一般模式走 `translateFocusedInput()`（取目前選取文字）；雙擊模式走 `translateDoubleClickInput()`。
- 按鈕定位：優先使用 `Selection` 的最後一個非零 `clientRect`，否則回退到事件座標；完成定位後再顯示以避免閃爍；考量 `window.scrollX/Y` 位移。
- 結果呈現：
  - 一般 Shift/熱鍵插入：`translateShiftInput` 仍以區塊附加到原內容尾端（使用 `textContent`，外層 `div` 有左框線樣式）。
  - 選取/雙擊/三擊：改用「懸浮彈窗」顯示，不更動原頁內容，並同步將查詢與翻譯送往側邊紀錄。
- 背景同步：以 `chrome.runtime.sendMessage` 發送 `selections`/`translations`，供側邊面板即時更新。
- 已知注意事項：
  - `keydown` 掛載於 `mousedown`，重複掛載以同函式參考為鍵，瀏覽器會去重；仍建議在適當時機移除以保守處理。
  - 目前僅處理視窗滾動，巢狀可捲動容器與 iframe 可能需額外偏移計算。
  - 段落模式會依 `paraMinChars` 略過過短的文字區塊（預設 20）。
  - 若 `...` 置於 `<a>` 內，點擊可能觸發導向；已在按鍵的 `mousedown`/`mouseup`/`click` 事件呼叫 `preventDefault + stopPropagation` 以阻擋導向。
  - 嚴格攔截：在文件層級以捕獲階段攔截 `.jk-para-btn` 的多種事件（click/mouse/pointer/touch/aux/contextmenu），同時在元件本身也阻擋，雙層保護避免任何跳轉。
  - 段落掃描以「最深層優先」並且若祖先已有子孫含 `jk-para-btn` 則跳過，以避免在祖先與子節點重複插入多個 `...`。
 - 視覺：段落內 `...` 按鈕（`.jk-para-btn`）在深色背景不易辨識，已統一使用不透明度 `0.8`（hover 變 `1`）並維持藍色底線字，以兼顧對比與干擾度。
- 標題白名單：即使位於非主要內容區（如頁首/側欄），`h1–h6` 與具標題語意的元素（包含 `data-testid` 含 `headline`/`title`）仍允許顯示「…」並可點擊翻譯，避免標題區域失效。
  - 標題白名單：即使位於非主要內容區（如頁首/側欄），`h1–h6` 與具標題語意的元素（包含 `data-testid` 含 `headline`/`title`）仍允許顯示「…」並可點擊翻譯，避免標題區域失效。
  - Twitter 支援：將 `[data-testid="tweetText"]` 納入白名單與掃描選取，即使為 inline 顯示也會在外側插入「…」按鈕，避免破壞版面。
  - 擴充掃描範圍：除一般段落外，會納入 `dd`、`#ranking-social`、`.module_aside--content` 與 `[data-testid="tweetText"]` 等側欄/社群模組樹內的文字節點進行標註與翻譯，確保排行榜/側欄/貼文內容也能覆蓋。

### 段落懸浮選單與自動翻譯
- 元件與 ID：`#jk-para-toggle`（右側浮動主按鈕，僅可垂直拖曳）、`#jk-para-menu`（選單）、`#jk-keep-dots`、`#jk-translate-all`、`.jk-para-btn`（段落內「…」）、`.jk-para-translation`（翻譯結果容器）。
- 觸發與佈局：滑鼠移入 `#jk-para-toggle` 顯示垂直選單（上方、水平置中）。定位先以隱形顯示量測寬高，避免 0 尺寸導致飄移；移出後延遲隱藏避免閃爍。
- 功能鍵：
  - `維持…`/`顯示…`（`#jk-keep-dots`）：切換是否顯示段落「…」。顯示時：`paragraphModeActive=true`、立即執行 `annotateParagraphs()` 並啟用 `enableParagraphAutoAnnotate()` 隨捲動/縮放自動補點；隱藏時：停用自動補點、移除所有「…」，且若正處於自動「全部翻譯」則一併停止。
  - `全部翻譯`（`#jk-translate-all`）：切換自動翻譯模式。啟用時註冊捲動/縮放監聽（`enableTranslateAllWatcher()`），僅對「視窗可見」的段落進行一次性標註並依序翻譯；停用時移除監聽（`disableTranslateAllWatcher()`）。一鍵模式 `translateAllParagraphButtons()` 亦僅翻譯當下可見段落並顯示對應 Toast。
- 其他行為：
  - 移除主按鈕點擊切換，所有段落相關功能均改由懸浮選單操作；主按鈕仍支援 Y 軸拖曳定位。
  - 以 `setupStrictInterceptors()` 在捕獲階段全面阻擋 `.jk-para-btn` 的滑鼠/指標/觸控事件，避免位於 `<a>` 內部造成跳轉。

### 選取翻譯彈窗（浮層）
- 元件與 ID：`#jk-float-popup`（彈窗）、`#jk-float-backdrop`（背景遮罩）。
- 觸發：
  - 選取文字按熱鍵、雙擊/三擊選取、或 Alt+選取（依 `hotKey`）均呼叫 `translateToPopup(text, rect)`。
- 內容與行為：
  - 初始顯示「翻譯中…」（使用 i18n `msg_translating`，無則退回預設文字），完成後更新譯文內容。
  - 標題列：包含「翻譯結果」與一個關閉按鈕（`#jk-float-close`）；可拖曳標題列移動視窗（`enablePopupDrag`）。
  - 背景遮罩：點擊遮罩可關閉彈窗並隱藏遮罩。
- 版面與尺寸：
  - 自適應寬度：`width: auto`，桌面最大寬度 `max-width: 50vw`；窄視窗（`max-width: 640px`）時上限為 `80vw`。
  - 高度上限 `max-height: 50vh`，內容區（`.jk-float-body`）自動捲動。
  - 文字換行：`word-break: break-word; overflow-wrap: anywhere;`，避免長字串撐破上限。
  - 定位：預設貼齊選取區塊右下；若無選取矩形則置中顯示；顯示前以隱形狀態量測尺寸再定位。
  - Z 軸：彈窗 `z-index: 1004`，遮罩 `z-index: 1003`，高於段落功能選單。
  - 無內嵌按鈕：彈窗不承擔「複製」等操作（後續如需可再擴充）。

## options.js 與設定頁維護
- 功能概覽：Profile 管理（新增/改名/刪除/切換）、全域目標語言、API 基本設定、快捷鍵與段落門檻、設定匯出/匯入、剪貼簿複製、頁內 i18n。
- 儲存結構：使用 `chrome.storage.sync`，Profile 以 `profile:{id}` 儲存；索引在 `profilesIndex`（`order` 與 `names`）；目前啟用為 `activeProfileId`；全域選項包含 `targetLang`、`hotKey`、`paraMinChars`；版本以 `schemaVersion` 標記。
- 重要函式：
  - `migrateIfNeeded()`：舊版搬遷→建立預設 Profile、移轉 `targetLang`。
  - `loadProfilesIndex()` / `ensureActiveProfile()` / `renderProfilesDropdown()`：維持與渲染 Profile 下拉。
  - `loadActiveProfileIntoForm()` / `updateActiveProfilePatch()`：同步表單與儲存。
  - `exportSettings()` / `importSettingsFromFile(file)` / `triggerImportPicker()`：設定匯出/匯入流程。

## 設定匯出/匯入
- UI：於 `options.html` 的「保存」右側新增兩個按鈕：
  - `#exportSettingsBtn`：以 JSON 下載目前設定檔。
  - `#importSettingsBtn`：從 JSON 檔案匯入（會覆蓋現有設定，先彈出確認）。
- 檔案內容：
  - 外層含 `__meta`（`name`、`exportedAt`、`version`）與 `settings` 物件；也接受單純的設定物件（for 向後相容）。
- 匯出/匯入的白名單鍵值（由 `pickAllowedSettings` 控制）：
  - `schemaVersion`、`profilesIndex`、`activeProfileId`、所有 `profile:*`、`targetLang`、`hotKey`、`paraMinChars`。
- 匯入後處理：
  - 寫入 `chrome.storage.sync` 後，重新載入 Profiles 索引、確保有效的 `activeProfileId`、重繪下拉並回填表單，顯示 i18n Toast。
- 失敗處理：
  - 讀檔或解析失敗會顯示 `msg_import_failed`；匯出錯誤顯示 `msg_export_failed`。

## 國際化（i18n）
- 標記方式：
  - 文字節點：於元素加上 `data-i18n="<key>"`，初始化時由 `localizePage()` 設定 `textContent`。
  - 屬性文案：使用 `data-i18n-attr` 指定屬性（如 `placeholder`、`title`）。
  - 獨立標題屬性：可用 `data-i18n-title` 直設 `title`（工具提示）。
- `options.js` 的 `localizePage()` 會處理上述三種情境，並設定 `<html lang>` 與 `document.title`。
- 新增的 i18n key（位於 `_locales/*/messages.json`）：
  - `btn_export_settings`、`title_export_settings`、`btn_import_settings`、`title_import_settings`
  - `msg_exported`、`msg_export_failed`、`msg_imported`、`msg_import_failed`
  - `confirm_import_settings`
  - 段落選單與 Toast：`menu_show_dots`、`menu_hide_dots`、`menu_translate_all`、`menu_stop_translate_all`、`toast_start_auto_translate`、`toast_stop_auto_translate`、`toast_no_visible_paras`、`toast_start_translating_n`、`toast_translate_all_done`
  - 彈窗標題/關閉：`popup_title`、`popup_close`、以及進度 `msg_translating`
- 新增/修改字串時請同步更新 `en`、`zh_TW`、`zh_CN`、`ja` 四套語系並保持 key 一致。

## 手測重點（設定頁）
- Profile 全流程：新增→切換→改名→刪除（至少保留 1 個）。
- i18n：切換瀏覽器語系時，按鈕、Placeholder、Title、Toast 文案皆符合該語系。
- 匯出：下載 JSON 檔，檢查 `__meta` 與 `settings`、以及 Profile 與全域鍵值是否齊全。
- 匯入：
  - 匯入相同架構檔案後，Profile 下拉與表單同步更新；顯示「已匯入設定」。
  - 匯入異常檔案（壞 JSON 或缺少 `settings`）會顯示「匯入失敗」。

## 手測重點（頁內段落）
- 懸浮選單：滑入 `#jk-para-toggle` 於其上方出現垂直選單；滑出延遲隱藏，不閃爍；拖曳主按鈕後再次滑入定位正確。
- 顯示/隱藏「…」：點擊「顯示…」即時補點，捲動與縮放會持續補點；點擊「隱藏…」會移除所有「…」並停用自動補點與自動翻譯。
- 全部翻譯：啟用後僅翻譯視窗內可見段落；捲動時持續對新進入視窗的段落翻譯；停用後不再觸發；過程中顯示本地化 Toast。
- 鍵值與在地化：選單兩個按鈕與所有 Toast 文字皆依瀏覽器語系正確顯示（含 `toast_start_translating_n` 的數量代入）。
- 連結內「…」：點擊不會觸發跳轉；段落內翻譯後不再補出重複的「…」。
- 視覺：深色背景下「…」可見度足夠（預設 opacity 0.8，hover 1），結果框樣式與原文區塊不衝突。
- 標題區可點：頁首或模組內的標題（`h1–h6`、headline/title 類元素）能顯示並響應「…」點擊，行為與一般段落一致。
- 側欄模組覆蓋：`#ranking-social`、`.module_aside--content` 等側欄排名/推薦模組中的文字能被標註並翻譯。
- 定義清單：`dl` 中的 `dd` 項目會被掃描與標註，點擊「…」可翻譯內文。
- Twitter：動態載入的推文文字（`[data-testid="tweetText"]`）會出現「…」，按下可翻譯；短推文若不足 `paraMinChars` 門檻則不顯示（可於設定頁調整門檻）。
- Reddit/社群網站相容：若站方把 `p/li/blockquote/h1–h6/dd` 改成 `display: inline`，仍會識別為可翻譯段落；`aria-hidden="true"` 的量測/追蹤節點會被略過。
 - 動態載入：啟用「顯示…」後會監看 DOM 變更（MutationObserver）並以 200ms 去抖動自動補點，涵蓋 Reddit 等滾動載入的留言。

## 手測重點（選取翻譯彈窗）
- 觸發：選取+熱鍵、雙擊、三擊皆能呼出彈窗，且不修改原頁內容。
- 翻譯流程：先顯示「翻譯中…」，完成後替換為最終譯文；側邊面板有同步紀錄。
- 定位：
  - 有選取矩形時，彈窗出現在其右下並不超出視窗；
  - 無選取矩形時，彈窗居中顯示。
- 尺寸：桌面最大 50vw、手機最大 80vw，長字不溢出（可正確換行），高度不超過 50vh 且內容可滾動。
- 關閉：點擊右上角關閉或點擊遮罩可關閉；關閉後遮罩消失。
- 拖曳：可透過標題列拖曳移動，拖曳過程不會選取頁面內容。
