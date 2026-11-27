// @vitest-environment jsdom
//
// Carrinho da conta usado em DOIS aparelhos com relógios diferentes (27/11/2026).
// A junção decidia "quem escreveu por último" comparando a hora do APARELHO, e
// a gravação mandava essa hora para o banco (`sync_cart_atomic` guarda o
// `updated_at` que o cliente envia). Com um aparelho adiantado:
//   - o celular 2 h adiantado põe 1 vestido; no computador ela muda para 2; de
//     volta ao celular continuava 1 (a linha do celular "parecia" mais nova) e
//     a próxima gravação dele devolvia o computador para 1;
//   - o computador adiantado tira o item X; ela põe X de novo pelo celular; o
//     computador ignorava (a lápide "parecia" mais nova) e, na próxima mudança
//     dele, X sumia do banco.
// A regra agora: nenhuma hora de aparelho decide nem vai ao banco. Linha que
// este aparelho não mexeu desde a última conversa com o banco segue o banco;
// linha mexida aqui e ainda não gravada segue a daqui; lápide só esconde a
// linha do banco enquanto a remoção não foi gravada.
//
// O cenário é de verdade: dois CartProvider montados ao mesmo tempo, cada um
// com o próprio armazenamento e o próprio relógio, um banco falso que APAGA e
// REGRAVA o carrinho inteiro como o real (com `updated_at` = o que o cliente
// mandou, senão a hora do servidor) e o eco ao vivo de cada gravação para os
// dois aparelhos -- inclusive para quem gravou, chegando ANTES da resposta da
// gravação. Os aparelhos agem em turnos: o eco para o outro aparelho chega no
// começo da vez dele (a entrega ao vivo é assíncrona; mais tarde é uma ordem
// possível) e, na troca de vez, nada pode estar em voo (`getTimerCount`), senão
// um aparelho leria o armazenamento do outro.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { mapProductFromDB } from "@/lib/mappers";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comPaginacao } from "./duble-consulta-paginada";

type Linha = {
  user_id: string;
  product_id: string;
  variant_id: string;
  quantity: number;
  variant_names: string | null;
  updated_at: string;
};
type Inscrito = {
  aparelho: string;
  aoMudar: (payload: unknown) => void;
  fila: unknown[];
  ativo: boolean;
};

const DUAS_HORAS = 2 * 60 * 60 * 1000;

const mundo = vi.hoisted(() => ({
  linhas: [] as Linha[],
  atual: "celular",
  desvio: new Map<string, number>(),
  inscritos: [] as Inscrito[],
  gravacoes: [] as {
    aparelho: string;
    enviados: Record<string, unknown>[];
    antes: Linha[];
    agoraNoServidor: number;
  }[],
  // Atraso da leitura do carrinho (o retrato é o de quando ela COMEÇOU).
  atrasoDaLeitura: 0,
  // O canal ao vivo caiu: o eco das gravações não chega a ninguém.
  canalCaido: false,
  // A gravação não chega ao banco (rede caiu no meio): nada é gravado.
  gravacaoFalha: false,
  // Quantas próximas consultas de sessão respondem "sem sessão" (o cliente do
  // Supabase ainda não restaurou a sessão).
  semSessao: 0,
  // Atraso da consulta de sessão (a gravação espera por ela antes de montar
  // o que envia).
  atrasoDaSessao: 0,
  // Quantas gravações ainda chegam ao banco antes de a rede cair (null = a
  // rede não cai).
  gravacoesAntesDeCair: null as number | null,
}));

// A hora do servidor: a do relógio falso menos o desvio do aparelho da vez.
function agoraNoServidor() {
  return Date.now() - (mundo.desvio.get(mundo.atual) ?? 0);
}
function publicar(eventos: unknown[]) {
  if (mundo.canalCaido) return;
  for (const inscrito of mundo.inscritos) {
    if (!inscrito.ativo) continue;
    if (inscrito.aparelho === mundo.atual) {
      setTimeout(() => {
        if (!inscrito.ativo) return;
        for (const e of eventos) inscrito.aoMudar(e);
      }, 10);
    } else {
      inscrito.fila.push(...eventos);
    }
  }
}

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
const usuario = { id: "u1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario, loading: false }),
}));
// Cada aparelho tem a SUA aba líder (assina o canal ao vivo).
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
const produtos = [
  { id: "vestido", nome: "Vestido", preco_venda: 100, estoque: 20 },
  { id: "bolsa", nome: "Bolsa", preco_venda: 80, estoque: 20 },
  { id: "brinco", nome: "Brinco", preco_venda: 30, estoque: 20 },
  { id: "cinto", nome: "Cinto", preco_venda: 40, estoque: 20 },
].map((p) => ({ ...p, ativo: true, imagens: [] }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => {
          const retrato = {
            data: mundo.linhas.map((l) => ({ ...l })),
            error: null,
          };
          if (mundo.atrasoDaLeitura === 0) return Promise.resolve(retrato);
          return new Promise((resolve) =>
            setTimeout(() => resolve(retrato), mundo.atrasoDaLeitura),
          );
        },
        in: comPaginacao(async (_coluna: string, ids: string[]) =>
          tabela === "product_variants"
            ? { data: [], error: null }
            : {
                data: produtos.filter((p) => ids.includes(p.id)),
                error: null,
              },
        ),
      }),
    }),
    auth: {
      getSession: async () => {
        if (mundo.atrasoDaSessao > 0) {
          await new Promise((r) => setTimeout(r, mundo.atrasoDaSessao));
        }
        if (mundo.semSessao > 0) {
          mundo.semSessao -= 1;
          return { data: { session: null } };
        }
        return { data: { session: { user: usuario } } };
      },
    },
    // O `sync_cart_atomic` de verdade: DELETE de tudo da conta e INSERT do que
    // veio, agrupado por produto+variação, com `updated_at` =
    // COALESCE(MAX(o que o cliente mandou), NOW()). O commit sai antes da
    // resposta; o eco ao vivo também.
    rpc: async (
      nome: string,
      args: { p_cart_items: Record<string, any>[] },
    ) => {
      if (nome !== "sync_cart_atomic") return { data: null, error: null };
      if (mundo.gravacaoFalha) return { error: { message: "sem rede" } };
      if (mundo.gravacoesAntesDeCair !== null) {
        if (mundo.gravacoesAntesDeCair === 0) {
          return { error: { message: "sem rede" } };
        }
        mundo.gravacoesAntesDeCair -= 1;
      }
      const agora = agoraNoServidor();
      const antes = mundo.linhas;
      mundo.gravacoes.push({
        aparelho: mundo.atual,
        enviados: args.p_cart_items.map((i) => ({ ...i })),
        antes: antes.map((l) => ({ ...l })),
        agoraNoServidor: agora,
      });
      const grupos = new Map<string, { linha: Linha; carimbos: number[] }>();
      for (const item of args.p_cart_items) {
        const variante = item.variant_id ?? "";
        const chave = `${item.product_id}|${variante}`;
        const grupo: { linha: Linha; carimbos: number[] } = grupos.get(
          chave,
        ) ?? {
          linha: {
            user_id: usuario.id,
            product_id: item.product_id,
            variant_id: variante,
            quantity: 0,
            variant_names: null,
            updated_at: "",
          },
          carimbos: [],
        };
        grupo.linha.quantity += Number(item.quantity);
        if (item.updated_at) grupo.carimbos.push(Date.parse(item.updated_at));
        if (item.variant_names) grupo.linha.variant_names = item.variant_names;
        grupos.set(chave, grupo);
      }
      mundo.linhas = [...grupos.values()].map(({ linha, carimbos }) => ({
        ...linha,
        updated_at: new Date(
          carimbos.length > 0 ? Math.max(...carimbos) : agora,
        ).toISOString(),
      }));
      publicar([
        ...antes.map(() => ({ eventType: "DELETE" })),
        ...mundo.linhas.map(() => ({ eventType: "INSERT" })),
      ]);
      await new Promise((r) => setTimeout(r, 20));
      return { error: null };
    },
    channel: () => {
      const inscrito: Inscrito = {
        aparelho: mundo.atual,
        aoMudar: () => {},
        fila: [],
        ativo: true,
      };
      const canal = {
        on: (_t: unknown, _f: unknown, aoMudar: Inscrito["aoMudar"]) => {
          inscrito.aoMudar = aoMudar;
          return canal;
        },
        subscribe: () => {
          mundo.inscritos.push(inscrito);
          return canal;
        },
        inscrito,
      };
      return canal;
    },
    removeChannel: async (canal: { inscrito?: Inscrito }) => {
      if (canal?.inscrito) canal.inscrito.ativo = false;
    },
  },
}));
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Armazenamento de cada aparelho (o navegador de um não vê o do outro).
class Memoria implements Storage {
  private dados = new Map<string, string>();
  get length() {
    return this.dados.size;
  }
  clear() {
    this.dados.clear();
  }
  getItem(chave: string) {
    return this.dados.get(chave) ?? null;
  }
  key(i: number) {
    return [...this.dados.keys()].at(i) ?? null;
  }
  removeItem(chave: string) {
    this.dados.delete(chave);
  }
  setItem(chave: string, valor: string) {
    this.dados.set(chave, String(valor));
  }
}
const armazens = new Map<string, { local: Memoria; sessao: Memoria }>();
function armazemDo(aparelho: string) {
  let armazem = armazens.get(aparelho);
  if (!armazem) {
    armazem = { local: new Memoria(), sessao: new Memoria() };
    armazens.set(aparelho, armazem);
  }
  return armazem;
}
function doAparelho(qual: "local" | "sessao"): Storage {
  const alvo = () => {
    const armazem = armazemDo(mundo.atual);
    return qual === "local" ? armazem.local : armazem.sessao;
  };
  return {
    get length() {
      return alvo().length;
    },
    clear: () => alvo().clear(),
    getItem: (c: string) => alvo().getItem(c),
    key: (i: number) => alvo().key(i),
    removeItem: (c: string) => alvo().removeItem(c),
    setItem: (c: string, v: string) => alvo().setItem(c, v),
  };
}

const contextos = new Map<string, ReturnType<typeof useCartContext>>();
function Sonda({ nome }: { nome: string }) {
  const contexto = useCartContext();
  useEffect(() => {
    contextos.set(nome, contexto);
  }, [contexto, nome]);
  return null;
}
const raizes: { raiz: Root; hospedeiro: HTMLDivElement }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-27T12:00:00Z"));
  mundo.linhas = [];
  mundo.atual = "celular";
  mundo.desvio = new Map();
  mundo.inscritos = [];
  mundo.gravacoes = [];
  mundo.atrasoDaLeitura = 0;
  mundo.canalCaido = false;
  mundo.gravacaoFalha = false;
  mundo.semSessao = 0;
  mundo.atrasoDaSessao = 0;
  mundo.gravacoesAntesDeCair = null;
  armazens.clear();
  contextos.clear();
  vi.stubGlobal("localStorage", doAparelho("local"));
  vi.stubGlobal("sessionStorage", doAparelho("sessao"));
  // Aparelhos diferentes não conversam pelo canal entre abas.
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      close() {}
    },
  );
});
afterEach(() => {
  for (const { raiz, hospedeiro } of raizes.splice(0)) {
    act(() => raiz.unmount());
    hospedeiro.remove();
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Passa a vez para outro aparelho: o relógio pula para a hora DELE (a do
// servidor mais o desvio dele) e chega o eco que ele perdeu enquanto o outro
// agia.
async function vez(aparelho: string, servidor = agoraNoServidor()) {
  expect(vi.getTimerCount()).toBe(0);
  mundo.atual = aparelho;
  vi.setSystemTime(servidor + (mundo.desvio.get(aparelho) ?? 0));
  await act(async () => {
    for (const inscrito of mundo.inscritos) {
      if (inscrito.aparelho !== aparelho || !inscrito.ativo) continue;
      for (const e of inscrito.fila.splice(0)) inscrito.aoMudar(e);
    }
    await vi.advanceTimersByTimeAsync(50);
  });
  await assentar();
}
// Deixa o aparelho da vez terminar tudo o que começou (gravação de 1 s depois
// do toque, eco, releitura e a gravação que ela puder pedir).
async function assentar() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  for (let i = 0; i < 30 && vi.getTimerCount() > 0; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
}
async function ligar(aparelho: string, desvio: number) {
  const servidor = agoraNoServidor();
  mundo.desvio.set(aparelho, desvio);
  await vez(aparelho, servidor);
  const hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  const raiz = createRoot(hospedeiro);
  raizes.push({ raiz, hospedeiro });
  await act(async () =>
    raiz.render(
      <CartProvider>
        <Sonda nome={aparelho} />
      </CartProvider>,
    ),
  );
  // Passa a trava de segurança de 8 s do carregamento (um relógio que não
  // pode disparar na vez do outro aparelho).
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9000);
  });
  await assentar();
}
async function noAparelho(
  aparelho: string,
  fazer: (c: ReturnType<typeof useCartContext>) => void,
) {
  expect(mundo.atual).toBe(aparelho);
  await act(async () => fazer(contextoDo(aparelho)));
  await assentar();
}

function contextoDo(aparelho: string) {
  const contexto = contextos.get(aparelho);
  if (!contexto) throw new Error(`aparelho ${aparelho} não montado`);
  return contexto;
}
const produto = (id: string) =>
  mapProductFromDB({
    ...produtos.find((p) => p.id === id),
    product_variants: [],
  });
const carrinhoDo = (aparelho: string) =>
  contextoDo(aparelho).cart.map((i) => [i.product.id, i.quantity]);
const LAPIDES_DA_CONTA = "marketplace_cart_account_tombstones_v1";
const lapidesDo = (aparelho: string) => {
  const texto = armazens.get(aparelho)?.local.getItem(LAPIDES_DA_CONTA);
  return texto ? (JSON.parse(texto).marcas as Record<string, unknown>[]) : [];
};
const banco = () =>
  mundo.linhas
    .map((l) => [l.product_id, l.quantity] as [string, number])
    .sort((a, b) => a[0].localeCompare(b[0]));

describe("carrinho em dois aparelhos com relógios diferentes", () => {
  it("celular 2 h adiantado: a quantidade mudada no computador chega ao celular e não volta", async () => {
    await ligar("celular", DUAS_HORAS);
    await noAparelho("celular", (c) => c.addToCart(produto("vestido"), 1));
    expect(banco()).toEqual([["vestido", 1]]);

    await ligar("computador", 0);
    expect(carrinhoDo("computador")).toEqual([["vestido", 1]]);
    await noAparelho("computador", (c) => c.updateQuantity("vestido", 2));
    expect(banco()).toEqual([["vestido", 2]]);

    await vez("celular");
    expect(carrinhoDo("celular")).toEqual([["vestido", 2]]);

    // Ela mexe em outra coisa no celular: a gravação "substitui tudo" leva o 2.
    await noAparelho("celular", (c) => c.addToCart(produto("bolsa"), 1));
    expect(banco()).toEqual([
      ["bolsa", 1],
      ["vestido", 2],
    ]);

    await vez("computador");
    expect(carrinhoDo("computador")).toEqual([
      ["vestido", 2],
      ["bolsa", 1],
    ]);
  });

  it("computador 2 h adiantado tira um item; ela o põe de novo pelo celular; ele fica nos dois e no banco", async () => {
    await ligar("computador", DUAS_HORAS);
    await noAparelho("computador", (c) => c.addToCart(produto("brinco"), 1));
    await ligar("celular", 0);
    expect(carrinhoDo("celular")).toEqual([["brinco", 1]]);

    await vez("computador");
    await noAparelho("computador", (c) => c.removeFromCart("brinco"));
    expect(banco()).toEqual([]);

    await vez("celular");
    expect(carrinhoDo("celular")).toEqual([]);
    await noAparelho("celular", (c) => c.addToCart(produto("brinco"), 1));
    expect(banco()).toEqual([["brinco", 1]]);

    await vez("computador");
    expect(carrinhoDo("computador")).toEqual([["brinco", 1]]);

    // A próxima mudança no computador não apaga o brinco do banco.
    await noAparelho("computador", (c) => c.addToCart(produto("cinto"), 1));
    expect(banco()).toEqual([
      ["brinco", 1],
      ["cinto", 1],
    ]);
    await vez("celular");
    expect(carrinhoDo("celular")).toEqual([
      ["brinco", 1],
      ["cinto", 1],
    ]);
  });

  it("nenhuma hora de aparelho vai ao banco: só volta o carimbo que o próprio banco deu", async () => {
    await ligar("celular", DUAS_HORAS);
    await noAparelho("celular", (c) => c.addToCart(produto("vestido"), 1));
    await noAparelho("celular", (c) => c.addToCart(produto("bolsa"), 1));
    await ligar("computador", -DUAS_HORAS);
    await noAparelho("computador", (c) => c.updateQuantity("bolsa", 3));
    await vez("celular");
    await noAparelho("celular", (c) => c.addToCart(produto("brinco"), 1));

    expect(mundo.gravacoes.length).toBeGreaterThanOrEqual(4);
    for (const g of mundo.gravacoes) {
      const carimbosDoBanco = new Set(g.antes.map((l) => l.updated_at));
      for (const enviado of g.enviados) {
        if (enviado.updated_at === undefined) continue;
        expect(carimbosDoBanco).toContain(enviado.updated_at);
      }
    }
    // E o banco nunca guarda hora do futuro.
    const agora = agoraNoServidor();
    for (const l of mundo.linhas) {
      expect(Date.parse(l.updated_at)).toBeLessThanOrEqual(agora);
    }
    expect(banco()).toEqual([
      ["bolsa", 3],
      ["brinco", 1],
      ["vestido", 1],
    ]);
  });

  it("linha que o banco não mudou leva o carimbo dele de volta (o aparelho antigo não a vê como edição nova)", async () => {
    await ligar("celular", 0);
    await noAparelho("celular", (c) => c.addToCart(produto("vestido"), 1));
    const carimboDoVestido = mundo.linhas[0]?.updated_at;
    vi.advanceTimersByTime(60_000);
    await noAparelho("celular", (c) => c.addToCart(produto("bolsa"), 1));

    const vestido = mundo.linhas.find((l) => l.product_id === "vestido");
    const bolsa = mundo.linhas.find((l) => l.product_id === "bolsa");
    expect(vestido?.updated_at).toBe(carimboDoVestido);
    expect(Date.parse(bolsa?.updated_at ?? "")).toBeGreaterThan(
      Date.parse(carimboDoVestido ?? ""),
    );
  });

  it("leitura que saiu ANTES da gravação e voltou DEPOIS não desfaz a quantidade gravada", async () => {
    await ligar("computador", 0);
    await noAparelho("computador", (c) => c.addToCart(produto("vestido"), 1));
    expect(banco()).toEqual([["vestido", 1]]);

    // A cliente muda para 2; logo antes da gravação (1 s depois do toque) sai
    // uma releitura lenta (a rede voltou) que traz o retrato de ANTES (vestido
    // 1) e só volta depois que a gravação do 2 já terminou. Com o canal caído
    // o eco da gravação não chega, e nenhuma leitura mais nova a supera.
    mundo.atrasoDaLeitura = 60;
    mundo.canalCaido = true;
    await act(async () =>
      contextoDo("computador").updateQuantity("vestido", 2),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(990);
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(100);
    });
    mundo.atrasoDaLeitura = 0;
    await assentar();

    expect(mundo.gravacoes.at(-1)?.enviados).toMatchObject([
      { product_id: "vestido", quantity: 2 },
    ]);
    expect(carrinhoDo("computador")).toEqual([["vestido", 2]]);
    expect(banco()).toEqual([["vestido", 2]]);
  });
  it("gravação que falhou não confirma a remoção: a linha que o banco ainda tem continua escondida", async () => {
    await ligar("computador", DUAS_HORAS);
    await noAparelho("computador", (c) => c.addToCart(produto("brinco"), 1));
    await noAparelho("computador", (c) => c.addToCart(produto("cinto"), 1));

    mundo.gravacaoFalha = true;
    await noAparelho("computador", (c) => c.removeFromCart("brinco"));
    expect(lapidesDo("computador")).toEqual([
      expect.objectContaining({ key: "brinco-", confirmada: false }),
    ]);
    // O banco segue com o brinco; uma releitura (a rede voltou) não o devolve.
    expect(banco()).toEqual([
      ["brinco", 1],
      ["cinto", 1],
    ]);
    mundo.gravacaoFalha = false;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await assentar();

    expect(carrinhoDo("computador")).toEqual([["cinto", 1]]);
    expect(banco()).toEqual([["cinto", 1]]);
    expect(lapidesDo("computador")).toEqual([
      expect.objectContaining({ key: "brinco-", confirmada: true }),
    ]);
  });

  it("lápide de antes da atualização (sem o campo novo) é confirmada pela próxima gravação e não barra o item posto de novo", async () => {
    // O computador (2 h adiantado) já tinha, da versão antiga do app, a lápide
    // do brinco gravada com a hora dele: mais nova que qualquer hora do banco.
    const servidor = agoraNoServidor();
    armazemDo("computador").local.setItem(
      LAPIDES_DA_CONTA,
      JSON.stringify({
        uid: "u1",
        marcas: [{ key: "brinco-", deletedAt: servidor + DUAS_HORAS - 60_000 }],
      }),
    );
    await ligar("computador", DUAS_HORAS);
    await noAparelho("computador", (c) => c.addToCart(produto("cinto"), 1));
    expect(lapidesDo("computador")).toEqual([
      expect.objectContaining({ key: "brinco-", confirmada: true }),
    ]);

    await ligar("celular", 0);
    await noAparelho("celular", (c) => c.addToCart(produto("brinco"), 1));
    await vez("computador");

    expect(carrinhoDo("computador")).toEqual([
      ["cinto", 1],
      ["brinco", 1],
    ]);
    expect(lapidesDo("computador")).toEqual([]);
  });
  // Revisão Opus (27/11/2026, 5766a7e4b): a lápide da conta nasce pendente e só
  // a gravação a confirmava. Três caminhos deixavam a lápide pendente sem prazo,
  // e a lápide pendente escondia o item que o OUTRO aparelho pôs depois -- a
  // próxima gravação "substitui tudo" o apagava do banco.
  it("pôr e tirar antes da gravação de 1 s não deixa lápide pendente que apaga o item posto no outro aparelho", async () => {
    await ligar("computador", 0);
    await noAparelho("computador", (c) => c.addToCart(produto("cinto"), 1));
    expect(banco()).toEqual([["cinto", 1]]);
    // O carrinho volta a ser o que o banco já tem: nada a gravar, mas a
    // remoção tem de valer como gravada (o banco nunca teve o brinco daqui).
    await noAparelho("computador", (c) => {
      c.addToCart(produto("brinco"), 1);
      c.removeFromCart("brinco");
    });

    await ligar("celular", 0);
    await noAparelho("celular", (c) => c.addToCart(produto("brinco"), 1));
    expect(banco()).toEqual([
      ["brinco", 1],
      ["cinto", 1],
    ]);

    await vez("computador");
    expect(carrinhoDo("computador")).toEqual([
      ["cinto", 1],
      ["brinco", 1],
    ]);
    await noAparelho("computador", (c) => c.addToCart(produto("vestido"), 1));
    expect(banco()).toEqual([
      ["brinco", 1],
      ["cinto", 1],
      ["vestido", 1],
    ]);
  });

  it("gravação pulada por sessão ainda não pronta tenta de novo e confirma a remoção", async () => {
    await ligar("computador", 0);
    await noAparelho("computador", (c) => c.addToCart(produto("brinco"), 1));
    await noAparelho("computador", (c) => c.addToCart(produto("cinto"), 1));

    mundo.semSessao = 1;
    await noAparelho("computador", (c) => c.removeFromCart("brinco"));
    expect(banco()).toEqual([["cinto", 1]]);
    expect(lapidesDo("computador")).toEqual([
      expect.objectContaining({ key: "brinco-", confirmada: true }),
    ]);

    await ligar("celular", 0);
    await noAparelho("celular", (c) => c.addToCart(produto("brinco"), 1));
    await vez("computador");
    await noAparelho("computador", (c) => c.addToCart(produto("vestido"), 1));
    expect(banco()).toEqual([
      ["brinco", 1],
      ["cinto", 1],
      ["vestido", 1],
    ]);
  });

  it("gravação que falha até esgotar as tentativas: a remoção fica pendente e vale quando a rede volta", async () => {
    await ligar("computador", 0);
    await noAparelho("computador", (c) => c.addToCart(produto("brinco"), 1));
    await noAparelho("computador", (c) => c.addToCart(produto("cinto"), 1));

    mundo.gravacaoFalha = true;
    await noAparelho("computador", (c) => c.removeFromCart("brinco"));
    // Passa toda a escada de esperas (5 reenvios, até 30 s cada) até não
    // sobrar nenhum relógio: a escada tem fim (não vira laço).
    for (let i = 0; i < 20 && vi.getTimerCount() > 0; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
    }
    expect(vi.getTimerCount()).toBe(0);
    // Só as duas gravações de antes da queda chegaram ao banco.
    expect(mundo.gravacoes).toHaveLength(2);
    expect(banco()).toEqual([
      ["brinco", 1],
      ["cinto", 1],
    ]);
    expect(lapidesDo("computador")).toEqual([
      expect.objectContaining({ key: "brinco-", confirmada: false }),
    ]);

    // A rede volta: a gravação que ficou devendo sai e confirma a remoção.
    mundo.gravacaoFalha = false;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await assentar();
    expect(banco()).toEqual([["cinto", 1]]);
    expect(lapidesDo("computador")).toEqual([
      expect.objectContaining({ key: "brinco-", confirmada: true }),
    ]);

    await ligar("celular", 0);
    await noAparelho("celular", (c) => c.addToCart(produto("brinco"), 1));
    await vez("computador");
    await noAparelho("computador", (c) => c.addToCart(produto("vestido"), 1));
    expect(banco()).toEqual([
      ["brinco", 1],
      ["cinto", 1],
      ["vestido", 1],
    ]);
  });

  // Caça de mutação (27/11/2026): os quatro testes abaixo pegam trechos da
  // regra das lápides e do carimbo que nenhum teste vigiava.
  it("leitura que saiu ANTES da gravação da remoção e voltou DEPOIS não devolve o item tirado", async () => {
    await ligar("computador", 0);
    await noAparelho("computador", (c) => c.addToCart(produto("bolsa"), 1));
    await noAparelho("computador", (c) => c.addToCart(produto("vestido"), 1));
    expect(banco()).toEqual([
      ["bolsa", 1],
      ["vestido", 1],
    ]);

    // A cliente tira o vestido; logo antes da gravação sai uma releitura
    // lenta com o retrato de ANTES (vestido ainda no banco), que só volta
    // depois que a gravação já confirmou a remoção. A lápide confirmada no
    // meio da leitura não vale como "posto de novo": a foto é a do início.
    mundo.atrasoDaLeitura = 60;
    mundo.canalCaido = true;
    await act(async () => contextoDo("computador").removeFromCart("vestido"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(990);
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(100);
    });
    mundo.atrasoDaLeitura = 0;
    await assentar();

    expect(carrinhoDo("computador")).toEqual([["bolsa", 1]]);
    expect(banco()).toEqual([["bolsa", 1]]);
  });

  it("item tirado enquanto a gravação espera a sessão: a gravação que ainda levou a linha não confirma a remoção", async () => {
    await ligar("computador", 0);
    await noAparelho("computador", (c) => c.addToCart(produto("brinco"), 1));
    await noAparelho("computador", (c) => c.addToCart(produto("cinto"), 1));

    // A gravação do vestido sai 1 s depois do toque e espera a sessão; nesse
    // meio a cliente tira o brinco. A gravação monta o envio com o carrinho
    // de quando saiu (com o brinco) e a lápide já nascida. A gravação
    // seguinte, a que tira o brinco, não chega ao banco.
    mundo.atrasoDaSessao = 500;
    mundo.gravacoesAntesDeCair = 1;
    await act(async () =>
      contextoDo("computador").addToCart(produto("vestido"), 1),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    await act(async () => contextoDo("computador").removeFromCart("brinco"));
    await assentar();

    expect(mundo.gravacoes.at(-1)?.enviados).toContainEqual(
      expect.objectContaining({ product_id: "brinco" }),
    );
    expect(banco()).toEqual([
      ["brinco", 1],
      ["cinto", 1],
      ["vestido", 1],
    ]);
    expect(lapidesDo("computador")).toEqual([
      expect.objectContaining({ key: "brinco-", confirmada: false }),
    ]);

    // O brinco que o banco ainda tem segue escondido numa releitura.
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await assentar();
    expect(carrinhoDo("computador")).toEqual([
      ["cinto", 1],
      ["vestido", 1],
    ]);
  });

  it("lápide trocada por outra durante a gravação não é confirmada por uma gravação que não a levou", async () => {
    await ligar("computador", 0);
    await noAparelho("computador", (c) => c.addToCart(produto("brinco"), 1));
    await noAparelho("computador", (c) => c.addToCart(produto("cinto"), 1));

    mundo.gravacoesAntesDeCair = 1;
    await act(async () => contextoDo("computador").removeFromCart("brinco"));
    // A gravação da remoção sai 1 s depois e espera a resposta do banco.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1005);
    });
    expect(mundo.gravacoes.at(-1)?.enviados).toEqual([
      expect.objectContaining({ product_id: "cinto" }),
    ]);
    const lapideEnviada = lapidesDo("computador")[0]?.deletedAt;
    // Nesse meio ela põe o brinco e tira de novo: nasce outra lápide, que
    // esta gravação não levou.
    await act(async () => {
      contextoDo("computador").addToCart(produto("brinco"), 1);
      contextoDo("computador").removeFromCart("brinco");
    });
    await assentar();

    const [lapide] = lapidesDo("computador");
    expect(lapide).toMatchObject({ key: "brinco-", confirmada: false });
    expect(lapide?.deletedAt).not.toBe(lapideEnviada);
  });

  it("linha cuja quantidade mudou não devolve o carimbo velho do banco", async () => {
    await ligar("celular", 0);
    await noAparelho("celular", (c) => c.addToCart(produto("vestido"), 1));
    const carimboVelho = mundo.linhas[0]?.updated_at ?? "";
    vi.advanceTimersByTime(60_000);
    await noAparelho("celular", (c) => c.updateQuantity("vestido", 2));

    const enviado = mundo.gravacoes.at(-1)?.enviados[0];
    expect(enviado).toMatchObject({ product_id: "vestido", quantity: 2 });
    expect(enviado?.updated_at).toBeUndefined();
    expect(Date.parse(mundo.linhas[0]?.updated_at ?? "")).toBeGreaterThan(
      Date.parse(carimboVelho),
    );
  });
});
