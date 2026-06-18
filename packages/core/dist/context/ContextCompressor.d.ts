export interface CompressionConfig {
    thresholdTokens: number;
    keepRecentCount: number;
}
interface ContextMessage {
    role: string;
    content: string;
}
interface CompressionResult {
    systemMessages: string[];
    chatMessages: ContextMessage[];
    compressedCount: number;
    summary: string;
}
export declare class ContextCompressor {
    private config;
    constructor(config?: Partial<CompressionConfig>);
    estimateTokens(text: string): number;
    needsCompression(messages: ContextMessage[]): boolean;
    buildContext(messages: ContextMessage[], baseSystemPrompt: string, llmSummarizeFn?: (text: string) => Promise<string>): CompressionResult;
}
export {};
//# sourceMappingURL=ContextCompressor.d.ts.map