// @vitest-environment jsdom
//
// Buracos de prova do perfil público da cliente achados por MUTAÇÃO (plantar
// um defeito de uma linha em `UserProfileView.tsx` e ver se algum teste cai).
// Cada teste abaixo derruba defeitos que sobreviviam aos vizinhos:
// - as iniciais do avatar sem foto: uma palavra = uma letra; duas ou mais = a
//   primeira e a ÚLTIMA palavra ("Ana Maria Souza" -> "AS");
// - avaliação/pergunta de produto NÃO público (nome ou id vazios): não aparece
//   o cabeçalho clicável do produto (nunca se fabrica um id);
// - o contador "Perguntas" vira "—" quando a consulta das perguntas falha (e o
//   de avaliações segue com o número, e vice-versa);
// - "Compra verificada" e "Resposta da Loja" só aparecem em quem tem; a lista
//   de respostas só existe quando há resposta;
// - o selo "Membro desde" só aparece com data; a capa e o nome têm padrão.
// Mutantes EQUIVALENTES (código morto, não dá para derrubar): a guarda
// `if (!product)` e o ramo `Array.isArray(product.imagem_url)` de
// `getProductImage` — a tela só chama a função com produto presente e sempre
// monta `imagem_url` como texto (`row.produto_imagem_url ?? ""`).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const estado = vi.hoisted(() => ({
  perfil: {} as Record<string, unknown>,
  perfilErro: null as null | { code: string; message: string },
  avaliacoes: { data: [] as unknown, error: null as unknown },
  perguntas: { data: [] as unknown, error: null as unknown },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: true } }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({
              data: estado.perfilErro ? null : estado.perfil,
              error: estado.perfilErro,
            }),
        }),
      }),
    }),
    rpc: (nome: string) =>
      Promise.resolve(
        nome === "perfil_publico_avaliacoes"
          ? estado.avaliacoes
          : estado.perguntas,
      ),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function avaliacao(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    product_id: "prod-1",
    rating: 5,
    comment: `Comentário ${id}`,
    created_at: "2026-11-01T12:00:00Z",
    helpful: 0,
    verified: false,
    merchant_reply: null,
    merchant_reply_at: null,
    produto_nome: "Vestido Floral",
    produto_imagem_url: null,
    ...extra,
  };
}

function pergunta(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    product_id: "prod-1",
    question: `Pergunta ${id}`,
    created_at: "2026-11-01T12:00:00Z",
    produto_nome: "Vestido Floral",
    produto_imagem_url: null,
    answers: [],
    ...extra,
  };
}

describe("UserProfileView — iniciais, produto não público e blocos opcionais", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeAll(async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    await import("@/views/customer/UserProfileView");
  }, 60_000);

  beforeEach(() => {
    estado.perfil = {
      id: "u1",
      nome_publico: "Ana Maria Souza",
      avatar_url: null,
      created_at: "2026-03-10T12:00:00Z",
      cover_url: null,
    };
    estado.perfilErro = null;
    estado.avaliacoes = { data: [], error: null };
    estado.perguntas = { data: [], error: null };
    onNavigate.mockClear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const onNavigate = vi.fn();

  async function abrir() {
    const { UserProfileView } = await import(
      "@/views/customer/UserProfileView"
    );
    await act(async () => {
      raiz.render(<UserProfileView userId="u1" onNavigate={onNavigate} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }

  const aba = (nome: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) =>
      b.textContent?.startsWith(nome),
    )!;
  const irParaPerguntas = async () => {
    await act(async () => {
      aba("Perguntas").click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
  };
  const cabecalhosDeProduto = () =>
    [...host.querySelectorAll('[role="button"]')].filter((el) =>
      /Avaliou o produto|Perguntou sobre o produto/.test(el.textContent ?? ""),
    );
  const contador = (rotulo: string) =>
    [...host.querySelectorAll("span")].find((s) => s.textContent === rotulo)
      ?.previousElementSibling?.textContent;

  describe("iniciais do avatar sem foto", () => {
    it.each([
      ["Mariana", "M"],
      ["Ana Lopes", "AL"],
      ["Ana Maria Souza", "AS"],
      ["  Ana   Souza  ", "AS"],
      ["maria josé", "MJ"],
    ])("'%s' mostra '%s'", async (nome, iniciais) => {
      estado.perfil = { ...estado.perfil, nome_publico: nome };
      await abrir();
      const avatar = host.querySelector("div.select-none");
      expect(avatar?.textContent).toBe(iniciais);
    });

    it("nome só com espaços: as iniciais caem no 'U'", async () => {
      estado.perfil = { ...estado.perfil, nome_publico: "   " };
      await abrir();
      // `nome_publico || "Cliente"`: espaços contam como texto e o aparo cai no "U".
      expect(host.querySelector("div.select-none")?.textContent).toBe("U");
    });

    it("sem nome nenhum: o título e as iniciais usam 'Cliente'", async () => {
      estado.perfil = { ...estado.perfil, nome_publico: "" };
      await abrir();
      expect(host.querySelector("h1")?.textContent).toBe("Cliente");
      expect(host.querySelector("div.select-none")?.textContent).toBe("C");
    });
  });

  describe("produto não público", () => {
    it("avaliação com nome do produto mas SEM id: sem cabeçalho clicável", async () => {
      estado.avaliacoes = {
        data: [
          avaliacao("a", { product_id: null }),
          avaliacao("b", { produto_nome: null }),
          avaliacao("c"),
        ],
        error: null,
      };
      await abrir();
      expect(cabecalhosDeProduto()).toHaveLength(1);
      expect(host.textContent).toContain("Comentário a");
      expect(host.textContent).toContain("Comentário b");
    });

    it("pergunta com nome do produto mas SEM id: sem cabeçalho clicável", async () => {
      estado.perguntas = {
        data: [
          pergunta("a", { product_id: null }),
          pergunta("b", { produto_nome: null }),
          pergunta("c"),
        ],
        error: null,
      };
      await abrir();
      await irParaPerguntas();
      expect(cabecalhosDeProduto()).toHaveLength(1);
      expect(host.textContent).toContain("Pergunta a");
      expect(host.textContent).toContain("Pergunta b");
    });

    it("cabeçalho do produto: foto padrão sem imagem, a imagem quando há; toque abre o produto", async () => {
      estado.avaliacoes = {
        data: [
          avaliacao("a", {
            produto_imagem_url: "https://cdn.exemplo.test/a.png",
          }),
          avaliacao("b", { product_id: "prod-2", produto_imagem_url: null }),
        ],
        error: null,
      };
      await abrir();
      const imagens = [
        ...host.querySelectorAll<HTMLImageElement>(
          '[role="button"] img[alt="Vestido Floral"]',
        ),
      ].map((i) => i.getAttribute("src"));
      expect(imagens).toEqual([
        "https://cdn.exemplo.test/a.png",
        "https://placehold.co/600x400?text=Sem+Imagem",
      ]);
      await act(async () => {
        cabecalhosDeProduto()[1].dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
      });
      expect(onNavigate).toHaveBeenCalledWith("product-detail", "prod-2");
    });
  });

  describe("contadores", () => {
    it("perguntas falharam: 'Perguntas' mostra '—' e 'Avaliações' continua com o número", async () => {
      estado.avaliacoes = {
        data: [avaliacao("a"), avaliacao("b")],
        error: null,
      };
      estado.perguntas = { data: null, error: { message: "falhou" } };
      await abrir();
      expect(contador("Perguntas")).toBe("—");
      expect(contador("Avaliações")).toBe("2");
    });

    it("avaliações falharam: 'Avaliações' mostra '—' e 'Perguntas' continua com o número", async () => {
      estado.avaliacoes = { data: null, error: { message: "falhou" } };
      estado.perguntas = { data: [pergunta("a")], error: null };
      await abrir();
      expect(contador("Avaliações")).toBe("—");
      expect(contador("Perguntas")).toBe("1");
    });
  });

  describe("falha, nova tentativa e perfil que não existe", () => {
    const botaoTentarDeNovo = () =>
      [...host.querySelectorAll("button")].find(
        (b) => b.textContent === "Tentar de novo",
      ) as HTMLButtonElement;

    it("perfil falhou por rede: tela de falha; ao tentar de novo e dar certo, a falha SAI e o perfil aparece", async () => {
      estado.perfilErro = { code: "XX000", message: "rede" };
      await abrir();
      expect(host.textContent).toContain(
        "Não conseguimos carregar este perfil",
      );
      estado.perfilErro = null;
      await act(async () => {
        botaoTentarDeNovo().click();
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(host.textContent).not.toContain(
        "Não conseguimos carregar este perfil",
      );
      expect(host.querySelector("h1")?.textContent).toBe("Ana Maria Souza");
    });

    it("avaliações falharam e voltaram: o contador deixa de ser '—'", async () => {
      estado.avaliacoes = { data: null, error: { message: "falhou" } };
      await abrir();
      expect(contador("Avaliações")).toBe("—");
      expect(host.textContent).toContain("Não conseguimos carregar");
      estado.avaliacoes = { data: [avaliacao("a")], error: null };
      await act(async () => {
        botaoTentarDeNovo().click();
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(contador("Avaliações")).toBe("1");
      expect(host.textContent).toContain("Comentário a");
    });

    it("perguntas falharam e voltaram: o contador deixa de ser '—'", async () => {
      estado.perguntas = { data: null, error: { message: "falhou" } };
      await abrir();
      expect(contador("Perguntas")).toBe("—");
      await irParaPerguntas();
      expect(host.textContent).toContain("Não conseguimos carregar");
      estado.perguntas = { data: [pergunta("a")], error: null };
      await act(async () => {
        botaoTentarDeNovo().click();
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(contador("Perguntas")).toBe("1");
      expect(host.textContent).toContain("Pergunta a");
    });

    it("perfil que não existe (PGRST116): 'Usuário não encontrado' e o botão leva ao início", async () => {
      estado.perfilErro = { code: "PGRST116", message: "0 linhas" };
      await abrir();
      expect(host.textContent).toContain("Usuário não encontrado");
      expect(host.textContent).not.toContain(
        "Não conseguimos carregar este perfil",
      );
      const voltar = [...host.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Voltar para o Início"),
      );
      await act(async () => {
        voltar?.click();
      });
      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith("home");
    });

    it("as abas dizem qual está escolhida (aria-selected) e a troca leva à lista certa", async () => {
      estado.avaliacoes = { data: [avaliacao("a")], error: null };
      estado.perguntas = { data: [pergunta("a")], error: null };
      await abrir();
      expect(aba("Avaliações").getAttribute("aria-selected")).toBe("true");
      expect(aba("Perguntas").getAttribute("aria-selected")).toBe("false");
      await irParaPerguntas();
      expect(aba("Avaliações").getAttribute("aria-selected")).toBe("false");
      expect(aba("Perguntas").getAttribute("aria-selected")).toBe("true");
      expect(host.textContent).toContain("Pergunta a");
      await act(async () => {
        aba("Avaliações").click();
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 400));
      });
      expect(host.textContent).toContain("Comentário a");
    });
  });

  describe("blocos opcionais", () => {
    it("'Compra verificada' e 'Resposta da Loja' só aparecem em quem tem", async () => {
      estado.avaliacoes = {
        data: [
          avaliacao("simples"),
          avaliacao("completa", {
            verified: true,
            merchant_reply: "Obrigada pelo carinho!",
          }),
        ],
        error: null,
      };
      await abrir();
      expect(host.textContent?.match(/Compra verificada/g)).toHaveLength(1);
      expect(host.textContent?.match(/Resposta da Loja/g)).toHaveLength(1);
      expect(host.textContent).toContain("Obrigada pelo carinho!");
    });

    it("pergunta sem resposta não ganha a faixa de respostas; com resposta, ganha", async () => {
      estado.perguntas = {
        data: [
          pergunta("a"),
          pergunta("b", {
            answers: [
              {
                id: "r1",
                answer: "Sim, tem no tamanho M.",
                created_at: "2026-11-02T12:00:00Z",
              },
            ],
          }),
        ],
        error: null,
      };
      await abrir();
      await irParaPerguntas();
      expect(host.textContent?.match(/Resposta da Equipe/g)).toHaveLength(1);
      expect(
        host.querySelectorAll("div.border-t.border-zinc-100.pt-2"),
      ).toHaveLength(1);
    });

    it("'Membro desde' só aparece com data de cadastro", async () => {
      await abrir();
      expect(host.textContent).toContain("Membro desde março de 2026");
      act(() => raiz.unmount());
      raiz = createRoot(host);
      estado.perfil = { ...estado.perfil, created_at: null };
      await abrir();
      expect(host.textContent).not.toContain("Membro desde");
    });

    it("sem capa usa a capa padrão; com capa usa a dela", async () => {
      await abrir();
      const capa = () =>
        host.querySelector<HTMLImageElement>('img[alt="Capa de Perfil"]');
      const padrao = capa()?.getAttribute("src");
      expect(padrao).toBeTruthy();
      act(() => raiz.unmount());
      raiz = createRoot(host);
      estado.perfil = {
        ...estado.perfil,
        cover_url: "https://cdn.exemplo.test/capa.png",
      };
      await abrir();
      expect(capa()?.getAttribute("src")).toBe(
        "https://cdn.exemplo.test/capa.png",
      );
      act(() => raiz.unmount());
      raiz = createRoot(host);
      estado.perfil = { ...estado.perfil, cover_url: "" };
      await abrir();
      expect(capa()?.getAttribute("src")).toBe(padrao);
      expect(padrao).not.toBe("https://cdn.exemplo.test/capa.png");
    });
  });
});
