// @vitest-environment jsdom
//
// A variante COMPOSTA no form do lojista (peça 19): o modal "Nova Variante"
// aceita uma ou mais duplas atributo+valor, e cada combinação vira UMA linha
// de variante com o estoque dela — a branca PP tem 3, a branca P pode ter 10.
// O desenho (uma linha por combinação, name="Cor / Tamanho",
// value="Branca / PP") e o porquê estão em `src/utils/variante-composta.ts`.
//
// O que ESTE arquivo prova, na tela de verdade: criar a combinação com dois
// atributos pelo clique real, criar uma SEGUNDA combinação do mesmo grupo
// (a trava de um grupo não pode confundir combinação com grupo novo), o caso
// simples de um atributo continuar saindo CRU (sem separador), a validação
// de par pela metade, a remoção do par extra, e a edição reabrindo em pares.
//
// Mesmo padrão de admin-product-form-um-grupo-de-variacao.test.tsx: sem
// @testing-library/react (não instalado), createRoot + act do React puro, e
// os hooks de dados mockados.
//
// DISCIPLINA DE ACT: dentro de `act(async ...)`, o re-render de um clique só
// aparece no próximo `await` — cada gesto que muda a tela fica no seu act, e
// quem CONSULTA a tela consulta DEPOIS do act que mudou ela.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    upsertVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct,
  }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
    addCategory: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: ReactNode;
  }) => (
    <select
      data-testid="select-category"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: toastError,
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function botaoPorTexto(raiz: ParentNode, texto: string) {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

/** Falha alto se o botão não existe: clique que não acontece deixa um
 *  `not.toHaveBeenCalled()` passar por vacuidade. */
function clicarObrigatorio(texto: string) {
  const botao = botaoPorTexto(document.body, texto);
  if (!botao) throw new Error(`Botão "${texto}" não está na tela.`);
  botao.click();
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  if (!el) throw new Error(`Campo "${id}" não está na tela.`);
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function valorDoCampo(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | null;
  return el?.value ?? "";
}

describe("AdminProductFormView — variante com mais de um atributo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
      },
    });
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
    vi.restoreAllMocks();
  });

  async function montar() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView onNavigate={vi.fn()} onSetDirty={vi.fn()} />,
      );
    });
  }

  /** Flush do debounce (200ms) do LocalBufferedInput — os onFlush digitados
   *  antes só chegam ao estado do form depois dele. */
  async function esperarFlushDosCampos() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
  }

  /** Abre "Nova Variante" do zero. */
  async function abrirModal() {
    await act(async () => {
      clicarObrigatorio("+ Novo");
    });
  }

  /** Digita um par inteiro (os campos já têm de estar na tela) e espera o
   *  debounce chegar ao estado. */
  async function digitarPar(indice: number, atributo: string, valor: string) {
    await act(async () => {
      digitar(
        indice === 0 ? "variant-name" : `variant-name-${indice}`,
        atributo,
      );
      digitar(
        indice === 0 ? "variant-value" : `variant-value-${indice}`,
        valor,
      );
      await new Promise((r) => setTimeout(r, 300));
    });
  }

  /** As variantes que a lista da tela mostra, como "Atributo: Valor". */
  function variantesNaTela(): string[] {
    return [
      ...document.querySelectorAll('[data-testid="variante-cadastrada"]'),
    ].map((el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "");
  }

  it("cria a combinação Cor=Branca E Tamanho=PP com um estoque só para a dupla", async () => {
    await montar();
    await abrirModal();

    await digitarPar(0, "Cor", "Branca");
    await act(async () => {
      clicarObrigatorio("+ Atributo");
    });

    await digitarPar(1, "Tamanho", "PP");
    await digitar("variant-stock", "3");
    await esperarFlushDosCampos();

    await act(async () => {
      clicarObrigatorio("Efetivar Variante");
    });

    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual(["Cor / Tamanho: Branca / PP"]);
    // O estoque digitado é DA COMBINAÇÃO — a branca PP tem 3, e é esse o
    // número que o pedido vai consumir da linha.
    expect(document.body.textContent).toContain("3 UND");
  });

  it("aceita a segunda combinação do MESMO grupo (a trava não confunde combinação com grupo)", async () => {
    await montar();

    await abrirModal();
    await digitarPar(0, "Cor", "Branca");
    await act(async () => {
      clicarObrigatorio("+ Atributo");
    });
    await digitarPar(1, "Tamanho", "PP");
    await act(async () => {
      clicarObrigatorio("Efetivar Variante");
    });

    await abrirModal();
    await digitarPar(0, "Cor", "Branca");
    await act(async () => {
      clicarObrigatorio("+ Atributo");
    });
    await digitarPar(1, "Tamanho", "P");
    await digitar("variant-stock", "10");
    await esperarFlushDosCampos();
    await act(async () => {
      clicarObrigatorio("Efetivar Variante");
    });

    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual([
      "Cor / Tamanho: Branca / PP",
      "Cor / Tamanho: Branca / P",
    ]);
  });

  it("um atributo só continua saindo CRU, sem separador nenhum", async () => {
    await montar();

    await abrirModal();
    await digitarPar(0, "Cor", "Espacial Grey");
    await act(async () => {
      clicarObrigatorio("Efetivar Variante");
    });

    expect(toastError).not.toHaveBeenCalled();
    // O caso simples de hoje NÃO PODE mudar de forma: a linha nasce igual à
    // que o produto de um atributo sempre nasceu ("Cor" / "Espacial Grey").
    expect(variantesNaTela()).toEqual(["Cor: Espacial Grey"]);
  });

  it("RECUSA par pela metade (atributo novo sem valor) e não efetiva", async () => {
    await montar();

    await abrirModal();
    await digitarPar(0, "Cor", "Branca");
    await act(async () => {
      clicarObrigatorio("+ Atributo");
    });
    await act(async () => {
      digitar("variant-name-1", "Tamanho");
      await new Promise((r) => setTimeout(r, 300));
    });
    await act(async () => {
      clicarObrigatorio("Efetivar Variante");
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toContain("obrigatório");
    expect(variantesNaTela()).toEqual([]);
  });

  it("remove o par extra pelo botão de remover e efetiva só o primeiro", async () => {
    await montar();

    await abrirModal();
    await digitarPar(0, "Cor", "Branca");
    await act(async () => {
      clicarObrigatorio("+ Atributo");
    });
    await digitarPar(1, "Tamanho", "PP");

    const remover = document.querySelector(
      '[aria-label="Remover atributo 2"]',
    ) as HTMLButtonElement | null;
    expect(remover).not.toBeNull();
    await act(async () => {
      remover?.click();
    });
    // O par removido saiu da tela.
    expect(document.getElementById("variant-name-1")).toBeNull();

    await act(async () => {
      clicarObrigatorio("Efetivar Variante");
    });

    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual(["Cor: Branca"]);
  });

  it("EDITAR a variante composta reabre os pares preenchidos e salva a mesma linha", async () => {
    await montar();

    await abrirModal();
    await digitarPar(0, "Cor", "Branca");
    await act(async () => {
      clicarObrigatorio("+ Atributo");
    });
    await digitarPar(1, "Tamanho", "PP");
    await act(async () => {
      clicarObrigatorio("Efetivar Variante");
    });

    // Reabre pela caneta da linha da variante composta.
    const rotulo = [
      ...document.querySelectorAll('[data-testid="variante-cadastrada"]'),
    ].find((el) => el.textContent?.includes("Branca / PP"));
    expect(rotulo).toBeDefined();
    const linha = rotulo?.closest("div.group");
    const caneta = linha?.querySelector("button") as HTMLButtonElement | null;
    expect(caneta).not.toBeNull();
    await act(async () => {
      caneta?.click();
    });

    // Os DOIS pares voltam preenchidos, um por dimensão.
    expect(valorDoCampo("variant-name")).toBe("Cor");
    expect(valorDoCampo("variant-value")).toBe("Branca");
    expect(valorDoCampo("variant-name-1")).toBe("Tamanho");
    expect(valorDoCampo("variant-value-1")).toBe("PP");

    // Salvar sem mexer reproduz a mesma linha — nada se perde no round-trip.
    // (No modo edição o rodapé muda o rótulo: "Salvar Protocolo".)
    await act(async () => {
      clicarObrigatorio("Salvar Protocolo");
    });
    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual(["Cor / Tamanho: Branca / PP"]);
  });
});
