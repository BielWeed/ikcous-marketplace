// @vitest-environment jsdom
// Loja com mais de 200 produtos: a leitura do catálogo antes parava nos 200
// mais novos (`.limit(200)`) e os mais antigos sumiam da vitrine e da busca
// sem aviso. Agora lê página por página e só entrega o catálogo quando TODAS
// as páginas chegaram -- falha no meio não vira catálogo "completo" no
// cofre offline nem tira da tela o que já estava lá.
//
// As páginas são lidas por CHAVE (27/11/2026): cada uma pede só o que vem
// DEPOIS do último (data_cadastro, id) lido. Por posição (`.range()`), um
// produto pausado/excluído no meio da leitura fazia a lista subir uma casa e
// o produto da fronteira (posição 200, 400...) nunca era lido.
//
// O dublê do Supabase faz o que o servidor faz: ordena pelas `.order()`
// pedidas (data_cadastro com MICROSSEGUNDOS e fuso, como o Postgres compara),
// aplica o filtro de chave do `.or()` e corta no `.limit()` (ou `.range()`).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, useStore } from "@/contexts/StoreContext";
import type { Product } from "@/types";

type Linha = Record<string, unknown>;
type Pedido = {
  tabela: string;
  /** Posição desta consulta entre as consultas de produtos (0, 1, 2...). */
  numero: number;
  de?: number;
  ate?: number;
  limite?: number;
  /** Texto cru passado ao `.or()` (o filtro por chave). */
  filtro?: string;
  /** Chave lida do filtro: (data_cadastro, id) do último produto já lido. */
  depoisDe?: { dataCadastro: string; id: string };
  ordens: string[];
  /** Ids devolvidos ao app por esta consulta. */
  devolvidos?: string[];
};

const controle = vi.hoisted(() => ({
  admin: false,
  loading: false,
  /** Linhas da view (o dublê ordena como o servidor antes de devolver). */
  linhas: [] as Record<string, unknown>[],
  /** Consultas de produtos (pelo número: 0 = a 1ª) que falham na rede. */
  paginasQueFalham: new Set<number>(),
  /** Roda quando uma página é atendida (para simular cadastro no meio). */
  aoAtender: null as null | ((pedido: unknown) => void),
  /** Mexe nas linhas já escolhidas antes de devolvê-las (resposta estranha). */
  aoResponder: null as
    | null
    | ((linhas: Record<string, unknown>[]) => Record<string, unknown>[]),
  pedidos: [] as unknown[],
  produtosNoCofre: [] as unknown[],
  replaceAll: vi.fn(),
  setLastSync: vi.fn().mockResolvedValue(undefined),
}));

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
      getAll: vi.fn(async () => controle.produtosNoCofre),
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

/**
 * `timestamptz` como o Postgres compara: microssegundos desde a época, com
 * fuso. Um cursor reformatado por `Date` (milissegundos) não é o mesmo
 * instante que o banco devolveu e cai em outro lugar da ordem.
 */
function microssegundos(valor: unknown): bigint {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:(Z)|([+-])(\d{2}):?(\d{2})?)$/.exec(
      String(valor),
    );
  if (!m) throw new Error(`data_cadastro inválida no dublê: ${String(valor)}`);
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const fracao = BigInt((m[7] ?? "").padEnd(6, "0"));
  const fusoMin = m[8]
    ? 0
    : (m[9] === "-" ? -1 : 1) * (Number(m[10]) * 60 + Number(m[11] ?? 0));
  return (BigInt(ms) - BigInt(fusoMin) * 60_000n) * 1000n + fracao;
}

/** Ordem do servidor: data_cadastro mais nova primeiro, desempate por id. */
function naOrdemDoServidor(linhas: Linha[]): Linha[] {
  return [...linhas].sort((a, b) => {
    const da = microssegundos(a.data_cadastro);
    const db = microssegundos(b.data_cadastro);
    if (da !== db) return da > db ? -1 : 1;
    return String(a.id) < String(b.id)
      ? -1
      : String(a.id) > String(b.id)
        ? 1
        : 0;
  });
}

const desaspar = (v: string) => v.replace(/\\(.)/g, "$1");

/**
 * Lê o filtro por chave que o PostgREST receberia no `or=(...)`:
 * `data_cadastro.lt."X",and(data_cadastro.eq."X",id.gt."Y")`. Qualquer outra
 * forma é recusada como o servidor recusaria um filtro que não entende.
 */
function lerFiltroDeChave(
  filtro: string,
): { dataCadastro: string; id: string } | null {
  const m =
    /^data_cadastro\.lt\."((?:[^"\\]|\\.)*)",and\(data_cadastro\.eq\."((?:[^"\\]|\\.)*)",id\.gt\."((?:[^"\\]|\\.)*)"\)$/.exec(
      filtro,
    );
  if (!m || m[1] !== m[2]) return null;
  return { dataCadastro: desaspar(m[1]), id: desaspar(m[3]) };
}

function atender(pedido: Pedido) {
  controle.pedidos.push(pedido);
  controle.aoAtender?.(pedido);
  if (controle.paginasQueFalham.has(pedido.numero)) {
    return { data: null, error: { message: "rede caiu" } };
  }
  let linhas = naOrdemDoServidor(controle.linhas);
  if (pedido.filtro !== undefined) {
    const chave = lerFiltroDeChave(pedido.filtro);
    if (!chave) {
      return {
        data: null,
        error: { message: `filtro não entendido: ${pedido.filtro}` },
      };
    }
    pedido.depoisDe = chave;
    const instante = microssegundos(chave.dataCadastro);
    linhas = linhas.filter((l) => {
      const d = microssegundos(l.data_cadastro);
      return d < instante || (d === instante && String(l.id) > chave.id);
    });
  }
  if (pedido.de !== undefined && pedido.ate !== undefined) {
    linhas = linhas.slice(pedido.de, pedido.ate + 1);
  } else if (pedido.limite !== undefined) {
    linhas = linhas.slice(0, pedido.limite);
  }
  if (controle.aoResponder) linhas = controle.aoResponder(linhas);
  pedido.devolvidos = linhas.map((l) => String(l.id));
  return { data: linhas, error: null };
}

let consultasDeProdutos = 0;

/** Consulta da view de produtos: encadeável, atendida só no `await`. */
function consultaDeProdutos(tabela: string): any {
  const pedido: Pedido = { tabela, numero: consultasDeProdutos++, ordens: [] };
  const consulta: any = {
    select: () => consulta,
    is: () => consulta,
    or: (filtro: string) => {
      pedido.filtro = filtro;
      return consulta;
    },
    order: (coluna: string) => {
      pedido.ordens.push(coluna);
      return consulta;
    },
    limit: (n: number) => {
      pedido.limite = n;
      return consulta;
    },
    range: (de: number, ate: number) => {
      pedido.de = de;
      pedido.ate = ate;
      return consulta;
    },
    // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase.
    then: (resolve: (v: unknown) => void, rejeitar: (e: unknown) => void) =>
      Promise.resolve(atender(pedido)).then(resolve, rejeitar),
  };
  return consulta;
}

function construtorVazio(): any {
  const alvo: any = () => construtorVazio();
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) =>
          Promise.resolve({ data: null, error: null }).then(resolve);
      }
      return () => construtorVazio();
    },
    apply() {
      return construtorVazio();
    },
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) =>
      tabela === "vw_produtos_public" || tabela === "vw_produtos_admin"
        ? consultaDeProdutos(tabela)
        : construtorVazio(),
    rpc: () => construtorVazio(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TAMANHO_DA_PAGINA = 200;

/** Linha da view, na ordem do servidor: i = 0 é o produto mais novo. */
function linhaDaView(i: number): Linha {
  return {
    id: `p${i}`,
    nome: `Produto ${i}`,
    preco_venda: 10,
    descricao: "",
    estoque: 5,
    ativo: true,
    categoria: "Geral",
    imagem_urls: [],
    data_cadastro: new Date(Date.UTC(2026, 0, 1) - i * 60_000).toISOString(),
    product_variants: [],
  };
}

function criarLinhas(quantas: number): Linha[] {
  return Array.from({ length: quantas }, (_, i) => linhaDaView(i));
}

function produtoDoCofre(id: string): Product {
  return {
    id,
    name: `Salvo ${id}`,
    description: "",
    price: 99,
    images: [],
    category: "Geral",
    stock: 3,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

type Retrato = Pick<
  ReturnType<typeof useStore>,
  "products" | "loadingProducts" | "catalogoErro"
>;

describe("StoreContext -- catálogo com mais de 200 produtos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let retrato: Retrato;

  function Capturador() {
    const { products, loadingProducts, catalogoErro } = useStore();
    useEffect(() => {
      retrato = { products, loadingProducts, catalogoErro };
    }, [products, loadingProducts, catalogoErro]);
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
    await assentar();
  }

  const pedidosDeProdutos = () => controle.pedidos as Pedido[];
  const idsNaTela = () => retrato.products.map((p) => p.id);
  /** Chave (data_cadastro, id) de onde cada consulta recomeçou. */
  const cursores = () =>
    pedidosDeProdutos().map((p) =>
      p.depoisDe ? [p.depoisDe.dataCadastro, p.depoisDe.id] : null,
    );
  const chaveDe = (l: Linha) => [l.data_cadastro, l.id];
  /** Quantas linhas o "servidor" entregou, somando todas as páginas. */
  const totalDevolvido = () =>
    pedidosDeProdutos().reduce((n, p) => n + (p.devolvidos?.length ?? 0), 0);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    controle.admin = false;
    controle.loading = false;
    controle.linhas = [];
    controle.paginasQueFalham = new Set();
    controle.aoAtender = null;
    controle.aoResponder = null;
    controle.pedidos = [];
    consultasDeProdutos = 0;
    controle.produtosNoCofre = [];
    controle.replaceAll.mockResolvedValue(undefined);
    retrato = { products: [], loadingProducts: true, catalogoErro: false };
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

  it("loja com 450 produtos: todos chegam à tela e ao cofre, na ordem do servidor", async () => {
    controle.linhas = criarLinhas(450);

    await renderizar();

    expect(retrato.products).toHaveLength(450);
    expect(idsNaTela()).toEqual(controle.linhas.map((l) => l.id));
    expect(retrato.loadingProducts).toBe(false);
    expect(retrato.catalogoErro).toBe(false);

    // Três páginas de 200: a 1ª sem chave, cada seguinte recomeça depois do
    // ÚLTIMO produto lido (nunca por posição), sem buraco nem sobreposição.
    expect(
      pedidosDeProdutos().every((p) => p.tabela === "vw_produtos_public"),
    ).toBe(true);
    expect(cursores()).toEqual([
      null,
      chaveDe(controle.linhas[199]),
      chaveDe(controle.linhas[399]),
    ]);
    expect(totalDevolvido()).toBe(450);

    // O cofre recebe o catálogo INTEIRO, uma vez só.
    expect(controle.replaceAll).toHaveBeenCalledTimes(1);
    const [tabela, gravados] = controle.replaceAll.mock.calls[0];
    expect(tabela).toBe("products");
    expect(gravados).toHaveLength(450);
    expect(controle.setLastSync).toHaveBeenCalledWith("products");
  });

  it("a ordem continua por data de cadastro, com desempate por id para a página não repetir nem pular linha", async () => {
    controle.linhas = criarLinhas(250);

    await renderizar();

    const primeiro = pedidosDeProdutos().find(
      (p) => p.tabela === "vw_produtos_public",
    );
    expect(primeiro?.ordens).toEqual(["data_cadastro", "id"]);
    // Toda página tem a MESMA ordem e o mesmo tamanho, e nenhuma é por
    // posição: o `limit` é o tamanho da página, a chave diz de onde seguir.
    expect(
      pedidosDeProdutos().every(
        (p) =>
          p.ordens.join() === "data_cadastro,id" &&
          p.limite === TAMANHO_DA_PAGINA &&
          p.de === undefined,
      ),
    ).toBe(true);
    expect(retrato.products).toHaveLength(250);
  });

  it("lojista (painel) também lê todas as páginas", async () => {
    controle.admin = true;
    controle.linhas = criarLinhas(450);

    await renderizar();

    expect(retrato.products).toHaveLength(450);
    expect(
      pedidosDeProdutos().every((p) => p.tabela === "vw_produtos_admin"),
    ).toBe(true);
  });

  it("loja com menos de 200 produtos faz UMA consulta só, sem página extra", async () => {
    controle.linhas = criarLinhas(37);

    await renderizar();

    expect(pedidosDeProdutos()).toHaveLength(1);
    expect(retrato.products).toHaveLength(37);
    expect(controle.replaceAll).toHaveBeenCalledTimes(1);
  });

  it("loja com exatamente 200 produtos: uma página cheia pede a próxima, vem vazia e para", async () => {
    controle.linhas = criarLinhas(TAMANHO_DA_PAGINA);

    await renderizar();

    expect(retrato.products).toHaveLength(TAMANHO_DA_PAGINA);
    expect(cursores()).toEqual([null, chaveDe(controle.linhas[199])]);
  });

  it("loja sem nenhum produto: lista vazia legítima, uma consulta e cofre limpo", async () => {
    controle.linhas = [];

    await renderizar();

    expect(pedidosDeProdutos()).toHaveLength(1);
    expect(retrato.products).toEqual([]);
    expect(retrato.catalogoErro).toBe(false);
    expect(controle.replaceAll).toHaveBeenCalledWith("products", []);
  });

  it("falha na 2ª página: o que já estava na tela fica e o cofre não recebe catálogo pela metade", async () => {
    controle.produtosNoCofre = [produtoDoCofre("salvo-1")];
    controle.linhas = criarLinhas(450);
    controle.paginasQueFalham = new Set([1]);

    await renderizar();

    // A primeira página (200) chegou, mas não é o catálogo: não substitui a tela.
    expect(idsNaTela()).toEqual(["salvo-1"]);
    expect(controle.replaceAll).not.toHaveBeenCalled();
    expect(controle.setLastSync).not.toHaveBeenCalled();
    // A falha é anunciada, como qualquer falha de catálogo.
    expect(retrato.catalogoErro).toBe(true);
    expect(retrato.loadingProducts).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    // Com cópia na tela não há laço de tentativas, e o cofre segue intacto.
    expect(controle.replaceAll).not.toHaveBeenCalled();
    expect(idsNaTela()).toEqual(["salvo-1"]);
  });

  it("falha na 2ª página sem cópia salva: tela segue vazia (não mostra 200 como se fosse tudo) e a nova tentativa completa o catálogo", async () => {
    controle.linhas = criarLinhas(450);
    controle.paginasQueFalham = new Set([1]);

    await renderizar();

    expect(retrato.products).toEqual([]);
    expect(controle.replaceAll).not.toHaveBeenCalled();
    expect(retrato.catalogoErro).toBe(true);

    // A rede volta; a primeira tentativa automática (2 s) lê tudo.
    controle.paginasQueFalham = new Set();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await assentar();

    expect(retrato.products).toHaveLength(450);
    expect(retrato.catalogoErro).toBe(false);
    expect(controle.replaceAll).toHaveBeenCalledTimes(1);
    expect(controle.replaceAll.mock.calls[0][1]).toHaveLength(450);
  });

  it("produto cadastrado no meio da leitura desloca a página: nenhum produto aparece duas vezes", async () => {
    controle.linhas = criarLinhas(450);
    let jaCadastrou = false;
    controle.aoAtender = (pedido) => {
      // Depois da 1ª página, entra um produto novo no topo (mais novo que
      // todos): por posição a página 2 repetiria a última linha da página 1.
      if (!jaCadastrou && (pedido as Pedido).numero === 1) {
        jaCadastrou = true;
        controle.linhas = [linhaDaView(-1), ...controle.linhas];
      }
    };

    await renderizar();

    const ids = idsNaTela();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(450);
    // O que ficou de fora (o produto recém-cadastrado) chega pelo realtime.
    expect(ids[0]).toBe("p0");
  });

  it("produto PAUSADO no meio da leitura não derruba o vizinho da fronteira: os outros 449 aparecem todos", async () => {
    controle.linhas = criarLinhas(450);
    controle.aoAtender = (pedido) => {
      // Entre a página 1 e a 2 a lojista pausa um produto da página 1: ele sai
      // da vista pública e a lista sobe uma casa. Por posição, o p200 (que
      // virou o 200º) ficava fora das duas páginas.
      if ((pedido as Pedido).numero === 1) {
        controle.linhas = controle.linhas.filter((l) => l.id !== "p10");
      }
    };

    await renderizar();

    // p10 já tinha sido lido na página 1 (antes da pausa): fica até o
    // realtime/próxima leitura tirar. O que NÃO pode é faltar o p200 nem
    // nenhum dos outros 449.
    expect(idsNaTela()).toContain("p200");
    expect(idsNaTela()).toEqual(criarLinhas(450).map((l) => l.id));
    expect(retrato.catalogoErro).toBe(false);
    // O cofre offline recebe o catálogo inteiro: a próxima visita não herda o buraco.
    expect(controle.replaceAll).toHaveBeenCalledTimes(1);
    expect(
      (controle.replaceAll.mock.calls[0][1] as Product[]).map((p) => p.id),
    ).toEqual(idsNaTela());
  });

  it("pausa em LOTE no meio da leitura (vários da página 1 e da 2): nenhum produto à venda some", async () => {
    controle.linhas = criarLinhas(650);
    const pausados = new Set(["p3", "p50", "p120", "p199", "p250", "p300"]);
    controle.aoAtender = (pedido) => {
      if ((pedido as Pedido).numero === 1) {
        controle.linhas = controle.linhas.filter(
          (l) => !pausados.has(String(l.id)),
        );
      }
    };

    await renderizar();

    // Os pausados da página 1 já tinham sido lidos (antes da pausa) e
    // continuam; os da página 2 em diante já não vêm. Ninguém mais falta.
    const esperados = criarLinhas(650)
      .map((l) => String(l.id))
      .filter((id) => !pausados.has(id) || Number(id.slice(1)) < 200);
    expect(idsNaTela()).toEqual(esperados);
    expect(totalDevolvido()).toBe(esperados.length);
  });

  it("produto que volta a ficar à venda no MEIO da lista (mais antigo que a chave) entra, sem repetir nem perder ninguém", async () => {
    controle.linhas = criarLinhas(450);
    // Mesmo instante do p300; o id maior o põe logo depois dele.
    const reativado: Linha = { ...linhaDaView(300), id: "p300-reativado" };
    controle.aoAtender = (pedido) => {
      if ((pedido as Pedido).numero === 1) {
        controle.linhas = [...controle.linhas, reativado];
      }
    };

    await renderizar();

    const ids = idsNaTela();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(451);
    expect(ids.indexOf("p300-reativado")).toBe(ids.indexOf("p300") + 1);
    expect(totalDevolvido()).toBe(451);
  });

  it("vários produtos cadastrados no MESMO instante atravessando a fronteira: o desempate por id não pula nem repete nenhum", async () => {
    const instante = "2025-12-31T12:00:00.000000+00:00";
    // 180 mais novos, 60 empatados (ocupam as posições 180-239, passando da
    // fronteira 200), e 30 mais antigos.
    const novos = Array.from({ length: 180 }, (_, i) => linhaDaView(i));
    const empatados = Array.from({ length: 60 }, (_, i) => ({
      ...linhaDaView(500),
      id: `e${String(i).padStart(3, "0")}`,
      data_cadastro: instante,
    }));
    const antigos = Array.from({ length: 30 }, (_, i) => linhaDaView(1000 + i));
    controle.linhas = [...antigos, ...empatados.slice().reverse(), ...novos];

    await renderizar();

    const esperado = [...novos, ...empatados, ...antigos].map((l) => l.id);
    expect(idsNaTela()).toEqual(esperado);
    // A página 2 recomeça DENTRO do empate, depois do e019 (posição 199).
    expect(cursores()[1]).toEqual([instante, "e019"]);
    // Nenhuma linha foi entregue duas vezes (a remoção de duplicata não
    // esconde um filtro `lte` errado: aqui se conta o que o servidor mandou).
    expect(totalDevolvido()).toBe(270);
  });

  it("data de cadastro com MICROSSEGUNDOS e fuso: a chave usa o texto exato do banco, sem arredondar para milissegundo", async () => {
    // Fronteira no meio de instantes que só diferem em microssegundos. Uma
    // chave que passasse por `Date` (…00.123Z) pularia o .123400 e os
    // empatados com o .123456 que vêm depois dela.
    const base = "2025-12-31T15:00:00";
    const exato = `${base}.123456-03:00`;
    const novos = Array.from({ length: 199 }, (_, i) => linhaDaView(i));
    const mesmoInstante = ["m000", "m001", "m002", "m003"].map((id) => ({
      ...linhaDaView(400),
      id,
      data_cadastro: exato,
    }));
    const umPoucoAntes = {
      ...linhaDaView(401),
      id: "m100",
      data_cadastro: `${base}.1234-03:00`,
    };
    const antigos = Array.from({ length: 5 }, (_, i) => linhaDaView(2000 + i));
    controle.linhas = [...antigos, umPoucoAntes, ...mesmoInstante, ...novos];

    await renderizar();

    expect(cursores()[1]).toEqual([exato, "m000"]);
    expect(idsNaTela()).toEqual([
      ...novos.map((l) => l.id),
      "m000",
      "m001",
      "m002",
      "m003",
      "m100",
      ...antigos.map((l) => l.id),
    ]);
  });

  it("página cheia cujo último produto veio sem chave (data de cadastro): erro, e nada de catálogo pela metade na tela ou no cofre", async () => {
    controle.produtosNoCofre = [produtoDoCofre("salvo-1")];
    controle.linhas = criarLinhas(450);
    controle.aoResponder = (linhas) =>
      linhas.map((l) =>
        l.id === "p199" ? { ...l, data_cadastro: undefined } : l,
      );

    await renderizar();

    // Sem chave não há de onde continuar: não inventa, não lê por posição.
    expect(pedidosDeProdutos()).toHaveLength(1);
    expect(idsNaTela()).toEqual(["salvo-1"]);
    expect(controle.replaceAll).not.toHaveBeenCalled();
    expect(retrato.catalogoErro).toBe(true);
  });

  it("servidor que ignora a chave e devolve a MESMA página de novo: erro na hora, sem 50 voltas nem catálogo de 200 fingindo ser tudo", async () => {
    controle.linhas = criarLinhas(450);
    let primeiraPagina: Record<string, unknown>[] | null = null;
    controle.aoResponder = (linhas) => {
      primeiraPagina ??= linhas;
      return primeiraPagina;
    };

    await renderizar();

    expect(pedidosDeProdutos()).toHaveLength(2);
    expect(retrato.products).toEqual([]);
    expect(controle.replaceAll).not.toHaveBeenCalled();
    expect(retrato.catalogoErro).toBe(true);
  });

  it("teto de segurança: um servidor que nunca devolve página curta não prende a leitura num laço", async () => {
    // Dublê em que sempre existe mais uma página cheia depois da chave.
    controle.aoAtender = () => {
      controle.linhas = criarLinhas(controle.linhas.length + TAMANHO_DA_PAGINA);
    };
    controle.linhas = [];

    await renderizar();

    expect(pedidosDeProdutos()).toHaveLength(50);
    expect(retrato.products).toHaveLength(50 * TAMANHO_DA_PAGINA);
    expect(retrato.catalogoErro).toBe(false);
  });
});
