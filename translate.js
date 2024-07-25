async function getTranslation(targetLang, apiBaseUrl, apiKey, apiModel, text) {
    const messages = [
        {
            "role": "user",
            "content": `"${text}"，用"${targetLang}"簡短翻譯，不要發音、注解。`
        }
    ];

    try {
        const response = await fetch(apiBaseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                "model": apiModel,
                "messages": messages,
                "max_tokens": 200,
                stream: false
            })
        });

        const responseJson = await response.json();
        console.log(responseJson);

        if (responseJson.choices && responseJson.choices[0].message.content) {
            return responseJson.choices[0].message.content.trim();
        } else {
            console.error("API response is missing expected data.");
            return null;
        }
    } catch (error) {
        console.error('Error fetching translation:', error);
        return null;
    }
}
