/* eslint-disable security/detect-non-literal-fs-filename -- Own TEMP certificate files and physical contained artifact paths; no network forwarding. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { X509Certificate, createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import {
  publicKey,
  publicRow,
  serviceHost,
  serviceOrigin,
  serviceRoute,
} from "./contracts.mjs";
import { hash, physical, write } from "./evidence.mjs";

const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".txt": "text/plain",
};
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
export async function certificate() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "a6ct-"));
  const config = `[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=${serviceHost}\n[ext]\nsubjectAltName=DNS:${serviceHost}\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`;
  await write(directory, "openssl.cnf", config);
  const key = path.join(directory, "server.key");
  const cert = path.join(directory, "server.crt");
  execFileSync(
    "C:/Program Files/Git/usr/bin/openssl.exe",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-noenc",
      "-days",
      "2",
      "-config",
      path.join(directory, "openssl.cnf"),
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  const certBytes = await fs.readFile(cert);
  const keyBytes = await fs.readFile(key);
  const x509 = new X509Certificate(certBytes);
  assert.equal(x509.ca, false);
  assert.equal(x509.subjectAltName, `DNS:${serviceHost}`);
  return {
    directory,
    cert: certBytes,
    key: keyBytes,
    pin: createHash("sha256")
      .update(x509.publicKey.export({ type: "spki", format: "der" }))
      .digest("base64"),
    fingerprint: x509.fingerprint256,
  };
}

// No DNS or user-selected upstream: all successful network connections end here.
export async function transport(certificateData, initialArtifact) {
  let artifact = initialArtifact;
  let offline = false;
  let phase = "preflight";
  const events = [];
  const sockets = new Set();
  const record = (value) => events.push({ at: Date.now(), phase, ...value });
  const track = (socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
  };
  const deny = (response, reason, url, status = 403) => {
    record({ type: "deny", reason, url, status });
    response.writeHead(status, { "Cache-Control": "no-store" }).end(reason);
  };
  const send = (response, bytes, type, url, extra = {}) => {
    const headers = {
      "Content-Type": type,
      "Content-Length": bytes.length,
      "Cache-Control": "no-store",
      ...extra,
    };
    record({
      type: "response",
      url,
      status: 200,
      bytes: bytes.length,
      sha256: hash(bytes),
      headers,
    });
    response.writeHead(200, headers).end(bytes);
  };
  const hasBody = (request) =>
    request.headers["transfer-encoding"] ||
    Number(request.headers["content-length"] ?? 0) !== 0;
  const serveApp = async (request, response) => {
    try {
      if (offline) {
        record({ type: "offline", url: request.url });
        request.socket.destroy();
        return;
      }
      const url = new URL(request.url, origin);
      if (
        url.origin !== origin ||
        request.headers.host !== new URL(origin).host ||
        request.method !== "GET" ||
        hasBody(request)
      )
        return deny(response, "app-request", url.origin + url.pathname);
      const pathname = decodeURIComponent(url.pathname);
      if (
        pathname.includes("\\") ||
        pathname.includes("\0") ||
        pathname.split("/").includes("..")
      )
        return deny(response, "app-path", pathname);
      const name = pathname === "/" ? "index.html" : pathname.slice(1);
      const filename = path.resolve(artifact.directory, name);
      const relation = path.relative(artifact.directory, filename);
      if (!relation || relation.startsWith("..") || path.isAbsolute(relation))
        return deny(response, "app-path", pathname);
      await physical(filename, false);
      const bytes = await fs.readFile(filename);
      send(
        response,
        bytes,
        mime[path.extname(filename)] ?? "application/octet-stream",
        url.href,
      );
    } catch (error) {
      deny(
        response,
        error.code === "ENOENT" ? "local-missing" : "local-error",
        request.url,
        404,
      );
    }
  };
  const app = http.createServer(serveApp);
  app.on("connection", track);
  await listen(app);
  const origin = `http://127.0.0.1:${app.address().port}`;
  const context = tls.createSecureContext({
    key: certificateData.key,
    cert: certificateData.cert,
  });
  const services = https.createServer(
    {
      key: certificateData.key,
      cert: certificateData.cert,
      SNICallback(name, done) {
        if (name === serviceHost) done(null, context);
        else {
          record({ type: "deny", reason: "sni", url: name });
          done(new Error("SNI_REFUSED"));
        }
      },
    },
    async (request, response) => {
      const pathname = new URL(request.url, serviceOrigin).pathname;
      try {
        if (offline) {
          record({ type: "offline", url: pathname });
          request.socket.destroy();
          return;
        }
        if (
          request.socket.servername !== serviceHost ||
          request.headers.host !== serviceHost ||
          hasBody(request)
        )
          return deny(response, "service-host-body", pathname);
        const kind = serviceRoute(request.url);
        const logo = artifact.snapshot.identity.urls.header;
        const logoMatch = serviceOrigin + request.url === logo;
        if (!kind && !logoMatch)
          return deny(response, "unknown-service", pathname);
        const cors = { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
        if (request.headers.origin && request.headers.origin !== origin)
          return deny(response, "cors-origin", pathname);
        if (request.method === "OPTIONS") {
          const headers = (
            request.headers["access-control-request-headers"] ?? ""
          )
            .split(",")
            .map((x) => x.trim().toLowerCase())
            .filter(Boolean);
          const rejectedHeaders = headers.filter(
            (x) =>
              !(
                [
                  "apikey",
                  "authorization",
                  "x-client-info",
                  "accept",
                  "content-type",
                  "accept-profile",
                ].includes(x) ||
                (kind && x === "x-retry-count")
              ),
          );
          const rejection =
            request.headers.origin !== origin
              ? "origin"
              : request.headers["access-control-request-method"] !== "GET"
                ? "method"
                : rejectedHeaders.length
                  ? "headers"
                  : null;
          if (rejection) {
            record({
              type: "cors-preflight-rejected",
              url: pathname,
              rejection,
              requestedHeaders: headers,
              rejectedHeaders,
            });
            return deny(response, "cors-preflight", pathname);
          }
          record({
            type: "options",
            url: request.url,
            requestedHeaders: headers,
          });
          response
            .writeHead(204, {
              ...cors,
              "Access-Control-Allow-Methods": "GET",
              "Access-Control-Allow-Headers": headers.join(", "),
              "Cache-Control": "no-store",
            })
            .end();
          return;
        }
        if (request.method !== "GET")
          return deny(response, "service-method", pathname);
        if (kind) {
          if (request.headers["accept-profile"] !== "public")
            return deny(response, "public-schema", pathname);
          if (
            request.headers.apikey !== publicKey ||
            request.headers.authorization !== `Bearer ${publicKey}`
          )
            return deny(response, "public-headers", pathname);
          if (
            kind === "config" &&
            request.headers.accept !== "application/vnd.pgrst.object+json"
          )
            return deny(response, "single-accept", pathname);
          send(
            response,
            Buffer.from(
              JSON.stringify(
                kind === "config" ? publicRow(artifact.snapshot) : [],
              ),
            ),
            "application/json",
            serviceOrigin + request.url,
            cors,
          );
        } else {
          const asset = artifact.snapshot.identity.assets.header;
          const bytes = await fs.readFile(
            path.join(
              artifact.directory,
              artifact.snapshot.localUrls.header.slice(1),
            ),
          );
          assert.equal(hash(bytes), asset.sha256);
          send(response, bytes, asset.media_type, logo, cors);
        }
      } catch {
        deny(response, "service-error", pathname, 500);
      }
    },
  );
  services.on("connection", track);
  services.on("upgrade", (request, socket) => {
    const url = new URL(request.url, serviceOrigin);
    const known =
      url.pathname === "/realtime/v1/websocket" &&
      request.headers.host === serviceHost &&
      request.socket.servername === serviceHost &&
      url.searchParams.get("apikey") === publicKey &&
      url.searchParams.get("vsn") === "2.0.0" &&
      url.searchParams.get("events_per_second") === "10" &&
      [...url.searchParams].length === 3;
    record({ type: "websocket-denied", known, url: url.origin + url.pathname });
    socket.end(
      "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
  });
  await listen(services);
  const proxy = http.createServer((request, response) => {
    if (offline) {
      record({ type: "offline", url: request.url });
      request.socket.destroy();
      return;
    }
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return deny(response, "proxy-url", "invalid");
    }
    if (url.origin !== origin)
      return deny(
        response,
        "proxy-background-or-external",
        url.origin + url.pathname,
      );
    // Invoke the same handler, preserving absolute target and Host; never forward.
    void serveApp(request, response);
  });
  proxy.on("connection", track);
  proxy.on("connect", (request, client, head) => {
    if (offline || request.url !== `${serviceHost}:443`) {
      record({
        type: offline ? "offline-connect" : "connect-denied",
        url: request.url,
      });
      client.end(
        "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
      return;
    }
    record({ type: "connect-local", url: request.url });
    const upstream = net.connect(
      { host: "127.0.0.1", port: services.address().port },
      () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      },
    );
    track(upstream);
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
  });
  await listen(proxy);
  return {
    origin,
    proxy: `http://127.0.0.1:${proxy.address().port}`,
    events,
    setPhase(value) {
      phase = value;
    },
    select(next) {
      assert(
        next.snapshot.identity.projectRef ===
          artifact.snapshot.identity.projectRef,
      );
      artifact = next;
      record({
        type: "artifact-switch",
        revision: next.snapshot.identityRevision,
      });
    },
    offline(value) {
      offline = value;
      record({ type: "network-switch", offline });
      if (value) for (const socket of sockets) socket.destroy();
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await Promise.all(
        [proxy, services, app].map(
          (server) => new Promise((resolve) => server.close(resolve)),
        ),
      );
      record({ type: "closed", sockets: sockets.size });
    },
  };
}
