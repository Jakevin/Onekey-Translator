document.addEventListener('DOMContentLoaded', async function () {

    // ===== i18n helper =====
    function t(key) {
        try {
            const msg = chrome.i18n ? chrome.i18n.getMessage(key) : '';
            return msg || key;
        } catch (e) {
            return key;
        }
    }

    function localizePage() {
        try {
            if (document && chrome.i18n) {
                const titleMsg = chrome.i18n.getMessage('options_title');
                if (titleMsg) document.title = titleMsg;
                document.documentElement.setAttribute('lang', chrome.i18n.getMessage('@@ui_locale') || 'en');
            }
            document.querySelectorAll('[data-i18n]').forEach(function (el) {
                const key = el.getAttribute('data-i18n');
                if (!key) return;
                const msg = t(key);
                const attr = el.getAttribute('data-i18n-attr');
                if (attr) {
                    el.setAttribute(attr, msg);
                } else {
                    el.textContent = msg;
                }
            });
            // Support separate title localization via data-i18n-title
            document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
                const key = el.getAttribute('data-i18n-title');
                if (!key) return;
                const msg = t(key);
                el.setAttribute('title', msg);
            });
        } catch (e) {
            // ignore
        }
    }

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

    // 自動依內容調整高度（防呆：元素不存在則直接返回）
    function autoResize(el) {
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
    }

    // ===== Profiles Support (Start) =====
    // Promise 版 storage
    function storageGet(keys) {
        return new Promise((resolve, reject) => {
            chrome.storage.sync.get(keys, (res) => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError); else resolve(res);
            });
        }).catch(e => { showToast(t('err_storage')); throw e; });
    }
    function storageSet(obj) {
        return new Promise((resolve, reject) => {
            chrome.storage.sync.set(obj, () => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError); else resolve();
            });
        }).catch(e => { showToast(t('err_storage')); throw e; });
    }
    function storageRemove(keys) {
        return new Promise((resolve, reject) => {
            chrome.storage.sync.remove(keys, () => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError); else resolve();
            });
        }).catch(e => { showToast(t('err_storage')); throw e; });
    }

    function generateProfileId(existingIds = []) {
        const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
        for (let attempt = 0; attempt < 5; attempt++) {
            let id = '';
            const len = 8 + Math.floor(Math.random() * 3); // 8~10
            for (let i = 0; i < len; i++) {
                id += alphabet[Math.floor(Math.random() * alphabet.length)];
            }
            if (!existingIds.includes(id)) return id;
        }
        // fallback
        return 'p' + Date.now().toString(36);
    }

    function normalizeBaseUrl(url) {
        if (!url) return '';
        return url.replace(/\/+$/, '');
    }

    async function migrateIfNeeded() {
        const all = await storageGet(null);
        const need = all.schemaVersion === undefined
            && !Object.keys(all).some(k => k.startsWith('profile:'))
            && all.profilesIndex === undefined;
        if (!need) return;
        const defaultBaseUrl = all.apiBaseUrl || 'https://api.openai.com/v1/chat/completions';
        const profileId = generateProfileId();
        const profile = {
            id: profileId,
            name: t('profile_default_name'),
            api: {
                baseUrl: normalizeBaseUrl(defaultBaseUrl),
                key: all.apiKey || '',
                model: all.apiModel || 'gpt-5-mini'
            },
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        await storageSet({
            ['profile:' + profileId]: profile,
            profilesIndex: { order: [profileId], names: { [profileId]: t('profile_default_name') } },
            activeProfileId: profileId,
            schemaVersion: 1
        });
        // 將舊 targetLang 轉為全域設定，並移除舊 API keys（保留 hotKey）
        if (all.targetLang) {
            await storageSet({ targetLang: all.targetLang });
        }
        await storageRemove(['apiBaseUrl', 'apiKey', 'apiModel']);
    }

    async function loadProfilesIndex() {
        const { profilesIndex } = await storageGet(['profilesIndex']);
        if (profilesIndex) return profilesIndex;
        // 建立 default profile
        const id = generateProfileId();
        const profile = {
            id,
            name: t('profile_default_name'),
            api: {
                baseUrl: 'https://api.openai.com/v1/chat/completions',
                key: '',
                model: 'gpt-5-mini'
            },
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        const index = { order: [id], names: { [id]: t('profile_default_name') } };
        await storageSet({
            ['profile:' + id]: profile,
            profilesIndex: index,
            activeProfileId: id
        });
        return index;
    }

    async function loadProfile(id) {
        const data = await storageGet(['profile:' + id]);
        return data['profile:' + id] || null;
    }

    async function ensureActiveProfile(profilesIndex) {
        const { activeProfileId } = await storageGet(['activeProfileId']);
        let id = activeProfileId;
        if (!id || !profilesIndex.order.includes(id)) {
            id = profilesIndex.order[0];
            await storageSet({ activeProfileId: id });
        }
        return id;
    }

    async function renderProfilesDropdown(profilesIndex, activeId) {
        if (!profileSelect) return;
        while (profileSelect.firstChild) profileSelect.removeChild(profileSelect.firstChild);
        profilesIndex.order.forEach(id => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = profilesIndex.names[id] || id;
            profileSelect.appendChild(opt);
        });
        profileSelect.value = activeId;
        if (deleteProfileBtn) {
            deleteProfileBtn.disabled = profilesIndex.order.length <= 1;
        }
    }

    async function loadActiveProfileIntoForm() {
        const { activeProfileId } = await storageGet(['activeProfileId']);
        if (!activeProfileId) return;
        const profile = await loadProfile(activeProfileId);
        if (!profile) return;
        // targetLang 與 profile 無關：優先使用全域設定，無則回退到舊 profile 值或預設
        const { targetLang: globalTargetLang, hotKey, paraMinChars } = await storageGet(['targetLang','hotKey','paraMinChars']);
        targetLangView.value = globalTargetLang || profile.targetLang || 'us-en 美式英文';
        apiBaseUrlView.value = profile.api?.baseUrl || 'https://api.openai.com/v1/chat/completions';
        apiKeyView.value = profile.api?.key || '';
        apiModelView.value = profile.api?.model || 'gpt-5-mini';
        hotKeyView.value = hotKey || 'altKey';
        if (paraMinCharsView) paraMinCharsView.value = (typeof paraMinChars === 'number' && !isNaN(paraMinChars)) ? paraMinChars : 20;
    }

    async function updateActiveProfilePatch(patch) {
        const { activeProfileId } = await storageGet(['activeProfileId']);
        if (!activeProfileId) return;
        const profile = await loadProfile(activeProfileId);
        if (!profile) return;
        const merged = { ...profile };
        if (patch.api) {
            merged.api = { ...profile.api, ...patch.api };
        }
        Object.keys(patch).forEach(k => {
            if (k === 'api') return;
            merged[k] = patch[k];
        });
        merged.updatedAt = Date.now();
        await storageSet({ ['profile:' + activeProfileId]: merged });
    }

    async function setActiveProfile(id) {
        await storageSet({ activeProfileId: id });
        activeProfileIdCache = id;
        await loadActiveProfileIntoForm();
    }

    async function createProfile() {
        const name = prompt(t('prompt_profile_name'));
        if (!name) return;
        const profilesIndex = await loadProfilesIndex();
        if (profilesIndex.order.some(id => profilesIndex.names[id] === name)) {
            showToast(t('msg_name_exists'));
            return;
        }
        const newId = generateProfileId(profilesIndex.order);
        const profile = {
            id: newId,
            name,
            api: {
                baseUrl: normalizeBaseUrl(apiBaseUrlView.value || 'https://api.openai.com/v1/chat/completions'),
                key: '',
                model: apiModelView.value || 'gpt-5-mini'
            },
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        profilesIndex.order.push(newId);
        profilesIndex.names[newId] = name;
        await storageSet({
            ['profile:' + newId]: profile,
            profilesIndex,
            activeProfileId: newId
        });
        await renderProfilesDropdown(profilesIndex, newId);
        await loadActiveProfileIntoForm();
        showToast(t('msg_profile_created'));
    }

    async function renameProfile() {
        const profilesIndex = await loadProfilesIndex();
        const { activeProfileId } = await storageGet(['activeProfileId']);
        if (!activeProfileId) return;
        const currentName = profilesIndex.names[activeProfileId] || '';
        const newName = prompt(t('prompt_new_name'), currentName);
        if (!newName || newName === currentName) return;
        if (profilesIndex.order.some(id => profilesIndex.names[id] === newName)) {
            showToast(t('msg_name_exists'));
            return;
        }
        profilesIndex.names[activeProfileId] = newName;
        await storageSet({ profilesIndex });
        await renderProfilesDropdown(profilesIndex, activeProfileId);
        showToast(t('msg_renamed'));
    }

    async function deleteProfile() {
        const profilesIndex = await loadProfilesIndex();
        if (profilesIndex.order.length <= 1) {
            showToast(t('msg_keep_one_profile'));
            return;
        }
        const { activeProfileId } = await storageGet(['activeProfileId']);
        if (!activeProfileId) return;
        if (!confirm(t('confirm_delete_profile'))) return;
        const idx = profilesIndex.order.indexOf(activeProfileId);
        if (idx >= 0) profilesIndex.order.splice(idx, 1);
        delete profilesIndex.names[activeProfileId];
        await storageRemove(['profile:' + activeProfileId]);
        // 新 active
        const newActive = profilesIndex.order[0];
        await storageSet({ profilesIndex, activeProfileId: newActive });
        await renderProfilesDropdown(profilesIndex, newActive);
        await loadActiveProfileIntoForm();
        showToast(t('msg_profile_deleted'));
    }
    // ===== Profiles Support (End) =====

    // 抓取既有元素
    const sourceText = document.getElementById('sourceText');
    const resultText = document.getElementById('resultText');
    const clearButton = document.getElementById('clearButton');

    const targetLangView = document.getElementById('targetLang');
    const apiBaseUrlView = document.getElementById('apiBaseUrl');
    const apiKeyView = document.getElementById('apiKey');
    const apiModelView = document.getElementById('apiModel');
    const hotKeyView = document.getElementById('hotKey');
    const paraMinCharsView = document.getElementById('paraMinChars');

    // 新增 Profiles UI 元件
    const profileSelect = document.getElementById('profileSelect');
    const addProfileBtn = document.getElementById('addProfileBtn');
    const renameProfileBtn = document.getElementById('renameProfileBtn');
    const deleteProfileBtn = document.getElementById('deleteProfileBtn');
    const exportSettingsBtn = document.getElementById('exportSettingsBtn');
    const importSettingsBtn = document.getElementById('importSettingsBtn');

    let activeProfileIdCache = null;

    // 初始化執行一次高度調整
    autoResize(sourceText);
    autoResize(resultText);

    // 綁定 input 事件動態調整高度
    if (sourceText) {
        sourceText.addEventListener('input', function () { autoResize(this); });
    }
    if (resultText) {
        resultText.addEventListener('input', function () { autoResize(this); });
    }

    // ---- 初始載入流程 ----
    localizePage();
    // 1. Migrate
    await migrateIfNeeded();
    // 2. Load index (create default if none)
    let profilesIndex = await loadProfilesIndex();
    // 3. ensure active
    activeProfileIdCache = await ensureActiveProfile(profilesIndex);
    // 4. render dropdown
    await renderProfilesDropdown(profilesIndex, activeProfileIdCache);
    // 5. load active profile into form
    await loadActiveProfileIntoForm();
    // 6. hotKey 已在 loadActiveProfileIntoForm 一併讀取

    // 監聽 targetLang 變更
    targetLangView.addEventListener('change', async function () {
        await doTranslate();
        // 僅更新全域 targetLang
        await storageSet({ targetLang: targetLangView.value || 'us-en 美式英文' });
    });

    // 保存設置按鈕
    document.getElementById('saveButton').addEventListener('click', function () {
        saveSetting();
    });

    // Profiles 相關事件綁定
    if (profileSelect) {
        profileSelect.addEventListener('change', async function () {
            await setActiveProfile(profileSelect.value);
        });
    }
    if (addProfileBtn) {
        addProfileBtn.addEventListener('click', async function () {
            await createProfile();
            profilesIndex = await loadProfilesIndex();
        });
    }
    if (renameProfileBtn) {
        renameProfileBtn.addEventListener('click', async function () {
            await renameProfile();
            profilesIndex = await loadProfilesIndex();
        });
    }
    if (deleteProfileBtn) {
        deleteProfileBtn.addEventListener('click', async function () {
            await deleteProfile();
            profilesIndex = await loadProfilesIndex();
        });
    }

    // ===== Settings Export / Import =====
    function pickAllowedSettings(all) {
        const allowKeys = new Set([
            'schemaVersion', 'profilesIndex', 'activeProfileId',
            'targetLang', 'hotKey', 'paraMinChars'
        ]);
        const out = {};
        // copy allowed top-level keys
        for (const k of Object.keys(all)) {
            if (allowKeys.has(k) || k.startsWith('profile:')) {
                out[k] = all[k];
            }
        }
        return out;
    }

    async function exportSettings() {
        try {
            const all = await storageGet(null);
            const data = pickAllowedSettings(all);
            const payload = {
                __meta: {
                    name: 'Onekey-Translator Settings',
                    exportedAt: new Date().toISOString(),
                    version: all.schemaVersion || 1
                },
                settings: data
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const ts = new Date().toISOString().replace(/[:]/g, '').replace(/\..+$/, '');
            a.href = url;
            a.download = `onekey-translator-settings-${ts}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            showToast(t('msg_exported'));
        } catch (e) {
            console.error('Export failed', e);
            showToast(t('msg_export_failed'));
        }
    }

    async function importSettingsFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error);
            reader.onload = async () => {
                try {
                    const text = String(reader.result || '');
                    const parsed = JSON.parse(text);
                    const settings = parsed && parsed.settings && typeof parsed.settings === 'object'
                        ? parsed.settings
                        : (typeof parsed === 'object' ? parsed : null);
                    if (!settings) throw new Error('Invalid settings file');
                    const toSet = pickAllowedSettings(settings);
                    // Apply imported settings
                    await storageSet(toSet);
                    // Refresh UI to reflect imported values
                    const idx = await loadProfilesIndex();
                    const active = await ensureActiveProfile(idx);
                    await renderProfilesDropdown(idx, active);
                    await loadActiveProfileIntoForm();
                    showToast(t('msg_imported'));
                    resolve();
                } catch (err) {
                    reject(err);
                }
            };
            reader.readAsText(file);
        });
    }

    function triggerImportPicker() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.style.display = 'none';
        input.addEventListener('change', async () => {
            const file = input.files && input.files[0];
            input.remove();
            if (!file) return;
            try {
                if (!confirm(t('confirm_import_settings'))) return;
                await importSettingsFromFile(file);
            } catch (e) {
                console.error('Import failed', e);
                showToast(t('msg_import_failed'));
            }
        });
        document.body.appendChild(input);
        input.click();
    }

    if (exportSettingsBtn) {
        exportSettingsBtn.addEventListener('click', exportSettings);
    }
    if (importSettingsBtn) {
        importSettingsBtn.addEventListener('click', triggerImportPicker);
    }

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (changes.selections) {
            console.log('selections changed:', changes.selections.newValue);
            sourceText.value = changes.selections.newValue;
            autoResize(sourceText);
        } else if (changes.translations) {
            console.log('translations changed:', changes.translations.newValue);
            resultText.value = changes.translations.newValue;
            autoResize(resultText);
        } else if (changes.menuSelections) {
            console.log('menuSelections changed:', changes.menuSelections.newValue);
            sourceText.value = changes.menuSelections.newValue;
            autoResize(sourceText);
            doTranslate();
        }
    });

    document.getElementById('translatorButton').addEventListener('click', async function () {
        await doTranslate();
    });

    // 清除按鈕：僅清空來源，不清空結果
    if (clearButton && sourceText) {
        clearButton.addEventListener('click', function () {
            sourceText.value = '';
            autoResize(sourceText);
        });
    }

    document.getElementById('copyButton').addEventListener('click', async function () {
        navigator.clipboard.writeText(resultText.value).then(() => {
            showToast(t('msg_copied'));
        }).catch(err => {
            console.error('Failed to copy: ', err);
        });
    });

    async function doTranslate() {
        const targetLang = targetLangView.value;
        const apiBaseUrl = apiBaseUrlView.value;
        const apiKey = apiKeyView.value;
        const apiModel = apiModelView.value;
        showToast(t('msg_translating'));
        const translatedText = await getTranslation(targetLang, apiBaseUrl, apiKey, apiModel, sourceText.value);
        resultText.value = translatedText;
        autoResize(resultText);
    }

    async function saveSetting() {
        const targetLang = targetLangView.value;
        const apiBaseUrl = normalizeBaseUrl(apiBaseUrlView.value);
        const apiKey = apiKeyView.value;
        const apiModel = apiModelView.value;
        const hotKey = hotKeyView.value;
        const paraMinChars = Math.max(0, parseInt(paraMinCharsView && paraMinCharsView.value ? paraMinCharsView.value : 20, 10) || 20);
        // 更新 profile（僅 API 設定）
        await updateActiveProfilePatch({
            api: { baseUrl: apiBaseUrl, key: apiKey, model: apiModel }
        });
        // 更新全域 targetLang
        await storageSet({ targetLang: targetLang || 'us-en 美式英文' });
        // 更新獨立 hotKey 與 段落按鍵門檻
        await storageSet({ hotKey: hotKey, paraMinChars: paraMinChars });
    }
});
