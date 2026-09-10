import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createIdentityUploadResume } from "../../src/lib/identityUploadResume";
const origin = "https://aaaaaaaaaaaaaaaaaaaa.supabase.co";
const sha256 = "a".repeat(64);
const asset = {
  path: `v1/${sha256}/image.png`,
  sha256,
  bytes: 10,
  media_type: "image/png" as const,
};
const uploadUrl =
  "https://aaaaaaaaaaaaaaaaaaaa.storage.supabase.co/storage/v1/upload/resumable/id";
class MemoryStorage {
  values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(i: number) {
    return [...this.values.keys()].at(i) ?? null;
  }
  getItem(k: string) {
    return this.values.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.values.set(k, v);
  }
  removeItem(k: string) {
    this.values.delete(k);
  }
}
function context(storage = new MemoryStorage(), userId = "u1") {
  return {
    origin,
    userId,
    asset,
    storage,
    isActive: () => true,
    validateUploadUrl: (url: string) => {
      if (url !== uploadUrl) throw Error();
    },
    nowMs: () => 100000000,
  };
}
function previous() {
  return {
    size: 10,
    metadata: {},
    creationTime: "",
    urlStorageKey: "",
    uploadUrl,
    parallelUploadUrls: null,
  };
}
it("preserva retomada propria e nunca entrega registro de outra conta", async () => {
  const c = context();
  const first = await createIdentityUploadResume(c);
  await first.urlStorage.addUpload(first.fingerprint, previous());
  const reload = await createIdentityUploadResume(c);
  expect(
    await reload.urlStorage.findUploadsByFingerprint(reload.fingerprint),
  ).toMatchObject([{ uploadUrl, size: 10 }]);
  const another = await createIdentityUploadResume({
    ...c,
    userId: "u1.child",
  });
  expect(await another.urlStorage.findAllUploads()).toEqual([]);
  expect(c.storage.length).toBe(1);
});
it.each([
  "origin",
  "userId",
  "path",
  "sha256",
  "bytes",
  "mediaType",
  "extra",
  "version",
  "ttl",
  "future",
  "malformed",
  "url",
  "large",
])("descarta registro %s sem devolver endereco", async (kind) => {
  const c = context();
  const r = await createIdentityUploadResume(c);
  const key = await r.urlStorage.addUpload(r.fingerprint, previous());
  const raw = JSON.parse(c.storage.getItem(key)!);
  if (kind === "origin")
    raw.origin = "https://bbbbbbbbbbbbbbbbbbbb.supabase.co";
  if (kind === "userId") raw.userId = "u2";
  if (kind === "path") raw.path = `v1/${sha256}/other.png`;
  if (kind === "sha256") raw.sha256 = "b".repeat(64);
  if (kind === "bytes") raw.bytes = 11;
  if (kind === "mediaType") raw.mediaType = "image/jpeg";
  if (kind === "extra") raw.headers = { Authorization: "test-secret" };
  if (kind === "version") raw.version = 2;
  if (kind === "ttl") raw.createdAt = 100000000 - 86400000;
  if (kind === "future") raw.createdAt = 100000001;
  if (kind === "url") raw.uploadUrl += "?secret=bad";
  c.storage.setItem(
    key,
    kind === "malformed"
      ? "broken"
      : kind === "large"
        ? "x".repeat(8193)
        : JSON.stringify(raw),
  );
  expect(await r.urlStorage.findAllUploads()).toEqual([]);
  expect(c.storage.length).toBe(0);
});
it("preserva TTL ao retomar a mesma URL", async () => {
  const c = context();
  const r = await createIdentityUploadResume(c);
  const key = await r.urlStorage.addUpload(r.fingerprint, previous());
  const later = await createIdentityUploadResume({
    ...c,
    nowMs: () => 100000010,
  });
  await later.urlStorage.addUpload(later.fingerprint, previous());
  expect(JSON.parse(c.storage.getItem(key)!).createdAt).toBe(100000000);
});
it("limita a32 e nao remove prefixo de outra conta", async () => {
  const c = context();
  c.storage.setItem("unrelated", "keep");
  for (let i = 0; i < 35; i++) {
    const hash = i.toString(16).padStart(64, "0");
    const r = await createIdentityUploadResume({
      ...c,
      asset: { ...asset, sha256: hash, path: `v1/${hash}/image.png` },
      nowMs: () => 100000000 + i,
    });
    await r.urlStorage.addUpload(r.fingerprint, previous());
  }
  expect(c.storage.length).toBe(33);
  expect(c.storage.getItem("unrelated")).toBe("keep");
  const first = await createIdentityUploadResume({
    ...c,
    asset: {
      ...asset,
      sha256: "0".repeat(64),
      path: `v1/${"0".repeat(64)}/image.png`,
    },
    nowMs: () => 100000035,
  });
  expect(await first.urlStorage.findAllUploads()).toEqual([]);
});
it("confirmacao nao apaga referencia substituida por outra aba", async () => {
  const c = context();
  const r = await createIdentityUploadResume({
    ...c,
    validateUploadUrl: () => {},
  });
  const key = await r.urlStorage.addUpload(r.fingerprint, previous());
  const newer = {
    ...JSON.parse(c.storage.getItem(key)!),
    uploadUrl: `${uploadUrl}2`,
  };
  c.storage.setItem(key, JSON.stringify(newer));
  r.clearConfirmed(uploadUrl);
  expect(c.storage.length).toBe(1);
});
it("confirmacao nao remove registro substituido que ainda nao pode validar", async () => {
  const c = context();
  const r = await createIdentityUploadResume(c);
  const key = await r.urlStorage.addUpload(r.fingerprint, previous());
  c.storage.setItem(key, JSON.stringify({ uploadUrl: `${uploadUrl}2` }));
  r.clearConfirmed(uploadUrl);
  expect(c.storage.length).toBe(1);
});
it.each(["read", "write", "key", "length"])(
  "storage %s indisponivel nao impede upload",
  async (method) => {
    const c = context();
    if (method === "read")
      c.storage.getItem = () => {
        throw Error("secret");
      };
    if (method === "write")
      c.storage.setItem = () => {
        throw Error("quota");
      };
    if (method === "key")
      c.storage.key = () => {
        throw Error();
      };
    if (method === "length")
      Object.defineProperty(c.storage, "length", {
        get: () => {
          throw Error();
        },
      });
    const r = await createIdentityUploadResume(c);
    await expect(
      r.urlStorage.addUpload(r.fingerprint, previous()),
    ).resolves.toEqual(expect.any(String));
  },
);
it("cancelamento durante storage nao adiciona registro", async () => {
  const c = context();
  let active = true;
  c.storage.getItem = () => {
    active = false;
    return null;
  };
  const r = await createIdentityUploadResume({ ...c, isActive: () => active });
  await r.urlStorage.addUpload(r.fingerprint, previous());
  expect(c.storage.length).toBe(0);
});
it("apos encerrar nao adiciona referencia tardia nem apaga referencia existente", async () => {
  const c = context();
  let active = true;
  const r = await createIdentityUploadResume({ ...c, isActive: () => active });
  const key = await r.urlStorage.addUpload(r.fingerprint, previous());
  active = false;
  r.clearConfirmed(uploadUrl);
  await r.urlStorage.removeUpload(key);
  await r.urlStorage.addUpload(r.fingerprint, previous());
  expect(c.storage.length).toBe(1);
});
it("nao aceita registro paralelo nem fingerprint alheio", async () => {
  const c = context();
  const r = await createIdentityUploadResume(c);
  await r.urlStorage.addUpload("other", previous());
  await r.urlStorage.addUpload(r.fingerprint, {
    ...previous(),
    parallelUploadUrls: [uploadUrl],
  });
  expect(c.storage.length).toBe(0);
});
it("storage null nao acessa storage global", async () => {
  const read = vi.fn(() => {
    throw Error();
  });
  vi.stubGlobal("window", {
    get localStorage() {
      return read();
    },
  });
  try {
    const r = await createIdentityUploadResume({ ...context(), storage: null });
    await r.urlStorage.addUpload(r.fingerprint, previous());
    expect(read).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
it("impressao inclui conta projeto caminho hash tamanho e mime", async () => {
  const c = context();
  const resume = await createIdentityUploadResume(c);
  expect(resume.fingerprint).toBe(
    createHash("sha256")
      .update(
        JSON.stringify([origin, "u1", asset.path, sha256, 10, "image/png"]),
      )
      .digest("hex"),
  );
});
it("outro projeto nao encontra nem remove registro", async () => {
  const c = context();
  const r = await createIdentityUploadResume(c);
  await r.urlStorage.addUpload(r.fingerprint, previous());
  const another = await createIdentityUploadResume({
    ...c,
    origin: "https://bbbbbbbbbbbbbbbbbbbb.supabase.co",
  });
  expect(await another.urlStorage.findAllUploads()).toEqual([]);
  expect(c.storage.length).toBe(1);
});
it("falha no acesso default a localStorage desliga persistencia", async () => {
  vi.stubGlobal("window", {
    get localStorage() {
      throw Error("private mode");
    },
  });
  try {
    const r = await createIdentityUploadResume({
      ...context(),
      storage: undefined,
    });
    await r.urlStorage.addUpload(r.fingerprint, previous());
    expect(await r.urlStorage.findAllUploads()).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("captura descritor antes do hash e nao persiste token ou blob", async () => {
  const c = context();
  const copy = { ...asset };
  const pending = createIdentityUploadResume({ ...c, asset: copy });
  copy.path = `v1/${sha256}/other.png`;
  const r = await pending;
  const key = await r.urlStorage.addUpload(r.fingerprint, previous());
  const record = JSON.parse(c.storage.getItem(key)!);
  expect(record.path).toBe(asset.path);
  expect(Object.keys(record).sort()).toEqual([
    "bytes",
    "createdAt",
    "mediaType",
    "origin",
    "path",
    "sha256",
    "uploadUrl",
    "userId",
    "version",
  ]);
});
