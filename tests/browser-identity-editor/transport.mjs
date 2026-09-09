import assert from "node:assert/strict";
import { hash } from "../identity-admin-http/environment.mjs";

export const storageOrigin = "https://aaaaaaaaaaaaaaaaaaaa.storage.supabase.co";
const publicPrefix = "/storage/v1/object/public/branding/";
const tusPrefix = "/storage/v1/upload/resumable";

// Protocol fixture only: no GoTrue, Supabase Storage authorization/RLS or CDN.
export function createTransport(objects, allowedOriginals, sessions, evidence) {
  const resources = new Map();
  let sequence = 0, pauseNext = false;
  const held = new Set();
  const release = () => { for (const done of held) done(); held.clear(); };
  const handle = async (route, req, res, body) => {
    const trace = { method: req.method, route, bytes: body.length, sha256: hash(body), status: null };
    evidence.tus.push(trace);
    const traceId = evidence.tus.length;
    const reply = (status, headers = {}, bytes) => {
      trace.status = status;
      if (!res.destroyed) { res.writeHead(status, { ...headers, "x-bench-tus-trace": String(traceId) }); res.end(bytes); }
    };
    if (req.method === "GET") {
      assert(route.startsWith(publicPrefix));
      assert(!req.headers.authorization && !req.headers.cookie);
      const object = objects.get(route.slice(publicPrefix.length));
      assert(object, "PUBLIC_OBJECT_NOT_COMPLETE");
      return reply(200, { "Content-Type": object.mediaType }, object.bytes);
    }
    const user = Object.values(sessions).find((session) => `Bearer ${session.access_token}` === req.headers.authorization)?.user.id;
    assert(user, "TUS_FIXTURE_USER");
    assert(!req.headers["x-upsert"] && req.method !== "DELETE");
    assert.equal(req.headers["tus-resumable"], "1.0.0");
    if (req.method === "POST") {
      assert.equal(route, tusPrefix);
      assert.equal(body.length, 0);
      const metadata = Object.fromEntries(String(req.headers["upload-metadata"]).split(",").map((pair) => {
        const [key, encoded] = pair.split(" ");
        return [key, Buffer.from(encoded, "base64").toString()];
      }));
      assert.deepEqual(Object.keys(metadata).sort(), ["bucketName", "cacheControl", "contentType", "objectName"]);
      assert.equal(metadata.bucketName, "branding");
      assert.equal(metadata.cacheControl, "31536000");
      const original = allowedOriginals.get(metadata.objectName);
      assert(original, "TUS_ORIGINAL_NOT_ALLOWLISTED");
      assert.equal(metadata.contentType, original.mediaType);
      assert.equal(Number(req.headers["upload-length"]), original.bytes.length);
      if (objects.has(metadata.objectName)) return reply(409);
      const id = `id${++sequence}`;
      resources.set(id, { metadata, user, original, parts: [], offset: 0 });
      trace.resource = id;
      return reply(201, { "Tus-Resumable": "1.0.0", Location: `${storageOrigin}${tusPrefix}/${id}` });
    }
    const match = /^\/storage\/v1\/upload\/resumable\/(id[0-9]+)$/.exec(route);
    assert(match);
    const record = resources.get(match[1]);
    assert(record && record.user === user, "TUS_BINDING");
    trace.resource = match[1];
    if (req.method === "HEAD") {
      assert.equal(body.length, 0);
      trace.offset = record.offset;
      return reply(200, { "Tus-Resumable": "1.0.0", "Upload-Length": String(record.original.bytes.length),
        "Upload-Offset": String(record.offset), "Upload-Metadata": Object.entries({ ...record.metadata, cacheControl: "max-age=31536000" })
          .map(([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`).join(",") });
    }
    assert.equal(req.method, "PATCH");
    assert.equal(req.headers["content-type"], "application/offset+octet-stream");
    trace.offset = Number(req.headers["upload-offset"]);
    if (trace.offset !== record.offset) return reply(409);
    assert(body.length > 0 && body.length <= 6291456);
    assert(record.offset + body.length <= record.original.bytes.length);
    assert.deepEqual(body, record.original.bytes.subarray(record.offset, record.offset + body.length));
    record.parts.push(body);
    record.offset += body.length;
    trace.accepted = body.length;
    if (record.offset === record.original.bytes.length) {
      const bytes = Buffer.concat(record.parts);
      assert.equal(hash(bytes), hash(record.original.bytes));
      objects.set(record.metadata.objectName, { bytes, mediaType: record.original.mediaType });
      trace.completeSha256 = hash(bytes);
    }
    if (pauseNext) {
      pauseNext = false;
      trace.heldAfterAccept = true;
      await new Promise((done) => held.add(done));
    }
    reply(204, { "Tus-Resumable": "1.0.0", "Upload-Offset": String(record.offset) });
  };
  return { handle, pause: () => { pauseNext = true; }, release, get held() { return held.size; } };
}

// Installed before evaluating product modules. Only exact synthetic endpoints map locally.
export function installFetchBridge(origin, storage, local) {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const expected = String(input);
    const url = new URL(expected);
    const rpc = url.origin === origin && /^\/rest\/v1\/rpc\/(read_store_identity|save_store_identity)$/.test(url.pathname) && init?.method === "POST";
    const tusPath = url.pathname === "/storage/v1/upload/resumable" || /^\/storage\/v1\/upload\/resumable\/id[0-9]+$/.test(url.pathname);
    const tus = url.origin === storage && tusPath && ["POST", "HEAD", "PATCH"].includes(init?.method ?? "GET");
    const asset = url.origin === origin && /^\/storage\/v1\/object\/public\/branding\/v1\/[a-f0-9]{64}\/[a-z0-9._-]+$/.test(url.pathname) && (init?.method ?? "GET") === "GET";
    if ((!rpc && !tus && !asset) || url.search || url.hash || init?.redirect !== "error" || init?.credentials !== "omit") {
      window.identityBridgeViolation = true;
      throw new Error("BENCH_FETCH_DESTINATION_OR_POLICY");
    }
    const target = `${local}/wire${url.pathname}`;
    const response = await nativeFetch(target, init);
    if (response.url !== target || response.redirected) throw new Error("BENCH_LOOPBACK_RESPONSE");
    if (response.headers.get("x-bench-fault") === "lost-real-200") throw new TypeError("BENCH_LOST_REAL_200");
    if (response.headers.get("x-bench-fault") === "read-unavailable") throw new TypeError("BENCH_READ_UNAVAILABLE");
    Object.defineProperty(response, "url", { value: expected });
    return response;
  };
}
