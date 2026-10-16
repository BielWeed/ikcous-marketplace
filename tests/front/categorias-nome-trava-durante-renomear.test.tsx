// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, renameCategory, deleteCategory, setCategoryActive } =
  vi.hoisted(() => ({
    rpcMock: vi.fn(),
    renameCategory: vi.fn(),
    deleteCategory: vi.fn(),
    setCategoryActive: vi.fn(),
  }));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcMock } }));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ renameCategory, deleteCategory, setCategoryActive }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { GerenciarCategorias } from "@/components/admin/categorias/GerenciarCategorias";
import {
  ErroDeCategoria,
  type ResultadoDoRenome,
} from "@/lib/gestao-de-categorias";

const CATEGORIA = {
  id: "c-joias",
  nome: "Joias",
  slug: "joias",
  ativo: true,
  produtos: 0,
  produtos_excluidos: 0,
  banners: 0,
  regra_devolucao: 0,
};

const RENOMEADA: ResultadoDoRenome = {
  id: "c-joias",
  nomeAntigo: "Joias",
  nome: "Anéis",
  slug: "aneis",
  mudou: true,
  produtos: 0,
  banners: 0,
  regraDeDevolucao: 0,
};

function renomeacaoPendente() {
  let concluir: (resultado: ResultadoDoRenome) => void = () => {};
  let recusar: (erro: Error) => void = () => {};
  const promessa = new Promise<ResultadoDoRenome>((resolve, reject) => {
    concluir = resolve;
    recusar = reject;
  });
  return { promessa, concluir, recusar };
}

function botao(nome: string): HTMLButtonElement {
  const achado = [...document.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === nome || b.textContent?.trim() === nome,
  );
  if (!achado) throw new Error(`Botão "${nome}" não está na tela.`);
  return achado;
}

function campoDoNome(): HTMLInputElement {
  const campo = document.querySelector<HTMLInputElement>(
    "#nome-da-categoria-c-joias",
  );
  if (!campo) throw new Error("Campo do nome não está na tela.");
  return campo;
}

function digitar(texto: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(campoDoNome(), texto);
  campoDoNome().dispatchEvent(new Event("input", { bubbles: true }));
}

const espera = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("Nome da categoria durante a renomeação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    rpcMock.mockResolvedValue({ data: [CATEGORIA], error: null });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
  });

  async function editarNome() {
    await act(async () => {
      raiz.render(<GerenciarCategorias aberta onFechar={() => {}} />);
      await espera();
    });
    await act(async () => {
      botao("Renomear Joias").click();
    });
    await act(async () => {
      digitar("Anéis");
    });
    expect(campoDoNome().disabled).toBe(false);
    expect(campoDoNome().value).toBe("Anéis");
  }

  it("trava o campo enquanto salva e fecha a edição depois do sucesso", async () => {
    const pendente = renomeacaoPendente();
    renameCategory.mockReturnValueOnce(pendente.promessa);
    await editarNome();

    await act(async () => {
      botao("Salvar nome").click();
    });

    expect(renameCategory).toHaveBeenCalledWith("c-joias", "Anéis");
    expect(campoDoNome().disabled).toBe(true);
    expect(campoDoNome().value).toBe("Anéis");
    expect(botao("Salvando…").disabled).toBe(true);
    expect(botao("Cancelar").disabled).toBe(true);
    expect(document.querySelector("#renomear-categoria-c-joias")).toBeNull();
    expect(document.querySelector("#apagar-categoria-c-joias")).toBeNull();

    rpcMock.mockResolvedValue({
      data: [{ ...CATEGORIA, nome: "Anéis", slug: "aneis" }],
      error: null,
    });
    await act(async () => {
      pendente.concluir(RENOMEADA);
      await espera();
    });

    expect(document.querySelector("#nome-da-categoria-c-joias")).toBeNull();
    expect(botao("Renomear Anéis").disabled).toBe(false);
    expect(botao("Apagar Anéis").disabled).toBe(false);
  });

  it("depois de erro, habilita o campo mantendo o texto para corrigir", async () => {
    const pendente = renomeacaoPendente();
    renameCategory.mockReturnValueOnce(pendente.promessa);
    await editarNome();

    await act(async () => {
      botao("Salvar nome").click();
    });
    expect(campoDoNome().disabled).toBe(true);

    await act(async () => {
      pendente.recusar(new ErroDeCategoria("Nome já cadastrado.", "23505"));
      await espera();
    });

    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Nome já cadastrado.",
    );
    expect(campoDoNome().disabled).toBe(false);
    expect(campoDoNome().value).toBe("Anéis");
    expect(botao("Salvar nome").disabled).toBe(false);
    expect(botao("Cancelar").disabled).toBe(false);

    await act(async () => {
      digitar("Anéis de prata");
    });
    expect(campoDoNome().value).toBe("Anéis de prata");
  });
});
