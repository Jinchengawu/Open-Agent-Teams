import express from 'express';
import { SessionManager } from './session/SessionManager';
import { MemoryStore } from './memory/MemoryStore';
import { ContextCompressor } from './context/ContextCompressor';
import { AgentBus } from './bus/AgentBus';
import type { AgentMessageEnvelope } from './bus/types';
export interface AgentFactoryConfig {
    id: string;
    label: string;
    port: number;
    hermesPort: number;
    skills: string[];
    tags: string[];
    peers: {
        host: string;
        port: number;
        id: string;
    }[];
    buildSystemPrompt: () => string;
    loadSkillContent: (skillName: string) => string;
}
export interface AgentApp {
    app: express.Application;
    sessionManager: SessionManager;
    memoryStore: MemoryStore;
    agentBus: AgentBus;
    compressor: ContextCompressor;
    config: AgentFactoryConfig;
    handleInterAgentMessage: (envelope: AgentMessageEnvelope, sendResponse: (msg: AgentMessageEnvelope) => void) => Promise<void>;
}
export declare function createAgentApp(config: AgentFactoryConfig): AgentApp;
//# sourceMappingURL=agent-factory.d.ts.map