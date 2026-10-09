// @vitest-environment jsdom
//
// D5 do painel simples: a marca (IdentitySettingsSection) deixa de pedir
// Cidade e UF — quem manda nelas agora é o Endereço da loja. Mas a RPC
// `save_store_identity` recusa pacote incompleto e compara a fotografia
// INTEIRA da identidade (as 8 chaves, cidade e UF incluídas): se o Endereço
// grava a cidade nova e a marca ainda guarda a antiga, o próximo "Salvar
// identidade" (a cor, por exemplo) ou REVERTE a cidade ou cai em conflito.
// Estes casos prendem os dois erros:
//  - a marca relê sozinha quando a cidade/UF do config muda por fora;
//  - a edição da marca em andamento sobrevive a essa releitura;
//  - o pacote continua levando as 8 chaves, e a tela de conflito continua
//    comparando cidade e UF mesmo com os campos escondidos.
import { IdentitySettingsSection } from "@/components/admin/settings/IdentitySettingsSection";
import type { StoreIdentityIntent } from "@/lib/adminStoreIdentity";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  refresh: vi.fn(),
  origin: "https://abcdefghijklmnopqrst.supabase.co",
  config: {} as Record<string, unknown>,
  version: 0,
  listeners: new Set<() => void>(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-a" },
    isAdmin: true,
    adminStatus: "admin",
    session: { user: { id: "admin-a" }, access_token: "synthetic-session" },
  }),
}));
vi.mock("@/contexts/StoreContext", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useStore: () => {
      useSyncExternalStore(
        (cb) => {
          h.listeners.add(cb);
          return () => {
            h.listeners.delete(cb);
          };
        },
        () => h.version,
      );
      return { config: h.config, isLoaded: true, refresh: h.refresh };
    },
  };
});
vi.mock("@/lib/env-valores", () => ({
  lerSupabaseUrl: () => h.origin,
  lerChaveSupabase: () => "sb_publishable_synthetic",
}));
vi.mock("@/lib/adminStoreIdentity", () => ({
  readAdminStoreIdentity: h.read,
  saveAdminStoreIdentity: h.save,
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
// @ts-expect-error React testing flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function asset(
  name: string,
  width?: number,
  height?: number,
  media_type = "image/png",
) {
  return {
    path: `v1/${"a".repeat(64)}/${name}`,
    sha256: "a".repeat(64),
    bytes: 100,
    media_type,
    ...(width === undefined ? {} : { width, height }),
  };
}
function snapshot(
  revision = "10",
  cidade = "Uberlândia",
  uf = "MG",
  cor = "#ABCDEF",
) {
  return {
    revision,
    identity: {
      store_name: "Loja Teste",
      store_city: cidade,
      store_state: uf,
      primary_color: cor,
      secondary_color: "#000000",
      accent_color: "#000000",
      logo_url: `${h.origin}/storage/v1/object/public/branding/${asset("header.svg").path}`,
      branding_assets: {
        version: 1,
        originals: [asset("source.svg", undefined, undefined, "image/svg+xml")],
        header: asset("header.svg", undefined, undefined, "image/svg+xml"),
        loader: asset("loader.svg", undefined, undefined, "image/svg+xml"),
        favicon: asset(
          "favicon.ico",
          undefined,
          undefined,
          "image/vnd.microsoft.icon",
        ),
        apple_touch: asset("apple.png", 180, 180),
        icon_192: asset("192.png", 192, 192),
        icon_512: asset("512.png", 512, 512),
        maskable_512: asset("mask.png", 512, 512),
        og: asset("og.png", 1200, 630),
      },
    },
  };
}

let root: Root;
let host: HTMLDivElement;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function render() {
  await act(async () => {
    root.render(<IdentitySettingsSection active />);
  });
  await flush();
}
function input(id: string) {
  const el = host.querySelector<HTMLInputElement>(`#${id}`);
  expect(el).not.toBeNull();
  return el!;
}
async function type(id: string, value: string) {
  await act(async () => {
    const el = input(id);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(text: string) {
  const el = [...host.querySelectorAll("button")].find(
    (node) => node.textContent === text,
  );
  expect(el).toBeDefined();
  await act(async () => {
    el!.click();
  });
  await flush();
}
/** O Endereço da loja gravou a cidade nova: o config do app muda por fora. */
async function enderecoGravouACidade(cidade: string, uf: string) {
  await act(async () => {
    h.config = { ...h.config, storeCity: cidade, storeState: uf };
    h.version++;
    for (const aviso of h.listeners) aviso();
  });
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.read.mockReset();
  h.save.mockReset();
  h.refresh.mockResolvedValue(undefined);
  h.config = { storeCity: "Uberlândia", storeState: "MG" };
  h.read.mockImplementation(async () => snapshot());
  h.save.mockImplementation(async (intent: StoreIdentityIntent) => ({
    status: "confirmed",
    source: "response",
    snapshot: { revision: "12", identity: intent.desired },
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("Minha loja — a marca não pede Cidade/UF e não reverte a cidade do endereço", () => {
  it("a marca mostra nome e cores, e NÃO pede Cidade nem UF", async () => {
    await render();
    expect(input("store-name").value).toBe("Loja Teste");
    expect(input("store-color-hex").value).toBe("#ABCDEF");
    expect(host.querySelector("#store-city")).toBeNull();
    expect(host.querySelector("#store-state")).toBeNull();
    expect(host.textContent).not.toContain("Estado (UF)");
  });

  it("o pacote continua com as 8 chaves, cidade e UF incluídas (a RPC recusa pacote incompleto)", async () => {
    await render();
    await type("store-color-hex", "#112233");
    await click("Salvar identidade");

    const intent = h.save.mock.calls[0][0] as StoreIdentityIntent;
    expect(Object.keys(intent.desired).sort()).toEqual([
      "accent_color",
      "branding_assets",
      "logo_url",
      "primary_color",
      "secondary_color",
      "store_city",
      "store_name",
      "store_state",
    ]);
    expect(Object.keys(intent.expected.identity).sort()).toEqual(
      Object.keys(intent.desired).sort(),
    );
    expect(intent.desired.store_city).toBe("Uberlândia");
    expect(intent.desired.store_state).toBe("MG");
  });

  it("salvar o endereço (cidade nova) e depois a cor: a cor sai com a cidade NOVA e nenhum conflito aparece", async () => {
    await render();
    expect(h.read).toHaveBeenCalledTimes(1);

    // O Endereço grava São Paulo/SP; o banco passa a ter outra fotografia.
    h.read.mockImplementation(async () => snapshot("11", "São Paulo", "SP"));
    await enderecoGravouACidade("São Paulo", "SP");
    expect(h.read).toHaveBeenCalledTimes(2);

    await type("store-color-hex", "#112233");
    await click("Salvar identidade");

    expect(h.save).toHaveBeenCalledTimes(1);
    const intent = h.save.mock.calls[0][0] as StoreIdentityIntent;
    // a fotografia esperada é a ATUAL (cidade nova, revisão nova)…
    expect(intent.expected.revision).toBe("11");
    expect(intent.expected.identity.store_city).toBe("São Paulo");
    // …e o que se quer gravar leva a cidade nova, não a antiga
    expect(intent.desired.store_city).toBe("São Paulo");
    expect(intent.desired.store_state).toBe("SP");
    expect(intent.desired.primary_color).toBe("#112233");
    expect(host.textContent).not.toContain("Outra configuração");
    expect(host.textContent).not.toContain("Conferir configuração atual");
  });

  it("a cor que a lojista já estava editando sobrevive à cidade nova que chega de fora", async () => {
    await render();
    await type("store-color-hex", "#112233");

    h.read.mockImplementation(async () => snapshot("11", "São Paulo", "SP"));
    await enderecoGravouACidade("São Paulo", "SP");

    expect(input("store-color-hex").value).toBe("#112233");
    await click("Salvar identidade");

    const intent = h.save.mock.calls[0][0] as StoreIdentityIntent;
    expect(intent.expected.revision).toBe("11");
    expect(intent.desired.primary_color).toBe("#112233");
    expect(intent.desired.store_city).toBe("São Paulo");
    expect(host.textContent).not.toContain("Outra configuração");
  });

  it("sem mudança de cidade/UF no config, a marca não relê à toa", async () => {
    await render();
    await act(async () => {
      h.config = { ...h.config, businessHours: "Seg-Sex" };
      h.version++;
      for (const aviso of h.listeners) aviso();
    });
    await flush();
    // mesmo a cidade/UF "mudando" para o que o banco já tem: nada a reler
    await enderecoGravouACidade("Uberlândia", "MG");
    expect(h.read).toHaveBeenCalledTimes(1);
  });

  it("releitura que falha não derruba a marca: o rascunho fica e o Salvar continua possível", async () => {
    await render();
    await type("store-color-hex", "#112233");
    h.read.mockRejectedValue(new Error("rede"));
    await enderecoGravouACidade("São Paulo", "SP");

    expect(input("store-color-hex").value).toBe("#112233");
    expect(
      [...host.querySelectorAll("button")].find(
        (b) => b.textContent === "Salvar identidade",
      )?.disabled,
    ).toBe(false);
  });

  it("conflito de verdade: a tela de diferenças ainda compara cidade e UF, mesmo escondidas", async () => {
    // O banco mudou a cidade SEM a marca saber (a releitura não aconteceu):
    // o servidor recusa e a lista mostra a diferença de cidade e de UF.
    h.save.mockResolvedValue({
      status: "conflict",
      source: "readback",
      current: snapshot("13", "Campinas", "SP"),
    });
    await render();
    await type("store-name", "Meu nome");
    await click("Salvar identidade");

    expect(host.textContent).toContain("Cidade: Uberlândia / Campinas");
    expect(host.textContent).toContain("Estado (UF): MG / SP");
  });
});
