async function getTranslation(targetLang, apiBaseUrl, apiKey, apiModel, text, tmContext) {
    const messages = [];

    // System/style instruction with consistency requirement
    messages.push({
        role: 'system',
        content: [
            '你是專業的翻譯員。',
            '要求：',
            '1) 僅輸出譯文，不要音標、註解或額外說明。',
            '2) 使用簡潔口吻並符合指定目標語言。',
            '3) 專有名詞、人名、產品名稱、術語需在同一會話中保持一致。',
            '4) 若提供了既有譯文或譯名，請嚴格沿用。'
        ].join('\n')
    });

    // Provide recent confirmed pairs as soft glossary/context
    if (tmContext && Array.isArray(tmContext.pairs) && tmContext.pairs.length > 0) {
        const lines = tmContext.pairs.map((p, idx) => {
            const s = (p && typeof p.src === 'string') ? p.src : '';
            const t = (p && typeof p.tgt === 'string') ? p.tgt : '';
            return `${idx + 1}. 原文：${s}\n   譯文：${t}`;
        });
        messages.push({
            role: 'system',
            content: '以下是此會話中先前已採用的譯名與譯文（請保持一致）：\n' + lines.join('\n')
        });
    }

    messages.push({
        role: 'user',
        content: `請翻譯為「${targetLang}」，僅輸出譯文（不要音標與註解）。\n---\n${text}`
    });

    try {
        const headers = {
            'Content-Type': 'application/json'
        }
        if (apiBaseUrl.indexOf('openai.azure.com') > 0) {
            headers['api-key'] = apiKey;
        } else {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await fetch(apiBaseUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                "model": apiModel,
                "messages": messages,
                stream: false
            })
        });

        const responseJson = await response.json();
        console.log(responseJson);

        if (responseJson.choices && responseJson.choices[0]?.message?.content) {
            let textOut = responseJson.choices[0].message.content.trim();
            // 若開頭與結尾有成對引號，移除它們
            const pairs = [
                ['"', '"'],
                ['\'', '\''],
                ['“', '”'],
                ['「', '」'],
                ['`', '`']
            ];
            for (const [open, close] of pairs) {
                if (textOut.startsWith(open) && textOut.endsWith(close) && textOut.length >= open.length + close.length) {
                    textOut = textOut.slice(open.length, -close.length).trim();
                    break;
                }
            }
            return textOut;
        } else {
            console.error("API response is missing expected data.");
            return null;
        }
    } catch (error) {
        console.error('Error fetching translation:', error);
        return null;
    }
}
