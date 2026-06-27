import type { AgentRegistration } from './types.js';

interface PeerConfig {
  host: string;
  port: number;
  id: string;
}

export class RegistryClient {
  private agents = new Map<string, AgentRegistration>();
  private selfRegistration: AgentRegistration;

  constructor(selfRegistration: AgentRegistration) {
    this.selfRegistration = selfRegistration;
    this.agents.set(selfRegistration.id, selfRegistration);
  }

  getAgent(agentId: string): AgentRegistration | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): AgentRegistration[] {
    return Array.from(this.agents.values());
  }

  getSelf(): AgentRegistration {
    return this.selfRegistration;
  }

  addPeer(peer: AgentRegistration): void {
    this.agents.set(peer.id, peer);
  }

  removePeer(agentId: string): void {
    if (agentId !== this.selfRegistration.id) {
      this.agents.delete(agentId);
    }
  }

  async registerWithPeers(
    peers: PeerConfig[],
    retries = 3,
    delayMs = 2000
  ): Promise<number> {
    let registered = 0;
    for (const peer of peers) {
      if (peer.id === this.selfRegistration.id) continue;
      let success = false;
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          const res = await fetch(
            `http://${peer.host}:${peer.port}/agent/register`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(this.selfRegistration),
              signal: controller.signal,
            }
          );
          clearTimeout(timeout);
          if (res.ok) {
            const data = (await res.json()) as AgentRegistration;
            if (data?.id) {
              this.agents.set(data.id, data);
            }
            registered++;
            success = true;
            break;
          }
        } catch {
          if (attempt < retries - 1) {
            await new Promise((resolve) =>
              setTimeout(resolve, delayMs * (attempt + 1))
            );
          }
        }
      }
      if (!success) {
        console.warn(
          `[Registry] Failed to register with peer ${peer.id} after ${retries} attempts`
        );
      }
    }
    return registered;
  }
}
