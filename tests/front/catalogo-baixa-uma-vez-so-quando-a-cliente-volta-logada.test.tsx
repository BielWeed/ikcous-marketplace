// @vitest-environment jsdom
//
// QUEM VOLTA LOGADA AO APP BAIXAVA O CATÁLOGO INTEIRO DUAS VEZES.
//
// `buscarProdutos` dependia de `[isAdmin, loading]`. Para quem tem sessão salva
// o `loading` nasce `true` e vira `false` milissegundos depois (a sessão local
// foi lida): a função mudava, o efeito de montagem disparava de novo e a MESMA
// consulta pública saía duas vezes (até 200 produtos com descrição e todas as
// variações em cada uma). A primeira resposta era descartada, mas os bytes já
// tinham vindo. Para cliente comum a fonte é a mesma nos dois momentos: só o
// lojista (`isAdmin && !loading`) troca de fonte e precisa repetir a busca.
//
// O que se trava aqui: (1) cliente comum, `loading` true -> false = UMA
// consulta pública (e uma da configuração); (2) lojista = a busca do painel
// acontece quando a sessão termina de carregar, e o catálogo dele traz o
// produto pausado; (3) a fonte do painel também vale quando o papel de
// lojista só chega depois do `loading`.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, useStore } from "@/contexts/StoreContext";

const controle = vi.hoisted(() => ({
  isAdmin: false,
  loading: true,
  consultas: [] as string[],
  linhasDaPublica: [] as Record<string, unknown>[],
  linhasDoPainel: [] as Record<string, unknown>[],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isAdmin: controle.isAdmin,
    loading: controle.loading,
    user: controle.isAdmin ? { id: "admin-1" } : { id: "cliente-1" },
  }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getById: vi.fn().mockResolvedValue(null),
      getAll: vi.fn(async () => []),
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

type Resposta = { data: unknown; error: unknown };

function construtorEncadeavel(obterResultado: () => Resposta): any {
  const alvo: any = () => construtorEncadeavel(obterResultado);
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (
          resolve: (v: unknown) => void,
          rejeitar: (e: unknown) => void,
        ) => Promise.resolve(obterResultado()).then(resolve, rejeitar);
      }
      return () => construtorEncadeavel(obterResultado);
    },
    apply() {
      return construtorEncadeavel(obterResultado);
    },
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      controle.consultas.push(tabela);
      if (tabela === "vw_produtos_public") {
        return construtorEncadeavel(() => ({
          data: controle.linhasDaPublica,
          error: null,
        }));
      }
      if (tabela === "vw_produtos_admin") {
        return construtorEncadeavel(() => ({
          data: controle.linhasDoPainel,
          error: null,
        }));
      }
      return construtorEncadeavel(() => ({ data: null, error: null }));
    },
    rpc: () => construtorEncadeavel(() => ({ data: null, error: null })),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function linha(id: string, ativo: boolean) {
  return {
    id,
    nome: `Produto ${id}`,
    preco_venda: 10,
    estoque: 5,
    ativo,
    data_cadastro: "2026-01-01T00:00:00.000Z",
    product_variants: [],
  };
}

const vezes = (tabela: string) =>
  controle.consultas.filter((t) => t === tabela).length;

describe("StoreContext — catálogo baixado uma vez só ao abrir logada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let nomesNaTela: string[];

  function Capturador() {
    const { products } = useStore();
    useEffect(() => {
      nomesNaTela = products.map((p) => `${p.id}:${p.isActive}`);
    }, [products]);
    return null;
  }

  async function renderizar() {
    await act(async () => {
      raiz.render(
        <StoreProvider>
          <Capturador />
        </StoreProvider>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    controle.isAdmin = false;
    controle.loading = true;
    controle.consultas = [];
    controle.linhasDaPublica = [linha("p1", true)];
    controle.linhasDoPainel = [linha("p1", true), linha("pausado", false)];
    nomesNaTela = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("cliente comum com sessão salva: loading true -> false baixa o catálogo e a configuração UMA vez", async () => {
    await renderizar();
    expect(vezes("vw_produtos_public")).toBe(1);

    // A sessão local terminou de ser lida.
    controle.loading = false;
    await renderizar();

    expect(vezes("vw_produtos_public")).toBe(1);
    expect(vezes("vw_produtos_admin")).toBe(0);
    expect(vezes("v_store_config")).toBe(1);
    expect(nomesNaTela).toEqual(["p1:true"]);
  });

  it("lojista: quando a sessão termina de carregar, busca o catálogo do painel (com o produto pausado)", async () => {
    controle.isAdmin = true;
    await renderizar();
    // Ainda carregando a sessão: nunca confia no papel antes da hora.
    expect(vezes("vw_produtos_admin")).toBe(0);
    expect(vezes("vw_produtos_public")).toBe(1);

    controle.loading = false;
    await renderizar();

    expect(vezes("vw_produtos_admin")).toBe(1);
    expect(nomesNaTela).toEqual(["p1:true", "pausado:false"]);
  });

  it("o papel de lojista só chega depois do loading: troca para a fonte do painel", async () => {
    controle.loading = false;
    await renderizar();
    expect(vezes("vw_produtos_public")).toBe(1);
    expect(vezes("vw_produtos_admin")).toBe(0);

    controle.isAdmin = true;
    await renderizar();

    expect(vezes("vw_produtos_admin")).toBe(1);
    expect(nomesNaTela).toEqual(["p1:true", "pausado:false"]);
  });
});
