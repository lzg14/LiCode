export class AnthropicProvider {
    name = 'anthropic';
    apiKey;
    baseUrl = 'https://api.anthropic.com/v1';
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    async complete(request) {
        const response = await fetch(`${this.baseUrl}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
                model: request.model,
                messages: request.messages,
                max_tokens: request.maxTokens ?? 4096,
                temperature: request.temperature ?? 1,
            }),
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Anthropic API error: ${response.status} ${error}`);
        }
        const data = await response.json();
        return {
            content: data.content[0]?.text ?? '',
            usage: {
                inputTokens: data.usage.input_tokens,
                outputTokens: data.usage.output_tokens,
            },
        };
    }
}
