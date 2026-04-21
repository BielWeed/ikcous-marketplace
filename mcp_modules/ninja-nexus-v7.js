const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * NINJA NEXUS v7.9.5-Omega - WORKSPACE HUB ⚡
 * Transport: Standard Input / Output (JSON-RPC)
 * Location: ./mcp_modules/ninja-nexus-v7.js
 * (Fixes AppData permissions & environment conflicts)
 */

const APP_DATA = 'C:/Users/Gabriel/.gemini/antigravity';
const LOG_FILE = path.join(__dirname, 'nexus.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch(e) {}
  process.stderr.write(line);
}

// Windows Stdio Performance Fix
if (process.stdout._handle && typeof process.stdout._handle.setBlocking === 'function') {
    process.stdout._handle.setBlocking(true);
}

const SERVERS = {
  'ninja-shell': { command: 'node', args: [`${APP_DATA}/mcp_modules/ninja-shell.cjs`], env: { ...process.env, NODE_PATH: `${APP_DATA}/mcp_modules/node_modules` } },
  'ninja-oracle': { command: 'node', args: [`${APP_DATA}/mcp_modules/ninja-oracle-v3.js`], env: { ...process.env, NODE_PATH: `${APP_DATA}/mcp_modules/node_modules` } },
  'ninja-vss': { command: 'node', args: [`${APP_DATA}/mcp_modules/ninja-vss.js`], env: { ...process.env, NODE_PATH: `${APP_DATA}/mcp_modules/node_modules` } },
  'gh-ninja': { command: 'node', args: [`${APP_DATA}/mcp_modules/gh-ninja.js`], env: { ...process.env, NODE_PATH: `${APP_DATA}/mcp_modules/node_modules` } },
  'ninja-omega-hub': { command: 'node', args: [`${APP_DATA}/mcp_modules/ninja-omega-hub.cjs`], env: { ...process.env, NODE_PATH: `${APP_DATA}/mcp_modules/node_modules` } },
  'ninja-memory': { command: 'node', args: [`${APP_DATA}/mcp_modules/ninja-memory-v2.js`], env: { ...process.env, NODE_PATH: `${APP_DATA}/mcp_modules/node_modules` } },
  'ninja-scribe': { command: 'node', args: [`${APP_DATA}/mcp_modules/ninja-scribe.js`], env: { ...process.env, NODE_PATH: `${APP_DATA}/mcp_modules/node_modules` } }
};

const activeDomains = Object.keys(SERVERS);
const domainTools = new Map();
const toolMap = new Map();
const processes = new Map();
const pendingRequests = new Map();

async function ensureProcess(domain) {
  let child = processes.get(domain);
  if (child && child.connected) return child;
  const config = SERVERS[domain];
  if (!config) return null;

  log(`[Omega] Spawning ${domain}...`);
  child = spawn(config.command, config.args, { env: config.env, stdio: ['pipe', 'pipe', 'pipe'] });
  
  let buffer = '';
  child.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && pendingRequests.has(msg.id)) {
          const handler = pendingRequests.get(msg.id);
          pendingRequests.delete(msg.id);
          handler(msg);
        } else {
          sendToIDE(msg);
        }
      } catch (e) {}
    }
  });

  child.stderr.on('data', (data) => log(`[${domain} ERR] ${data.toString().trim()}`));
  child.on('exit', () => processes.delete(domain));
  processes.set(domain, child);

  child.stdin.write(JSON.stringify({ 
    jsonrpc: '2.0', id: `init-${Date.now()}`, method: 'initialize', 
    params: { capabilities: {}, protocolVersion: '2024-11-05' } 
  }) + '\n');

  return child;
}

function sendToIDE(msg) {
    if (!msg) return;
    process.stdout.write(JSON.stringify({ ...msg, jsonrpc: '2.0' }) + '\n');
}

async function discoverTools(domain) {
    const config = SERVERS[domain];
    return new Promise((resolve) => {
        const child = spawn(config.command, config.args, { env: config.env, stdio: ['pipe', 'pipe', 'pipe'] });
        let buffer = '';
        const timeout = setTimeout(() => { child.kill(); log(`[Discovery] Timeout: ${domain}`); resolve([]); }, 12000);
        child.stdout.on('data', (data) => {
            buffer += data.toString();
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop();
            for (const line of lines) {
                try {
                    const msg = JSON.parse(line);
                    if (msg.id === 'list' && msg.result?.tools) {
                        clearTimeout(timeout); child.kill(); resolve(msg.result.tools);
                    }
                } catch(e){}
            }
        });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { capabilities: {}, protocolVersion: '2024-11-05' } }) + '\n');
        setTimeout(() => { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 'list', method: 'tools/list', params: {} }) + '\n'); }, 1500);
    });
}

async function warmup() {
    log("[Omega] Parallel discovery starts...");
    const tasks = activeDomains.map(async (domain) => {
        try {
            const tools = await discoverTools(domain);
            if (tools.length > 0) {
                domainTools.set(domain, tools);
                tools.forEach(t => toolMap.set(t.name, domain));
                log(`[Omega] Registered ${tools.length} tools from ${domain}.`);
            }
        } catch (e) { log(`[Omega] Error: ${domain} - ${e.message}`); }
    });
    Promise.allSettled(tasks).then(() => log(`[Omega] Active. Tools: ${toolMap.size + 1}`));
}

async function handleRequest(request, onResponse) {
    if (request.method === 'initialize') {
        return onResponse({
            jsonrpc: '2.0', id: request.id,
            result: { capabilities: { tools: { listChanged: true } }, protocolVersion: '2024-11-05', serverInfo: { name: 'NinjaNexusV7-Omega', version: '7.9.5-Omega' } }
        });
    }
    if (request.method === 'tools/list') {
        const allTools = [];
        domainTools.forEach(tools => allTools.push(...tools));
        allTools.push({ name: 'omega_status', description: 'Check Workspace Hub Status', inputSchema: { type: 'object', properties: {} } });
        return onResponse({ jsonrpc: '2.0', id: request.id, result: { tools: allTools } });
    }
    if (request.method === 'tools/call') {
        const { name } = request.params;
        if (name === 'omega_status') {
            return onResponse({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: `Omega Hub Active. Tools: ${toolMap.size + 1}` }] } });
        }
        const domain = toolMap.get(name) || 'ninja-shell';
        const child = await ensureProcess(domain);
        if (!child) return onResponse({ jsonrpc: '2.0', id: request.id, error: { message: 'Domain error.' } });
        pendingRequests.set(request.id, onResponse);
        child.stdin.write(JSON.stringify(request) + '\n');
        return;
    }
    onResponse({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unknown method.' } });
}

let stdioBuffer = '';
process.stdin.on('data', (data) => {
    stdioBuffer += data.toString();
    const lines = stdioBuffer.split(/\r?\n/);
    stdioBuffer = lines.pop();
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const req = JSON.parse(trimmed);
            handleRequest(req, (msg) => sendToIDE({ ...msg, id: req.id }));
        } catch(e) {}
    }
});

log("[Omega Hub] Native Workspace Hub Active.");
warmup();
process.on('SIGINT', () => process.exit(0));
process.on('exit', () => processes.forEach(c => c?.kill()));
