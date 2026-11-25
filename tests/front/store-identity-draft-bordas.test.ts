import { describe, expect, it } from "vitest";

import type { IdentityAsset } from "@/lib/storeIdentity";
import {
  IdentityDraftError,
  buildIdentityEditorIntent,
  changeIdentityEditorDraft,
  createIdentityEditorDraft,
} from "@/lib/storeIdentityDraft";

// Bordas do rascunho da identidade da loja que a suíte principal
// (store-identity-draft.test.ts) deixava passar em caça por mutação:
// campo a mais com valor TEXTO, três papéis no mesmo envio e as cores
// "secundária" e "destaque" que a tela não editou (voltam como estavam).
// Fixtures inventadas.
const origin = "https://abcdefghijklmnopqrst.supabase.co";

function file(
  name: string,
  width?: number,
  height?: number,
  media_type = "image/png",
) {
  return {
    path: `v1/${"b".repeat(64)}/${name}`,
    sha256: "b".repeat(64),
    media_type,
    bytes: 100,
    ...(width === undefined ? {} : { width, height }),
  };
}

function snapshot(cores: {
  secondary: string | null;
  accent: string | null;
  primary?: string | null;
}) {
  return {
    revision: "7",
    identity: {
      store_name: "Loja Teste",
      store_city: "Cidade",
      store_state: "SP",
      primary_color: cores.primary === undefined ? "#aabbcc" : cores.primary,
      secondary_color: cores.secondary,
      accent_color: cores.accent,
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
        og: file("og.png", 1200, 630),
      },
    },
  };
}

function enviado(asset = file("novo.png")) {
  return {
    asset: asset as IdentityAsset,
    url: `${origin}/storage/v1/object/public/branding/${asset.path}`,
  };
}

function rascunho() {
  return createIdentityEditorDraft(
    snapshot({ secondary: "#aabbcc", accent: "#ddeeff" }),
    origin,
  );
}

function recusa(fn: () => unknown) {
  expect(fn).toThrow(IdentityDraftError);
  expect(fn).toThrow("IDENTITY_DRAFT_INVALID");
}

describe("rascunho da identidade: chaves a mais com valor texto", () => {
  it("recusa campo extra de TEXTO nos campos do formulário", () => {
    const base = rascunho();
    recusa(() =>
      changeIdentityEditorDraft(
        base,
        {
          kind: "fields",
          fields: { ...base.fields, intruso: "texto" },
        } as never,
        origin,
      ),
    );
  });

  it("recusa chave extra no próprio pedido de mudança", () => {
    const base = rascunho();
    recusa(() =>
      changeIdentityEditorDraft(
        base,
        { kind: "fields", fields: base.fields, extra: "x" } as never,
        origin,
      ),
    );
    recusa(() =>
      changeIdentityEditorDraft(
        base,
        {
          kind: "source-remove",
          index: 0,
          extra: "x",
        } as never,
        origin,
      ),
    );
  });

  it("recusa chave extra no descritor do arquivo enviado", () => {
    const base = rascunho();
    recusa(() =>
      changeIdentityEditorDraft(
        base,
        {
          kind: "asset",
          roles: ["og"],
          uploaded: { ...enviado(file("og2.png", 1200, 630)), nota: "x" },
        } as never,
        origin,
      ),
    );
  });

  it("recusa rascunho guardado com chave a mais", () => {
    const base = rascunho();
    recusa(() =>
      changeIdentityEditorDraft(
        { ...base, lixo: "x" } as never,
        { kind: "fields", fields: base.fields },
        origin,
      ),
    );
  });

  it("aceita o mesmo pedido sem a chave extra (controle)", () => {
    const base = rascunho();
    const trocado = changeIdentityEditorDraft(
      base,
      {
        kind: "fields",
        fields: { ...base.fields, storeName: "Outro Nome" },
      },
      origin,
    );
    expect(trocado.fields.storeName).toBe("Outro Nome");
  });
});

describe("rascunho da identidade: quais papéis uma imagem pode ocupar", () => {
  it("aceita exatamente um papel, ou o par cabeçalho + carregando", () => {
    const base = rascunho();
    const par = changeIdentityEditorDraft(
      base,
      {
        kind: "asset",
        roles: ["header", "loader"],
        uploaded: enviado(
          file("par.svg", undefined, undefined, "image/svg+xml"),
        ),
      },
      origin,
    );
    expect(par.assets.header.path).toContain("par.svg");
    expect(par.assets.loader.path).toContain("par.svg");
    const um = changeIdentityEditorDraft(
      base,
      {
        kind: "asset",
        roles: ["og"],
        uploaded: enviado(file("og2.png", 1200, 630)),
      },
      origin,
    );
    expect(um.assets.og.path).toContain("og2.png");
  });

  it("recusa três papéis, mesmo contendo cabeçalho e carregando", () => {
    const base = rascunho();
    recusa(() =>
      changeIdentityEditorDraft(
        base,
        {
          kind: "asset",
          roles: ["header", "loader", "favicon"],
          uploaded: enviado(
            file("tres.svg", undefined, undefined, "image/svg+xml"),
          ),
        } as never,
        origin,
      ),
    );
  });

  it("recusa par que não é cabeçalho + carregando, e lista vazia", () => {
    const base = rascunho();
    recusa(() =>
      changeIdentityEditorDraft(
        base,
        {
          kind: "asset",
          roles: ["header", "og"],
          uploaded: enviado(file("x.png", 1200, 630)),
        } as never,
        origin,
      ),
    );
    recusa(() =>
      changeIdentityEditorDraft(
        base,
        {
          kind: "asset",
          roles: [],
          uploaded: enviado(file("y.png", 1200, 630)),
        } as never,
        origin,
      ),
    );
  });
});

describe("rascunho da identidade: cores que a tela não editou voltam como estavam", () => {
  it("secundária e destaque sem edição mantêm caixa e valor bruto", () => {
    const base = rascunho();
    const alterado = changeIdentityEditorDraft(
      base,
      { kind: "fields", fields: { ...base.fields, storeName: "Nome Novo" } },
      origin,
    );
    const { desired } = buildIdentityEditorIntent(alterado, origin);
    expect(desired.store_name).toBe("Nome Novo");
    expect(desired.primary_color).toBe("#aabbcc");
    expect(desired.secondary_color).toBe("#aabbcc");
    expect(desired.accent_color).toBe("#ddeeff");
  });

  it("editar só a secundária normaliza só ela; destaque e principal ficam", () => {
    const base = rascunho();
    const alterado = changeIdentityEditorDraft(
      base,
      {
        kind: "fields",
        fields: { ...base.fields, secondaryColor: "#112233" },
      },
      origin,
    );
    const { desired } = buildIdentityEditorIntent(alterado, origin);
    expect(desired.secondary_color).toBe("#112233");
    expect(desired.accent_color).toBe("#ddeeff");
    expect(desired.primary_color).toBe("#aabbcc");
  });

  it("editar só o destaque normaliza só ele; secundária e principal ficam", () => {
    const base = rascunho();
    const alterado = changeIdentityEditorDraft(
      base,
      {
        kind: "fields",
        fields: { ...base.fields, accentColor: "#445566" },
      },
      origin,
    );
    const { desired } = buildIdentityEditorIntent(alterado, origin);
    expect(desired.accent_color).toBe("#445566");
    expect(desired.secondary_color).toBe("#aabbcc");
    expect(desired.primary_color).toBe("#aabbcc");
  });

  it("principal ausente (null) continua null quando só a secundária muda", () => {
    const base = createIdentityEditorDraft(
      snapshot({ secondary: "#aabbcc", accent: "#ddeeff", primary: null }),
      origin,
    );
    const alterado = changeIdentityEditorDraft(
      base,
      {
        kind: "fields",
        fields: { ...base.fields, secondaryColor: "#112233" },
      },
      origin,
    );
    const { desired } = buildIdentityEditorIntent(alterado, origin);
    expect(desired.primary_color).toBeNull();
    expect(desired.secondary_color).toBe("#112233");
    expect(desired.accent_color).toBe("#ddeeff");
  });
});
