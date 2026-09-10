import { afterEach, describe, expect, it, vi } from "vitest";

import {
  IDENTITY_ASSET_ROLES,
  type IdentityAsset,
  type IdentityAssetRole,
} from "@/lib/storeIdentity";
import {
  IdentityDraftError,
  buildIdentityEditorIntent,
  changeIdentityEditorDraft,
  createIdentityEditorDraft,
  identityEditorDraftIsDirty,
  reconcileIdentityEditorDraft,
} from "@/lib/storeIdentityDraft";

const origin = "https://abcdefghijklmnopqrst.supabase.co";
const otherOrigin = "https://zyxwvutsrqponmlkjihg.supabase.co";
function file(
  name: string,
  width?: number,
  height?: number,
  media_type = "image/png",
) {
  return {
    path: `v1/${"a".repeat(64)}/${name}`,
    sha256: "a".repeat(64),
    media_type,
    bytes: 100,
    ...(width === undefined ? {} : { width, height }),
  };
}
function snapshot() {
  return {
    revision: "9007199254740993",
    identity: {
      store_name: "  Loja A  ",
      store_city: " Cidade ",
      store_state: "sp",
      primary_color: "#aabbcc",
      secondary_color: "#000000",
      accent_color: "#000000",
      logo_url: `${origin}/storage/v1/object/public/branding/${file("header.svg").path}`,
      branding_assets: {
        version: 1,
        originals: [
          file("original.svg", undefined, undefined, "image/svg+xml"),
        ],
        header: file("header.svg", undefined, undefined, "image/svg+xml"),
        loader: file("loader.svg", undefined, undefined, "image/svg+xml"),
        favicon: file(
          "f.ico",
          undefined,
          undefined,
          "image/vnd.microsoft.icon",
        ),
        apple_touch: file("apple.png", 180, 180),
        icon_192: file("192.png", 192, 192),
        icon_512: file("512.png", 512, 512),
        maskable_512: file("mask.png", 512, 512),
        og: file("og.jpg", 1200, 630, "image/jpeg"),
      },
    },
  };
}
function uploaded(asset = file("new.png")) {
  return {
    asset: asset as IdentityAsset,
    url: `${origin}/storage/v1/object/public/branding/${asset.path}`,
  };
}
function draft() {
  return createIdentityEditorDraft(snapshot(), origin);
}
function error(fn: () => unknown, code = "IDENTITY_DRAFT_INVALID") {
  expect(fn).toThrow(IdentityDraftError);
  expect(fn).toThrow(code);
}
function frozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) frozen(child);
}

afterEach(() => vi.unstubAllGlobals());

describe("rascunho de identidade separado da fotografia", () => {
  it("captura raw8 e revisao maior que 2^53 sem normalizar expected", () => {
    const input = snapshot();
    const result = createIdentityEditorDraft(input, origin);
    expect(result.expected).toEqual(input);
    expect(result.fields).toEqual({
      storeName: "Loja A",
      storeCity: "Cidade",
      storeState: "SP",
      primaryColor: "#AABBCC",
      secondaryColor: "#000000",
      accentColor: "#000000",
    });
    expect(identityEditorDraftIsDirty(result, origin)).toBe(false);
    input.identity.store_name = "Mudou";
    input.identity.branding_assets.originals[0].bytes = 200;
    expect(result.expected).toEqual(snapshot());
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.identity.branding_assets.originals[0])).toBe(
      false,
    );
    frozen(result);
  });

  it("conserva null bruto e monta apenas oito campos canonicos", () => {
    const input = snapshot();
    const raw = { ...input.identity, store_city: null, store_state: null };
    const result = createIdentityEditorDraft(
      { ...input, identity: raw },
      origin,
    );
    expect(result.fields.storeCity).toBe("");
    expect(result.fields.storeState).toBe("");
    const fields = {
      ...result.fields,
      storeName: "  Novo nome  ",
      storeCity: "  ",
      storeState: " ",
    };
    const edited = changeIdentityEditorDraft(
      result,
      { kind: "fields", fields },
      origin,
    );
    fields.storeName = "Outra tecla";
    const intent = buildIdentityEditorIntent(edited, origin);
    expect(intent.expected).toEqual({ ...input, identity: raw });
    expect(intent.desired).toEqual({
      ...raw,
      store_name: "Novo nome",
      primary_color: "#AABBCC",
    });
    expect(intent.expected.revision).toBe("9007199254740993");
    expect(edited.fields.storeName).toBe("  Novo nome  ");
    expect(identityEditorDraftIsDirty(edited, origin)).toBe(true);
    expect(Object.isFrozen(fields)).toBe(false);
    frozen(edited);
    frozen(intent);
  });

  it.each(["", "http://localhost", otherOrigin])(
    "recusa origem sem reconstruir fotografia %s",
    (badOrigin) => {
      error(
        () => createIdentityEditorDraft(snapshot(), badOrigin),
        badOrigin === otherOrigin
          ? "IDENTITY_DRAFT_INCOMPLETE"
          : "IDENTITY_DRAFT_INVALID",
      );
    },
  );

  it("distingue raw malformado de legado valido mas incompleto", () => {
    error(() =>
      createIdentityEditorDraft(
        { ...snapshot(), revision: 1 } as never,
        origin,
      ),
    );
    error(
      () =>
        createIdentityEditorDraft(
          {
            ...snapshot(),
            identity: { ...snapshot().identity, branding_assets: null },
          },
          origin,
        ),
      "IDENTITY_DRAFT_INCOMPLETE",
    );
  });

  it.each([
    { storeName: "" },
    { primaryColor: "#0" },
    { primaryColor: "#000000" },
    { storeState: "S" },
  ])("permite digitar mas recusa publicar %#", (patch) => {
    const original = draft();
    const edited = changeIdentityEditorDraft(
      original,
      { kind: "fields", fields: { ...original.fields, ...patch } },
      origin,
    );
    expect(edited.expected).toEqual(original.expected);
    expect(identityEditorDraftIsDirty(edited, origin)).toBe(true);
    error(() => buildIdentityEditorIntent(edited, origin));
  });

  it("nao executa getters ou toJSON nem aceita extras, ciclo, undefined e prototipo", () => {
    const original = draft();
    let invoked = 0;
    const accessor = { ...original.fields };
    Object.defineProperty(accessor, "storeName", {
      enumerable: true,
      get() {
        invoked++;
        return "Malicioso";
      },
    });
    const cycle: Record<string, unknown> = { ...original.fields };
    cycle.storeName = cycle;
    for (const fields of [
      accessor,
      cycle,
      { ...original.fields, extra: 1 },
      { ...original.fields, storeName: undefined },
      {
        ...original.fields,
        toJSON() {
          invoked++;
          return {};
        },
      },
      Object.assign(Object.create({ inherited: true }), original.fields),
    ]) {
      error(() =>
        changeIdentityEditorDraft(
          original,
          { kind: "fields", fields } as never,
          origin,
        ),
      );
    }
    const forged = { ...original, fields: accessor };
    error(() => identityEditorDraftIsDirty(forged, origin));
    error(() => buildIdentityEditorIntent(forged, origin));
    error(() => reconcileIdentityEditorDraft(forged, snapshot(), origin));
    error(() =>
      changeIdentityEditorDraft(
        original,
        Object.defineProperty({}, "kind", {
          enumerable: true,
          get() {
            invoked++;
            return "fields";
          },
        }) as never,
        origin,
      ),
    );
    expect(invoked).toBe(0);
    expect(original).toEqual(draft());
  });

  // Table keys are the closed A3 role list, never caller data.
  /* eslint-disable security/detect-object-injection */
  it.each(IDENTITY_ASSET_ROLES)("troca somente o papel %s", (role) => {
    const original = draft();
    const replacement = {
      ...original.assets[role],
      path: original.assets[role].path.replace(
        /[^/]+$/,
        `new-${role}.${original.assets[role].path.split(".").at(-1)}`,
      ),
    };
    const result = changeIdentityEditorDraft(
      original,
      { kind: "asset", roles: [role], uploaded: uploaded(replacement) },
      origin,
    );
    for (const key of IDENTITY_ASSET_ROLES)
      expect(result.assets[key]).toEqual(
        key === role ? replacement : original.assets[key],
      );
    expect(result.assets.originals).toEqual(original.assets.originals);
    expect(result.expected).toEqual(original.expected);
    const intent = buildIdentityEditorIntent(result, origin);
    expect(intent.desired.logo_url).toBe(
      `${origin}/storage/v1/object/public/branding/${result.assets.header.path}`,
    );
    frozen(result);
  });

  /* eslint-enable security/detect-object-injection */
  it("junta header e loader apenas por escolha explicita e nao acumula fontes", () => {
    const original = draft();
    let result = original;
    for (let i = 0; i < 10; i++)
      result = changeIdentityEditorDraft(
        result,
        {
          kind: "asset",
          roles: ["header", "loader"],
          uploaded: uploaded(file(`logo-${i}.png`)),
        },
        origin,
      );
    expect(result.assets.header).toEqual(file("logo-9.png"));
    expect(result.assets.loader).toEqual(file("logo-9.png"));
    expect(result.assets.originals).toEqual(original.assets.originals);
    for (const roles of [
      [],
      ["header", "header"],
      ["header", "og"],
      [...IDENTITY_ASSET_ROLES],
      ["unknown"],
    ]) {
      error(() =>
        changeIdentityEditorDraft(
          original,
          {
            kind: "asset",
            roles: roles as IdentityAssetRole[],
            uploaded: uploaded(),
          },
          origin,
        ),
      );
    }
  });

  it("reprova URL externa, query, hash, getter e dimensoes incompativeis sem mutar", () => {
    const original = draft();
    for (const url of [
      uploaded().url.replace(origin, otherOrigin),
      `${uploaded().url}?x`,
      `${uploaded().url}#x`,
    ])
      error(() =>
        changeIdentityEditorDraft(
          original,
          {
            kind: "asset",
            roles: ["header"],
            uploaded: { ...uploaded(), url },
          },
          origin,
        ),
      );
    for (const role of [
      "apple_touch",
      "icon_192",
      "icon_512",
      "maskable_512",
      "og",
    ] as const)
      error(() =>
        changeIdentityEditorDraft(
          original,
          { kind: "asset", roles: [role], uploaded: uploaded() },
          origin,
        ),
      );
    let invoked = 0;
    error(() =>
      changeIdentityEditorDraft(
        original,
        {
          kind: "asset",
          roles: ["header"],
          uploaded: {
            get asset() {
              invoked++;
              return uploaded().asset;
            },
            url: uploaded().url,
          },
        },
        origin,
      ),
    );
    expect(invoked).toBe(0);
    expect(original).toEqual(draft());
  });

  it("fontes exigem escolha explicita e respeitam 1, 8 e 9", () => {
    const original = draft();
    let result = original;
    for (let i = 1; i < 8; i++)
      result = changeIdentityEditorDraft(
        result,
        { kind: "source-add", uploaded: uploaded(file(`source-${i}.png`)) },
        origin,
      );
    expect(result.assets.originals).toHaveLength(8);
    error(
      () =>
        changeIdentityEditorDraft(
          result,
          { kind: "source-add", uploaded: uploaded() },
          origin,
        ),
      "IDENTITY_DRAFT_SOURCE_LIMIT",
    );
    const duplicate = changeIdentityEditorDraft(
      result,
      { kind: "source-add", uploaded: uploaded(result.assets.originals[7]) },
      origin,
    );
    expect(duplicate).toEqual(result);
    expect(duplicate).not.toBe(result);
    const replaced = changeIdentityEditorDraft(
      result,
      { kind: "source-replace", index: 3, uploaded: uploaded() },
      origin,
    );
    expect(replaced.assets.originals).toEqual(
      result.assets.originals.map((asset, index) =>
        index === 3 ? uploaded().asset : asset,
      ),
    );
    const removed = changeIdentityEditorDraft(
      replaced,
      { kind: "source-remove", index: 3 },
      origin,
    );
    expect(removed.assets.originals).toEqual(
      result.assets.originals.filter((_, index) => index !== 3),
    );
    for (const role of IDENTITY_ASSET_ROLES) {
      // Both keys come from the closed A3 role list.
      // eslint-disable-next-line security/detect-object-injection
      expect(removed.assets[role]).toEqual(original.assets[role]);
    }
    error(
      () =>
        changeIdentityEditorDraft(
          original,
          { kind: "source-remove", index: 0 },
          origin,
        ),
      "IDENTITY_DRAFT_SOURCE_REQUIRED",
    );
  });

  it("rejeita duplicidade em outro indice e descritor conflitante no mesmo path", () => {
    const original = draft();
    const two = changeIdentityEditorDraft(
      original,
      { kind: "source-add", uploaded: uploaded() },
      origin,
    );
    expect(
      changeIdentityEditorDraft(
        two,
        { kind: "source-replace", index: 1, uploaded: uploaded() },
        origin,
      ),
    ).toEqual(two);
    error(
      () =>
        changeIdentityEditorDraft(
          two,
          { kind: "source-replace", index: 0, uploaded: uploaded() },
          origin,
        ),
      "IDENTITY_DRAFT_SOURCE_DUPLICATE",
    );
    for (const kind of ["source-add", "source-replace"] as const)
      error(() =>
        changeIdentityEditorDraft(
          two,
          {
            kind,
            ...(kind === "source-replace" ? { index: 1 } : {}),
            uploaded: uploaded({ ...uploaded().asset, bytes: 101 }),
          } as never,
          origin,
        ),
      );
    error(() =>
      changeIdentityEditorDraft(
        original,
        {
          kind: "asset",
          roles: ["header"],
          uploaded: uploaded({ ...original.assets.loader, bytes: 101 }),
        },
        origin,
      ),
    );
  });

  it("substituicao identica em si nao altera lista preexistente com repeticao", () => {
    const input = snapshot();
    input.identity.branding_assets.originals.push({
      ...input.identity.branding_assets.originals[0],
    });
    const original = createIdentityEditorDraft(input, origin);
    const result = changeIdentityEditorDraft(
      original,
      {
        kind: "source-replace",
        index: 0,
        uploaded: uploaded(original.assets.originals[0]),
      },
      origin,
    );
    expect(result).toEqual(original);
    expect(result).not.toBe(original);
  });

  it.each([Number.NaN, -1, 0.5, 1, Number.POSITIVE_INFINITY])(
    "recusa indice invalido %s",
    (index) => {
      for (const kind of ["source-remove", "source-replace"] as const)
        error(() =>
          changeIdentityEditorDraft(
            draft(),
            {
              kind,
              index,
              ...(kind === "source-replace" ? { uploaded: uploaded() } : {}),
            } as never,
            origin,
          ),
        );
    },
  );

  it("ordem de chaves nao suja, mas ordem de fontes suja", () => {
    const original = draft();
    const fields = Object.fromEntries(
      Object.entries(original.fields).reverse(),
    );
    const assets = Object.fromEntries(
      Object.entries(original.assets).reverse(),
    );
    expect(
      identityEditorDraftIsDirty(
        { ...original, fields, assets } as never,
        origin,
      ),
    ).toBe(false);
    expect(
      changeIdentityEditorDraft(
        original,
        {
          kind: "asset",
          roles: ["header"],
          uploaded: uploaded(original.assets.header),
        },
        origin,
      ),
    ).toEqual(original);
    const input = snapshot();
    input.identity.branding_assets.originals.push(file("source.png"));
    const two = createIdentityEditorDraft(input, origin);
    expect(
      identityEditorDraftIsDirty(
        {
          ...two,
          assets: {
            ...two.assets,
            originals: [...two.assets.originals].reverse(),
          },
        },
        origin,
      ),
    ).toBe(true);
  });

  it("reconciliacao reaplica somente campos tocados e preserva edicao externa", () => {
    const original = draft();
    const edited = changeIdentityEditorDraft(
      original,
      {
        kind: "fields",
        fields: {
          ...original.fields,
          storeName: "  Novo nome  ",
          storeState: "S",
        },
      },
      origin,
    );
    const current = snapshot();
    current.revision = "9007199254740995";
    current.identity.primary_color = "#0055aa";
    current.identity.store_city = "Outra cidade";
    const reconciled = reconcileIdentityEditorDraft(edited, current, origin);
    expect(reconciled.fields).toEqual({
      ...original.fields,
      storeName: "  Novo nome  ",
      storeState: "S",
      primaryColor: "#0055AA",
      storeCity: "Outra cidade",
    });
    expect(reconciled.expected).toEqual(current);
    expect(edited.expected).toEqual(snapshot());
    expect(current.identity.primary_color).toBe("#0055aa");
    frozen(reconciled);
    expect(Object.isFrozen(current)).toBe(false);
    const reverted = changeIdentityEditorDraft(
      edited,
      { kind: "fields", fields: original.fields },
      origin,
    );
    expect(
      reconcileIdentityEditorDraft(reverted, current, origin).fields
        .primaryColor,
    ).toBe("#0055AA");
    expect(
      identityEditorDraftIsDirty(
        reconcileIdentityEditorDraft(reverted, current, origin),
        origin,
      ),
    ).toBe(false);
  });

  it("reconcilia papéis e fontes independentes inclusive volta ao valor original", () => {
    const original = draft();
    const edited = changeIdentityEditorDraft(
      original,
      { kind: "asset", roles: ["header"], uploaded: uploaded() },
      origin,
    );
    const current = snapshot();
    current.identity.branding_assets.loader = file(
      "external.svg",
      undefined,
      undefined,
      "image/svg+xml",
    );
    current.identity.branding_assets.originals.push(
      file("external-source.png"),
    );
    const reconciled = reconcileIdentityEditorDraft(edited, current, origin);
    expect(reconciled.assets.header).toEqual(uploaded().asset);
    expect(reconciled.assets.loader).toEqual(
      current.identity.branding_assets.loader,
    );
    expect(reconciled.assets.originals).toEqual(
      current.identity.branding_assets.originals,
    );
    const sourceEdited = changeIdentityEditorDraft(
      edited,
      { kind: "source-add", uploaded: uploaded() },
      origin,
    );
    expect(
      reconcileIdentityEditorDraft(sourceEdited, current, origin).assets
        .originals,
    ).toEqual(sourceEdited.assets.originals);
    const reverted = changeIdentityEditorDraft(
      edited,
      {
        kind: "asset",
        roles: ["header"],
        uploaded: uploaded(original.assets.header),
      },
      origin,
    );
    expect(
      reconcileIdentityEditorDraft(reverted, current, origin).assets,
    ).toEqual(current.identity.branding_assets);
    const sourcesReverted = changeIdentityEditorDraft(
      sourceEdited,
      { kind: "source-remove", index: 1 },
      origin,
    );
    expect(
      reconcileIdentityEditorDraft(sourcesReverted, current, origin).assets
        .originals,
    ).toEqual(current.identity.branding_assets.originals);
  });

  it("recusa pacote combinado conflitante sem tocar nenhuma fotografia", () => {
    const original = draft();
    const edited = changeIdentityEditorDraft(
      original,
      { kind: "asset", roles: ["header"], uploaded: uploaded() },
      origin,
    );
    const current = snapshot();
    current.identity.branding_assets.originals.push({
      ...file("new.png"),
      bytes: 101,
    });
    error(() => reconcileIdentityEditorDraft(edited, current, origin));
    expect(edited.assets.header.bytes).toBe(100);
    expect(current.identity.branding_assets.originals[1].bytes).toBe(101);
    expect(edited.expected).toEqual(snapshot());
  });

  it("importacao e fluxo completo sao puros sem SDK, fetch ou storage", async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("rede proibida");
    });
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("storage proibido");
      },
    });
    vi.resetModules();
    const pure = await import("@/lib/storeIdentityDraft");
    const original = pure.createIdentityEditorDraft(snapshot(), origin);
    const edited = pure.changeIdentityEditorDraft(
      original,
      { kind: "fields", fields: { ...original.fields, storeName: "Novo" } },
      origin,
    );
    const reconciled = pure.reconcileIdentityEditorDraft(
      edited,
      snapshot(),
      origin,
    );
    expect(
      pure.buildIdentityEditorIntent(reconciled, origin).desired.store_name,
    ).toBe("Novo");
  });
});
