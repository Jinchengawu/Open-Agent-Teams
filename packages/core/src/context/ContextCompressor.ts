export interface CompressionConfig {
  thresholdTokens: number;
  keepRecentCount: number;
}

const DEFAULT_CONFIG: CompressionConfig = {
  thresholdTokens: 4000,
  keepRecentCount: 10,
};

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

export class ContextCompressor {
  private config: CompressionConfig;

  constructor(config?: Partial<CompressionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length * 0.4);
  }

  needsCompression(messages: ContextMessage[]): boolean {
    const total = messages.reduce(
      (sum, m) => sum + this.estimateTokens(m.content),
      0
    );
    return total > this.config.thresholdTokens && messages.length > this.config.keepRecentCount;
  }

  buildContext(
    messages: ContextMessage[],
    baseSystemPrompt: string,
    llmSummarizeFn?: (text: string) => Promise<string>
  ): CompressionResult {
    const totalTokens = messages.reduce(
      (sum, m) => sum + this.estimateTokens(m.content),
      0
    );

    if (
      totalTokens <= this.config.thresholdTokens ||
      messages.length <= this.config.keepRecentCount
    ) {
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
      .map(
        (m) =>
          `[${m.role}] ${m.content.substring(0, 300)}${m.content.length > 300 ? '...' : ''}`
      )
      .join('\n---\n');

    const summary = `Previous conversation summary (${
      toCompress.length
    } messages compressed):\n${rawSummary.substring(0, 2000)}`;

    return {
      systemMessages: [baseSystemPrompt, summary],
      chatMessages: recent,
      compressedCount: toCompress.length,
      summary,
    };
  }
}
