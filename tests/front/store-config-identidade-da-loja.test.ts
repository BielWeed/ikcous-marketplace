// @vitest-environment jsdom
//
// Tarefa 2 do plano "o app para de inventar endereço".
//
// Achado de revisão: a versão anterior deste arquivo importava só `@/types`,
// montava um `Partial<StoreConfig>` literal e conferia que as propriedades
// batiam com o que ela mesma tinha atribuído -- isso é verdade para
// qualquer objeto JavaScript, exista ou não o campo em `StoreConfig`, e o
// vitest deste projeto não checa tipo (`npx vitest run` não roda `tsc`). O
// teste passava verde com a Tarefa 2 inteira revertida.
//
// Esta versão exercita o `StoreContext` de verdade: que `store_name`,
// `store_city` e `store_state` do banco viram `storeName`/`storeCity`/
// `storeState` na leitura, que ausência vira `undefined` (nunca texto de
// reserva), e que `updateConfig` manda os três campos ao RPC quando
// recebidos. Mesmo padrão de
// tests/front/store-context-nao-mexe-em-dark.test.tsx: render real do
// StoreProvider (react-dom/client + jsdom) com o cliente Supabase dublado --
// um dublê de contexto não provaria que o dado passa pelo `mapConfig` real.
//
// SEM JSX DE PROPÓSITO: este arquivo mantém a extensão `.test.ts` (não
// `.tsx`) porque é o nome que a Tarefa 2 do plano fixou, e o esbuild só
// interpreta sintaxe JSX em arquivo `.tsx`/`.jsx`. `React.createElement`
// substitui os dois elementos que este teste precisa montar.
import { act, createElement, useEffect, useRef } from "react";
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

// DataVault sem cache: `getById` resolvendo `null` pula o ramo que
// aplicaria config vinda do IndexedDB (indisponível no jsdom puro) e isola
// o teste no que vem do `select().single()` do Supabase dublado.
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

// A linha do banco que `select("*").single()` devolve -- cada teste ajusta
// antes de renderizar. `mapConfig` lê em tempo de render, então mudar a
// variável entre testes funciona mesmo com o módulo já carregado.
let linhaDoBanco: Record<string, unknown> = { id: 1 };
const rpcCalls: Array<{ config_json: Record<string, unknown> }> = [];

// Builder encadeável e "thenable" -- cobre `.from().select().single()` sem
// precisar replicar a assinatura exata da chamada. Mesmo dublê de
// store-context-nao-mexe-em-dark.test.tsx.
function construtorEncadeavel(resultado: { data: unknown; error: unknown }) {
  // `any` de proposito: o alvo do Proxy tem de ser chamavel E indexavel.
  // O eslint nao cobra `no-explicit-any` em tests/, entao a diretiva de
  // excecao que estava aqui ficava sem uso e subia a catraca em +1.
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

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => construtorEncadeavel({ data: linhaDoBanco, error: null }),
    rpc: (_fn: string, args: { config_json: Record<string, unknown> }) => {
      rpcCalls.push(args);
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão
// dos outros testes deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type UpdateConfigFn = (updates: Partial<StoreConfig>) => Promise<boolean>;

// Componente pequeno só para tirar `config` e `updateConfig` do contexto e
// devolver para o corpo do teste via callback -- StoreProvider não expõe um
// jeito de ler o estado de fora da árvore React.
function Capturador({
  onReady,
}: {
  onReady: (config: StoreConfig, updateConfig: UpdateConfigFn) => void;
}) {
  const { config, updateConfig } = useStore();
  const onReadyRef = useRef(onReady);
  // Escrita em ref num efeito, não no corpo do render (regra do
  // react-hooks, teto de 0 erro do eslint) -- mesmo padrão do "latest ref"
  // de admin-limpar-campo-persiste-como-null.test.tsx.
  useEffect(() => {
    onReadyRef.current = onReady;
  });
  useEffect(() => {
    onReadyRef.current(config, updateConfig);
  }, [config, updateConfig]);
  return null;
}

describe("StoreContext — identidade da loja (nome, cidade, estado)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    linhaDoBanco = { id: 1 };
    rpcCalls.length = 0;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizarEcapturar(): Promise<{
    ultimoConfig: () => StoreConfig;
    updateConfig: () => UpdateConfigFn;
  }> {
    let ultimoConfig: StoreConfig | null = null;
    let updateConfigFn: UpdateConfigFn | null = null;

    await act(async () => {
      raiz.render(
        createElement(
          StoreProvider,
          null,
          createElement(Capturador, {
            onReady: (config: StoreConfig, updateConfig: UpdateConfigFn) => {
              ultimoConfig = config;
              updateConfigFn = updateConfig;
            },
          }),
        ),
      );
    });
    // Duas voltas de microtarefa: `fetchConfig` é assíncrono (await no
    // `.select().single()` dublado) e só depois disso `setConfig` roda.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    return {
      ultimoConfig: () => ultimoConfig as unknown as StoreConfig,
      updateConfig: () => updateConfigFn as unknown as UpdateConfigFn,
    };
  }

  it("lê store_name, store_city e store_state do banco como storeName, storeCity, storeState", async () => {
    linhaDoBanco = {
      id: 1,
      store_name: "Loja Teste",
      store_city: "Uberlândia",
      store_state: "MG",
    };

    const { ultimoConfig } = await renderizarEcapturar();

    expect(ultimoConfig().storeName).toBe("Loja Teste");
    expect(ultimoConfig().storeCity).toBe("Uberlândia");
    expect(ultimoConfig().storeState).toBe("MG");
  });

  it("ausência das três colunas no banco vira undefined, nunca texto de reserva", async () => {
    linhaDoBanco = { id: 1, store_name: null, store_city: null, store_state: null };

    const { ultimoConfig } = await renderizarEcapturar();

    expect(ultimoConfig().storeName).toBeUndefined();
    expect(ultimoConfig().storeCity).toBeUndefined();
    expect(ultimoConfig().storeState).toBeUndefined();
    // origin_cep tinha reserva "38500-000" (Monte Carmelo calada); sem valor
    // no banco, tem de ficar undefined, não a reserva antiga.
    expect(ultimoConfig().originCep).toBeUndefined();
  });

  it("updateConfig manda store_name, store_city e store_state ao RPC quando os campos são informados", async () => {
    const { updateConfig } = await renderizarEcapturar();

    await act(async () => {
      await updateConfig()({
        storeName: "Nova Loja",
        storeCity: "Patos de Minas",
        storeState: "MG",
      });
    });

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].config_json).toMatchObject({
      store_name: "Nova Loja",
      store_city: "Patos de Minas",
      store_state: "MG",
    });
  });
});
