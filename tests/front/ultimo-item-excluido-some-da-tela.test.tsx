// @vitest-environment jsdom
//
// Defeito: o OUVINTE de sync em tempo real (StoreContext.tsx, useBanners.ts,
// useCategories.ts) relê a lista inteira do DataVault quando o motor de
// sincronização aplica uma mudança, mas só chama o setter se a lista relida
// tiver `length > 0`. Cenário concreto: a loja tem UM produto, a lojista
// exclui esse produto em outro dispositivo, o cofre local fica vazio, o
// ouvinte relê e recebe `[]` -- e a guarda barra o `setProducts`, deixando o
// produto excluído (com preço e estoque) na tela até alguém recarregar a
// página. Vale igual para o último banner e a última categoria.
//
// A guarda IRMà na carga INICIAL do cofre (StoreContext.tsx:290,
// useBanners.ts:124, useCategories.ts:39) é LEGÍTIMA -- ela evita piscar
// vazio antes da rede responder -- e este arquivo não a toca nem a testa.
// Só o ouvinte de sync é o alvo.
//
// POR QUE O HOOK/CONTEXTO DE VERDADE (react-dom/client + jsdom), não um
// dublê do RealtimeSyncEngine.onSync: capturar o callback REAL que
// useSyncListener registra e disparar o evento à mão é a única forma de
// provar que o ouvinte de produção -- não uma cópia do teste -- reage certo
// à lista vazia. Mesmo padrão de dashboard-escuta-a-tabela-certa.test.tsx e
// store-context-nao-mexe-em-dark.test.tsx.
//
// POR QUE `vi.resetModules()` + `await import(...)` SÓ para useBanners e
// useCategories: os dois têm cache de MÓDULO (`globalBannersCache`,
// `globalCategoriesCache`) que sobrevive entre `it`s do mesmo arquivo sem
// reset -- o segundo teste herdaria o banner/categoria que o primeiro
// deixou. StoreContext.tsx não tem esse cache (só estado de componente),
// então é importado estático como os vizinhos deste diretório. Mesmo motivo
// documentado em auth-admin-check.test.tsx.
import { act, useEffect, useRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, useStore } from "@/contexts/StoreContext";

// `vi.hoisted` -- os dois mocks abaixo (`dataVault` e `realtimeSyncEngine`)
// precisam enxergar estas filas/listas na hora em que a fábrica do mock roda
// (içada para o topo do arquivo, antes de qualquer `const` normal existir).
const h = vi.hoisted(() => {
  // Uma fila de retornos POR NOME DE STORE (products/banners/categories) --
  // cada chamada de `getAll(storeName)` consome o próximo valor da fila
  // daquele store; fila vazia devolve `[]`. Por store, e não uma fila
  // única, porque os três hooks/contextos deste teste chamam o MESMO mock
  // de DataVault (`@/lib/dataVault` é um módulo só), e misturar as filas
  // faria a chamada de produtos consumir o valor que era da de banners.
  const filas = new Map<string, unknown[][]>();

  // Fila PARALELA, também por store: quantas das próximas chamadas de
  // `getAllOrThrow(storeName)` devem REJEITAR em vez de consumir a fila de
  // sucesso acima -- é o achado da revisão (dataVault.ts:234): `getAll`
  // devolve `[]` tanto para "cofre vazio de verdade" quanto para "a
  // leitura estourou", e os ouvintes de sync passaram a usar
  // `getAllOrThrow` exatamente para distinguir os dois casos.
  const filasFalhas = new Map<string, boolean[]>();

  function enfileirarGetAll(storeName: string, valor: unknown[]) {
    if (!filas.has(storeName)) filas.set(storeName, []);
    filas.get(storeName)?.push(valor);
  }

  function enfileirarGetAllOrThrowFalha(storeName: string) {
    if (!filasFalhas.has(storeName)) filasFalhas.set(storeName, []);
    filasFalhas.get(storeName)?.push(true);
  }

  function getAllImpl(storeName: string): Promise<unknown[]> {
    const fila = filas.get(storeName);
    if (fila && fila.length > 0) {
      return Promise.resolve(fila.shift() ?? []);
    }
    return Promise.resolve([]);
  }

  function getAllOrThrowImpl(storeName: string): Promise<unknown[]> {
    const falhas = filasFalhas.get(storeName);
    if (falhas && falhas.length > 0) {
      falhas.shift();
      return Promise.reject(
        new Error(`getAllOrThrow('${storeName}') falhou (simulado pelo teste)`),
      );
    }
    return getAllImpl(storeName);
  }

  function limparFilas() {
    filas.clear();
    filasFalhas.clear();
  }

  // Callbacks REAIS que `useSyncListener` registrou via
  // `RealtimeSyncEngine.onSync` -- um por hook/contexto montado. Disparar
  // "sync" no teste é chamar cada um destes com `{ store }`; o próprio
  // wrapper de `useSyncListener` (código de produção, não mock) decide se o
  // evento é dele (`stores.includes(event.store)`).
  const callbacksCapturados: Array<(event: { store: string }) => void> = [];

  function dispararSync(store: string) {
    for (const cb of [...callbacksCapturados]) {
      cb({ store });
    }
  }

  function limparCallbacks() {
    callbacksCapturados.length = 0;
  }

  return {
    enfileirarGetAll,
    enfileirarGetAllOrThrowFalha,
    getAllImpl,
    getAllOrThrowImpl,
    limparFilas,
    callbacksCapturados,
    dispararSync,
    limparCallbacks,
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: false, loading: false, user: null }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getById: vi.fn().mockResolvedValue(null),
      getAll: (storeName: string) => h.getAllImpl(storeName),
      getAllOrThrow: (storeName: string) => h.getAllOrThrowImpl(storeName),
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
    onSync: vi.fn((cb: (event: { store: string }) => void) => {
      h.callbacksCapturados.push(cb);
      return () => {
        const idx = h.callbacksCapturados.indexOf(cb);
        if (idx >= 0) h.callbacksCapturados.splice(idx, 1);
      };
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));

// Builder encadeável e "thenable" -- mesmo padrão de
// store-context-nao-mexe-em-dark.test.tsx: cobre qualquer corrente de
// `.from().select()....` sem replicar a assinatura exata de cada chamada.
// Devolve sempre lista vazia sem erro -- a rede não é o que este teste
// prova, e uma resposta vazia sem erro não briga com o estado que o teste
// monta via os eventos de sync disparados à mão.
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

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => construtorEncadeavel({ data: [], error: null }),
    rpc: () => construtorEncadeavel({ data: null, error: null }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão
// dos vizinhos deste diretório.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Espera a fila de microtarefas drenar por inteiro -- mesmo helper de
 * auth-admin-check.test.tsx e pagamento-online.test.tsx: um `setTimeout(0)`
 * só roda depois que TODAS as microtarefas pendentes (inclusive as que uma
 * promise resolvida agenda em cadeia) já drenaram. */
function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function produto(id: string): any {
  return { id, name: `Produto ${id}`, price: 10, stock: 1 };
}

function banner(id: string): any {
  return {
    id,
    imageUrl: `https://exemplo.com/${id}.jpg`,
    title: `Banner ${id}`,
    position: "home_top",
    active: true,
    order: 1,
  };
}

function categoria(id: string): any {
  return {
    id,
    name: `Categoria ${id}`,
    slug: id,
    description: "",
    isActive: true,
  };
}

describe("Ouvinte de sync -- último item excluído some da tela (não fica preso pela guarda de lista vazia)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.limparFilas();
    h.limparCallbacks();
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

  describe("Produtos (StoreContext)", () => {
    function CapturadorProdutos({
      aoAtualizar,
    }: {
      readonly aoAtualizar: (produtos: any[]) => void;
    }) {
      const { products } = useStore();
      const aoAtualizarRef = useRef(aoAtualizar);
      useEffect(() => {
        aoAtualizarRef.current = aoAtualizar;
      });
      useEffect(() => {
        aoAtualizarRef.current(products);
      }, [products]);
      return null;
    }

    async function montarProdutos() {
      let ultimo: any[] = [];
      await act(async () => {
        raiz.render(
          <StoreProvider>
            <CapturadorProdutos
              aoAtualizar={(produtos) => {
                ultimo = produtos;
              }}
            />
          </StoreProvider>,
        );
      });
      // Deixa fetchConfig/fetchProducts (rede, mockada vazia/sem erro)
      // assentarem antes de manipular o motor de sync à mão -- sem isto, a
      // resposta de rede poderia chegar DEPOIS dos eventos manuais e
      // sobrescrever o estado que o teste monta.
      await act(async () => {
        await esperarMicrotarefas();
      });
      return { obterUltimo: () => ultimo };
    }

    it("a exclusão do último produto (cofre volta vazio) esvazia a vitrine", async () => {
      const { obterUltimo } = await montarProdutos();

      // Estabelece a base: um produto na tela, pelo próprio ouvinte de sync
      // (prova que ele reage a lista não-vazia antes de testar o vazio).
      h.enfileirarGetAll("products", [produto("p1")]);
      await act(async () => {
        h.dispararSync("products");
        await esperarMicrotarefas();
      });
      expect(obterUltimo().length).toBe(1);

      // A exclusão: o cofre volta vazio -- é o que o motor de sync grava
      // depois de aplicar a exclusão do último produto.
      h.enfileirarGetAll("products", []);
      await act(async () => {
        h.dispararSync("products");
        await esperarMicrotarefas();
      });

      expect(obterUltimo()).toEqual([]);
    });

    it("controle negativo: o cofre passa a ter DOIS produtos -- a tela mostra os dois (prova que o disparo de sync realmente atualiza a tela, não só que ela ficou vazia)", async () => {
      const { obterUltimo } = await montarProdutos();

      h.enfileirarGetAll("products", [produto("p1")]);
      await act(async () => {
        h.dispararSync("products");
        await esperarMicrotarefas();
      });
      expect(obterUltimo().length).toBe(1);

      h.enfileirarGetAll("products", [produto("p1"), produto("p2")]);
      await act(async () => {
        h.dispararSync("products");
        await esperarMicrotarefas();
      });

      // Não só o TAMANHO -- a IDENTIDADE. `setProducts(fresh.map(() => ({}) as
      // any))` também teria comprimento 2 e passaria numa asserção só de
      // `.length`, deixando objeto vazio (sem id, preço, estoque) na
      // vitrine.
      expect(obterUltimo().map((p: any) => p.id)).toEqual(["p1", "p2"]);
    });

    it("achado da revisão: a releitura do cofre FALHA (conexão fechada por outra aba, por exemplo) -- a vitrine mantém o que já estava, não esvazia", async () => {
      const { obterUltimo } = await montarProdutos();

      h.enfileirarGetAll("products", [produto("p1")]);
      await act(async () => {
        h.dispararSync("products");
        await esperarMicrotarefas();
      });
      expect(obterUltimo().map((p: any) => p.id)).toEqual(["p1"]);

      // A releitura REJEITA (getAllOrThrow) -- é o caso que `getAll`
      // (dataVault.ts:234) mascarava como cofre vazio de verdade.
      h.enfileirarGetAllOrThrowFalha("products");
      await act(async () => {
        h.dispararSync("products");
        await esperarMicrotarefas();
      });

      expect(obterUltimo().map((p: any) => p.id)).toEqual(["p1"]);
    });
  });

  describe("Banners (useBanners)", () => {
    function criarSondaBanners(
      useBannersHook: () => { banners: any[] },
      aoAtualizar: (banners: any[]) => void,
    ) {
      return function SondaBanners() {
        const { banners } = useBannersHook();
        const aoAtualizarRef = useRef(aoAtualizar);
        useEffect(() => {
          aoAtualizarRef.current = aoAtualizar;
        });
        useEffect(() => {
          aoAtualizarRef.current(banners);
        }, [banners]);
        return null;
      };
    }

    async function montarBanners() {
      vi.resetModules();
      const { useBanners } = await import("@/hooks/useBanners");
      let ultimo: any[] = [];
      const SondaBanners = criarSondaBanners(useBanners, (banners) => {
        ultimo = banners;
      });
      await act(async () => {
        raiz.render(<SondaBanners />);
      });
      await act(async () => {
        await esperarMicrotarefas();
      });
      return { obterUltimo: () => ultimo };
    }

    it("a exclusão do último banner (cofre volta vazio) esvazia a lista", async () => {
      const { obterUltimo } = await montarBanners();

      h.enfileirarGetAll("banners", [banner("b1")]);
      await act(async () => {
        h.dispararSync("banners");
        await esperarMicrotarefas();
      });
      expect(obterUltimo().length).toBe(1);

      h.enfileirarGetAll("banners", []);
      await act(async () => {
        h.dispararSync("banners");
        await esperarMicrotarefas();
      });

      expect(obterUltimo()).toEqual([]);
    });

    it("controle negativo: o cofre passa a ter DOIS banners -- a lista mostra os dois", async () => {
      const { obterUltimo } = await montarBanners();

      h.enfileirarGetAll("banners", [banner("b1")]);
      await act(async () => {
        h.dispararSync("banners");
        await esperarMicrotarefas();
      });
      expect(obterUltimo().length).toBe(1);

      h.enfileirarGetAll("banners", [banner("b1"), banner("b2")]);
      await act(async () => {
        h.dispararSync("banners");
        await esperarMicrotarefas();
      });

      // Não só o TAMANHO -- a IDENTIDADE (mesma trava do controle de
      // produtos acima).
      expect(obterUltimo().map((b: any) => b.id)).toEqual(["b1", "b2"]);
    });

    it("achado da revisão: a releitura do cofre FALHA -- a lista mantém o que já estava, não esvazia", async () => {
      const { obterUltimo } = await montarBanners();

      h.enfileirarGetAll("banners", [banner("b1")]);
      await act(async () => {
        h.dispararSync("banners");
        await esperarMicrotarefas();
      });
      expect(obterUltimo().map((b: any) => b.id)).toEqual(["b1"]);

      h.enfileirarGetAllOrThrowFalha("banners");
      await act(async () => {
        h.dispararSync("banners");
        await esperarMicrotarefas();
      });

      expect(obterUltimo().map((b: any) => b.id)).toEqual(["b1"]);
    });
  });

  describe("Categorias (useCategories)", () => {
    function criarSondaCategorias(
      useCategoriesHook: () => { categories: any[] },
      aoAtualizar: (categorias: any[]) => void,
    ) {
      return function SondaCategorias() {
        const { categories } = useCategoriesHook();
        const aoAtualizarRef = useRef(aoAtualizar);
        useEffect(() => {
          aoAtualizarRef.current = aoAtualizar;
        });
        useEffect(() => {
          aoAtualizarRef.current(categories);
        }, [categories]);
        return null;
      };
    }

    async function montarCategorias() {
      vi.resetModules();
      const { useCategories } = await import("@/hooks/useCategories");
      let ultimo: any[] = [];
      const SondaCategorias = criarSondaCategorias(
        useCategories,
        (categorias) => {
          ultimo = categorias;
        },
      );
      await act(async () => {
        raiz.render(<SondaCategorias />);
      });
      await act(async () => {
        await esperarMicrotarefas();
      });
      return { obterUltimo: () => ultimo };
    }

    it("a exclusão da última categoria (cofre volta vazio) esvazia a lista", async () => {
      const { obterUltimo } = await montarCategorias();

      h.enfileirarGetAll("categories", [categoria("c1")]);
      await act(async () => {
        h.dispararSync("categories");
        await esperarMicrotarefas();
      });
      expect(obterUltimo().length).toBe(1);

      h.enfileirarGetAll("categories", []);
      await act(async () => {
        h.dispararSync("categories");
        await esperarMicrotarefas();
      });

      expect(obterUltimo()).toEqual([]);
    });

    it("controle negativo: o cofre passa a ter DUAS categorias -- a lista mostra as duas", async () => {
      const { obterUltimo } = await montarCategorias();

      h.enfileirarGetAll("categories", [categoria("c1")]);
      await act(async () => {
        h.dispararSync("categories");
        await esperarMicrotarefas();
      });
      expect(obterUltimo().length).toBe(1);

      h.enfileirarGetAll("categories", [categoria("c1"), categoria("c2")]);
      await act(async () => {
        h.dispararSync("categories");
        await esperarMicrotarefas();
      });

      // Não só o TAMANHO -- a IDENTIDADE (mesma trava dos controles de
      // produtos e banners acima).
      expect(obterUltimo().map((c: any) => c.id)).toEqual(["c1", "c2"]);
    });

    it("achado da revisão: a releitura do cofre FALHA -- a lista mantém o que já estava, não esvazia", async () => {
      const { obterUltimo } = await montarCategorias();

      h.enfileirarGetAll("categories", [categoria("c1")]);
      await act(async () => {
        h.dispararSync("categories");
        await esperarMicrotarefas();
      });
      expect(obterUltimo().map((c: any) => c.id)).toEqual(["c1"]);

      h.enfileirarGetAllOrThrowFalha("categories");
      await act(async () => {
        h.dispararSync("categories");
        await esperarMicrotarefas();
      });

      expect(obterUltimo().map((c: any) => c.id)).toEqual(["c1"]);
    });
  });
});
