export class OpenAIProvider {
    name = 'openai';
    apiKey;
    baseUrl = 'https://api.openai.com/v1';
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    async complete(request) {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: request.model,
                messages: request.messages,
                temperature: request.temperature ?? 1,
                max_tokens: request.maxTokens ?? 4096,
            }),
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`OpenAI API error: ${response.status} ${error}`);
        }
        const data = await response.json();
        return {
            content: data.choices[0]?.message?.content ?? '',
            usage: {
                inputTokens: data.usage.prompt_tokens,
                outputTokens: data.usage.completion_tokens,
            },
        };
    }
}
