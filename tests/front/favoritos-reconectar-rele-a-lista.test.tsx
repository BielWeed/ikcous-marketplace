// @vitest-environment jsdom
//
// "VOLTOU A INTERNET E O FAVORITO CONTINUA ERRADO": RECONECTAR RELÊ A LISTA
// (13/11/2026).
//
// O DEFEITO: o evento `online` só chamava `retentarPendentes()`, que sai na hora
// quando a fila de gravações pendentes está vazia (o caso comum), e a volta do
// canal de tempo real (`SUBSCRIBED` outra vez) não relia nada. Quem ficou sem
// rede e voltou continuava vendo o retrato de antes: o favorito removido em outro
// aparelho seguia marcado e o novo não aparecia, até alguém trocar de aba ou
// puxar a tela.
//
// O CONSERTO: `online` e a RECONEXÃO do canal (não a primeira inscrição) relêem
// a lista da conta pelo mesmo caminho de sempre (`fetchDbFavorites`), que já
// descarta resposta velha (número de rodada) e resposta que atravessa uma
// gravação em voo. Uma releitura de reconexão por vez: enquanto a anterior não
// termina (ou estoura os 15 s do prazo), outro gatilho não abre uma segunda.
//
// O QUE ESTA SUÍTE TRAVA:
//   1. `online` relê e aplica: favorito novo aparece, removido some;
//   2. `SUBSCRIBED` da PRIMEIRA inscrição não relê; o da reconexão relê (e avisa
//      as outras abas);
//   3. gravação local ainda não confirmada (toque em voo) NÃO é pisada pela
//      releitura de reconexão, e a fila de pendentes em disco continua lá até o
//      servidor confirmar;
//   4. rajada de gatilhos (online + reconexão do canal) custa UMA releitura, e
//      uma releitura pendurada solta no prazo (não bloqueia para sempre);
//   5. resposta velha da releitura de reconexão não desfaz uma mais nova;
//   6. sem conta, `online` não consulta nada.
import {
  FavoritesContext,
  FavoritesProvider,
} from "@/contexts/FavoritesContext";
import type { Product } from "@/types";
import { type ContextType, act, useContext, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Erro = { message: string } | null;
type Leitura = { usuario: string; concluir: () => void };
type Gravacao = { concluir: (erro?: Erro) => void };
const mundo = vi.hoisted(() => ({
  usuario: { id: "conta-a" } as { id: string } | null,
  lider: false,
  linhas: new Set<string>(),
  leituras: [] as Leitura[],
  gravacoes: [] as Gravacao[],
  assinaturas: [] as Array<(status: string) => void>,
  avisosAsOutrasAbas: [] as unknown[],
}));
const produtos = [
  { id: "caneca", name: "Caneca azul", price: 19, images: [] },
  { id: "jarra", name: "Jarra verde", price: 32, images: [] },
] as unknown as Product[];

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: produtos, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: mundo.lider }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    channel: () => {
      const canal = {
        on: () => canal,
        subscribe: (retorno: (status: string) => void) => {
          mundo.assinaturas.push(retorno);
          return canal;
        },
      };
      return canal;
    },
    removeChannel: () => Promise.resolve(),
    from: (tabela: string) => {
      if (tabela !== "favorites")
        throw new Error(`Tabela inesperada: ${tabela}`);
      const gravar = (usuario: string, produto: string, remover: boolean) =>
        new Promise<{ error: Erro }>((resolve) => {
          mundo.gravacoes.push({
            concluir: (erro = null) => {
              if (!erro) {
                const chave = `${usuario}|${produto}`;
                if (remover) mundo.linhas.delete(chave);
                else mundo.linhas.add(chave);
              }
              resolve({ error: erro });
            },
          });
        });
      return {
        select: () => ({
          eq: (_coluna: string, usuario: string) => {
            // Congela na PARTIDA: ler o Set só ao concluir esconderia a corrida.
            const retrato = Array.from(mundo.linhas)
              .filter((chave) => chave.startsWith(`${usuario}|`))
              .map((chave) => ({ product_id: chave.split("|")[1] }));
            return new Promise((resolve) => {
              mundo.leituras.push({
                usuario,
                concluir: () => resolve({ data: retrato, error: null }),
              });
            });
          },
        }),
        upsert: ({
          user_id,
          product_id,
        }: { user_id: string; product_id: string }) =>
          gravar(user_id, product_id, false),
        delete: () => ({
          eq: (_coluna: string, usuario: string) => ({
            eq: (_campo: string, produto: string) =>
              gravar(usuario, produto, true),
          }),
        }),
      };
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const observar = vi.fn();
function Sonda() {
  const contexto = useContext(FavoritesContext);
  useEffect(() => {
    observar(contexto);
  });
  return (
    <>
      <button
        type="button"
        aria-label="Favoritar caneca"
        onClick={() => contexto?.toggleFavorite(produtos[0])}
      >
        Coração
      </button>
    </>
  );
}
const atual = () =>
  observar.mock.calls.at(-1)?.[0] as NonNullable<
    ContextType<typeof FavoritesContext>
  >;
let raiz: Root;
let hospedeiro: HTMLDivElement;

async function renderizar() {
  await act(async () => {
    raiz.render(
      <FavoritesProvider>
        <Sonda />
      </FavoritesProvider>,
    );
  });
}
async function responderLeitura(indice: number) {
  const leitura = mundo.leituras.at(indice);
  if (!leitura) throw new Error(`Leitura ${indice} não começou`);
  await act(async () => leitura.concluir());
}
async function concluirGravacao(indice: number, erro: Erro = null) {
  const gravacao = mundo.gravacoes.at(indice);
  if (!gravacao) throw new Error(`Gravação ${indice} não começou`);
  await act(async () => gravacao.concluir(erro));
}
async function voltarARede() {
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
}
async function canalAvisa(status: string) {
  const retorno = mundo.assinaturas.at(-1);
  if (!retorno) throw new Error("O canal não se inscreveu");
  await act(async () => retorno(status));
}
async function tocarCoracao() {
  await act(async () => {
    hospedeiro.querySelector("button")?.click();
  });
}
const ids = () => atual().favorites.map((produto) => produto.id);

beforeEach(() => {
  vi.clearAllMocks();
  mundo.usuario = { id: "conta-a" };
  mundo.lider = false;
  mundo.linhas.clear();
  mundo.leituras.length = 0;
  mundo.gravacoes.length = 0;
  mundo.assinaturas.length = 0;
  mundo.avisosAsOutrasAbas.length = 0;
  const valores = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => valores.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      valores.set(chave, valor);
    },
    removeItem: (chave: string) => {
      valores.delete(chave);
    },
  });
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage(mensagem: unknown) {
        mundo.avisosAsOutrasAbas.push(mensagem);
      }
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Favoritos — o `online` relê a lista da conta", () => {
  it("favorito novo de outro aparelho aparece depois de voltar a rede", async () => {
    await renderizar();
    await responderLeitura(0);
    expect(ids()).toEqual([]);

    mundo.linhas.add("conta-a|caneca"); // outro aparelho favoritou
    await voltarARede();

    expect(mundo.leituras).toHaveLength(2);
    await responderLeitura(1);
    expect(ids()).toEqual(["caneca"]);
  });

  it("favorito removido em outro aparelho some depois de voltar a rede", async () => {
    mundo.linhas.add("conta-a|caneca");
    mundo.linhas.add("conta-a|jarra");
    await renderizar();
    await responderLeitura(0);
    expect(ids()).toEqual(["caneca", "jarra"]);

    mundo.linhas.delete("conta-a|caneca"); // outro aparelho removeu
    await voltarARede();
    await responderLeitura(1);

    expect(ids()).toEqual(["jarra"]);
  });

  it("sem conta, voltar a rede não consulta nada", async () => {
    mundo.usuario = null;
    await renderizar();

    await voltarARede();

    expect(mundo.leituras).toHaveLength(0);
  });
});

describe("Favoritos — a volta do canal de tempo real relê a lista", () => {
  it("a primeira inscrição não relê; a reconexão relê, aplica e avisa as outras abas", async () => {
    mundo.lider = true;
    await renderizar();
    await responderLeitura(0);
    expect(mundo.assinaturas).toHaveLength(1);

    await canalAvisa("SUBSCRIBED"); // primeira inscrição: a lista já está em dia
    expect(mundo.leituras).toHaveLength(1);
    expect(mundo.avisosAsOutrasAbas).toEqual([]);

    // A conexão cai e volta; nesse intervalo o outro aparelho favoritou.
    await canalAvisa("CHANNEL_ERROR");
    mundo.linhas.add("conta-a|jarra");
    await canalAvisa("SUBSCRIBED");

    expect(mundo.leituras).toHaveLength(2);
    await responderLeitura(1);
    expect(ids()).toEqual(["jarra"]);
    expect(mundo.avisosAsOutrasAbas).toEqual([{ type: "favorites_update" }]);
  });

  it("aba que não é a líder não tem canal: só o `online` dela relê", async () => {
    mundo.lider = false;
    await renderizar();
    await responderLeitura(0);

    expect(mundo.assinaturas).toHaveLength(0);
    mundo.linhas.add("conta-a|jarra");
    await voltarARede();
    await responderLeitura(1);
    expect(ids()).toEqual(["jarra"]);
  });
});

describe("Favoritos — a releitura de reconexão respeita o que é local", () => {
  it("toque ainda em gravação não é pisado pela releitura (nem a leitura velha desfaz o toque)", async () => {
    await renderizar();
    await responderLeitura(0);

    await tocarCoracao(); // otimista: caneca marcada, gravação em voo
    expect(atual().isFavorite("caneca")).toBe(true);
    expect(mundo.gravacoes).toHaveLength(1);

    await voltarARede(); // a releitura parte ANTES de a gravação confirmar
    expect(mundo.leituras).toHaveLength(2);
    await responderLeitura(1); // retrato sem a caneca: não pode desfazer o toque
    expect(atual().isFavorite("caneca")).toBe(true);
    expect(ids()).toEqual(["caneca"]);

    await concluirGravacao(0); // o servidor confirma
    expect(mundo.leituras).toHaveLength(3); // UMA reconsulta, sem ciclo
    await responderLeitura(2);
    expect(atual().isFavorite("caneca")).toBe(true);
    expect(ids()).toEqual(["caneca"]);
    expect(mundo.leituras).toHaveLength(3);
  });

  it("fila de pendentes em disco: o `online` grava de novo e a releitura não a apaga antes da confirmação", async () => {
    localStorage.setItem(
      "ikcous_favorites_pendentes:conta-a",
      JSON.stringify([{ id: "caneca" }]),
    );
    await renderizar();
    await responderLeitura(0);
    await concluirGravacao(0, { message: "sem rede" }); // a drenagem do login falha
    expect(atual().pendingCount).toBe(1);

    await voltarARede(); // retentativa + releitura
    expect(mundo.gravacoes).toHaveLength(2);
    expect(mundo.leituras).toHaveLength(2); // a releitura de reconexão
    await responderLeitura(1);
    // A gravação ainda não confirmou: a fila continua no disco e na tela.
    expect(atual().pendingCount).toBe(1);
    expect(
      JSON.parse(localStorage.getItem("ikcous_favorites_pendentes:conta-a")!),
    ).toHaveLength(1);

    await concluirGravacao(1); // agora sim: o servidor tem a caneca
    // As releituras que a confirmação provoca chegam em ordem; só a mais nova vale.
    const total = mundo.leituras.length;
    expect(total).toBeGreaterThan(2);
    for (let i = 2; i < total; i++) await responderLeitura(i);
    expect(atual().pendingCount).toBe(0);
    expect(
      localStorage.getItem("ikcous_favorites_pendentes:conta-a"),
    ).toBeNull();
    expect(ids()).toEqual(["caneca"]);
  });
});

describe("Favoritos — sem leitura em loop", () => {
  it("online + reconexão do canal juntos custam UMA releitura; terminada, o próximo gatilho relê", async () => {
    mundo.lider = true;
    await renderizar();
    await responderLeitura(0);
    await canalAvisa("SUBSCRIBED");

    await voltarARede();
    await canalAvisa("CHANNEL_ERROR");
    await canalAvisa("SUBSCRIBED");
    await voltarARede();
    expect(mundo.leituras).toHaveLength(2); // uma só, as outras três coalesceram

    await responderLeitura(1);
    await voltarARede();
    expect(mundo.leituras).toHaveLength(3); // a trava soltou: relê de novo
    await responderLeitura(2);
    expect(mundo.leituras).toHaveLength(3); // e a resposta não gera nova leitura
  });

  it("releitura pendurada solta no prazo: depois dos 15 s o gatilho seguinte relê", async () => {
    vi.useFakeTimers();
    await renderizar();
    await responderLeitura(0);

    await voltarARede();
    expect(mundo.leituras).toHaveLength(2); // essa nunca responde
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999);
    });
    await voltarARede();
    expect(mundo.leituras).toHaveLength(2); // ainda em voo: não abre outra

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    mundo.linhas.add("conta-a|caneca");
    await voltarARede();
    expect(mundo.leituras).toHaveLength(3); // o prazo soltou a trava
    await responderLeitura(2);
    expect(ids()).toEqual(["caneca"]);
  });

  it("resposta velha da releitura de reconexão não desfaz uma leitura mais nova", async () => {
    mundo.linhas.add("conta-a|caneca");
    await renderizar();
    await responderLeitura(0);
    expect(ids()).toEqual(["caneca"]);

    await voltarARede(); // leitura 1: retrato AINDA com a caneca
    mundo.linhas.delete("conta-a|caneca"); // o outro aparelho removeu
    // A leitura mais nova parte pelo caminho da releitura manual (`refresh`),
    // que não tem a trava da reconexão.
    await act(async () => atual().refresh()); // leitura 2: retrato sem a caneca
    expect(mundo.leituras).toHaveLength(3);

    await responderLeitura(2);
    expect(ids()).toEqual([]);
    await responderLeitura(1); // a velha chega por último
    expect(ids()).toEqual([]);
    expect(mundo.leituras).toHaveLength(3);
  });
});
