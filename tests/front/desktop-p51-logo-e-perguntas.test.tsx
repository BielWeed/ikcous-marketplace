// @vitest-environment jsdom
// P51 -- dois acabamentos de PC medidos na vitrine real:
//  1) o logo do cabeçalho de PC renderizava 46x14 (limite do código: 80x25)
//     porque o <img>, item flex ao lado do nome da loja, encolhia para dar
//     lugar ao texto. `shrink-0` segura o logo; o botão que o contém já tem
//     largura máxima própria (180/220 px), então a largura do conjunto não muda.
//  2) "Perguntas ao vendedor" ficava centrada (max-w-2xl mx-auto) enquanto
//     "Avaliações" e "Você também pode gostar" ficam à esquerda da coluna.
//     `lg:mx-0` alinha à esquerda só no computador; o celular não muda.
import { readFileSync } from "node:fs";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

// @ts-expect-error flag interna do ambiente de testes React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      storeName: "Loja de ensaio com nome comprido",
      logoUrl: "https://exemplo.invalid/logo.png",
    },
  }),
}));
vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({ unreadCount: 0 }),
}));
vi.mock("@/hooks/useCart", () => ({
  useCartState: () => ({ cartCount: 0 }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));
vi.mock("@/components/pwa/IlhaDeAtualizacao", () => ({
  IlhaDeAtualizacao: () => null,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, isAdmin: false }),
}));
vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [],
    loading: false,
    error: null,
    getQuestionsByProduct: vi.fn(),
    addQuestion: vi.fn(),
    addAnswer: vi.fn(),
    subscribeToQuestions: () => () => {},
  }),
}));

import { CabecalhoDoComputador } from "@/components/desktop/CabecalhoDoComputador";
import { ProductQA } from "@/components/ui/custom/ProductQA";

const FONTE_CABECALHO = readFileSync(
  "src/components/desktop/CabecalhoDoComputador.tsx",
  "utf8",
);
const FONTE_QA = readFileSync("src/components/ui/custom/ProductQA.tsx", "utf8");
const FONTE_PRODUTO = readFileSync(
  "src/views/customer/ProductView.tsx",
  "utf8",
);

// Lista LITERAL (não lida do histórico do git: o CI clona 1 commit só).
const LOGO_SEM_PREFIXO = "max-h-10 max-w-20 shrink-0 object-contain";
const PERGUNTAS_SEM_PREFIXO = "mx-auto max-w-2xl space-y-6";
const ENTRAR_SEM_PREFIXO =
  "rounded-full bg-primary px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-primary-foreground shadow-sm transition-all hover:opacity-90 active:scale-95";
const ENTRAR_NO_TABLET = [
  "md:inline-flex",
  "md:min-h-10",
  "md:items-center",
  "md:justify-center",
];

const tokens = (classes: string) => classes.split(/\s+/).filter(Boolean);

/** As regras que o conserto precisa cumprir, sobre uma lista de classes. */
function logoNaoEncolhe(classes: string) {
  return (
    classesDoCelular(classes) === LOGO_SEM_PREFIXO &&
    tokens(classes).includes("shrink-0")
  );
}
function perguntasAlinhamComAPagina(classes: string) {
  return (
    classesDoCelular(classes) === PERGUNTAS_SEM_PREFIXO &&
    tokens(classes).includes("lg:mx-0") &&
    tokens(classes).includes("max-w-2xl")
  );
}

/** Sem os tokens de tablet/computador (md, lg, xl, 2xl): o "como é no celular". */
const semPrefixoDeTela = (classes: string) =>
  tokens(classes)
    .filter((t) => !["md", "lg", "xl", "2xl"].includes(t.split(":")[0]))
    .join(" ");
/** Botão "Entrar na Conta": alvo de toque >= 40 px no tablet, celular intacto. */
function entrarTemAlvoDeToque(classes: string) {
  return (
    semPrefixoDeTela(classes) === ENTRAR_SEM_PREFIXO &&
    ENTRAR_NO_TABLET.every((t) => tokens(classes).includes(t))
  );
}

/** Pega a lista de classes dos elementos tocados direto do TEXTO da fonte. */
const classesDoLogoNaFonte = (fonte: string) =>
  /alt=""\s+className="([^"]*max-h-10[^"]*)"/.exec(fonte)?.[1] ?? "";
const classesDoEntrarNaFonte = (fonte: string) =>
  /<button\s+onClick=\{handleNavigateToAuth\}\s+className="([^"]*)"/.exec(
    fonte,
  )?.[1] ?? "";
const classesDoQaNaFonte = (fonte: string) =>
  /<div className="(mx-auto max-w-2xl[^"]*)"/.exec(fonte)?.[1] ?? "";

let host: HTMLDivElement;
let root: Root;
const ImagemOriginal = window.Image;

beforeEach(() => {
  // jsdom nunca carrega imagem; o Radix (avatar) só monta o <img> após o load.
  class ImagemQueCarrega extends EventTarget {
    referrerPolicy = "";
    crossOrigin: string | null = null;
    set src(_valor: string) {
      queueMicrotask(() => this.dispatchEvent(new Event("load")));
    }
  }
  window.Image = ImagemQueCarrega as never;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  window.Image = ImagemOriginal;
  act(() => root.unmount());
  host.remove();
});

describe("P51 -- logo do cabeçalho do computador não encolhe", () => {
  it("o <img> real do logo sai com shrink-0 e o resto das classes congelado", async () => {
    await act(async () => {
      root.render(
        <CabecalhoDoComputador
          currentView="home"
          onNavigate={() => {}}
          searchQuery=""
          onSearch={() => {}}
          selectedCategory="Todas"
          onCategorySelect={() => {}}
          onCategoryChange={() => {}}
          onOpenNotifications={() => {}}
        />,
      );
    });
    const botao = host.querySelector<HTMLElement>(
      'button[aria-label="Ir para o Início"]',
    );
    const logo = botao?.querySelector("img");
    expect(logo, "o logo precisa ser desenhado").not.toBeNull();
    expect(logoNaoEncolhe(logo?.className ?? "")).toBe(true);
    // O botão que contém o logo e o nome já segura a própria largura: o
    // conjunto não cresce, só o nome cede espaço (line-clamp-2 + overflow).
    expect(tokens(botao?.className ?? "")).toEqual(
      expect.arrayContaining([
        "shrink-0",
        "max-w-[180px]",
        "xl:max-w-[220px]",
        // alvo de toque/clique de 44 px do botão do logo
        "min-h-11",
      ]),
    );
    // Quem cede espaço é o nome da loja: no máximo duas linhas, o resto some.
    expect(tokens(botao?.querySelector("span")?.className ?? "")).toContain(
      "line-clamp-2",
    );
  });

  it("a fonte tem o conserto, e o mutante sem shrink-0 é pego", () => {
    expect(logoNaoEncolhe(classesDoLogoNaFonte(FONTE_CABECALHO))).toBe(true);
    const mutante = FONTE_CABECALHO.replace(
      "max-w-20 shrink-0 object-contain",
      "max-w-20 object-contain",
    );
    expect(mutante).not.toBe(FONTE_CABECALHO);
    expect(logoNaoEncolhe(classesDoLogoNaFonte(mutante))).toBe(false);
  });
});

describe("P51 -- Perguntas ao vendedor alinha com a página do produto", () => {
  it("o bloco real sai com lg:mx-0 e o celular fica byte a byte igual", async () => {
    await act(async () => {
      root.render(<ProductQA productId="produto-ficticio" />);
    });
    const bloco = host.firstElementChild as HTMLElement;
    expect(bloco.textContent).toContain("Perguntas ao vendedor");
    expect(perguntasAlinhamComAPagina(bloco.className)).toBe(true);
    expect(classesDoCelular(bloco.className)).toBe(PERGUNTAS_SEM_PREFIXO);
  });

  it("a fonte tem o conserto, e o mutante sem o prefixo lg: é pego", () => {
    expect(perguntasAlinhamComAPagina(classesDoQaNaFonte(FONTE_QA))).toBe(true);
    const semClasse = FONTE_QA.replace(" lg:mx-0", "");
    expect(semClasse).not.toBe(FONTE_QA);
    expect(perguntasAlinhamComAPagina(classesDoQaNaFonte(semClasse))).toBe(
      false,
    );
    // Mutante que vaza para o celular (tira o prefixo): quebra o congelado.
    const semPrefixo = FONTE_QA.replace(" lg:mx-0", " mx-0");
    expect(semPrefixo).not.toBe(FONTE_QA);
    expect(perguntasAlinhamComAPagina(classesDoQaNaFonte(semPrefixo))).toBe(
      false,
    );
  });

  it("com lg:mx-0 a borda esquerda cai na da coluna (1280 e 1536)", () => {
    // Antes, max-w-2xl (672) centralizado numa coluna de conteúdo = contêiner - px-8 (64) - coluna
    // de compra (440) - gap 48 deixava sobra à esquerda: 28 px em 1280 (coluna 728) e 108 px em
    // 1536 (coluna 888). Depois do conserto o recuo à esquerda é 0 (mx-0): igual às vizinhas.
    expect(tokens(classesDoQaNaFonte(FONTE_QA))).toContain("lg:mx-0");
  });

  it("o contêiner das três seções (Avaliações, Perguntas, Relacionados) é a mesma coluna cheia", () => {
    // O `className` do PRÓPRIO elemento: o primeiro `className="..."` depois do
    // marcador. (Antes eram 260 caracteres fixos: o `chat-section` tem handlers
    // longos e a classe ficava fora da janela, então um `mx-auto max-w-2xl`
    // nele passava.)
    const trecho = (inicio: string) => {
      const i = FONTE_PRODUTO.indexOf(inicio);
      expect(i).toBeGreaterThan(-1);
      const classe = /className="([^"]*)"/.exec(FONTE_PRODUTO.slice(i));
      expect(classe, `className do elemento ${inicio}`).not.toBeNull();
      return classe?.[1] ?? "";
    };
    // Nenhum dos três limita largura nem centraliza: o QA era o único.
    for (const marcador of [
      'id="reviews-section"',
      'id="chat-section"',
      "ref={recsRef}",
    ]) {
      const t = trecho(marcador);
      expect(t).not.toMatch(/max-w-|mx-auto/);
    }
  });
});

describe("P51 -- botão Entrar na Conta tem alvo de toque no tablet", () => {
  it("o botão real sai com md:min-h-10 centralizado e o celular fica igual", async () => {
    await act(async () => {
      root.render(<ProductQA productId="produto-ficticio" />);
    });
    const botao = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Entrar na Conta"),
    );
    expect(botao, "sem usuário, o botão precisa existir").toBeDefined();
    expect(entrarTemAlvoDeToque(botao?.className ?? "")).toBe(true);
    expect(semPrefixoDeTela(botao?.className ?? "")).toBe(ENTRAR_SEM_PREFIXO);
  });

  it("a fonte tem o conserto, e os mutantes (sem a classe / sem o prefixo md:) são pegos", () => {
    expect(entrarTemAlvoDeToque(classesDoEntrarNaFonte(FONTE_QA))).toBe(true);
    const semClasse = FONTE_QA.replace(" md:min-h-10", "");
    expect(semClasse).not.toBe(FONTE_QA);
    expect(entrarTemAlvoDeToque(classesDoEntrarNaFonte(semClasse))).toBe(false);
    // Vazar para o celular: tira o prefixo e o congelado do celular quebra.
    const semPrefixo = FONTE_QA.replace(" md:min-h-10", " min-h-10");
    expect(semPrefixo).not.toBe(FONTE_QA);
    expect(entrarTemAlvoDeToque(classesDoEntrarNaFonte(semPrefixo))).toBe(
      false,
    );
  });

  it("a conta 36 px -> 40 px: a fonte do botão tem py-2.5 e text-xs, e md:min-h-10 completa o resto", () => {
    // py-2.5 (10 + 10) + linha do text-xs (16) = 36 px; md:min-h-10 sobe para 40 px no tablet.
    const classes = tokens(classesDoEntrarNaFonte(FONTE_QA));
    expect(classes).toContain("py-2.5");
    expect(classes).toContain("text-xs");
    expect(classes).toContain("md:min-h-10");
  });
});
