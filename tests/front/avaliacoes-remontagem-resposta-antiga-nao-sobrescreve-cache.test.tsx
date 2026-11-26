// @vitest-environment jsdom
//
// Hook e cache reais, compartilhados entre montagens. Só a fronteira da
// rede é controlada: nenhuma resposta pode chegar sem o teste soltá-la.
import { act, useEffect, useRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type LinhaPublica = {
  id: string;
  product_id: string;
  author_name: string;
  author_avatar_url: null;
  rating: number;
  comment: string;
  created_at: string;
  helpful: number;
  verified: boolean;
  merchant_reply: null;
};

type Consulta = {
  produto: string;
  terminada: boolean;
  responder: (linhas: LinhaPublica[]) => void;
  falhar: () => void;
  conclusao?: Promise<void>;
};

const rede = vi.hoisted(() => ({
  consultas: [] as Consulta[],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "vw_reviews_public") {
        throw new Error(`Tabela inesperada na sonda anônima: ${tabela}`);
      }
      let produto = "";
      const builder = {
        select: () => builder,
        eq: (coluna: string, valor: string) => {
          if (coluna !== "product_id") {
            throw new Error(`Filtro inesperado: ${coluna}`);
          }
          produto = valor;
          return builder;
        },
        order: () => builder,
        limit: () =>
          new Promise<{
            data: LinhaPublica[];
            error: null | { message: string };
          }>((resolve) => {
            const consulta: Consulta = {
              produto,
              terminada: false,
              responder: (linhas) => {
                consulta.terminada = true;
                resolve({ data: linhas, error: null });
              },
              falhar: () => {
                consulta.terminada = true;
                resolve({ data: [], error: { message: "falha-ficticia" } });
              },
            };
            rede.consultas.push(consulta);
          }),
      };
      return builder;
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/lib/canal-de-abas", () => ({
  criarCanalDeAbas: () => null,
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedReviewsData: null,
  setCachedReviewsData: vi.fn(),
  lerGeracaoDosCachesDeAdmin: () => 0,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { useReviews } from "@/hooks/useReviews";
import {
  REVIEWS_CACHE_KEY_PREFIX,
  esquecerAvaliacoesGuardadas,
  getReviewsCache,
} from "@/lib/cache-de-avaliacoes";

type Ler = ReturnType<typeof useReviews>["getReviewsByProduct"];
type Evento = {
  tipo: "montou" | "desmontou";
  produto: string;
  instancia: number;
};

let proximaInstancia = 0;
let eventos: Evento[] = [];
let atual: { produto: string; instancia: number; ler: Ler } | null = null;

function iniciar(
  produto: string,
  ler: Ler,
  opcoes?: Parameters<Ler>[1],
): Consulta {
  const indice = rede.consultas.length;
  const conclusao = ler(produto, opcoes);
  // eslint-disable-next-line security/detect-object-injection -- Índice interno: tamanho anterior da fila fictícia.
  const consulta = rede.consultas[indice];
  if (!consulta || consulta.produto !== produto) {
    throw new Error("A leitura real não alcançou a fronteira esperada.");
  }
  consulta.conclusao = conclusao;
  return consulta;
}

function Consumidor({ produto }: { produto: string }) {
  const { reviews, loading, getReviewsByProduct } = useReviews();
  const identidade = useRef<number | null>(null);
  if (identidade.current === null) identidade.current = ++proximaInstancia;
  const instancia = identidade.current;

  useEffect(() => {
    eventos.push({ tipo: "montou", produto, instancia });
    atual = { produto, instancia, ler: getReviewsByProduct };
    iniciar(produto, getReviewsByProduct);
    return () => {
      eventos.push({ tipo: "desmontou", produto, instancia });
      if (atual?.instancia === instancia) atual = null;
    };
  }, [produto, instancia, getReviewsByProduct]);

  return (
    <section data-instancia={instancia}>
      <output data-testid="carregamento">
        {loading ? "pendente" : "pronto"}
      </output>
      <ul>
        {reviews.map((review) => (
          <li key={review.id}>{review.comment}</li>
        ))}
      </ul>
    </section>
  );
}

function criarStorage(): Storage {
  const valores = new Map<string, string>();
  return {
    get length() {
      return valores.size;
    },
    key: (indice) => [...valores.keys()].at(indice) ?? null,
    getItem: (chave) => valores.get(chave) ?? null,
    setItem: (chave, valor) => {
      valores.set(chave, String(valor));
    },
    removeItem: (chave) => {
      valores.delete(chave);
    },
    clear: () => valores.clear(),
  };
}

function linha(produto: string, comentario: string): LinhaPublica {
  return {
    id: `avaliacao-ficticia-${comentario}`,
    product_id: produto,
    author_name: "Pessoa Fictícia",
    author_avatar_url: null,
    rating: 5,
    comment: comentario,
    created_at: "2026-11-01T12:00:00.000Z",
    helpful: 0,
    verified: false,
    merchant_reply: null,
  };
}

describe("avaliações de instâncias desmontadas e cache compartilhado", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("localStorage", criarStorage());
    esquecerAvaliacoesGuardadas();
    rede.consultas.length = 0;
    eventos = [];
    proximaInstancia = 0;
    atual = null;
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
      for (const consulta of rede.consultas) {
        if (!consulta.terminada) consulta.responder([]);
      }
      await Promise.all(rede.consultas.map((consulta) => consulta.conclusao));
    });
    esquecerAvaliacoesGuardadas();
    localStorage.clear();
    host.remove();
    atual = null;
    eventos = [];
    rede.consultas.length = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function abrir(produto: string): Promise<Consulta> {
    const indice = rede.consultas.length;
    await act(async () => {
      raiz.render(<Consumidor key={produto} produto={produto} />);
    });
    expect(rede.consultas).toHaveLength(indice + 1);
    // eslint-disable-next-line security/detect-object-injection -- Índice interno: tamanho anterior da fila fictícia.
    const consulta = rede.consultas[indice];
    expect(consulta.produto).toBe(produto);
    return consulta;
  }

  async function reler(produto: string, opcoes?: Parameters<Ler>[1]) {
    let consulta: Consulta | undefined;
    await act(async () => {
      if (!atual || atual.produto !== produto) {
        throw new Error("Consumidor do produto não montado.");
      }
      consulta = iniciar(produto, atual.ler, opcoes);
    });
    if (!consulta) throw new Error("Releitura não iniciada.");
    return consulta;
  }

  async function responder(consulta: Consulta, linhas: LinhaPublica[]) {
    expect(consulta.terminada).toBe(false);
    expect(consulta.conclusao).toBeInstanceOf(Promise);
    await act(async () => {
      consulta.responder(linhas);
      // Barreira sobre o método COMPLETO do hook, inclusive o finally.
      await consulta.conclusao;
    });
    expect(consulta.terminada).toBe(true);
  }

  function comentariosVisiveis() {
    return [...host.querySelectorAll("li")].map((item) => item.textContent);
  }

  function comentariosGuardados(produto: string) {
    return getReviewsCache(produto)?.map((review) => review.comment) ?? null;
  }

  function comentariosNoDisco(produto: string) {
    const copia = localStorage.getItem(`${REVIEWS_CACHE_KEY_PREFIX}${produto}`);
    if (!copia) return null;
    return (JSON.parse(copia) as { comment: string }[]).map(
      (review) => review.comment,
    );
  }

  it("mantém a resposta nova na terceira abertura P, mesmo se A desmontada terminar depois de B", async () => {
    const p = "produto-ficticio-remontagem-p";
    const q = "produto-ficticio-remontagem-q";
    const a = await abrir(p);
    const primeira = atual?.instancia;
    expect(primeira).toBe(1);
    const consultaQ = await abrir(q);
    expect(eventos).toContainEqual({
      tipo: "desmontou",
      produto: p,
      instancia: primeira,
    });
    expect(a.terminada).toBe(false);
    await responder(consultaQ, []);

    const b = await abrir(p);
    const segunda = atual?.instancia;
    expect(segunda).toBe(3);
    expect(segunda).not.toBe(primeira);
    await responder(b, [linha(p, "nova")]);
    expect(comentariosVisiveis()).toEqual(["nova"]);
    expect(comentariosGuardados(p)).toEqual(["nova"]);
    expect(host.querySelector("output")?.textContent).toBe("pronto");

    await responder(a, [linha(p, "antiga")]);
    // A instância atual não é a que recebeu a resposta A.
    expect(atual?.instancia).toBe(segunda);
    expect(comentariosVisiveis()).toEqual(["nova"]);
    expect(comentariosNoDisco(p)).toEqual(["nova"]);

    const outraQ = await abrir(q);
    await responder(outraQ, []);
    const c = await abrir(p);
    expect(atual?.instancia).toBe(5);
    expect(eventos.filter((evento) => evento.produto === p)).toEqual([
      { tipo: "montou", produto: p, instancia: 1 },
      { tipo: "desmontou", produto: p, instancia: 1 },
      { tipo: "montou", produto: p, instancia: 3 },
      { tipo: "desmontou", produto: p, instancia: 3 },
      { tipo: "montou", produto: p, instancia: 5 },
    ]);
    expect(c.terminada).toBe(false);
    expect(comentariosVisiveis()).toEqual(["nova"]);
    expect(comentariosGuardados(p)).toEqual(["nova"]);
  });

  it("controle: na mesma instância B prevalece sobre A na tela e no cache", async () => {
    const p = "produto-ficticio-mesma-instancia";
    const a = await abrir(p);
    const instancia = atual?.instancia;
    const b = await reler(p);
    await responder(b, [linha(p, "nova-controle")]);
    await responder(a, [linha(p, "antiga-controle")]);
    expect(atual?.instancia).toBe(instancia);
    expect(eventos).toEqual([{ tipo: "montou", produto: p, instancia }]);
    expect(comentariosVisiveis()).toEqual(["nova-controle"]);
    expect(comentariosGuardados(p)).toEqual(["nova-controle"]);
    expect(host.querySelector("output")?.textContent).toBe("pronto");
  });

  it("controle: a limpeza real da geração impede A de repovoar o cache", async () => {
    const p = "produto-ficticio-geracao-p";
    const q = "produto-ficticio-geracao-q";
    const a = await abrir(p);
    const consultaQ = await abrir(q);
    await responder(consultaQ, []);
    esquecerAvaliacoesGuardadas();
    await responder(a, [linha(p, "antiga-apos-limpeza")]);
    expect(comentariosGuardados(p)).toBeNull();
    expect(localStorage.getItem(`${REVIEWS_CACHE_KEY_PREFIX}${p}`)).toBeNull();

    const c = await abrir(p);
    expect(c.terminada).toBe(false);
    expect(comentariosVisiveis()).toEqual([]);
    expect(host.querySelector("output")?.textContent).toBe("pendente");
    expect(comentariosGuardados(p)).toBeNull();
  });

  it("controle: B com erro preserva o cache anterior e não devolve a vez para A", async () => {
    const p = "produto-ficticio-erro-p";
    const q = "produto-ficticio-erro-q";
    const registroErro = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const inicial = await abrir(p);
    await responder(inicial, [linha(p, "anterior-valida")]);
    const a = await reler(p);
    const consultaQ = await abrir(q);
    await responder(consultaQ, []);
    const b = await abrir(p);
    expect(comentariosVisiveis()).toEqual(["anterior-valida"]);
    await act(async () => {
      b.falhar();
      await b.conclusao;
    });
    expect(b.terminada).toBe(true);
    expect(registroErro).toHaveBeenCalledExactlyOnceWith(
      "Error fetching reviews:",
      { message: "falha-ficticia" },
    );
    await responder(a, [linha(p, "antiga-proibida")]);
    expect(comentariosGuardados(p)).toEqual(["anterior-valida"]);
    expect(comentariosNoDisco(p)).toEqual(["anterior-valida"]);
    expect(comentariosVisiveis()).toEqual(["anterior-valida"]);
    const outraQ = await abrir(q);
    await responder(outraQ, []);
    const c = await abrir(p);
    expect(c.terminada).toBe(false);
    expect(comentariosVisiveis()).toEqual(["anterior-valida"]);
  });

  it("controle: produtos distintos podem atualizar seus próprios caches após o desmonte", async () => {
    const p = "produto-ficticio-distinto-p";
    const q = "produto-ficticio-distinto-q";
    const a = await abrir(p);
    const b = await abrir(q);
    await responder(b, [linha(q, "resposta-q")]);
    await responder(a, [linha(p, "resposta-p")]);
    expect(comentariosVisiveis()).toEqual(["resposta-q"]);
    expect(comentariosGuardados(p)).toEqual(["resposta-p"]);
    expect(comentariosGuardados(q)).toEqual(["resposta-q"]);
    expect(comentariosNoDisco(p)).toEqual(["resposta-p"]);
    expect(comentariosNoDisco(q)).toEqual(["resposta-q"]);
  });

  it("controle: releitura silenciosa após desmonte atualiza cache sem sucessora do produto", async () => {
    const p = "produto-ficticio-silencioso-p";
    const q = "produto-ficticio-silencioso-q";
    const inicial = await abrir(p);
    await responder(inicial, [linha(p, "antes-de-fechar")]);
    const silenciosa = await reler(p, { silencioso: true });
    const consultaQ = await abrir(q);
    expect(eventos).toContainEqual({
      tipo: "desmontou",
      produto: p,
      instancia: 1,
    });
    await responder(consultaQ, []);
    await responder(silenciosa, [linha(p, "depois-de-fechar")]);
    expect(comentariosGuardados(p)).toEqual(["depois-de-fechar"]);
    expect(comentariosNoDisco(p)).toEqual(["depois-de-fechar"]);
    const c = await abrir(p);
    expect(c.terminada).toBe(false);
    expect(comentariosVisiveis()).toEqual(["depois-de-fechar"]);
  });

  it("controle: o finally de A não remove a vez de B ainda pendente", async () => {
    const p = "produto-ficticio-proprietario-p";
    const q = "produto-ficticio-proprietario-q";
    const a = await abrir(p);
    const consultaQ = await abrir(q);
    await responder(consultaQ, []);
    const b = await abrir(p);
    await responder(a, [linha(p, "antiga-sem-vez")]);
    expect(b.terminada).toBe(false);
    expect(comentariosGuardados(p)).toBeNull();
    expect(comentariosVisiveis()).toEqual([]);
    expect(host.querySelector("output")?.textContent).toBe("pendente");
    await responder(b, [linha(p, "nova-proprietaria")]);
    expect(comentariosVisiveis()).toEqual(["nova-proprietaria"]);
    expect(comentariosGuardados(p)).toEqual(["nova-proprietaria"]);
    expect(comentariosNoDisco(p)).toEqual(["nova-proprietaria"]);
  });
});
