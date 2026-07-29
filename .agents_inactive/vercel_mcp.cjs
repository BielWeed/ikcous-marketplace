const fs = require("fs");
const path = require("path");
const https = require("https");
const { exec } = require("child_process");
const readline = require("readline");

function logError(msg) {
  process.stderr.write(`[Error] ${msg}\n`);
}

function getVercelToken() {
  const home = process.env.USERPROFILE || "C:\\Users\\Gabriel";
  const authPath = path.join(
    home,
    "AppData",
    "Roaming",
    "xdg.data",
    "com.vercel.cli",
    "auth.json",
  );
  try {
    if (fs.existsSync(authPath)) {
      const data = fs.readFileSync(authPath, "utf8");
      const auth = JSON.parse(data);
      return auth.token;
    }
  } catch (err) {
    logError("Error reading local Vercel auth.json: " + err.message);
  }
  return null;
}

function vercelApi(method, apiPath, body = null) {
  return new Promise((resolve, reject) => {
    const token = getVercelToken();
    if (!token) {
      return reject(
        new Error(
          "Vercel token not found in local CLI config. Please run 'vercel login' first.",
        ),
      );
    }
    const options = {
      hostname: "api.vercel.com",
      port: 443,
      path: apiPath,
      method: method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(
              new Error(
                parsed.error?.message ||
                  `Vercel API returned status ${res.statusCode}: ${data}`,
              ),
            );
          }
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(
              new Error(
                `Vercel API returned status ${res.statusCode}: ${data}`,
              ),
            );
          }
        }
      });
    });
    req.on("error", (err) => reject(err));
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on("line", async (line) => {
  if (!line.trim()) return;
  try {
    const request = JSON.parse(line);
    if (request.jsonrpc !== "2.0") return;

    if (request.method === "initialize") {
      sendResponse(request.id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "vercel-local-bridge",
          version: "1.0.0",
        },
      });
    } else if (request.method === "tools/list") {
      const tools = getToolsList();
      sendResponse(request.id, { tools });
    } else if (request.method === "tools/call") {
      try {
        const result = await handleToolCall(
          request.params.name,
          request.params.arguments || {},
        );
        sendResponse(request.id, result);
      } catch (err) {
        sendError(request.id, -32603, err.message);
      }
    } else {
      if (request.id !== undefined) {
        sendError(request.id, -32601, `Method not found: ${request.method}`);
      }
    }
  } catch (err) {
    logError("Error processing line: " + err.message);
  }
});

function sendResponse(id, result) {
  process.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: id,
      result: result,
    }) + "\n",
  );
}

function sendError(id, code, message) {
  process.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: id,
      error: {
        code: code,
        message: message,
      },
    }) + "\n",
  );
}

function getToolsList() {
  const home = process.env.USERPROFILE || "C:\\Users\\Gabriel";
  const mcpDir = path.join(home, ".gemini", "antigravity-ide", "mcp", "vercel");
  try {
    if (!fs.existsSync(mcpDir)) return [];
    const files = fs.readdirSync(mcpDir);
    const tools = [];
    for (const file of files) {
      if (file.endsWith(".json")) {
        const content = fs.readFileSync(path.join(mcpDir, file), "utf8");
        const tool = JSON.parse(content);
        tools.push({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.parameters || tool.inputSchema,
        });
      }
    }
    return tools;
  } catch (err) {
    logError("Error reading tools list: " + err.message);
    return [];
  }
}

async function handleToolCall(name, args) {
  logError(`Calling tool: ${name} with args ${JSON.stringify(args)}`);
  switch (name) {
    case "list_teams": {
      const data = await vercelApi("GET", "/v2/teams");
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
    case "list_projects": {
      const { teamId } = args;
      const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
      const data = await vercelApi("GET", `/v9/projects${query}`);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
    case "list_deployments": {
      const { projectId, teamId, since, until } = args;
      let query = `?teamId=${encodeURIComponent(teamId)}`;
      if (projectId) query += `&projectId=${encodeURIComponent(projectId)}`;
      if (since) query += `&since=${encodeURIComponent(since)}`;
      if (until) query += `&until=${encodeURIComponent(until)}`;
      const data = await vercelApi("GET", `/v6/deployments${query}`);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
    case "get_deployment": {
      const { idOrUrl, teamId } = args;
      const data = await vercelApi(
        "GET",
        `/v13/deployments/${encodeURIComponent(idOrUrl)}?teamId=${encodeURIComponent(teamId)}`,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
    case "get_deployment_build_logs": {
      const {
        idOrUrl,
        teamId,
        limit,
        direction,
        errorsOnly,
        since,
        until,
        buildId,
      } = args;
      let query = `?teamId=${encodeURIComponent(teamId)}`;
      if (limit) query += `&limit=${encodeURIComponent(limit)}`;
      if (direction) query += `&direction=${encodeURIComponent(direction)}`;
      if (errorsOnly) query += `&errorsOnly=${encodeURIComponent(errorsOnly)}`;
      if (since) query += `&since=${encodeURIComponent(since)}`;
      if (until) query += `&until=${encodeURIComponent(until)}`;
      if (buildId) query += `&buildId=${encodeURIComponent(buildId)}`;
      const data = await vercelApi(
        "GET",
        `/v2/deployments/${encodeURIComponent(idOrUrl)}/events${query}`,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
    case "get_runtime_logs": {
      const {
        projectId,
        teamId,
        deploymentId,
        environment,
        level,
        limit,
        query,
        requestId,
        since,
        source,
        statusCode,
        until,
      } = args;
      let cmd = `npx vercel logs ${deploymentId || projectId} --no-follow --json`;
      if (teamId) cmd += ` --scope ${encodeURIComponent(teamId)}`;
      if (environment)
        cmd += ` --environment ${encodeURIComponent(environment)}`;
      if (level) {
        const levels = Array.isArray(level) ? level : [level];
        levels.forEach((l) => (cmd += ` --level ${encodeURIComponent(l)}`));
      }
      if (limit) cmd += ` --limit ${encodeURIComponent(limit)}`;
      if (query) cmd += ` --query "${query.replace(/"/g, '\\"')}"`;
      if (requestId) cmd += ` --request-id ${encodeURIComponent(requestId)}`;
      if (since) cmd += ` --since ${encodeURIComponent(since)}`;
      if (source) {
        const sources = Array.isArray(source) ? source : [source];
        sources.forEach((s) => (cmd += ` --source ${encodeURIComponent(s)}`));
      }
      if (statusCode) cmd += ` --status-code ${encodeURIComponent(statusCode)}`;
      if (until) cmd += ` --until ${encodeURIComponent(until)}`;

      const logsText = await runCommand(cmd);
      return {
        content: [{ type: "text", text: logsText }],
      };
    }
    case "deploy_to_vercel": {
      const cmd = `npx vercel --yes`;
      const deployResult = await runCommand(cmd);
      return {
        content: [{ type: "text", text: deployResult }],
      };
    }
    default:
      throw new Error(`Tool ${name} is not implemented in local bridge`);
  }
}

function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: process.cwd() }, (error, stdout, stderr) => {
      if (error) {
        resolve(
          `Command failed: ${error.message}\nStdout: ${stdout}\nStderr: ${stderr}`,
        );
      } else {
        resolve(stdout || stderr);
      }
    });
  });
}
