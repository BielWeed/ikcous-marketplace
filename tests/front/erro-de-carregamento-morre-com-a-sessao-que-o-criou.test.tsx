// @vitest-environment jsdom
//
// REGRESSÃO que eu mesmo introduzi, apontada pela revisão cruzada do parceiro
// (laudo da rodada 2, achados #4 e #5) — dois contextos, o mesmo defeito.
//
// Ao dar estado de erro às telas de Favoritos e de Avisos (commits bd79351 e
// 9142182), o campo `erro` nasceu com ciclo de vida de SESSÃO em vez de ciclo
// de vida de TELA: ele é escrito quando a consulta LOGADA falha e só era
// apagado quando uma consulta LOGADA dá certo. O ramo `!user` — o logout —
// limpava lista, contador e `loading`, e deixava `erro` de pé.
//
// O que a pessoa via, nos dois casos:
//
//   cliente loga → rede oscila → a consulta falha ("Não conseguimos
//   carregar") → rede volta → cliente sai da conta → QUALQUER visitante no
//   mesmo aparelho (balcão da loja, tablet de casa) abre Favoritos ou toca no
//   sino de Avisos e vê a mensagem de erro. Para sempre: o botão "Tentar de
//   novo" chama um fetch que retorna cedo por não haver sessão, então nada
//   nunca limpava o campo.
//
// Aparelho compartilhado é o cenário normal de uma loja, e Favoritos é aba
// principal do app — o defeito não precisava de nada raro para aparecer.
//
// A correção é o `setErro(null)` nos ramos que encerram a sessão que produziu
// o erro (o logout, e a troca direta de conta que não passa por `null`).
//
// VERMELHO contra o código anterior: sem essas linhas, a última asserção de
// cada teste ("depois do logout, `erro` é null") reprova com a string de erro
// que a sessão anterior deixou. As duas asserções do MEIO — que provam que o
// erro de fato aparece enquanto a sessão logada existe — continuam passando
// nos dois códigos, e existem justamente para que um teste verde não possa
// ser confundido com "o erro nunca é setado".
import type { Context } from "react";
import { act, useContext, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

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

// Liga/desliga a falha da LEITURA (o `select`), que é o caminho que escreve
// `erro` nos dois contextos.
let leituraFalha = false;

// Quando ligado, a leitura NÃO resolve sozinha: fica pendurada até o teste
// chamar `liberarLeitura()`. É o que torna observável a janela entre "B já
// está na tela" e "a consulta de B respondeu" — sem isso, o dublê resolve
// dentro do mesmo `act()` e o caminho de sucesso limpa `erro` de qualquer
// jeito, escondendo a limpeza da troca de conta (mutante sobrevivia).
let leituraPendurada = false;
let liberar: (() => void) | null = null;

function liberarLeitura() {
  liberar?.();
  liberar = null;
}

function respostaDaLeitura() {
  const resultado = leituraFalha
    ? { data: null, error: { message: "network down" } }
    : { data: [], error: null };
  if (!leituraPendurada) return Promise.resolve(resultado);
  return new Promise((resolve) => {
    liberar = () => resolve(resultado);
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      upsert: () => Promise.resolve({ data: [{}], error: null }),
      delete: () => ({
        eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
      // Favoritos: .select().eq()
      // Notificações: .select().or().order().limit()
      select: () => ({
        eq: () => respostaDaLeitura(),
        or: () => ({
          order: () => ({
            limit: () => respostaDaLeitura(),
          }),
        }),
      }),
    }),
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
// outros testes de contexto desta pasta.
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

let ultimoContexto: unknown = null;

// `contexto` chega como PROP, resolvido do MESMO import dinâmico que gerou o
// Provider: `vi.resetModules()` cria um Context NOVO a cada import, e uma
// referência estática do topo do arquivo nunca casaria com o Provider
// renderizado.
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
  usuarioDaVez = null;
  leituraFalha = false;
  leituraPendurada = false;
  liberar = null;
  ultimoContexto = null;
  vi.stubGlobal("localStorage", criarStorageFake());
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

/**
 * Monta o provider com o usuário corrente e devolve o valor do contexto.
 * Chamado de novo a cada mudança de `usuarioDaVez` — é a re-renderização que
 * dispara o efeito de sessão dos dois contextos.
 */
async function renderizar(
  Provider: (props: { children?: unknown }) => unknown,
  contexto: Context<any>,
) {
  await act(async () => {
    raiz.render(
      // @ts-expect-error o provider é resolvido em tempo de execução.
      <Provider>
        <Sonda contexto={contexto} />
      </Provider>,
    );
  });
  await flush();
  return ultimoContexto as { erro: string | null } | null;
}

/**
 * Igual à de cima, mas SEM `flush()`: devolve o contexto do primeiro commit,
 * antes de a consulta assíncrona da nova sessão responder. É essa janela que
 * a troca direta de conta expõe — e é a única forma de o teste enxergar a
 * limpeza do `trocouDeConta`, porque depois que a consulta de B dá certo o
 * caminho de sucesso limparia `erro` de qualquer jeito.
 */
async function renderizarSemEsperarAConsulta(
  Provider: (props: { children?: unknown }) => unknown,
  contexto: Context<any>,
) {
  await act(async () => {
    raiz.render(
      // @ts-expect-error o provider é resolvido em tempo de execução.
      <Provider>
        <Sonda contexto={contexto} />
      </Provider>,
    );
  });
  return ultimoContexto as { erro: string | null } | null;
}

describe("o estado de erro morre junto com a sessão que o produziu", () => {
  it("Favoritos: consulta falha logada, cliente sai, e o visitante seguinte NÃO herda a tela de erro", async () => {
    const { FavoritesProvider, FavoritesContext } = await import(
      "@/contexts/FavoritesContext"
    );

    // 1. Cliente entra e a leitura dos favoritos falha.
    leituraFalha = true;
    usuarioDaVez = { id: "userA" };
    const logada = await renderizar(
      FavoritesProvider as never,
      FavoritesContext,
    );

    // O erro TEM de aparecer para quem está logada — senão o teste passaria
    // por nunca ter havido erro nenhum.
    expect(logada?.erro).toBe("Não conseguimos carregar seus favoritos.");

    // 2. A rede volta e a cliente sai da conta.
    leituraFalha = false;
    usuarioDaVez = null;
    const visitante = await renderizar(
      FavoritesProvider as never,
      FavoritesContext,
    );

    // 3. O visitante seguinte abre Favoritos: estado limpo, nada de "Não
    //    conseguimos carregar" herdado da sessão anterior.
    expect(visitante?.erro).toBeNull();
  });

  it("Favoritos: trocar de conta sem passar por deslogado também não leva o erro de A para B", async () => {
    const { FavoritesProvider, FavoritesContext } = await import(
      "@/contexts/FavoritesContext"
    );

    leituraFalha = true;
    usuarioDaVez = { id: "userA" };
    const deA = await renderizar(FavoritesProvider as never, FavoritesContext);
    expect(deA?.erro).toBe("Não conseguimos carregar seus favoritos.");

    // Troca direta A -> B (AuthContext tem transições que não passam por
    // `null`), agora com a leitura funcionando.
    leituraFalha = false;
    leituraPendurada = true; // a consulta de B fica em voo, sob controle do teste
    usuarioDaVez = { id: "userB" };

    // A asserção que importa é NESTE instante: B já está na tela e a consulta
    // de B ainda NÃO respondeu. Sem a limpeza no ramo `trocouDeConta`, é aqui
    // que B lê "Não conseguimos carregar seus favoritos." — uma falha que não
    // é dela, na tela dela. Deixar a consulta resolver antes de olhar
    // esconderia o defeito, porque o caminho de sucesso limpa `erro` sozinho.
    const deBNoPrimeiroQuadro = await renderizarSemEsperarAConsulta(
      FavoritesProvider as never,
      FavoritesContext,
    );
    expect(deBNoPrimeiroQuadro?.erro).toBeNull();

    // E continua limpo depois que a consulta de B termina.
    liberarLeitura();
    await flush();
    expect((ultimoContexto as { erro: string | null } | null)?.erro).toBeNull();
  });

  it("Avisos: consulta falha logada, cliente sai, e o sino NÃO abre em erro para o visitante", async () => {
    const { NotificationProvider } = await import(
      "@/contexts/NotificationContext"
    );
    const { NotificationContext } = await import(
      "@/contexts/NotificationContextCore"
    );

    leituraFalha = true;
    usuarioDaVez = { id: "userA" };
    const logada = await renderizar(
      NotificationProvider as never,
      NotificationContext as Context<any>,
    );

    expect(logada?.erro).toBe("Não conseguimos carregar suas notificações.");

    leituraFalha = false;
    usuarioDaVez = null;
    const visitante = await renderizar(
      NotificationProvider as never,
      NotificationContext as Context<any>,
    );

    expect(visitante?.erro).toBeNull();
  });
});
