// @vitest-environment jsdom
//
// Dois defeitos de tela da política, medidos pelo que a cliente enxerga:
//  (A) texto escrito pela lojista com link ou palavra longa, sem espaços, não
//      pode estourar a tela: os parágrafos precisam quebrar a palavra;
//  (B) a folha não esvazia nem perde o título durante a animação de fechar.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LINK_LONGO = `https://${"loja-da-ana-".repeat(12)}exemplo.com.br/regras`;

const { politicaDaLoja } = vi.hoisted(() => ({
  politicaDaLoja: { valor: null as Record<string, unknown> | null },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      storeName: "Loja da Ana",
      storeAddress: "Rua das Flores, 10",
    },
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const cadeia = {
        select: () => cadeia,
        eq: () => cadeia,
        maybeSingle: () =>
          Promise.resolve({ data: politicaDaLoja.valor, error: null }),
      };
      return cadeia;
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const POLITICA_BASE = {
  prazo_arrependimento_dias: 7,
  prazo_troca_dias: 30,
  prazo_vicio_dias: 90,
  aceita_troca: true,
  aceita_vale: false,
  exige_fotos_vicio: false,
  metodos_locais: ["entrega_na_loja"],
  metodos_nacionais: ["envio_proprio"],
  reembolso_momento: "ao_receber",
  frete_troca_pago_por: "loja",
  categorias_sem_troca: [],
  texto_politica: `Regras completas em ${LINK_LONGO}`,
  endereco_devolucao: null,
  updated_at: null,
};

function esperar(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("política: texto longo e saída da folha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    politicaDaLoja.valor = { ...POLITICA_BASE };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function renderizar(node: React.ReactNode) {
    await act(async () => {
      raiz.render(node);
    });
    await act(async () => {
      await esperar();
    });
  }

  it("(A) o texto da lojista com link longo quebra a palavra, em todo parágrafo", async () => {
    const { ConteudoDaPolitica } = await import(
      "@/components/politicas/ConteudoDaPolitica"
    );
    await renderizar(<ConteudoDaPolitica tipo="trocas" />);
    const secao = hospedeiro.querySelector(
      'section[aria-labelledby="politica-regras-da-loja"]',
    );
    expect(secao, "seção com o texto da lojista").not.toBeNull();
    const paragrafo = [...(secao?.querySelectorAll("p") ?? [])].find((p) =>
      p.textContent?.includes(LINK_LONGO),
    );
    expect(paragrafo, "parágrafo com o link longo").toBeDefined();
    expect(paragrafo?.classList.contains("break-words")).toBe(true);
    // Todos os parágrafos das seções do texto seguem a mesma regra (o bloco
    // de contato é outro teste: a linha do endereço é flex).
    const paragrafos = hospedeiro.querySelectorAll(
      'section:not([aria-labelledby="politica-contato-da-loja"]) p',
    );
    expect(paragrafos.length).toBeGreaterThan(1);
    for (const p of paragrafos) {
      expect(p.classList.contains("break-words"), p.textContent ?? "").toBe(
        true,
      );
    }
  });

  it("(A) o endereço da loja no contato também quebra a palavra", async () => {
    const { ConteudoDaPolitica } = await import(
      "@/components/politicas/ConteudoDaPolitica"
    );
    await renderizar(<ConteudoDaPolitica tipo="termos" />);
    const contato = hospedeiro.querySelector(
      'section[aria-labelledby="politica-contato-da-loja"]',
    );
    // A linha é flex (ícone + texto): o texto precisa de min-w-0, senão o item
    // flex nunca encolhe abaixo da palavra mais longa e a tela estoura.
    const endereco = [...(contato?.querySelectorAll("p span") ?? [])].find(
      (s) => s.textContent?.includes("Rua das Flores"),
    );
    expect(endereco, "endereço no contato").toBeDefined();
    expect(endereco?.classList.contains("break-words")).toBe(true);
    expect(endereco?.classList.contains("min-w-0")).toBe(true);
  });

  it("(B) fechar a folha mantém o título e o conteúdo durante a saída", async () => {
    // O jsdom não anima: sem isto a folha some no mesmo instante e o quadro
    // de saída (o que a cliente vê durante a animação) nunca existe no teste.
    // O Radix só espera a saída se o nome da animação mudar de "none" para
    // outro quando a folha fecha.
    const animacao = { nome: "none" };
    const calculado = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
      const estilo = calculado(el, pseudo);
      return new Proxy(estilo, {
        get(alvo, chave) {
          if (chave === "animationName") return animacao.nome;
          const valor = Reflect.get(alvo, chave, alvo);
          return typeof valor === "function" ? valor.bind(alvo) : valor;
        },
      });
    });
    const { PoliticaEmFolha } = await import(
      "@/components/politicas/PoliticaEmFolha"
    );
    await renderizar(<PoliticaEmFolha tipo="termos" onFechar={() => {}} />);
    const folha = document.querySelector('[data-testid="folha-politica"]');
    expect(folha, "folha aberta").not.toBeNull();
    expect(folha?.textContent).toContain("Termos de uso");
    expect(
      document.querySelector('[data-testid="politica-termos"]'),
    ).not.toBeNull();

    // O pai zera o tipo; a folha ainda está na tela (animação de saída).
    animacao.nome = "sheet-out";
    await renderizar(<PoliticaEmFolha tipo={null} onFechar={() => {}} />);
    const saindo = document.querySelector('[data-testid="folha-politica"]');
    expect(saindo, "folha ainda montada na saída").not.toBeNull();
    expect(saindo?.getAttribute("data-state")).toBe("closed");
    expect(saindo?.textContent).toContain("Termos de uso");
    expect(
      document.querySelector('[data-testid="politica-termos"]'),
      "conteúdo continua durante a saída",
    ).not.toBeNull();
  });

  it("(B) sem nunca abrir, a folha não monta conteúdo", async () => {
    const { PoliticaEmFolha } = await import(
      "@/components/politicas/PoliticaEmFolha"
    );
    await renderizar(<PoliticaEmFolha tipo={null} onFechar={() => {}} />);
    expect(document.querySelector('[data-testid="folha-politica"]')).toBeNull();
    expect(document.querySelector('[data-testid^="politica-"]')).toBeNull();
  });

  it("(B) abrir outra política depois de fechar mostra a nova", async () => {
    const { PoliticaEmFolha } = await import(
      "@/components/politicas/PoliticaEmFolha"
    );
    await renderizar(<PoliticaEmFolha tipo="termos" onFechar={() => {}} />);
    await renderizar(<PoliticaEmFolha tipo={null} onFechar={() => {}} />);
    await renderizar(
      <PoliticaEmFolha tipo="privacidade" onFechar={() => {}} />,
    );
    const folha = document.querySelector('[data-testid="folha-politica"]');
    expect(folha?.getAttribute("data-state")).toBe("open");
    expect(
      document.querySelector('[data-testid="politica-privacidade"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="politica-termos"]'),
    ).toBeNull();
  });
});
