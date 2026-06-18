const DEFAULT_CONFIG = {
    thresholdTokens: 4000,
    keepRecentCount: 10,
};
export class ContextCompressor {
    config;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    estimateTokens(text) {
        return Math.ceil(text.length * 0.4);
    }
    needsCompression(messages) {
        const total = messages.reduce((sum, m) => sum + this.estimateTokens(m.content), 0);
        return total > this.config.thresholdTokens && messages.length > this.config.keepRecentCount;
    }
    buildContext(messages, baseSystemPrompt, llmSummarizeFn) {
        const totalTokens = messages.reduce((sum, m) => sum + this.estimateTokens(m.content), 0);
        if (totalTokens <= this.config.thresholdTokens ||
            messages.length <= this.config.keepRecentCount) {
            return {
                systemMessages: [baseSystemPrompt],
                chatMessages: messages,
                compressedCount: 0,
                summary: '',
            };
        }
        const splitPoint = messages.length - this.config.keepRecentCount;
        const toCompress = messages.slice(0, splitPoint);
        const recent = messages.slice(splitPoint);
        const rawSummary = toCompress
            .map((m) => `[${m.role}] ${m.content.substring(0, 300)}${m.content.length > 300 ? '...' : ''}`)
            .join('\n---\n');
        const summary = `Previous conversation summary (${toCompress.length} messages compressed):\n${rawSummary.substring(0, 2000)}`;
        return {
            systemMessages: [baseSystemPrompt, summary],
            chatMessages: recent,
            compressedCount: toCompress.length,
            summary,
        };
    }
}
//# sourceMappingURL=ContextCompressor.js.map