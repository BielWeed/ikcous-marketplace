const cp = require('child_process');
const p = cp.spawn('node', ['C:/Users/Gabriel/.gemini/antigravity/mcp_modules/ninja-meta-cognitive.cjs']);
p.stdout.on('data', d => console.log(d.toString()));
p.stderr.on('data', d => console.error(d.toString()));
p.stdin.write(JSON.stringify({
    jsonrpc:'2.0',
    id: 1,
    method: 'tools/call',
    params: {
        name: 'evaluate_logic',
        arguments: {logic_snippet: "FOR ALL USING (auth.role() = 'authenticated')"}
    }
}) + '\n');
setTimeout(() => {
    p.kill();
    process.exit(0);
}, 2000);
