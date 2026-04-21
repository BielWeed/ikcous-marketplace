const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

/**
 * MCP DEEP DIAGNOSTIC (V24.2.0-Logic)
 * Checks system integrity and node health.
 */

const APP_DATA = 'C:/Users/Gabriel/.gemini/antigravity';
const CONFIG_PATH = path.join(APP_DATA, 'mcp_config.json');
const LOG_FILE = path.join(APP_DATA, 'mcp_modules/ninja-nexus-v7.log');

function log(msg) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [Health] ${msg}\n`;
    console.log(line.trim());
    try { fs.appendFileSync(LOG_FILE, line); } catch(e) {}
}

async function run() {
    log("=== Iniciando Verificação de Saúde Nexus ===");
    
    // 1. Check Config
    if (!fs.existsSync(CONFIG_PATH)) {
        log("❌ CRITICAL: mcp_config.json não encontrado!");
    } else {
        log("✅ Configuração mcp_config.json detectada.");
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        const servers = Object.keys(config.mcpServers || {});
        log(`Monitorando ${servers.length} servidores: ${servers.join(', ')}`);
        
        for (const s of servers) {
            const srv = config.mcpServers[s];
            const scriptPath = srv.args?.[0];
            if (scriptPath && fs.existsSync(scriptPath)) {
                log(`[${s}] ✅ Script encontrado: ${path.basename(scriptPath)}`);
            } else {
                log(`[${s}] ⚠️ Script ausente ou incorreto: ${scriptPath}`);
            }
        }
    }

    // 2. Check Dashboard
    try {
        const { exec } = require('node:child_process');
        const checkPort = () => new Promise((resolve) => {
            exec('netstat -ano | findstr :7777', { timeout: 3000 }, (error, stdout) => {
                if (error || !stdout.includes('LISTENING')) resolve(false);
                else resolve(true);
            });
        });

        const isOnline = await checkPort();
        if (isOnline) {
            log("✅ Dashboard Visual (Stitch-UI) está ONLINE em http://localhost:7777");
        } else {
            log("❌ Dashboard Visual (Stitch-UI) parece OFFLINE.");
        }
    } catch (e) {
        log("❌ Erro ao verificar Dashboard: " + e.message);
    }

if (fs.existsSync(LOG_FILE)) {
        const stats = fs.statSync(LOG_FILE);
        const sizeKB = (stats.size / 1024).toFixed(2);
        log(`✅ Log Stream Nexus detectado (${sizeKB} KB).`);
    } else {
        log(`⚠️ Log Stream Nexus (ninja-nexus-v7.log) não encontrado em ${LOG_FILE}.`);
    }

    log("=== Diagnóstico Concluído ===");
}

run().catch(err => {
    log(`FATAL ERROR: ${err.message}`);
    process.exit(1);
});
