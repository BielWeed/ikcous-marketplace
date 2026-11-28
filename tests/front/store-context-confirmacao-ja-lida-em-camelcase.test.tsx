// @vitest-environment jsdom
//
// Lote 567: a confirmação da Loja pronta (20261652000000) que chega JÁ LIDA,
// em camelCase. O motor de realtime (`realtimeSyncEngine`) traduz a linha do
// banco antes de guardá-la no cofre offline e de avisar o StoreContext: o
// registro que chega ao `mapConfig` traz `entregaConfirmada: false` e não traz
// mais a coluna `entrega_confirmada_em`. Ignorar esse valor (só olhar a
// coluna) apagava a pendência: a loja nova que ainda não confirmou a entrega
// passava a ler como confirmada, e o "Está certo" sumia do Início.
//
// Mesmo casco de store-context-realtime-identico-nao-re-renderiza.test.tsx:
// RENDER DE VERDADE do StoreProvider; os listeners do motor são capturados e o
// teste dispara o evento por eles.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, useStore } from "@/contexts/StoreContext";
import type { StoreConfig } from "@/types";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, loading: false, user: { id: "admin-1" } }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
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

const callbacksDeSync: Array<(event: unknown) => void> = [];

vi.mock("@/lib/realtimeSyncEngine", () => ({
  RealtimeSyncEngine: {
    start: vi.fn(() => () => {}),
    onSync: vi.fn((cb: (event: unknown) => void) => {
      callbacksDeSync.push(cb);
      return () => {};
    }),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));

function construtorEncadeavel(resultado: { data: unknown; error: unknown }) {
  const alvo: any = () => construtorEncadeavel(resultado);
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(resultado);
      }
      return () => construtorEncadeavel(resultado);
    },
    apply() {
      return construtorEncadeavel(resultado);
    },
  });
}

// A linha que o banco devolve na leitura: SEM as colunas de confirmação
// (banco sem a migration) — a config começa sem o campo.
const LINHA_DA_LOJA: Record<string, unknown> = {
  id: 1,
  free_shipping_min: 0,
  shipping_fee: 15,
  store_name: "Loja Teste",
  theme_mode: "light",
  local_delivery_fee: 10,
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) =>
      tabela === "store_config"
        ? construtorEncadeavel({ data: LINHA_DA_LOJA, error: null })
        : construtorEncadeavel({ data: [], error: null }),
    rpc: () => construtorEncadeavel({ data: null, error: null }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const visto = { config: null as StoreConfig | null };

function Consumidor() {
  const { config } = useStore();
  useEffect(() => {
    visto.config = config;
  });
  return null;
}

function dispararSync(newRecord: Record<string, unknown>) {
  const evento = { store: "store_config", eventType: "UPDATE", newRecord };
  for (const cb of callbacksDeSync) cb(evento);
}

describe("StoreContext — confirmação da Loja pronta já lida (camelCase, sem a coluna)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    callbacksDeSync.length = 0;
    visto.config = null;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function montar() {
    await act(async () => {
      raiz.render(
        <StoreProvider>
          <Consumidor />
        </StoreProvider>,
      );
    });
    await act(async () => {});
  }

  it("registro com entregaConfirmada: false e sem entrega_confirmada_em: a entrega segue a confirmar", async () => {
    await montar();
    expect(visto.config && "entregaConfirmada" in visto.config).toBe(false);

    await act(async () => {
      dispararSync({
        ...LINHA_DA_LOJA,
        entregaConfirmada: false,
        pagamentoConfirmado: true,
      });
    });

    expect(visto.config?.entregaConfirmada).toBe(false);
    expect(visto.config?.pagamentoConfirmado).toBe(true);
  });

  it("controle: com a coluna presente, ela vence o valor já lido", async () => {
    await montar();

    await act(async () => {
      dispararSync({
        ...LINHA_DA_LOJA,
        entrega_confirmada_em: "2026-11-27T12:00:00+00:00",
        entregaConfirmada: false,
      });
    });

    expect(visto.config?.entregaConfirmada).toBe(true);
  });
});
