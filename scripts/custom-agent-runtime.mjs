#!/usr/bin/env node
import http from 'node:http';

const id = process.env.CUSTOM_AGENT_ID || 'custom-agent';
const name = process.env.CUSTOM_AGENT_NAME || id;
const role = process.env.CUSTOM_AGENT_ROLE || 'Custom Agent';
const description = process.env.CUSTOM_AGENT_DESCRIPTION || role;
const skills = (process.env.CUSTOM_AGENT_SKILLS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const port = Number(process.env.CUSTOM_AGENT_PORT || 0);

if (!port) {
  console.error('CUSTOM_AGENT_PORT is required');
  process.exit(1);
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(`${JSON.stringify(payload)}\n`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    json(res, 200, {
      status: 'online',
      id,
      agent: name,
      label: role,
      description,
      hermesPort: port,
      skills: skills.length,
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const userMessage = [...messages].reverse().find((message) => message?.role === 'user')?.content || '';
      const content = [
        `# ${name}`,
        '',
        `Role: ${role}`,
        skills.length ? `Skills: ${skills.join(', ')}` : 'Skills: not configured',
        '',
        'This local runtime is online and reachable from Open-Agent-Teams.',
        '',
        'Received request:',
        typeof userMessage === 'string' ? userMessage : JSON.stringify(userMessage),
      ].join('\n');

      json(res, 200, {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'custom-agent-runtime',
        choices: [{
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: String(userMessage).length,
          completion_tokens: content.length,
          total_tokens: String(userMessage).length + content.length,
        },
      });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : 'Invalid request' });
    }
    return;
  }

  json(res, 404, { error: 'not found' });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[custom-agent-runtime] ${name} (${id}) listening on http://127.0.0.1:${port}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
