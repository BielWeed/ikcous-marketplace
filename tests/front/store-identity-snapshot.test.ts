import { describe, expect, it } from "vitest";

import {
  type RawStoreIdentity,
  StoreIdentitySnapshotError,
  parseRawStoreIdentity,
  parseStoreIdentitySnapshot,
  sameRawStoreIdentity,
} from "@/lib/storeIdentitySnapshot";

function rawIdentity() {
  return {
    store_name: "  Nome bruto  ",
    store_city: null,
    store_state: "sp",
    primary_color: "#000000",
    secondary_color: "#abcdef",
    accent_color: "",
    logo_url: " URL antiga ",
    branding_assets: {
      legacy: [{ text: " Original ", items: [1, null, true] }],
    },
  };
}

const fields = [
  "store_name",
  "store_city",
  "store_state",
  "primary_color",
  "secondary_color",
  "accent_color",
  "logo_url",
  "branding_assets",
] as const;

function rejected(value: unknown) {
  expect(() => parseRawStoreIdentity(value)).toThrow(
    StoreIdentitySnapshotError,
  );
}

describe("fotografia administrativa bruta", () => {
  it("separa a fonte sem normalizar e congela recursivamente somente a saida", () => {
    const input = { revision: "9007199254740993", identity: rawIdentity() };
    const result = parseStoreIdentitySnapshot(input);
    input.identity.store_name = "Mudou depois";
    input.identity.branding_assets.legacy[0].text = "Outro";
    input.identity.branding_assets.legacy[0].items.push(42);
    expect(result.revision).toBe("9007199254740993");
    expect(result.identity).toEqual(rawIdentity());
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.identity)).toBe(false);
    expect(Object.isFrozen(input.identity.branding_assets.legacy[0])).toBe(
      false,
    );
    const frozen = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      expect(Object.isFrozen(value)).toBe(true);
      for (const child of Object.values(value)) frozen(child);
    };
    frozen(result);
  });

  it("parse bruto tambem clona e aceita cada null explicito e assets vazios", () => {
    const source = rawIdentity();
    const parsed = parseRawStoreIdentity(source);
    source.branding_assets.legacy[0].items.push(2);
    expect(parsed).toEqual(rawIdentity());
    expect(Object.isFrozen(parsed)).toBe(true);
    const empty = Object.fromEntries(fields.map((key) => [key, null]));
    expect(parseRawStoreIdentity(empty)).toEqual(empty);
    expect(
      parseRawStoreIdentity({ ...empty, branding_assets: {} }).branding_assets,
    ).toEqual({});
  });

  it.each(["0", "1", "9007199254740993", "9223372036854775807"])(
    "conserva revisao %s e suporta releitura",
    (revision) => {
      const result = parseStoreIdentitySnapshot({
        revision,
        identity: rawIdentity(),
      });
      expect(result.revision).toBe(revision);
      expect(parseStoreIdentitySnapshot(result)).toEqual(result);
      expect(parseStoreIdentitySnapshot(result)).not.toBe(result);
    },
  );

  it.each([
    undefined,
    null,
    0,
    9007199254740993n,
    "",
    "00",
    "01",
    "-0",
    "-1",
    "+1",
    " 1",
    "1 ",
    "1\n",
    "1\r\n",
    "1.0",
    "1e1",
    "9223372036854775808",
    "9".repeat(10000),
  ])("recusa revisao nao canonica %#", (revision) => {
    expect(() =>
      parseStoreIdentitySnapshot({ revision, identity: rawIdentity() }),
    ).toThrow(StoreIdentitySnapshotError);
  });

  it.each([
    null,
    [],
    {},
    { revision: "0" },
    { identity: rawIdentity() },
    { revision: "0", identity: rawIdentity(), extra: null },
  ])("exige envelope completo e fechado %#", (value) => {
    expect(() => parseStoreIdentitySnapshot(value)).toThrow(
      StoreIdentitySnapshotError,
    );
  });

  it.each(fields)("exige chave propria %s e seu tipo", (field) => {
    const missing = Object.fromEntries(
      Object.entries(rawIdentity()).filter(([key]) => key !== field),
    );
    rejected(missing);
    rejected({ ...rawIdentity(), [field]: undefined });
    rejected({ ...rawIdentity(), [field]: 12 });
    rejected({ ...rawIdentity(), [field]: [] });
    rejected({ ...rawIdentity(), [field]: false });
    const inherited = Object.create({
      [field]: field === "branding_assets" ? {} : null,
    });
    Object.assign(inherited, missing);
    rejected(inherited);
  });

  it.each([
    null,
    [],
    {},
    "raw",
    { ...rawIdentity(), extra: null },
    { ...rawIdentity(), branding_assets: "assets" },
  ])("recusa identidade incompleta ou extra %#", rejected);

  it.each([
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    () => "value",
    Symbol("private"),
    1n,
  ])("nao apaga nem transforma dado nao JSON %#", (bad) => {
    rejected({ ...rawIdentity(), branding_assets: { nested: { value: bad } } });
    rejected({ ...rawIdentity(), branding_assets: { nested: [bad] } });
    rejected({
      ...rawIdentity(),
      branding_assets: Object.fromEntries([["__proto__", bad]]),
    });
  });

  it("recusa ciclos sem RangeError mas permite referencias compartilhadas aciclicas", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    rejected({ ...rawIdentity(), branding_assets: cycle });
    const array: unknown[] = [];
    array.push(array);
    rejected({ ...rawIdentity(), branding_assets: { array } });
    const child = { saved: [1] };
    const result = parseRawStoreIdentity({
      ...rawIdentity(),
      branding_assets: { a: child, b: child },
    });
    child.saved.push(2);
    expect(result.branding_assets).toEqual({
      a: { saved: [1] },
      b: { saved: [1] },
    });
  });

  it("nao omite chaves simbolicas, nao enumeraveis, buracos ou propriedades de arrays", () => {
    rejected({ ...rawIdentity(), [Symbol("extra")]: null });
    rejected(Object.defineProperty(rawIdentity(), "extra", { value: null }));
    rejected({ ...rawIdentity(), branding_assets: { sparse: Array(1) } });
    rejected({
      ...rawIdentity(),
      branding_assets: { extra: Object.assign([1], { label: "lost" }) },
    });
    rejected({ ...rawIdentity(), branding_assets: { date: new Date(0) } });
  });

  it("preserva __proto__ e constructor como dados mesmo quando z.json descarta __proto__", () => {
    const assets = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"safe":1}},"nested":[{"__proto__":null}]}',
    );
    const parsed = parseRawStoreIdentity({
      ...rawIdentity(),
      branding_assets: assets,
    });
    expect(parsed.branding_assets).toEqual(assets);
    expect(Object.keys(parsed.branding_assets!)).toContain("__proto__");
    expect(Object.getPrototypeOf(parsed.branding_assets)).toBe(
      Object.prototype,
    );
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    expect(JSON.stringify(parsed.branding_assets)).toBe(JSON.stringify(assets));
  });

  it("erro publico nao inclui entrada, caminho, cause ou erro de getter", () => {
    const secret = "SEGREDO_SINTETICO_NAO_VAZAR";
    const values = [
      { ...rawIdentity(), [secret]: secret },
      { ...rawIdentity(), branding_assets: { [secret]: undefined } },
      Object.defineProperty(rawIdentity(), "store_name", {
        get() {
          throw new Error(secret);
        },
      }),
    ];
    for (const value of values) {
      try {
        parseRawStoreIdentity(value);
        expect.fail("deveria recusar");
      } catch (error) {
        expect(error).toBeInstanceOf(StoreIdentitySnapshotError);
        expect(error).toMatchObject({ code: "IDENTITY_SNAPSHOT_INVALID" });
        expect(String(error)).not.toContain(secret);
        expect(JSON.stringify(error)).not.toContain(secret);
        expect(error).not.toHaveProperty("cause");
      }
    }
  });
});

describe("comparacao da identidade bruta", () => {
  it("ignora ordem de chaves em toda profundidade e conserva ordem dos arrays", () => {
    const a = {
      ...rawIdentity(),
      branding_assets: { x: { a: 1, b: 2 }, y: [1, 2] },
    };
    const b = Object.fromEntries(
      Object.entries({
        ...a,
        branding_assets: { y: [1, 2], x: { b: 2, a: 1 } },
      }).reverse(),
    ) as unknown as RawStoreIdentity;
    expect(sameRawStoreIdentity(a, b)).toBe(true);
    expect(
      sameRawStoreIdentity(a, {
        ...a,
        branding_assets: { x: { a: 1, b: 2 }, y: [2, 1] },
      }),
    ).toBe(false);
  });

  it.each(fields)("percebe alteracao em %s", (field) => {
    const a = rawIdentity();
    const b = {
      ...a,
      [field]: field === "branding_assets" ? null : "Diferente",
    };
    expect(sameRawStoreIdentity(a, b)).toBe(false);
  });

  it("nao normaliza espaco, caixa, null ou vazio e compara chaves especiais", () => {
    const a = rawIdentity();
    for (const patch of [
      { store_name: "Nome bruto" },
      { store_state: "SP" },
      { store_city: "" },
      { secondary_color: "#ABCDEF" },
    ]) {
      expect(sameRawStoreIdentity(a, { ...a, ...patch })).toBe(false);
    }
    const special = { ...a, branding_assets: JSON.parse('{"__proto__":1}') };
    expect(sameRawStoreIdentity(special, { ...a, branding_assets: {} })).toBe(
      false,
    );
    expect(
      sameRawStoreIdentity(special, {
        ...a,
        branding_assets: JSON.parse('{"__proto__":1}'),
      }),
    ).toBe(true);
  });

  it("entrada malformada por cast retorna false mesmo comparada consigo", () => {
    for (const malformed of [
      null,
      {},
      { ...rawIdentity(), branding_assets: { bad: undefined } },
    ]) {
      const invalid = malformed as unknown as RawStoreIdentity;
      expect(sameRawStoreIdentity(invalid, invalid)).toBe(false);
      expect(sameRawStoreIdentity(rawIdentity(), invalid)).toBe(false);
    }
  });
});
