// @vitest-environment jsdom
//
// Defeito 1 da revisão de contexto limpo (26/08/2026) sobre esta mesma
// correção: o efeito de RETENTATIVA (evento `online`) fechava sobre o
// `pendingFavorites` do RENDER, e `user`/`pendingFavorites` mudam em
// COMMITS diferentes. Numa troca DIRETA de conta A->B — que existe de
// verdade neste app (AuthContext.tsx:579-583, `isCriticalTransition`, troca
// sem passar por `null` quando o id muda) — o listener podia religar já com
// o `user` NOVO (B) mas com a fila do usuário ANTERIOR (A) ainda presa no
// fechamento. Se `online` disparasse nessa janela — e é exatamente o
// GATILHO que a rede instável (a mesma causa da pendência) provoca — os
// favoritos de A eram gravados na conta de B.
//
// Este teste reproduz a janela de forma DETERMINÍSTICA: em vez de torcer
// para o timing do React abrir a fresta sozinho, ele mantém o próprio sync
// de B "em voo" (upsert de `pB` sem resolver) e dispara `online` durante
// essa espera — o cenário realista de rede lenta, não caída, que
// `favoritos-locais-nao-somem-se-a-gravacao-falhar.test.tsx` já usa para o
// defeito irmão.
//
// ATUALIZADO em 26/08/2026 (achado 1 da revisão de contexto limpo SOBRE ESTE
// MESMO teste): a versão anterior deste arquivo afirmava, aqui embaixo, que
// era "vermelha contra o código antigo" — falso. `await act(async () => {
// raiz.render(...) })` drena TUDO que não depende de uma promessa externa
// ainda pendurada, inclusive a re-renderização que o próprio reset de
// `trocouDeConta` dispara — e o código com o defeito reinscreve o listener
// (com `pendingFavorites` FRESCO) como parte dessa MESMA drenagem, antes do
// `dispatchEvent("online")` mais abaixo sequer existir. A janela do defeito
// fecha antes do evento disparar; a asserção só media o mundo depois dela
// fechada. Confirmado com o mutante: revertendo a correção (retentativa
// fechando sobre `pendingFavorites` do render + a dependência de volta), a
// suíte continuava 100% verde.
//
// A correção do teste: capturar a REFERÊNCIA da função passada ao PRIMEIRO
// `window.addEventListener("online", ...)` registrado quando B loga — antes
// de qualquer reconciliação subsequente ter chance de reinscrever o listener
// — e invocá-la DIRETO. Isso prova o que aquele fechamento carregava no
// instante em que o efeito rodou, sem depender de nenhuma corrida de
// verdade contra o event loop. Contra o código com o defeito, esse PRIMEIRO
// fechamento é exatamente o que ainda aponta para a fila stale de A.
import type { Context } from "react";
import { act } from "react";
import { useContext, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const FAVORITES_KEY = "ikcous_favorites";
const pendingKeyDe = (userId: string) => `ikcous_favorites_pendentes:${userId}`;

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] as Product[], loading: false }),
}));

let usuarioDaVez: { id: string } | null = null;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioDaVez }),
}));

// product_id -> resultado do upsert quando NÃO está segurado (`undefined` =
// sucesso). Produtos em `segurarProduto` devolvem uma promise que só resolve
// quando `liberarProduto` é chamado — simula rede LENTA (não caída), a
// janela em que o defeito 1 vive.
let resultadoPorProduto: Record<string, { message: string } | undefined> = {};
let chamadasUpsert: { user_id: string; product_id: string }[] = [];
let segurarProduto = new Set<string>();
let resolvedoresPendentes = new Map<string, Array<() => void>>();

function liberarProduto(id: string) {
  const lista = resolvedoresPendentes.get(id) ?? [];
  resolvedoresPendentes.delete(id);
  for (const resolver of lista) resolver();
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "favorites") {
        throw new Error(`tabela inesperada no dublê: ${tabela}`);
      }
      return {
        upsert: (obj: { user_id: string; product_id: string }) => {
          chamadasUpsert.push({ ...obj });
          if (segurarProduto.has(obj.product_id)) {
            return new Promise((resolve) => {
              const atual = resolvedoresPendentes.get(obj.product_id) ?? [];
              atual.push(() => {
                const erro = resultadoPorProduto[obj.product_id];
                resolve({ data: erro ? null : [{}], error: erro ?? null });
              });
              resolvedoresPendentes.set(obj.product_id, atual);
            });
          }
          const erro = resultadoPorProduto[obj.product_id];
          return Promise.resolve({
            data: erro ? null : [{}],
            error: erro ?? null,
          });
        },
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
      };
    },
    channel: () => ({
      on() {
        return this;
      },
      subscribe: () => ({}),
    }),
    removeChannel: () => Promise.resolve(),
  },
}));

// Node 25 pisa em `localStorage` global antes do jsdom — mesmo contorno dos
// testes irmãos de FavoritesContext.
function criarStorageFake() {
  const armazem = new Map<string, string>();
  return {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
    clear: () => {
      armazem.clear();
    },
    key: (index: number) => Array.from(armazem.keys()).at(index) ?? null,
    get length() {
      return armazem.size;
    },
  };
}

function produto(id: string): Product {
  return {
    id,
    name: `Produto ${id}`,
    price: 10,
    images: [],
  } as unknown as Product;
}

let ultimoContexto: unknown = null;
function Sonda({ contexto }: { contexto: Context<any> }) {
  const ctx = useContext(contexto);
  useEffect(() => {
    ultimoContexto = ctx;
  });
  return null;
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let storageFake: ReturnType<typeof criarStorageFake>;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  resultadoPorProduto = {};
  chamadasUpsert = [];
  segurarProduto = new Set<string>();
  resolvedoresPendentes = new Map<string, Array<() => void>>();
  usuarioDaVez = null;
  ultimoContexto = null;
  storageFake = criarStorageFake();
  vi.stubGlobal("localStorage", storageFake);
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("FavoritesContext — retentativa no evento online não vaza entre contas", () => {
  it("A favorita sem conta, sync falha, troca DIRETA para B (sem logout) com o sync de B em voo — online não grava p1/p2 na conta de B", async () => {
    // Espiona TODO `addEventListener` de "online" a partir daqui — inclusive
    // os que o próprio código reinscreve sozinho durante a drenagem de um
    // `act()`. Por padrão o vitest preserva o comportamento real (o
    // dispatchEvent mais abaixo continua funcionando via o listener ATIVO no
    // momento); a espionagem só ADICIONA um registro consultável.
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");

    // 1. Visitante A favorita 2 produtos sem conta.
    storageFake.setItem(
      FAVORITES_KEY,
      JSON.stringify([produto("p1"), produto("p2")]),
    );

    const { FavoritesProvider, FavoritesContext } = await import(
      "@/contexts/FavoritesContext"
    );

    await act(async () => {
      raiz.render(
        <FavoritesProvider>
          <Sonda contexto={FavoritesContext} />
        </FavoritesProvider>,
      );
    });
    await flush();

    // 2. A cria conta / loga — e a gravação FALHA para os dois produtos.
    // A fila de A fica em ikcous_favorites_pendentes:userA.
    resultadoPorProduto = {
      p1: { message: "network down" },
      p2: { message: "network down" },
    };
    usuarioDaVez = { id: "userA" };

    await act(async () => {
      raiz.render(
        <FavoritesProvider>
          <Sonda contexto={FavoritesContext} />
        </FavoritesProvider>,
      );
    });
    await flush();

    expect(
      JSON.parse(storageFake.getItem(pendingKeyDe("userA")) ?? "[]"),
    ).toHaveLength(2);

    // 3. B loga DIRETO, sem A passar por logout — a mesma transição crítica
    // que AuthContext.tsx faz sem passar por `null` quando o id muda. B já
    // tinha uma pendência PRÓPRIA neste aparelho (pB, de uma tentativa
    // anterior) — isso faz o sync de B ficar "em voo" de verdade.
    storageFake.setItem(pendingKeyDe("userB"), JSON.stringify([produto("pB")]));
    segurarProduto.add("pB");
    usuarioDaVez = { id: "userB" };
    const registrosAntesDoLoginDeB = addEventListenerSpy.mock.calls.length;

    await act(async () => {
      raiz.render(
        <FavoritesProvider>
          <Sonda contexto={FavoritesContext} />
        </FavoritesProvider>,
      );
    });
    // Sem `flush()` completo aqui de propósito: o upsert de "pB" está
    // segurado, então o sync de B (chamado pelo efeito de sync) fica preso
    // no `await tentarSincronizarComServidor`. É exatamente esta janela que
    // o defeito 1 explorava.

    // 3.5. Acha o PRIMEIRO listener de "online" registrado nesta transição
    // para B — capturado ANTES de qualquer reconciliação subsequente ter
    // tido chance de reinscrevê-lo com dados frescos — e chama ele DIRETO,
    // ignorando o `window.dispatchEvent` (que só alcançaria o listener
    // ATIVO agora, já possivelmente o segundo, saneado). Contra o código com
    // o defeito 1, este primeiro fechamento é exatamente o que ainda aponta
    // para a fila stale de A ([p1, p2]).
    const registrosOnlineDeB = addEventListenerSpy.mock.calls
      .slice(registrosAntesDoLoginDeB)
      .filter(([tipoDeEvento]) => tipoDeEvento === "online");
    expect(registrosOnlineDeB.length).toBeGreaterThan(0);
    const primeiroHandlerDeB = registrosOnlineDeB[0][1] as EventListener;

    await act(async () => {
      primeiroHandlerDeB(new Event("online"));
    });
    await flush();

    const upsertsDoFechamentoCapturado = chamadasUpsert.filter(
      (c) =>
        c.user_id === "userB" &&
        (c.product_id === "p1" || c.product_id === "p2"),
    );
    expect(upsertsDoFechamentoCapturado).toEqual([]);

    // 4. A rede "volta" (o mesmo sinal que motivou a retentativa) enquanto o
    // sync de B ainda não terminou — mantém a cobertura end-to-end original,
    // via dispatchEvent de verdade.
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    // 5. Libera o upsert de "pB" — só agora o(s) sync(s) em voo terminam.
    liberarProduto("pB");
    await flush();

    // O que importa: NENHUM upsert foi disparado com o `user_id` de B e um
    // `product_id` que era de A. Isso prova que os favoritos de A não
    // vazaram para a conta de B — nem tentaram ser gravados lá.
    const upsertsDeAsobB = chamadasUpsert.filter(
      (c) =>
        c.user_id === "userB" &&
        (c.product_id === "p1" || c.product_id === "p2"),
    );
    expect(upsertsDeAsobB).toEqual([]);

    // Controle positivo: a retentativa REALMENTE disparou e tentou
    // sincronizar o favorito de B (senão a asserção acima passaria por o
    // mecanismo nunca ter sido exercitado — ver "o controle também precisa
    // de controle").
    const upsertsDePB = chamadasUpsert.filter((c) => c.product_id === "pB");
    expect(upsertsDePB.length).toBeGreaterThan(0);
    expect(upsertsDePB.every((c) => c.user_id === "userB")).toBe(true);

    // E o que B vê na tela, na mesma janela, também não pode incluir p1/p2.
    const ctxDeB = ultimoContexto as { favorites: Product[] } | null;
    const idsNaTelaDeB = (ctxDeB?.favorites ?? []).map((p) => p.id);
    expect(idsNaTelaDeB).not.toContain("p1");
    expect(idsNaTelaDeB).not.toContain("p2");
  });
});
