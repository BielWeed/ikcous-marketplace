// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026): loja cujo nome está GUARDADO como texto vazio
// ("" — a lojista apagou o campo e salvou) tem de cair no texto neutro de
// compartilhar, nunca em "Olha que achei na !". O teste vizinho
// (`texto-de-compartilhar-nao-cita-marca-de-outra-loja`) cobre o nome ausente
// (`null`) e o nome preenchido, mas não o vazio.
import { act, useEffect, useRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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

describe("texto de compartilhar com o nome da loja guardado vazio", () => {
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

  beforeAll(async () => {
    await import("@/contexts/StoreContext");
  });

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

  it.each([
    ["texto padrão da fábrica", null],
    ["texto antigo da plataforma", "Olha que achei na IKCOUS!"],
    ["padrão herdado do banco", "Confira os produtos da Ikous!"],
  ])(
    "nome vazio + %s: volta ao texto neutro, sem 'na !'",
    async (_n, texto) => {
      await montar({ id: 1, share_text: texto, store_name: "" });
      expect(visto.config?.shareText).toBe(defaultStoreConfig.shareText);
      expect(visto.config?.shareText).not.toMatch(/na !/);
    },
  );
});
