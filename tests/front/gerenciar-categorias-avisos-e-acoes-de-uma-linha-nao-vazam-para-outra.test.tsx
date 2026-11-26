// @vitest-environment jsdom
//
// Folha "Gerenciar categorias": o que uma linha faz não pode deixar resto na
// tela de outra, nem uma frase velha ao lado da nova.
//
// - só UMA confirmação de apagar e UM campo de nome abertos por vez: abrir um
//   fecha o outro, mesmo em categorias diferentes;
// - frase de sucesso (verde) e de falha (vermelha) são sempre da ÚLTIMA ação:
//   começar outra ação, abrir o campo, pedir para apagar, cancelar ou manter
//   limpa a anterior;
// - com uma gravação em andamento o seletor de ícone também fica apagado;
// - a sugestão de ícone acompanha o nome DIGITADO enquanto o campo está aberto;
// - uma releitura da lista (volta para a aba) não troca a lista por "Carregando"
//   e um erro nela não vem junto de "Nenhuma categoria ainda".
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
  useCategories: () => ({
    renameCategory,
    deleteCategory,
    setCategoryActive,
    updateCategory: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { GerenciarCategorias } from "@/components/admin/categorias/GerenciarCategorias";
import { esquecerOCatalogoCarregado } from "@/lib/catalogo-de-icones";

const linha = (id: string, nome: string) => ({
  id,
  nome,
  slug: nome.toLowerCase(),
  ativo: true,
  produtos: 0,
  produtos_excluidos: 0,
  banners: 0,
  regra_devolucao: 0,
});
const JOIAS = linha("c-joias", "Joias");
const BOLSAS = linha("c-bolsas", "Bolsas");

function botao(nome: string): HTMLButtonElement {
  const achado = [...document.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === nome || b.textContent?.trim() === nome,
  );
  if (!achado) throw new Error(`Botão "${nome}" não está na tela.`);
  return achado;
}
const temBotao = (nome: string) =>
  [...document.querySelectorAll("button")].some(
    (b) =>
      b.getAttribute("aria-label") === nome || b.textContent?.trim() === nome,
  );
const campo = (id: string) =>
  document.querySelector<HTMLInputElement>(`#nome-da-categoria-${id}`);

function digitar(id: string, texto: string) {
  const alvo = campo(id);
  if (!alvo) throw new Error("Campo do nome não está na tela.");
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.call(alvo, texto);
  alvo.dispatchEvent(new Event("input", { bubbles: true }));
}

const espera = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const verde = () => document.querySelector('[role="status"].text-emerald-300');
const vermelho = () =>
  document.querySelector('[role="alert"].bg-red-500\\/10:not(.space-y-3)');
const alertas = () => [...document.querySelectorAll('[role="alert"]')];

describe("Gerenciar categorias — nada de uma linha vaza para outra", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    // O catálogo de ícones é pedido por rede quando o seletor abre: aqui não chega.
    esquecerOCatalogoCarregado();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("sem rede no teste")),
    );
    rpcMock.mockReset();
    renameCategory.mockReset();
    deleteCategory.mockReset();
    setCategoryActive.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  async function abrir(linhas = [JOIAS, BOLSAS]) {
    rpcMock.mockResolvedValue({ data: linhas, error: null });
    await act(async () => {
      raiz.render(<GerenciarCategorias aberta onFechar={() => {}} />);
      await espera();
    });
  }
  const clicar = async (nome: string) => {
    await act(async () => {
      botao(nome).click();
      await espera();
    });
  };

  it("pedir para apagar uma fecha o campo de nome aberto em outra", async () => {
    await abrir();
    await clicar("Renomear Joias");
    expect(campo("c-joias")).not.toBeNull();
    await clicar("Apagar Bolsas");
    expect(campo("c-joias")).toBeNull();
    expect(document.body.textContent).toContain("Apagar “Bolsas”?");
  });

  it("começar a renomear uma fecha a confirmação de apagar aberta em outra", async () => {
    await abrir();
    await clicar("Apagar Joias");
    expect(document.body.textContent).toContain("Apagar “Joias”?");
    await clicar("Renomear Bolsas");
    expect(document.body.textContent).not.toContain("Apagar “Joias”?");
    expect(campo("c-bolsas")).not.toBeNull();
  });

  it("a frase verde da ação anterior some quando se começa a renomear", async () => {
    setCategoryActive.mockResolvedValueOnce(undefined);
    await abrir();
    await clicar("Esconder Joias da vitrine");
    expect(verde()?.textContent).toContain("saiu do filtro da vitrine");
    await clicar("Renomear Bolsas");
    expect(verde()).toBeNull();
  });

  it("a frase verde da ação anterior some quando a seguinte falha", async () => {
    setCategoryActive
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("falha qualquer"));
    await abrir();
    await clicar("Esconder Joias da vitrine");
    expect(verde()).not.toBeNull();
    await clicar("Esconder Bolsas da vitrine");
    expect(alertas().length).toBeGreaterThan(0);
    expect(verde()).toBeNull();
  });

  it("a frase vermelha some ao pedir para apagar", async () => {
    setCategoryActive.mockRejectedValueOnce(new Error("falha qualquer"));
    await abrir();
    await clicar("Esconder Joias da vitrine");
    expect(vermelho()).not.toBeNull();
    await clicar("Apagar Joias");
    expect(vermelho()).toBeNull();
    expect(temBotao("Apagar de vez")).toBe(true);
  });

  it("a frase vermelha de um renome some ao Cancelar", async () => {
    renameCategory.mockRejectedValueOnce(new Error("falha qualquer"));
    await abrir();
    await clicar("Renomear Joias");
    await act(async () => {
      digitar("c-joias", "Anéis");
    });
    await clicar("Salvar nome");
    expect(vermelho()).not.toBeNull();
    await clicar("Cancelar");
    expect(vermelho()).toBeNull();
    expect(campo("c-joias")).toBeNull();
  });

  it("a frase vermelha de um apagar some ao Manter", async () => {
    deleteCategory.mockRejectedValueOnce(new Error("falha qualquer"));
    await abrir();
    await clicar("Apagar Joias");
    await clicar("Apagar de vez");
    expect(vermelho()).not.toBeNull();
    await clicar("Manter");
    expect(vermelho()).toBeNull();
    expect(temBotao("Apagar de vez")).toBe(false);
  });

  it("durante a gravação o seletor de ícone também fica apagado", async () => {
    let soltar: () => void = () => {};
    setCategoryActive.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        soltar = resolve;
      }),
    );
    await abrir([JOIAS]);
    await clicar("Escolher ícone");
    expect(botao("Ícone Automático para Joias").disabled).toBe(false);
    await act(async () => {
      botao("Esconder Joias da vitrine").click();
      await espera();
    });
    expect(botao("Renomear Joias").disabled).toBe(true);
    expect(botao("Ícone Automático para Joias").disabled).toBe(true);
    await act(async () => {
      soltar();
      await espera();
    });
    expect(botao("Ícone Automático para Joias").disabled).toBe(false);
  });

  it("a sugestão de ícone acompanha o nome que está sendo digitado", async () => {
    await abrir([JOIAS]);
    await clicar("Escolher ícone");
    await clicar("Renomear Joias");
    await act(async () => {
      digitar("c-joias", "Moda feminina");
    });
    expect(document.body.textContent).toContain(
      "Sugerimos pelo nome “Moda feminina”",
    );
  });

  it("releitura da lista (volta para a aba) mantém as categorias na tela, sem 'Carregando'", async () => {
    await abrir([JOIAS]);
    expect(document.body.textContent).toContain("Joias");
    rpcMock.mockReturnValue(new Promise<never>(() => {}));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await espera();
    });
    expect(document.body.textContent).toContain("Joias");
    expect(document.body.textContent).not.toContain(
      "Carregando as categorias…",
    );
  });

  it("lista vazia e a releitura falha: mostra o erro, sem dizer 'Nenhuma categoria ainda'", async () => {
    await abrir([]);
    expect(document.body.textContent).toContain("Nenhuma categoria ainda");
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "falha do servidor", code: "XX000" },
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await espera();
    });
    expect(alertas().length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("Nenhuma categoria ainda");
  });
});
