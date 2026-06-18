export class RegistryClient {
    agents = new Map();
    selfRegistration;
    constructor(selfRegistration) {
        this.selfRegistration = selfRegistration;
        this.agents.set(selfRegistration.id, selfRegistration);
    }
    getAgent(agentId) {
        return this.agents.get(agentId);
    }
    getAllAgents() {
        return Array.from(this.agents.values());
    }
    getSelf() {
        return this.selfRegistration;
    }
    addPeer(peer) {
        this.agents.set(peer.id, peer);
    }
    removePeer(agentId) {
        if (agentId !== this.selfRegistration.id) {
            this.agents.delete(agentId);
        }
    }
    async registerWithPeers(peers, retries = 3, delayMs = 2000) {
        let registered = 0;
        for (const peer of peers) {
            if (peer.id === this.selfRegistration.id)
                continue;
            let success = false;
            for (let attempt = 0; attempt < retries; attempt++) {
                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 5000);
                    const res = await fetch(`http://${peer.host}:${peer.port}/agent/register`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(this.selfRegistration),
                        signal: controller.signal,
                    });
                    clearTimeout(timeout);
                    if (res.ok) {
                        const data = (await res.json());
                        if (data?.id) {
                            this.agents.set(data.id, data);
                        }
                        registered++;
                        success = true;
                        break;
                    }
                }
                catch {
                    if (attempt < retries - 1) {
                        await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
                    }
                }
            }
            if (!success) {
                console.warn(`[Registry] Failed to register with peer ${peer.id} after ${retries} attempts`);
            }
        }
        return registered;
    }
}
//# sourceMappingURL=RegistryClient.js.map