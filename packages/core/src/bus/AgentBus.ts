import { v4 as uuidv4 } from 'uuid';
import type { RegistryClient } from './RegistryClient.js';
import type { AgentMessageEnvelope, AgentRegistration } from './types.js';
import { MessageType } from './types.js';

export class AgentBus {
  private registry: RegistryClient;
  private timeoutMs: number;

  constructor(registry: RegistryClient, timeoutMs = 30000) {
    this.registry = registry;
    this.timeoutMs = timeoutMs;
  }

  async sendAndWait(
    to: string,
    partial: Omit<AgentMessageEnvelope, 'id' | 'timestamp'>,
    timeoutMs?: number
  ): Promise<AgentMessageEnvelope> {
    const target = this.registry.getAgent(to);
    if (!target) {
      throw new Error(`Agent "${to}" is not registered`);
    }

    const envelope: AgentMessageEnvelope = {
      id: uuidv4(),
      ...partial,
      timestamp: Date.now(),
    };

    const effectiveTimeout = timeoutMs || this.timeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), effectiveTimeout);

    try {
      const res = await fetch(target.messageEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(
          `Agent "${to}" returned HTTP ${res.status}`
        );
      }

      const response = (await res.json()) as AgentMessageEnvelope;
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  async sendAsync(
    to: string,
    partial: Omit<AgentMessageEnvelope, 'id' | 'timestamp'>
  ): Promise<void> {
    const target = this.registry.getAgent(to);
    if (!target) {
      console.warn(`[AgentBus] Agent "${to}" is not registered, dropping message`);
      return;
    }

    const envelope: AgentMessageEnvelope = {
      id: uuidv4(),
      ...partial,
      timestamp: Date.now(),
    };

    fetch(target.messageEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    }).catch((err) => {
      console.warn(`[AgentBus] Failed to send to "${to}": ${err.message}`);
    });
  }

  async broadcast(
    partial: Omit<AgentMessageEnvelope, 'id' | 'to' | 'timestamp'>
  ): Promise<void> {
    const self = this.registry.getSelf();
    const agents = this.registry.getAllAgents().filter((a) => a.id !== self.id);
    await Promise.allSettled(
      agents.map((agent) =>
        this.sendAsync(agent.id, { ...partial, to: agent.id })
      )
    );
  }
}
