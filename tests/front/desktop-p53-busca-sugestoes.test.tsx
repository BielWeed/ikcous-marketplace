// @vitest-environment jsdom
// P53 (computador): o painel de sugestões da busca abria CENTRADO NA JANELA
// (cartão `fixed inset-x-0 mx-auto`), 162 a 242 px à direita do campo. No
// computador ele passa a nascer embaixo do campo, alinhado a ele: só classes
// com prefixo `lg:` acrescentadas; o celular (sem prefixo) fica byte a byte.
// jsdom NÃO calcula layout: aqui só se prova a classe aplicada; a posição em
// pixels no navegador real não é provada por este teste.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    loadingProducts: false,
    catalogoErro: false,
    fetchProducts: vi.fn(),
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn() },
}));

// @ts-expect-error flag de teste interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Lista LITERAL do celular (sem prefixo de breakpoint nem de variante).
const CARTAO_NO_CELULAR =
  "fixed inset-x-0 top-[calc(var(--header-height)+6px)] z-[100] mx-auto max-h-[72vh] w-[calc(100vw-24px)] max-w-lg overflow-y-auto rounded-[28px] border border-zinc-200/90 bg-white p-4 shadow-[0_30px_70px_-15px_rgba(0,0,0,0.35)] duration-200 animate-in fade-in slide-in-from-top-2";
const CONTEINER_NO_CELULAR = "relative z-[90] w-full overflow-hidden";

const CARTAO_NO_COMPUTADOR = [
  "lg:absolute",
  "lg:inset-x-auto",
  "lg:left-0",
  "lg:top-full",
  "lg:mx-0",
  "lg:mt-2",
  "lg:w-full",
  "lg:max-w-none",
];

const semPrefixo = (classes: string) =>
  classes
    .split(/\s+/)
    .filter((c) => c && !c.includes(":"))
    .join(" ");

const temTodas = (classes: string, esperadas: string[]) => {
  const tokens = classes.split(/\s+/);
  return esperadas.every((c) => tokens.includes(c));
};

describe("SearchBar — painel de sugestões no computador (P53)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function abrirPainel() {
    const { SearchBar } = await import("@/components/ui/custom/SearchBar");
    await act(async () => {
      raiz.render(<SearchBar value="bo" onChange={() => {}} />);
    });
    const campo = hospedeiro.querySelector("input")!;
    await act(async () => {
      campo.focus();
      campo.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    const veu = hospedeiro.querySelector<HTMLElement>(
      "button[aria-label='Fechar busca']",
    );
    expect(veu).not.toBeNull();
    const cartao = veu!.nextElementSibling as HTMLElement;
    const conteiner = hospedeiro.firstElementChild as HTMLElement;
    return { cartao, conteiner };
  }

  it("celular intacto: as classes sem prefixo do cartão e do contêiner não mudam", async () => {
    const { cartao, conteiner } = await abrirPainel();
    expect(semPrefixo(cartao.className)).toBe(CARTAO_NO_CELULAR);
    expect(semPrefixo(conteiner.className)).toBe(CONTEINER_NO_CELULAR);
  }, 15000);

  it("no computador o cartão vira absoluto, alinhado ao campo e abaixo dele", async () => {
    const { cartao } = await abrirPainel();
    expect(temTodas(cartao.className, CARTAO_NO_COMPUTADOR)).toBe(true);
  }, 15000);

  it("no computador o contêiner do campo deixa o cartão passar (sem corte)", async () => {
    const { conteiner } = await abrirPainel();
    expect(conteiner.className.split(/\s+/)).toContain("lg:overflow-visible");
  }, 15000);

  it("controle: tirando as classes de computador, a checagem reprova", async () => {
    const { cartao } = await abrirPainel();
    const semClassesNovas = cartao.className
      .split(/\s+/)
      .filter((c) => !CARTAO_NO_COMPUTADOR.includes(c))
      .join(" ");
    expect(temTodas(semClassesNovas, CARTAO_NO_COMPUTADOR)).toBe(false);
  }, 15000);

  it("o limite de altura e a rolagem interna do cartão continuam", async () => {
    const { cartao } = await abrirPainel();
    const tokens = cartao.className.split(/\s+/);
    expect(tokens).toContain("max-h-[72vh]");
    expect(tokens).toContain("overflow-y-auto");
    expect(tokens).toContain("z-[100]");
  }, 15000);
});
