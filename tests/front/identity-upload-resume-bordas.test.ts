import { describe, expect, it } from "vitest";
import { createIdentityUploadResume } from "../../src/lib/identityUploadResume";

// Bordas da retomada de envio de imagem da identidade (caça por mutação):
// limite exato de tamanho do registro e do nome da conta, relógio em zero,
// desempate de registros do mesmo instante e a regra "só apaga o que eu vi".
// Fixtures inventadas.
const origin = "https://aaaaaaaaaaaaaaaaaaaa.supabase.co";
const sha256 = "c".repeat(64);
const asset = {
  path: `v1/${sha256}/imagem.png`,
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

function contexto(
  overrides: {
    userId?: string;
    nowMs?: () => number;
    storage?: MemoryStorage;
    validateUploadUrl?: (url: string) => void;
  } = {},
) {
  return {
    origin,
    userId: overrides.userId ?? "conta-1",
    asset,
    storage: overrides.storage ?? new MemoryStorage(),
    isActive: () => true,
    validateUploadUrl:
      overrides.validateUploadUrl ??
      ((url: string) => {
        if (url !== uploadUrl) throw new Error("url");
      }),
    nowMs: overrides.nowMs ?? (() => 100000000),
  };
}

function anterior() {
  return {
    size: 10,
    metadata: {},
    creationTime: "",
    urlStorageKey: "",
    uploadUrl,
    parallelUploadUrls: null,
  };
}

describe("retomada de envio: tamanho do nome da conta", () => {
  it("aceita 128 caracteres e recusa 129", async () => {
    const ok = await createIdentityUploadResume(
      contexto({ userId: "u".repeat(128) }),
    );
    expect(ok.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      createIdentityUploadResume(contexto({ userId: "u".repeat(129) })),
    ).rejects.toThrow("IDENTITY_UPLOAD_INVALID");
  });

  it("recusa conta vazia ou só com espaços", async () => {
    await expect(
      createIdentityUploadResume(contexto({ userId: "" })),
    ).rejects.toThrow("IDENTITY_UPLOAD_INVALID");
    await expect(
      createIdentityUploadResume(contexto({ userId: "   " })),
    ).rejects.toThrow("IDENTITY_UPLOAD_INVALID");
  });
});

describe("retomada de envio: limite exato do registro guardado", () => {
  async function guardado(tamanhoTotal: number) {
    const c = contexto({ validateUploadUrl: () => {} });
    const r = await createIdentityUploadResume(c);
    const key = await r.urlStorage.addUpload(r.fingerprint, anterior());
    const base = JSON.parse(c.storage.getItem(key)!);
    const semPreenchimento = JSON.stringify(base).length;
    const registro = {
      ...base,
      uploadUrl: uploadUrl + "x".repeat(tamanhoTotal - semPreenchimento),
    };
    const texto = JSON.stringify(registro);
    expect(texto.length).toBe(tamanhoTotal);
    c.storage.setItem(key, texto);
    return { c, r, registro };
  }

  it("registro de 8192 caracteres ainda é aceito", async () => {
    const { r, registro } = await guardado(8192);
    const achados = await r.urlStorage.findAllUploads();
    expect(achados).toHaveLength(1);
    expect(achados[0]?.uploadUrl).toBe(registro.uploadUrl);
  });

  it("registro de 8193 caracteres é descartado e apagado", async () => {
    const { c, r } = await guardado(8193);
    expect(await r.urlStorage.findAllUploads()).toEqual([]);
    expect(c.storage.length).toBe(0);
  });
});

describe("retomada de envio: relógio em zero e antes de zero", () => {
  it("registro criado no instante zero é guardado e reencontrado", async () => {
    const c = contexto({ nowMs: () => 0 });
    const r = await createIdentityUploadResume(c);
    const key = await r.urlStorage.addUpload(r.fingerprint, anterior());
    expect(c.storage.length).toBe(1);
    expect(JSON.parse(c.storage.getItem(key)!).createdAt).toBe(0);
    const achados = await r.urlStorage.findAllUploads();
    expect(achados).toHaveLength(1);
    expect(achados[0]?.creationTime).toBe("1970-01-01T00:00:00.000Z");
  });

  it("relógio negativo não grava nada", async () => {
    const c = contexto({ nowMs: () => -5 });
    const r = await createIdentityUploadResume(c);
    await r.urlStorage.addUpload(r.fingerprint, anterior());
    expect(c.storage.length).toBe(0);
  });

  it("registro guardado com data negativa é descartado", async () => {
    const c = contexto();
    const r = await createIdentityUploadResume(c);
    const key = await r.urlStorage.addUpload(r.fingerprint, anterior());
    const raw = JSON.parse(c.storage.getItem(key)!);
    raw.createdAt = -1;
    c.storage.setItem(key, JSON.stringify(raw));
    expect(await r.urlStorage.findAllUploads()).toEqual([]);
    expect(c.storage.length).toBe(0);
  });
});

describe("retomada de envio: desempate quando o limite de 32 é atingido", () => {
  it("com a mesma hora, sai primeiro o registro de menor chave", async () => {
    const c = contexto();
    for (let i = 0; i < 32; i++) {
      const hash = i.toString(16).padStart(64, "0");
      const r = await createIdentityUploadResume({
        ...c,
        asset: { ...asset, sha256: hash, path: `v1/${hash}/imagem.png` },
      });
      await r.urlStorage.addUpload(r.fingerprint, anterior());
    }
    expect(c.storage.length).toBe(32);
    const antes = [...c.storage.values.keys()].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const hash = (32).toString(16).padStart(64, "0");
    const novo = await createIdentityUploadResume({
      ...c,
      asset: { ...asset, sha256: hash, path: `v1/${hash}/imagem.png` },
    });
    await novo.urlStorage.addUpload(novo.fingerprint, anterior());
    expect(c.storage.length).toBe(32);
    expect(c.storage.values.has(antes[0]!)).toBe(false);
    expect(c.storage.values.has(antes[1]!)).toBe(true);
    expect(c.storage.values.has(antes[31]!)).toBe(true);
  });
});

describe("retomada de envio: removeUpload só apaga o que esta aba viu", () => {
  it("apaga o registro que ela mesma acabou de gravar", async () => {
    const c = contexto();
    const r = await createIdentityUploadResume(c);
    const key = await r.urlStorage.addUpload(r.fingerprint, anterior());
    expect(c.storage.length).toBe(1);
    await r.urlStorage.removeUpload(key);
    expect(c.storage.length).toBe(0);
  });

  it("apaga o registro que ela encontrou ao retomar", async () => {
    const c = contexto();
    const primeira = await createIdentityUploadResume(c);
    const key = await primeira.urlStorage.addUpload(
      primeira.fingerprint,
      anterior(),
    );
    const retomada = await createIdentityUploadResume(c);
    expect(
      await retomada.urlStorage.findUploadsByFingerprint(retomada.fingerprint),
    ).toHaveLength(1);
    await retomada.urlStorage.removeUpload(key);
    expect(c.storage.length).toBe(0);
  });

  it("não apaga sem nunca ter visto o registro", async () => {
    const c = contexto();
    const primeira = await createIdentityUploadResume(c);
    const key = await primeira.urlStorage.addUpload(
      primeira.fingerprint,
      anterior(),
    );
    const semVer = await createIdentityUploadResume(c);
    await semVer.urlStorage.removeUpload(key);
    expect(c.storage.length).toBe(1);
  });

  it("não apaga se outra aba trocou o endereço depois", async () => {
    const c = contexto({ validateUploadUrl: () => {} });
    const r = await createIdentityUploadResume(c);
    const key = await r.urlStorage.addUpload(r.fingerprint, anterior());
    expect(await r.urlStorage.findAllUploads()).toHaveLength(1);
    const outra = {
      ...JSON.parse(c.storage.getItem(key)!),
      uploadUrl: `${uploadUrl}-nova`,
    };
    c.storage.setItem(key, JSON.stringify(outra));
    await r.urlStorage.removeUpload(key);
    expect(c.storage.length).toBe(1);
    expect(JSON.parse(c.storage.getItem(key)!).uploadUrl).toBe(
      `${uploadUrl}-nova`,
    );
  });

  it("chave que não é a deste envio nunca é apagada", async () => {
    const c = contexto();
    const r = await createIdentityUploadResume(c);
    await r.urlStorage.addUpload(r.fingerprint, anterior());
    await r.urlStorage.removeUpload("ikcous.identityUpload.v1.outra");
    expect(c.storage.length).toBe(1);
  });
});
