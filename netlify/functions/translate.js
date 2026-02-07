/**
 * Netlify Function: DeepL Translation Proxy
 *
 * This function securely handles translation requests without exposing
 * the DeepL API key to the client.
 *
 * Environment Variables Required:
 * - DEEPL_API_KEY: Your DeepL API key
 * - DEEPL_API_TYPE: 'free' or 'paid' (determines which endpoint to use)
 */

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // Get API key from environment variable
    const apiKey = process.env.DEEPL_API_KEY;
    const apiType = process.env.DEEPL_API_TYPE || 'free';

    if (!apiKey) {
        console.error('DEEPL_API_KEY environment variable not set');
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Translation service not configured' })
        };
    }

    try {
        // Parse request body
        const { text, targetLang } = JSON.parse(event.body);

        // Validate input
        if (!text || !targetLang) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing required parameters: text, targetLang' })
            };
        }

        // Determine API endpoint based on account type
        const apiUrl = apiType === 'paid'
            ? 'https://api.deepl.com/v2/translate'
            : 'https://api-free.deepl.com/v2/translate';

        // Prepare request to DeepL
        const formData = new URLSearchParams();
        formData.append('text', text);
        formData.append('source_lang', 'EN');
        formData.append('target_lang', targetLang.toUpperCase());

        // Make request to DeepL API
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `DeepL-Auth-Key ${apiKey}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData.toString()
        });

        // Handle DeepL API errors
        if (!response.ok) {
            const errorText = await response.text();
            console.error('DeepL API error:', response.status, errorText);

            if (response.status === 403) {
                return {
                    statusCode: 403,
                    body: JSON.stringify({ error: 'Authentication failed' })
                };
            } else if (response.status === 456) {
                return {
                    statusCode: 429,
                    body: JSON.stringify({ error: 'Quota exceeded' })
                };
            } else {
                return {
                    statusCode: 500,
                    body: JSON.stringify({ error: 'Translation service error' })
                };
            }
        }

        // Parse and return translation
        const data = await response.json();
        const translation = data.translations && data.translations[0]
            ? data.translations[0].text
            : text;

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=3600' // Cache translations for 1 hour
            },
            body: JSON.stringify({
                translatedText: translation,
                detectedSourceLang: data.translations[0]?.detected_source_language || 'EN'
            })
        };

    } catch (error) {
        console.error('Translation function error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};
