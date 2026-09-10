import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;
const pgImage = "public.ecr.aws/supabase/postgres:17.6.1.153";
const restImage = "public.ecr.aws/supabase/postgrest:v14.8";
const images = new Map([
  [
    pgImage,
    "sha256:86ff8755d0a92d7e8167304ba218f0e9f3acb2e385a1527a078a21e60d89d908",
  ],
  [
    restImage,
    "sha256:4173b72e0be29cf15349dc827798c3e464c5f2cc7f9c1697022f9cd1874b4c36",
  ],
]);
const allowed = new Set([
  "tests/identity-database/fixture.sql",
  "tests/identity-database/storage-principal.sql",
  "tests/identity-database/storage-savy.sql",
  "tests/identity-database/contract.sql",
  "supabase/migrations/20261121000000_identidade_e_arquivos_da_loja.sql",
  "supabase/migrations/20261122000000_gravacao_concorrente_da_identidade.sql",
]);
export function readFixture(root, path) {
  assert(allowed.has(path), "FIXTURE_ALLOWLIST");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Closed source allowlist above.
  return readFileSync(resolve(root, path), "utf8");
}
function docker(args, input, permitFailure = false) {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 2 ** 24,
    windowsHide: true,
  });
  // Never include arguments, SQL, DSN or Docker stderr: fixture secrets can occur there.
  if (!permitFailure)
    assert.equal(result.status, 0, "LOCAL_DOCKER_COMMAND_FAILED");
  return result;
}
function inspect(kind, id) {
  return JSON.parse(docker([kind, "inspect", id]).stdout)[0];
}

export function createEnvironment(runId, evidence) {
  assert(/^[a-z0-9_]+$/.test(runId), "RUN_ID");
  const prefix = `ikcous-identity-http-${runId}`;
  const label = "ikcous.identity-http.run";
  const resources = [];
  const databases = new Set();
  const password = randomBytes(32).toString("hex");
  const restPassword = randomBytes(32).toString("hex");
  const restRole = `identity_http_authenticator_${runId}`;
  assert(restRole.length <= 63);
  const jwtSecret = randomBytes(48).toString("hex");
  let network;
  let pg;
  let sourceId;
  let dump;
  const bridges = [];
  const nativeFetch = globalThis.fetch;
  const guardNetwork = () => {
    assert(network, "NETWORK_NOT_CREATED");
    const state = inspect("network", network.id);
    assert.equal(state.Id, network.id);
    assert.equal(state.Name, network.name);
    assert.equal(state.Labels?.["ikcous.identity-http.run"], runId);
    assert.equal(state.Internal, true);
    assert.equal(state.Driver, "bridge");
    return state;
  };
  const guard = (resource) => {
    assert(resources.includes(resource), "NOT_OWN_RESOURCE");
    guardNetwork();
    const state = inspect("container", resource.id);
    assert.equal(state.Id, resource.id);
    assert.equal(state.Name, `/${resource.name}`);
    assert.equal(state.Config.Labels?.["ikcous.identity-http.run"], runId);
    assert.equal(state.Image, images.get(resource.image));
    assert.equal(state.Config.Image, resource.image);
    assert.equal(state.HostConfig.NetworkMode, network.name);
    assert.equal(state.HostConfig.Privileged, false);
    assert.equal(state.HostConfig.Binds, null);
    assert.deepEqual(Object.keys(state.NetworkSettings.Networks), [
      network.name,
    ]);
    assert.deepEqual(state.HostConfig.PortBindings, {});
    return state;
  };
  const guardSource = () => {
    const state = inspect("container", "ikcous-identidade-sql-20260909");
    assert.equal(state.Name, "/ikcous-identidade-sql-20260909");
    assert.equal(
      state.Config.Image,
      "public.ecr.aws/supabase/postgres:17.6.1.106",
    );
    assert.equal(state.HostConfig.NetworkMode, "none");
    assert.deepEqual(state.HostConfig.PortBindings, {});
    assert.equal(state.State.Running, true);
    if (sourceId) assert.equal(state.Id, sourceId);
    else sourceId = state.Id;
  };
  const create = (suffix, image, options, command = []) => {
    guardNetwork();
    const name = `${prefix}-${suffix}`;
    const collisions = docker([
      "container",
      "ls",
      "-a",
      "--format",
      "{{.Names}}",
      "--filter",
      `name=^/${name}$`,
    ]).stdout.trim();
    assert.equal(collisions, "", "RESOURCE_COLLISION");
    const id = docker([
      "create",
      "--pull=never",
      "--name",
      name,
      "--label",
      `${label}=${runId}`,
      "--network",
      network.name,
      ...options,
      image,
      ...command,
    ]).stdout.trim();
    assert(/^[a-f0-9]{64}$/.test(id), "CREATED_ID");
    const resource = { name, id, image };
    resources.push(resource);
    guard(resource);
    docker(["start", id]);
    return resource;
  };
  const sql = (db, source) => {
    assert(databases.has(db), "SQL_DATABASE_NOT_OWNED");
    assert.equal(guard(pg).State.Running, true);
    const result = docker(
      [
        "exec",
        "-i",
        "--env",
        `PGPASSWORD=${password}`,
        pg.id,
        "psql",
        "-U",
        "postgres",
        "-d",
        db,
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      source,
      true,
    );
    if (result.status !== 0) {
      // Selected migration sentinels only; never print the SQL/error detail.
      evidence.events.push({
        phase: "sql-failure",
        code: /A[25]_[A-Z_]+/.exec(result.stderr)?.[0] ?? "SQL_FAILED",
        database: db,
      });
      throw new Error("LOCAL_SQL_FAILED");
    }
    return result.stdout.trim();
  };
  return {
    jwtSecret,
    sql,
    async start() {
      for (const [image, digest] of images) {
        const state = inspect("image", image);
        assert.equal(state.Id, digest, "IMAGE_DIGEST_MISMATCH");
        evidence.images.push({ image, digest });
      }
      guardSource();
      const dumped = docker([
        "exec",
        "--env",
        "PGPASSWORD=postgres",
        sourceId,
        "pg_dump",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "--schema-only",
        "--no-owner",
        "--no-privileges",
        "--schema=auth",
        "--schema=storage",
      ]).stdout;
      assert(
        !/^(?:COPY\s+[^\n]+\s+FROM\s+stdin|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|ALTER\s+ROLE|CREATE\s+ROLE)/im.test(
          dumped,
        ),
        "SCHEMA_DUMP_CONTAINS_DML",
      );
      dump = dumped;
      evidence.events.push({
        phase: "schema-only",
        sourceId,
        sha256: hash(dump),
      });
      const networkName = `${prefix}-net`;
      assert.equal(
        docker([
          "network",
          "ls",
          "--format",
          "{{.Name}}",
          "--filter",
          `name=^${networkName}$`,
        ]).stdout.trim(),
        "",
        "NETWORK_COLLISION",
      );
      const id = docker([
        "network",
        "create",
        "--internal",
        "--label",
        `${label}=${runId}`,
        networkName,
      ]).stdout.trim();
      network = { name: networkName, id };
      guardNetwork();
      pg = create(
        "pg",
        pgImage,
        ["--env", `POSTGRES_PASSWORD=${password}`],
        ["postgres", "-D", "/etc/postgresql"],
      );
      const deadline = Date.now() + 60000;
      for (;;) {
        guard(pg);
        if (
          docker(
            [
              "exec",
              pg.id,
              "pg_isready",
              "-h",
              "127.0.0.1",
              "-p",
              "5432",
              "-U",
              "postgres",
            ],
            undefined,
            true,
          ).status === 0
        )
          break;
        assert(Date.now() < deadline, "POSTGRES_READINESS_TIMEOUT");
        await delay(250);
      }
      // Cluster is new, postgres database is used only for these fixed setup statements.
      assert.equal(guard(pg).State.Running, true);
      docker(
        [
          "exec",
          "-i",
          "--env",
          `PGPASSWORD=${password}`,
          pg.id,
          "psql",
          "-U",
          "postgres",
          "-d",
          "postgres",
          "-X",
          "-qAt",
          "-v",
          "ON_ERROR_STOP=1",
        ],
        `BEGIN; CREATE ROLE ${restRole} WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${lit(restPassword)}; GRANT anon, authenticated TO ${restRole}; COMMIT;`,
      );
      guard(pg);
      const curl = docker(["exec", pg.id, "curl", "-q", "--version"]);
      assert(
        /^curl [0-9]+\.[0-9]+\.[0-9]+ /.test(curl.stdout),
        "CURL_NOT_AVAILABLE",
      );
      evidence.events.push({
        phase: "curl-available",
        version: /^curl [0-9]+\.[0-9]+\.[0-9]+/.exec(curl.stdout)[0],
      });
    },
    createDatabase(suffix) {
      assert(
        ["principal", "savy", "principal_missing", "savy_missing"].includes(
          suffix,
        ),
      );
      const db = `identity_a5e_${runId}_${suffix}`;
      assert(!databases.has(db), "DB_COLLISION");
      assert.equal(guard(pg).State.Running, true);
      docker(
        [
          "exec",
          "-i",
          "--env",
          `PGPASSWORD=${password}`,
          pg.id,
          "psql",
          "-U",
          "postgres",
          "-d",
          "postgres",
          "-X",
          "-qAt",
          "-v",
          "ON_ERROR_STOP=1",
        ],
        `CREATE DATABASE ${db} TEMPLATE template0;`,
      );
      databases.add(db);
      sql(
        db,
        'CREATE SCHEMA extensions; CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;',
      );
      sql(db, dump);
      assert.equal(
        sql(
          db,
          `SELECT NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole FROM pg_roles WHERE rolname=${lit(restRole)};`,
        ),
        "t",
      );
      assert.equal(
        sql(
          db,
          `SELECT string_agg(r.rolname,',' ORDER BY r.rolname) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE m.member=${lit(restRole)}::regrole;`,
        ),
        "anon,authenticated",
      );
      return db;
    },
    async startRest(db, suffix) {
      assert(databases.has(db));
      assert(
        ["principal", "savy", "principal-missing", "savy-missing"].includes(
          suffix,
        ),
      );
      const shortSuffix = suffix
        .replace("principal-missing", "p-missing")
        .replace("savy-missing", "s-missing");
      assert(
        `${prefix}-rest-${shortSuffix}`.length <= 63,
        "REST_DNS_LABEL_TOO_LONG",
      );
      const resource = create(`rest-${shortSuffix}`, restImage, [
        "--env",
        `PGRST_DB_URI=postgresql://${restRole}:${restPassword}@${pg.name}:5432/${db}`,
        "--env",
        "PGRST_DB_SCHEMAS=public",
        "--env",
        "PGRST_DB_CONFIG=false",
        "--env",
        "PGRST_DB_ANON_ROLE=anon",
        "--env",
        `PGRST_JWT_SECRET=${jwtSecret}`,
        "--env",
        "PGRST_JWT_AUD=authenticated",
      ]);
      guard(resource);
      const benchToken = randomBytes(32).toString("hex");
      const active = new Set();
      const rpcNames = new Set([
        "read_store_identity",
        "save_store_identity",
        "upsert_store_config",
      ]);
      const allowedHeaders = new Set([
        "authorization",
        "apikey",
        "content-type",
        "accept",
        "content-profile",
      ]);
      const quote = (value) =>
        `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\r", "\\r").replaceAll("\n", "\\n").replaceAll("\t", "\\t")}"`;
      const curlRequest = async (name, headers, body, signal) => {
        assert(rpcNames.has(name), "BRIDGE_RPC_FORBIDDEN");
        assert(Buffer.byteLength(body) <= 1048576, "BRIDGE_BODY_LIMIT");
        assert.equal(guard(pg).State.Running, true);
        assert.equal(guard(resource).State.Running, true);
        const config = [
          'header = "Expect:"',
          ...Array.from(headers, ([key, value]) => {
            assert(allowedHeaders.has(key), "BRIDGE_HEADER_FORBIDDEN");
            assert(!/[\r\n]/.test(value), "BRIDGE_HEADER_NEWLINE");
            return `header = ${quote(`${key}: ${value}`)}`;
          }),
          `data-binary = ${quote(body)}`,
        ].join("\n");
        // Configuration is stdin, not shell syntax or argv. Quoting round-trip covers
        // JSON backslashes, quotes, tabs, CR/LF and UTF-8 without normalization.
        const result = await new Promise((resolveResult, reject) => {
          const child = spawn(
            "docker",
            [
              "exec",
              "-i",
              pg.id,
              "curl",
              "-q",
              "--config",
              "-",
              "--noproxy",
              "*",
              "--proxy",
              "",
              "--max-time",
              "30",
              "--max-filesize",
              "1048576",
              "--include",
              "--silent",
              "--show-error",
              "--request",
              "POST",
              "--url",
              `http://${resource.name}:3000/rpc/${name}`,
            ],
            { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
          );
          active.add(child);
          const chunks = [];
          let size = 0;
          let settled = false;
          const finish = (error, bytes) => {
            if (settled) return;
            settled = true;
            active.delete(child);
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            if (error) {
              child.kill();
              reject(new Error("LOCAL_CURL_TRANSPORT_FAILED"));
            } else resolveResult(bytes);
          };
          const abort = () => finish(true);
          const timer = setTimeout(abort, 35000);
          signal?.addEventListener("abort", abort, { once: true });
          child.stdout.on("data", (chunk) => {
            size += chunk.length;
            if (size > 1114112) finish(true);
            else chunks.push(chunk);
          });
          child.stderr.on("data", () => {
            /* Never expose curl diagnostics or Authorization. */
          });
          child.on("error", () => finish(true));
          child.stdin.on("error", () => finish(true));
          child.on("close", (code) => {
            if (code !== 0)
              evidence.events.push({
                phase: "curl-transport-error",
                exitCode: typeof code === "number" ? code : null,
                resource: resource.id,
              });
            finish(code !== 0, Buffer.concat(chunks));
          });
          if (signal?.aborted) abort();
          else child.stdin.end(config);
        });
        const boundary = result.indexOf("\r\n\r\n");
        assert(boundary > 0 && boundary <= 65536, "CURL_HTTP_HEADERS_INVALID");
        const lines = result
          .subarray(0, boundary)
          .toString("latin1")
          .split("\r\n");
        const match = /^HTTP\/1\.[01] ([1-5][0-9]{2})(?: |$)/.exec(
          lines.shift(),
        );
        assert(match, "CURL_HTTP_STATUS_INVALID");
        const responseHeaders = new Headers();
        for (const line of lines) {
          const separator = line.indexOf(":");
          assert(separator > 0, "CURL_HTTP_HEADER_INVALID");
          const key = line.slice(0, separator).toLowerCase();
          // Curl decodes transfer framing; Node supplies its own connection framing.
          if (
            ![
              "transfer-encoding",
              "connection",
              "content-length",
              "keep-alive",
            ].includes(key)
          )
            responseHeaders.append(key, line.slice(separator + 1).trim());
        }
        const responseBody = result.subarray(boundary + 4);
        assert(responseBody.length <= 1048576, "CURL_BODY_LIMIT");
        evidence.events.push({
          phase: "curl-http",
          resource: resource.id,
          rpc: name,
          status: Number(match[1]),
          requestSha256: hash(body),
          responseSha256: hash(responseBody),
        });
        return {
          status: Number(match[1]),
          headers: responseHeaders,
          body: responseBody,
        };
      };
      const server = createServer(async (request, response) => {
        try {
          if (request.headers["x-identity-bench"] !== benchToken) {
            response.writeHead(403);
            response.end();
            return;
          }
          const match =
            /^\/rpc\/(read_store_identity|save_store_identity|upsert_store_config)$/.exec(
              request.url ?? "",
            );
          if (request.method !== "POST" || !match) {
            response.writeHead(405);
            response.end();
            return;
          }
          const controller = new AbortController();
          response.on("close", () => {
            if (!response.writableFinished) controller.abort();
          });
          const chunks = [];
          let size = 0;
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 1048576) throw new Error("BRIDGE_BODY_LIMIT");
            chunks.push(chunk);
          }
          const body = new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks),
          );
          const headers = new Headers();
          for (const key of allowedHeaders) {
            // eslint-disable-next-line security/detect-object-injection -- Five fixed request header names, never a URL or arbitrary property.
            const value = request.headers[key];
            if (typeof value === "string") headers.set(key, value);
          }
          const actual = await curlRequest(
            match[1],
            headers,
            body,
            controller.signal,
          );
          response.writeHead(actual.status, Object.fromEntries(actual.headers));
          response.end(actual.body);
        } catch {
          response.destroy();
        }
      });
      server.requestTimeout = 35000;
      server.headersTimeout = 10000;
      await new Promise((resolveListening, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolveListening);
      });
      const address = server.address();
      assert.equal(address.address, "127.0.0.1");
      const origin = `http://127.0.0.1:${address.port}`;
      bridges.push({ server, active, origin });
      evidence.events.push({
        phase: "rest-created",
        name: resource.name,
        database: db,
        origin,
      });
      return {
        origin,
        guard: () => guard(resource),
        fetch: (url, init) => {
          assert(
            typeof url === "string" && url.startsWith(`${origin}/rpc/`),
            "BRIDGE_ORIGIN_FORBIDDEN",
          );
          assert(
            rpcNames.has(url.slice(`${origin}/rpc/`.length)),
            "BRIDGE_RPC_FORBIDDEN",
          );
          const headers = new Headers(init?.headers);
          headers.set("x-identity-bench", benchToken);
          return nativeFetch(url, { ...init, headers, redirect: "error" });
        },
        direct: curlRequest,
      };
    },
    async stop() {
      let failed = false;
      for (const { server, active, origin } of bridges) {
        for (const child of active) child.kill();
        server.closeAllConnections();
        await new Promise((resolveClosed) => server.close(resolveClosed));
        evidence.events.push({ phase: "bridge-stopped", origin });
      }
      for (const resource of [...resources].reverse()) {
        try {
          const state = guard(resource);
          if (state.State.Running) docker(["stop", "--time", "5", resource.id]);
          const after = guard(resource);
          evidence.resources.push({
            ...resource,
            running: after.State.Running,
            label: runId,
            network: network.name,
            portBindings: after.HostConfig.PortBindings,
            mounts: after.Mounts.map(({ Type, Name, Destination }) => ({
              Type,
              Name,
              Destination,
            })),
          });
          assert.equal(after.State.Running, false);
        } catch {
          failed = true;
          evidence.events.push({ phase: "stop-failed", name: resource.name });
        }
      }
      if (network) {
        guardNetwork();
        evidence.network = { ...network, internal: true, preserved: true };
      }
      if (sourceId) guardSource();
      assert.equal(failed, false, "OWN_RESOURCE_STOP_FAILED");
    },
  };
}
