import { StoreProvider, useStore } from "@/contexts/StoreContext";
import type { SyncEvent } from "@/lib/realtimeSyncEngine";
import type { StoreConfig } from "@/types";
// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pacoteDeMarca, urlDoHeader } from "./fixtures/branding-assets";

type Resultado = { data: unknown; error: unknown };
const externo = vi.hoisted(() => ({
  admin: true,
  linha: {} as Record<string, unknown>,
  cache: null as Record<string, unknown> | null,
  consulta: null as Promise<Resultado> | null,
  rpc: vi.fn(),
  put: vi.fn().mockResolvedValue(undefined),
  insert: vi.fn(),
  listeners: new Set<(event: SyncEvent) => void>(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: externo.admin, loading: false, user: null }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getById: async () => externo.cache,
      getAll: async () => [],
      put: externo.put,
      replaceAll: async () => {},
      setLastSync: async () => {},
    }),
  },
}));
// Só o transporte é dublado: useSyncListener e seu callback do provider são reais.
vi.mock("@/lib/realtimeSyncEngine", () => ({
  RealtimeSyncEngine: {
    start: () => () => {},
    onSync: (listener: (event: SyncEvent) => void) => {
      externo.listeners.add(listener);
      return () => externo.listeners.delete(listener);
    },
  },
}));
function consultaEncadeada(resultado: Promise<Resultado>) {
  const alvo: any = () => consultaEncadeada(resultado);
  return new Proxy(alvo, {
    get(_target, prop) {
      if (prop === "then") return resultado.then.bind(resultado);
      if (prop === "insert")
        return (rows: unknown) => {
          externo.insert(rows);
          return consultaEncadeada(
            Promise.resolve({ data: { id: 1 }, error: null }),
          );
        };
      return () => consultaEncadeada(resultado);
    },
  });
}
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) =>
      consultaEncadeada(
        table === "store_config" || table === "v_store_config"
          ? (externo.consulta ??
              Promise.resolve({ data: externo.linha, error: null }))
          : Promise.resolve({ data: [], error: null }),
      ),
    rpc: externo.rpc,
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// @ts-expect-error flag interna do React, como nos testes existentes.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let store: ReturnType<typeof useStore>;
function Capturador() {
  const value = useStore();
  useEffect(() => {
    store = value;
  }, [value]);
  return null;
}
function patchIdentidade() {
  return {
    logoUrl: urlDoHeader,
    secondaryColor: "#FFFFFF",
    accentColor: "#C99730",
    brandingAssets: pacoteDeMarca(),
  };
}
function linhaIdentidade() {
  return {
    id: 1,
    logo_url: urlDoHeader,
    secondary_color: "#FFFFFF",
    accent_color: "#C99730",
    branding_assets: pacoteDeMarca(),
  };
}
function reordenarObjetos(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reordenarObjetos);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, child]) => [key, reordenarObjetos(child)]),
    );
  }
  return value;
}

describe("identidade transportada pelo StoreProvider real", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.clearAllMocks();
    externo.rpc.mockReset();
    externo.admin = true;
    externo.linha = linhaIdentidade();
    externo.cache = null;
    externo.consulta = null;
    externo.listeners.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });
  async function montar() {
    await act(async () =>
      root.render(
        <StoreProvider>
          <Capturador />
        </StoreProvider>,
      ),
    );
    externo.put.mockClear();
  }
  async function salvar(patch: Partial<StoreConfig>) {
    let ok: boolean | undefined;
    await act(async () => {
      ok = await store.updateConfig(patch);
    });
    return ok;
  }
  async function sincronizar(record: Record<string, unknown>) {
    expect(externo.listeners.size).toBeGreaterThan(0);
    await act(async () => {
      for (const listener of externo.listeners)
        listener({
          table: "store_config",
          store: "store_config",
          eventType: "UPDATE",
          newRecord: record,
        });
    });
  }
  it("lê o trio snake_case e preserva a referência em refresh e eco JSON equivalente", async () => {
    await montar();
    expect(store.config).toMatchObject(patchIdentidade());
    const anterior = store.config;
    externo.linha = reordenarObjetos(linhaIdentidade()) as Record<
      string,
      unknown
    >;
    await act(async () => store.refresh({ onlyConfig: true }));
    await sincronizar(externo.linha);
    expect(store.config).toBe(anterior);
    expect(externo.put).not.toHaveBeenCalled();
    await sincronizar({
      ...externo.linha,
      branding_assets: {
        ...pacoteDeMarca(),
        header: { ...pacoteDeMarca().header, bytes: 200 },
      },
    });
    expect(store.config.brandingAssets?.header.bytes).toBe(200);
    expect(store.config).not.toBe(anterior);
  });
  it("preserva ausência e null sem ressuscitar o camelCase antigo", async () => {
    externo.linha = { id: 1 };
    await montar();
    expect(store.config.secondaryColor).toBeUndefined();
    expect(store.config.accentColor).toBeUndefined();
    expect(store.config.brandingAssets).toBeUndefined();
    await sincronizar({
      ...patchIdentidade(),
      secondary_color: null,
      accent_color: null,
      branding_assets: null,
    });
    expect(store.config.secondaryColor).toBeNull();
    expect(store.config.accentColor).toBeNull();
    expect(store.config.brandingAssets).toBeNull();
    await sincronizar({ id: 1 });
    expect(store.config.brandingAssets).toBeUndefined();
  });
  it("uma mudança somente de ausência para null no pacote não some na igualdade", async () => {
    externo.linha = { id: 1 };
    await montar();
    const ausente = store.config;
    await sincronizar({ id: 1, branding_assets: null });
    expect(store.config.brandingAssets).toBeNull();
    expect(store.config).not.toBe(ausente);
    const limpo = store.config;
    await sincronizar({ id: 1, branding_assets: null });
    expect(store.config).toBe(limpo);
    await sincronizar({ id: 1 });
    expect(store.config.brandingAssets).toBeUndefined();
    expect(store.config).not.toBe(limpo);
  });
  it.each([true, false])(
    "carrega cache camelCase antes da rede, com identidade=%s, e conserva depois do listener/reload",
    async (comIdentidade) => {
      externo.cache = {
        id: "singleton",
        ...(comIdentidade ? patchIdentidade() : {}),
      };
      externo.consulta = new Promise(() => {});
      await montar();
      if (comIdentidade) expect(store.config).toMatchObject(patchIdentidade());
      else expect(store.config.brandingAssets).toBeUndefined();
      await sincronizar({
        ...patchIdentidade(),
        brandingAssets: reordenarObjetos(pacoteDeMarca()),
      });
      expect(store.config).toMatchObject(patchIdentidade());
      externo.cache = { id: "singleton", ...store.config };
      await act(async () => root.unmount());
      root = createRoot(container);
      await montar();
      expect(store.config).toMatchObject(patchIdentidade());
    },
  );
  it("não acrescenta identidade no INSERT inicial", async () => {
    externo.consulta = Promise.resolve({
      data: null,
      error: { code: "PGRST116" },
    });
    await montar();
    const [insert] = externo.insert.mock.calls[0];
    expect(insert[0]).not.toHaveProperty("branding_assets");
    expect(insert[0]).not.toHaveProperty("secondary_color");
    expect(insert[0]).not.toHaveProperty("accent_color");
  });
  it("envia somente campos escolhidos e confirma JSON com objetos reordenados", async () => {
    externo.linha = { id: 1 };
    await montar();
    externo.rpc.mockResolvedValue({
      data: reordenarObjetos(linhaIdentidade()),
      error: null,
    });
    expect(await salvar(patchIdentidade())).toBe(true);
    expect(externo.rpc).toHaveBeenCalledWith("upsert_store_config", {
      config_json: {
        logo_url: urlDoHeader,
        secondary_color: "#FFFFFF",
        accent_color: "#C99730",
        branding_assets: pacoteDeMarca(),
      },
    });
    expect(store.config).toMatchObject(patchIdentidade());
    expect(externo.put).toHaveBeenCalledWith(
      "store_config",
      expect.objectContaining(patchIdentidade()),
    );
    expect(toast.success).toHaveBeenCalledOnce();
  });
  it("null explícito limpa os quatro campos e undefined não entra no patch", async () => {
    await montar();
    externo.rpc.mockResolvedValue({
      data: {
        logo_url: null,
        secondary_color: null,
        accent_color: null,
        branding_assets: null,
      },
      error: null,
    });
    expect(
      await salvar({
        logoUrl: null,
        secondaryColor: null,
        accentColor: null,
        brandingAssets: null,
      }),
    ).toBe(true);
    expect(store.config).toMatchObject({
      logoUrl: null,
      secondaryColor: null,
      accentColor: null,
      brandingAssets: null,
    });
    externo.rpc.mockResolvedValue({
      data: { store_name: "Nome" },
      error: null,
    });
    expect(
      await salvar({
        storeName: "Nome",
        secondaryColor: undefined,
        accentColor: undefined,
        brandingAssets: undefined,
      }),
    ).toBe(true);
    expect(externo.rpc).toHaveBeenLastCalledWith("upsert_store_config", {
      config_json: { store_name: "Nome" },
    });
    expect(store.config.brandingAssets).toBeNull();
  });
  it.each([
    "omitido",
    "null",
    "hash",
    "MIME",
    "papel",
    "ordem",
    "protótipo",
    "vazio",
    "rede",
    "RLS",
    "sem linha",
  ])("recusa retorno %s sem mudar estado/cache/sucesso", async (caso) => {
    await montar();
    const anterior = store.config;
    const linha: any = linhaIdentidade();
    const { branding_assets: _pacote, ...semPacote } = linha;
    if (caso === "null") linha.branding_assets = null;
    if (caso === "hash") {
      linha.branding_assets.header.sha256 = "b".repeat(64);
      linha.branding_assets.header.path = `v1/${"b".repeat(64)}/header.png`;
    }
    if (caso === "MIME") {
      linha.branding_assets.header.media_type = "image/jpeg";
      linha.branding_assets.header.path = `v1/${"a".repeat(64)}/header.jpg`;
    }
    if (caso === "papel")
      [linha.branding_assets.header, linha.branding_assets.loader] = [
        linha.branding_assets.loader,
        linha.branding_assets.header,
      ];
    if (caso === "ordem") linha.branding_assets.originals.reverse();
    const data =
      caso === "omitido"
        ? semPacote
        : caso === "protótipo"
          ? Object.create(linha)
          : caso === "sem linha"
            ? null
            : caso === "vazio"
              ? {}
              : linha;
    if (caso === "rede") externo.rpc.mockRejectedValue(new Error("offline"));
    else
      externo.rpc.mockResolvedValue({
        data,
        error: caso === "RLS" ? { code: "42501" } : null,
      });
    expect(await salvar(patchIdentidade())).toBe(false);
    expect(store.config).toBe(anterior);
    expect(externo.put).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("recusa pacote malformado antes da RPC e recusa ausência de permissão", async () => {
    await montar();
    const anterior = store.config;
    const invalido = { ...pacoteDeMarca(), originals: [] };
    expect(await salvar({ brandingAssets: invalido })).toBe(false);
    expect(externo.rpc).not.toHaveBeenCalled();
    expect(store.config).toBe(anterior);
    expect(externo.put).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    externo.admin = false;
    await act(async () =>
      root.render(
        <StoreProvider>
          <Capturador />
        </StoreProvider>,
      ),
    );
    externo.put.mockClear();
    expect(await salvar(patchIdentidade())).toBe(false);
    expect(externo.rpc).not.toHaveBeenCalled();
    expect(externo.put).not.toHaveBeenCalled();
  });
  it("congela uma cópia validada antes de aguardar a RPC, mantendo pedido e cache iguais", async () => {
    externo.linha = { id: 1 };
    await montar();
    const patch = patchIdentidade();
    const esperado = pacoteDeMarca();
    let resolver!: (result: Resultado) => void;
    externo.rpc.mockImplementation(
      () =>
        new Promise<Resultado>((resolve) => {
          resolver = resolve;
        }),
    );
    let pendente!: Promise<boolean>;
    await act(async () => {
      pendente = store.updateConfig(patch);
    });
    patch.secondaryColor = "#111111";
    patch.accentColor = "#222222";
    patch.brandingAssets.header.bytes = 999;
    patch.brandingAssets.originals.reverse();
    patch.brandingAssets = pacoteDeMarca();
    patch.brandingAssets.loader.bytes = 777;
    const enviado = externo.rpc.mock.calls[0][1].config_json.branding_assets;
    expect(enviado).toEqual(esperado);
    expect(Object.isFrozen(enviado.header)).toBe(true);
    let ok: boolean | undefined;
    await act(async () => {
      resolver({ data: linhaIdentidade(), error: null });
      ok = await pendente;
    });
    expect(ok).toBe(true);
    expect(store.config.secondaryColor).toBe("#FFFFFF");
    expect(store.config.accentColor).toBe("#C99730");
    expect(store.config.brandingAssets).toBe(enviado);
    expect(externo.put).toHaveBeenCalledWith(
      "store_config",
      expect.objectContaining({ brandingAssets: esperado }),
    );
  });
});
