// @vitest-environment jsdom
//
// "COMPARTILHAR PRODUTO" NÃO CITA MARCA DE OUTRA LOJA (caça 12-B #3 e 12-E #2):
// o texto padrão era "Olha que achei na IKCOUS!". Loja sem nome salvo, ou a
// cliente abrindo a loja antes de a configuração chegar, mandava a marca da
// plataforma para os amigos. Agora o padrão é neutro, e o nome da loja só
// entra quando a loja tem um.
//
// RENDER DE VERDADE do StoreProvider (mesmo molde de
// store-context-modo-e-prazo-da-entrega.test.tsx).
import { act, useEffect, useRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultStoreConfig } from "@/config/cor-da-loja";
import { StoreProvider, useStore } from "@/contexts/StoreContext";
import type { StoreConfig } from "@/types";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, loading: false, user: { id: "admin-1" } }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

const { linhaDaLoja } = vi.hoisted(() => ({
  linhaDaLoja: { valor: {} as Record<string, unknown> },
}));

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getById: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue(undefined),
      replaceAll: vi.fn().mockResolvedValue(undefined),
      setLastSync: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));
vi.mock("@/lib/realtimeSyncEngine", () => ({
  RealtimeSyncEngine: {
    start: vi.fn(() => () => {}),
    onSync: vi.fn(() => () => {}),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));

function consultaEncadeada(resultado: { data: unknown; error: unknown }) {
  const alvo: any = () => consultaEncadeada(resultado);
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(resultado);
      }
      return () => consultaEncadeada(resultado);
    },
    apply() {
      return consultaEncadeada(resultado);
    },
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) =>
      consultaEncadeada(
        tabela === "store_config" || tabela === "v_store_config"
          ? { data: linhaDaLoja.valor, error: null }
          : { data: [], error: null },
      ),
    rpc: () => consultaEncadeada({ data: null, error: null }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const visto: { config: StoreConfig | null } = { config: null };

function Capturador() {
  const { config } = useStore();
  const ref = useRef(visto);
  useEffect(() => {
    ref.current.config = config;
  });
  return null;
}

describe("texto de compartilhar produto sem marca de outra loja", () => {
  let raiz: Root | undefined;
  let hospedeiro: HTMLDivElement | undefined;

  async function montar(linha: Record<string, unknown>) {
    linhaDaLoja.valor = linha;
    visto.config = null;
    const caixa = document.createElement("div");
    document.body.appendChild(caixa);
    const raizNova = createRoot(caixa);
    hospedeiro = caixa;
    raiz = raizNova;
    await act(async () => {
      raizNova.render(
        <StoreProvider>
          <Capturador />
        </StoreProvider>,
      );
    });
    await act(async () => {
      for (let i = 0; i < 25; i++) await Promise.resolve();
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (raiz) {
      const aDesmontar = raiz;
      act(() => {
        aDesmontar.unmount();
      });
    }
    hospedeiro?.remove();
    raiz = undefined;
    hospedeiro = undefined;
  });

  it("sem configuração (padrão de fábrica, é o que a semente do painel grava): nenhuma marca", () => {
    expect(defaultStoreConfig.shareText).not.toMatch(/ikcous|ikous/i);
  });

  it("configuração SEM nome da loja: texto neutro, sem marca", async () => {
    await montar({ id: 1, share_text: null, store_name: null });
    expect(visto.config?.shareText).toBe(defaultStoreConfig.shareText);
    expect(visto.config?.shareText).not.toMatch(/ikcous/i);
  });

  it("loja que já guardou o texto antigo da IKCOUS e não tem nome: também sem marca", async () => {
    await montar({
      id: 1,
      share_text: "Olha que achei na IKCOUS!",
      store_name: null,
    });
    expect(visto.config?.shareText).not.toMatch(/ikcous/i);
  });

  it("configuração COM nome da loja: usa o nome dela", async () => {
    await montar({ id: 1, share_text: null, store_name: "Loja Aurora" });
    expect(visto.config?.shareText).toBe("Olha que achei na Loja Aurora!");
  });

  it("texto antigo da IKCOUS + nome da loja: troca pelo nome dela", async () => {
    await montar({
      id: 1,
      share_text: "Olha que achei na IKCOUS!",
      store_name: "Loja Aurora",
    });
    expect(visto.config?.shareText).toBe("Olha que achei na Loja Aurora!");
  });

  it("texto escrito pela lojista nunca é trocado", async () => {
    await montar({
      id: 1,
      share_text: "Veja só [nome] por [preco]! [link]",
      store_name: "Loja Aurora",
    });
    expect(visto.config?.shareText).toBe("Veja só [nome] por [preco]! [link]");
  });
});
