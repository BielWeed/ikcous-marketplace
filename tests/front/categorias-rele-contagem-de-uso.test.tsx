// @vitest-environment jsdom
import { GerenciarCategorias } from "@/components/admin/categorias/GerenciarCategorias";
import { ErroDeCategoria } from "@/lib/gestao-de-categorias";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, deleteCategory } = vi.hoisted(() => ({
  rpc: vi.fn(),
  deleteCategory: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ deleteCategory }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function contagem(produtos: number) {
  return {
    data: [
      {
        id: "c-joias",
        nome: "Joias",
        slug: "joias",
        ativo: true,
        produtos,
        produtos_excluidos: 0,
        banners: 0,
        regra_devolucao: 0,
      },
    ],
    error: null,
  };
}

function botao(nome: string): HTMLButtonElement {
  const achado = [...document.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === nome || b.textContent?.trim() === nome,
  );
  if (!achado) throw new Error(`Botão não encontrado: ${nome}`);
  return achado;
}

describe("A contagem de uso na gestão de categorias", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpc.mockReset();
    deleteCategory.mockReset();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mostrar(aberta: boolean) {
    await act(async () => {
      raiz.render(<GerenciarCategorias aberta={aberta} onFechar={() => {}} />);
    });
  }

  async function mudarVisibilidade() {
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
  }

  it("reconta ao voltar à aba, habilita Apagar e deixa de consultar ao fechar", async () => {
    const visibilidade = vi.spyOn(document, "visibilityState", "get");
    const remover = vi.spyOn(document, "removeEventListener");
    rpc.mockResolvedValueOnce(contagem(1)).mockResolvedValue(contagem(0));
    await mostrar(true);
    expect(botao("Apagar Joias").disabled).toBe(true);

    visibilidade.mockReturnValue("hidden");
    await mudarVisibilidade();
    expect(rpc).toHaveBeenCalledTimes(1);

    visibilidade.mockReturnValue("visible");
    await mudarVisibilidade();
    expect(rpc).toHaveBeenNthCalledWith(2, "categorias_com_uso");
    expect(botao("Apagar Joias").disabled).toBe(false);

    await mostrar(false);
    expect(remover).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    await mudarVisibilidade();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("reconta quando o servidor recusa apagar uma categoria em uso", async () => {
    rpc.mockResolvedValueOnce(contagem(0)).mockResolvedValue(contagem(1));
    deleteCategory.mockRejectedValueOnce(
      new ErroDeCategoria("A categoria está em uso.", "55006"),
    );
    await mostrar(true);
    expect(botao("Apagar Joias").disabled).toBe(false);
    await act(async () => botao("Apagar Joias").click());
    await act(async () => botao("Apagar de vez").click());

    expect(deleteCategory).toHaveBeenCalledWith("c-joias");
    expect(rpc).toHaveBeenNthCalledWith(2, "categorias_com_uso");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "A categoria está em uso.",
    );
    expect(botao("Apagar Joias").disabled).toBe(true);
  });
});
