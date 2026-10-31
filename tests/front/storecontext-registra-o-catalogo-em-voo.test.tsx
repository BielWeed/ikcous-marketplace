// @vitest-environment jsdom
//
// A VITRINE AVISA QUE O CATÁLOGO ESTÁ EM VOO (e SEMPRE avisa que acabou).
//
// O `catchUp` do motor espera o registro de src/lib/deposito-do-catalogo.ts
// antes de ler o cofre (ver catchup-espera-o-catalogo-em-voo.test.ts). Aqui
// o outro lado: o `buscarProdutos` do StoreContext ABRE o registro quando a
// consulta começa e o FECHA em TODOS os desfechos -- se algum ficasse sem
// fechar, cada rodada de sincronização esperaria o prazo inteiro (8 s).
//
//   1. sucesso: fecha só DEPOIS de gravar no cofre (é o que a rodada vai
//      ler), sem segurar o "carregando" da vitrine por causa da gravação;
//   2. falha de rede: fecha;
//   3. gravação no cofre que falha: fecha;
//   4. consulta superada (lojista consulta duas vezes): a velha não fecha a
//      nova; o registro só acaba quando a mais nova termina;
//   5. consulta que lança no meio: fecha.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, useStore } from "@/contexts/StoreContext";
import { catalogoEmVoo } from "@/lib/deposito-do-catalogo";

type Resposta = {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
};

const controle = vi.hoisted(() => {
  const criarConsulta = () => {
    let responder!: (resposta: Resposta) => void;
    let rejeitar!: (erro: unknown) => void;
    const promessa = new Promise<Resposta>((resolve, reject) => {
      responder = resolve;
      rejeitar = reject;
    });
    return { promessa, responder, rejeitar };
  };
  return {
    criarConsulta,
    loading: true,
    admin: false,
    consultas: [] as ReturnType<typeof criarConsulta>[],
    replaceAll: vi.fn(),
    setLastSync: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isAdmin: controle.admin,
    loading: controle.loading,
    user: null,
  }),
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
      replaceAll: controle.replaceAll,
      setLastSync: controle.setLastSync,
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

function construtorEncadeavel(obterResultado: () => Promise<Resposta>): any {
  const alvo: any = () => construtorEncadeavel(obterResultado);
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (
          resolve: (v: unknown) => void,
          rejeitar: (e: unknown) => void,
        ) => obterResultado().then(resolve, rejeitar);
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
      if (tabela === "vw_produtos_public" || tabela === "vw_produtos_admin") {
        const consulta = controle.criarConsulta();
        controle.consultas.push(consulta);
        return construtorEncadeavel(() => consulta.promessa);
      }
      return construtorEncadeavel(async () => ({ data: [], error: null }));
    },
    rpc: () => construtorEncadeavel(async () => ({ data: null, error: null })),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// O cofre dublê é um só para todas as tabelas, e o StoreProvider também grava
// os banners (pedidos no boot): o que este arquivo cobre é a gravação do CATÁLOGO.
function gravacoesDoCatalogo() {
  return controle.replaceAll.mock.calls.filter(([loja]) => loja === "products");
}

function linhaDaView() {
  return {
    id: "p1",
    nome: "Anel de prata",
    preco_venda: 20,
    estoque: 5,
    ativo: true,
    data_cadastro: "2026-01-01T00:00:00.000Z",
    product_variants: [],
  };
}

describe("StoreContext — registro do catálogo em voo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let carregando = true;

  function Capturador() {
    const { loadingProducts } = useStore();
    useEffect(() => {
      carregando = loadingProducts;
    }, [loadingProducts]);
    return null;
  }

  async function assentar() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  async function renderizar() {
    await act(async () => {
      raiz.render(
        <StoreProvider>
          <Capturador />
        </StoreProvider>,
      );
    });
    await assentar();
  }

  async function responder(indice: number, resposta: Resposta) {
    const consulta = controle.consultas.at(indice);
    if (!consulta) throw new Error(`Consulta ${indice} não iniciada`);
    await act(async () => {
      consulta.responder(resposta);
      await consulta.promessa;
    });
    await assentar();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    controle.loading = true;
    controle.admin = false;
    controle.consultas = [];
    controle.replaceAll.mockImplementation(async () => {});
    controle.setLastSync.mockResolvedValue(undefined);
    carregando = true;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
      for (const consulta of controle.consultas) {
        consulta.responder({ data: [], error: null });
      }
    });
    await vi.advanceTimersByTimeAsync(0);
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("abre ao começar a consulta e fecha só depois de gravar no cofre, sem segurar o carregando", async () => {
    let liberarGravacao!: () => void;
    const gravacao = new Promise<void>((resolve) => {
      liberarGravacao = resolve;
    });
    controle.replaceAll.mockImplementation(() => gravacao);

    await renderizar();
    expect(controle.consultas).toHaveLength(1);
    expect(catalogoEmVoo()).toBe(true);

    await responder(0, { data: [linhaDaView()], error: null });

    // A vitrine já está liberada (não espera a gravação)...
    expect(carregando).toBe(false);
    expect(gravacoesDoCatalogo()).toHaveLength(1);
    // ...mas o cofre ainda não tem o catálogo: a rodada tem de continuar esperando.
    expect(catalogoEmVoo()).toBe(true);

    await act(async () => {
      liberarGravacao();
    });
    await assentar();
    expect(catalogoEmVoo()).toBe(false);
  });

  it("falha de rede fecha o registro", async () => {
    await renderizar();
    expect(catalogoEmVoo()).toBe(true);

    await responder(0, { data: null, error: { message: "network" } });

    expect(catalogoEmVoo()).toBe(false);
    expect(gravacoesDoCatalogo()).toHaveLength(0);
  });

  it("consulta que lança fecha o registro", async () => {
    await renderizar();
    expect(catalogoEmVoo()).toBe(true);

    await act(async () => {
      controle.consultas[0].rejeitar(new Error("rede caiu"));
      await controle.consultas[0].promessa.catch(() => {});
    });
    await assentar();

    expect(catalogoEmVoo()).toBe(false);
  });

  it("gravação no cofre que falha fecha o registro", async () => {
    controle.replaceAll.mockRejectedValue(new Error("cofre fechado"));
    await renderizar();
    expect(catalogoEmVoo()).toBe(true);

    await responder(0, { data: [linhaDaView()], error: null });

    expect(catalogoEmVoo()).toBe(false);
  });

  it("consulta superada não fecha a mais nova; o registro acaba quando a mais nova termina", async () => {
    controle.admin = true;
    await renderizar();
    controle.loading = false;
    await renderizar(); // o lojista consulta de novo (fonte do painel)
    expect(controle.consultas).toHaveLength(2);
    expect(catalogoEmVoo()).toBe(true);

    await responder(0, { data: [linhaDaView()], error: null }); // a velha termina
    expect(catalogoEmVoo()).toBe(true);

    await responder(1, { data: [linhaDaView()], error: null }); // a nova termina
    expect(catalogoEmVoo()).toBe(false);
  });
});
