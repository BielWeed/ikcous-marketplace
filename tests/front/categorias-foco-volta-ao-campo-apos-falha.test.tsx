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
const OUTRA_CATEGORIA = {
  ...CATEGORIA,
  id: "c-brincos",
  nome: "Brincos",
  slug: "brincos",
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

describe("Foco do nome depois da renomeação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    rpcMock.mockResolvedValue({
      data: [CATEGORIA, OUTRA_CATEGORIA],
      error: null,
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    vi.restoreAllMocks();
    hospedeiro.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  async function editarNome() {
    await act(async () => {
      raiz.render(<GerenciarCategorias aberta onFechar={() => {}} />);
      await espera();
    });
    await act(async () => {
      botao("Renomear Joias").click();
    });
    expect(document.activeElement).toBe(campoDoNome());
    await act(async () => {
      digitar("Anéis");
    });
  }

  async function enviarPorEnter() {
    const campo = campoDoNome();
    expect(document.activeElement).toBe(campo);
    await act(async () => {
      campo.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      // O jsdom não faz o submit implícito do Enter: reproduzimos essa ação.
      campo.form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(campo.disabled).toBe(true);
    return campo;
  }

  it("devolve o foco ao campo habilitado quando o envio por Enter falha", async () => {
    const pendente = renomeacaoPendente();
    renameCategory.mockReturnValueOnce(pendente.promessa);
    await editarNome();
    const campo = await enviarPorEnter();
    // O jsdom não desfoca ao desabilitar: activeElement sozinho daria um falso
    // positivo. O spy exige um focus() explícito após a falha, sem contar a abertura.
    const focarCampo = vi.spyOn(campo, "focus");

    await act(async () => {
      pendente.recusar(new ErroDeCategoria("Nome já cadastrado.", "23505"));
      await espera();
    });

    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Nome já cadastrado.",
    );
    expect(campoDoNome()).toBe(campo);
    expect(campo.disabled).toBe(false);
    expect(campo.value).toBe("Anéis");
    expect(focarCampo).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(campo);
  });

  it("fecha o editor no sucesso e devolve o foco ao botão de renomear", async () => {
    const pendente = renomeacaoPendente();
    renameCategory.mockReturnValueOnce(pendente.promessa);
    await editarNome();
    const campo = await enviarPorEnter();
    const focarCampo = vi.spyOn(campo, "focus");
    rpcMock.mockResolvedValue({
      data: [{ ...CATEGORIA, nome: "Anéis", slug: "aneis" }, OUTRA_CATEGORIA],
      error: null,
    });

    await act(async () => {
      pendente.concluir(RENOMEADA);
      await espera();
    });

    expect(document.querySelector("#nome-da-categoria-c-joias")).toBeNull();
    expect(campo.isConnected).toBe(false);
    expect(focarCampo).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(botao("Renomear Anéis"));
    expect(document.activeElement?.isConnected).toBe(true);
  });

  it("mantém Cancelar desabilitado e o editor aberto durante o envio", async () => {
    const pendente = renomeacaoPendente();
    renameCategory.mockReturnValueOnce(pendente.promessa);
    await editarNome();
    const campo = await enviarPorEnter();

    expect(botao("Cancelar").disabled).toBe(true);
    await act(async () => {
      botao("Cancelar").click();
    });
    expect(campoDoNome()).toBe(campo);
    expect(campo.disabled).toBe(true);
    expect(botao("Salvando…").disabled).toBe(true);

    await act(async () => {
      pendente.recusar(new ErroDeCategoria("Nome já cadastrado.", "23505"));
      await espera();
    });
    expect(botao("Cancelar").disabled).toBe(false);
  });

  it("não trava nem refoca o editor quando a operação é em outra linha", async () => {
    const pendente = renomeacaoPendente();
    setCategoryActive.mockReturnValueOnce(pendente.promessa);
    await editarNome();
    const campo = campoDoNome();
    const focarCampo = vi.spyOn(campo, "focus");
    const fechar = botao("Fechar");

    await act(async () => {
      fechar.focus();
      botao("Esconder Brincos da vitrine").click();
    });
    expect(campo.disabled).toBe(false);
    expect(campo.value).toBe("Anéis");
    expect(botao("Cancelar").disabled).toBe(false);
    expect(document.activeElement).toBe(fechar);

    await act(async () => {
      pendente.recusar(
        new ErroDeCategoria("Não foi possível esconder.", "P0001"),
      );
      await espera();
    });

    expect(campoDoNome()).toBe(campo);
    expect(campo.disabled).toBe(false);
    expect(campo.value).toBe("Anéis");
    expect(focarCampo).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(fechar);
  });
});
