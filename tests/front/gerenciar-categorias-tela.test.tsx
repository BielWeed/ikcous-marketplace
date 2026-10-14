// @vitest-environment jsdom
//
// A tela "Gerenciar categorias" (migration 20261237000000). A lojista só
// conseguia CRIAR categoria. Esta tela deixa renomear, esconder da vitrine e
// apagar, sem produto órfão: quem conta o que está em uso e quem troca o nome
// nos quatro lugares é o BANCO; a tela só mostra o que o servidor contou, só
// habilita "Apagar" quando a conta é zero e mostra o motivo se o banco recusar.
//
// Sem `@testing-library/react`: `createRoot` + `act`, padrão da casa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const {
  rpcMock,
  renameCategory,
  deleteCategory,
  setCategoryActive,
  toastSuccess,
} = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  renameCategory: vi.fn(),
  deleteCategory: vi.fn(),
  setCategoryActive: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcMock } }));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ renameCategory, deleteCategory, setCategoryActive }),
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

import { GerenciarCategorias } from "@/components/admin/categorias/GerenciarCategorias";
import { ErroDeCategoria } from "@/lib/gestao-de-categorias";

const USOS = [
  {
    id: "c-brinq",
    nome: "Brinquedos",
    slug: "brinquedos",
    ativo: true,
    produtos: 3,
    banners: 1,
    regra_devolucao: 1,
  },
  {
    id: "c-vazia",
    nome: "Promoção antiga",
    slug: "promocao-antiga",
    ativo: true,
    produtos: 0,
    banners: 0,
    regra_devolucao: 0,
  },
  {
    id: "c-oculta",
    nome: "Outono",
    slug: "outono",
    ativo: false,
    produtos: 2,
    banners: 0,
    regra_devolucao: 0,
  },
];

function botao(nome: string): HTMLButtonElement {
  const achado = [...document.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === nome || b.textContent?.trim() === nome,
  );
  if (!achado) throw new Error(`botão "${nome}" não está na tela`);
  return achado as HTMLButtonElement;
}

function digitar(rotulo: string, texto: string) {
  const campo = [...document.querySelectorAll("input")].find(
    (i) => i.id.startsWith("nome-da-categoria-") && rotulo === "nome",
  ) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(campo, texto);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

const espera = () => new Promise<void>((r) => setTimeout(r, 0));

describe("Gerenciar categorias", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({ data: USOS, error: null });
    renameCategory.mockResolvedValue({
      id: "c-brinq",
      nomeAntigo: "Brinquedos",
      nome: "Brinquedos de Montar",
      slug: "brinquedos-de-montar",
      mudou: true,
      produtos: 3,
      banners: 1,
      regraDeDevolucao: 1,
    });
    deleteCategory.mockResolvedValue({
      id: "c-vazia",
      nome: "Promoção antiga",
    });
    setCategoryActive.mockResolvedValue(undefined);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
  });

  async function abrir() {
    await act(async () => {
      raiz.render(<GerenciarCategorias aberta onFechar={() => {}} />);
    });
    await act(async () => {
      await espera();
    });
  }

  it("fechada, não pede nada ao servidor", async () => {
    await act(async () => {
      raiz.render(<GerenciarCategorias aberta={false} onFechar={() => {}} />);
    });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/Gerenciar categorias/);
  });

  it("aberta, pede a lista com uso ao servidor e mostra o que cada categoria usa", async () => {
    await abrir();
    expect(rpcMock).toHaveBeenCalledWith("categorias_com_uso");
    const texto = document.body.textContent ?? "";
    expect(texto).toMatch(/Brinquedos/);
    expect(texto).toMatch(
      /Em uso: 3 produtos, 1 banner e a regra de devolução\./,
    );
    expect(texto).toMatch(/Sem nenhum produto, banner ou regra\./);
    expect(texto).toMatch(/Escondida da vitrine/);
  });

  it("'Apagar' só está habilitado quando NADA aponta para a categoria", async () => {
    await abrir();
    expect(botao("Apagar Brinquedos").disabled).toBe(true);
    expect(botao("Apagar Outono").disabled).toBe(true);
    expect(botao("Apagar Promoção antiga").disabled).toBe(false);
    // e diz o que fazer antes de apagar a que está em uso
    expect(document.body.textContent).toMatch(/Para apagar: mude os produtos/);
  });

  it("apagar pede confirmação ANTES de chamar o banco, e só então apaga", async () => {
    await abrir();
    await act(async () => {
      botao("Apagar Promoção antiga").click();
    });
    expect(deleteCategory).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(
      /Apagar “Promoção antiga”\? Não dá para desfazer\./,
    );
    await act(async () => {
      botao("Apagar de vez").click();
      await espera();
    });
    expect(deleteCategory).toHaveBeenCalledTimes(1);
    expect(deleteCategory).toHaveBeenCalledWith("c-vazia");
    expect(document.body.textContent).toMatch(
      /Categoria “Promoção antiga” apagada\./,
    );
    // depois de apagar, a lista é relida do servidor
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it("'Manter' desiste de apagar sem chamar o banco", async () => {
    await abrir();
    await act(async () => {
      botao("Apagar Promoção antiga").click();
    });
    await act(async () => {
      botao("Manter").click();
    });
    expect(deleteCategory).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/Não dá para desfazer/);
  });

  it("renomear: mostra o que vai acompanhar, manda o nome digitado e diz o que acompanhou", async () => {
    await abrir();
    await act(async () => {
      botao("Renomear Brinquedos").click();
    });
    expect(document.body.textContent).toMatch(
      /Vão acompanhar o nome novo: 3 produtos, 1 banner e a regra de devolução\./,
    );
    await act(async () => {
      digitar("nome", "Brinquedos de Montar");
    });
    await act(async () => {
      botao("Salvar nome").click();
      await espera();
    });
    expect(renameCategory).toHaveBeenCalledTimes(1);
    expect(renameCategory).toHaveBeenCalledWith(
      "c-brinq",
      "Brinquedos de Montar",
    );
    expect(document.body.textContent).toMatch(
      /Categoria renomeada para “Brinquedos de Montar”\. Acompanharam o nome novo: 3 produtos, 1 banner e a regra de devolução\./,
    );
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("não deixa salvar o mesmo nome nem nome em branco", async () => {
    await abrir();
    await act(async () => {
      botao("Renomear Brinquedos").click();
    });
    expect(botao("Salvar nome").disabled).toBe(true); // o campo começa com o nome atual
    await act(async () => {
      digitar("nome", "   ");
    });
    expect(botao("Salvar nome").disabled).toBe(true);
    await act(async () => {
      digitar("nome", "Brinquedos 2");
    });
    expect(botao("Salvar nome").disabled).toBe(false);
  });

  it("quando o banco recusa (nome repetido), a frase DELE aparece na linha e nada é anunciado como feito", async () => {
    renameCategory.mockRejectedValueOnce(
      new ErroDeCategoria(
        'Já existe uma categoria chamada "Outono". Escolha outro nome.',
        "23505",
      ),
    );
    await abrir();
    await act(async () => {
      botao("Renomear Brinquedos").click();
    });
    await act(async () => {
      digitar("nome", "outono");
    });
    await act(async () => {
      botao("Salvar nome").click();
      await espera();
    });
    const alerta = document.querySelector('[role="alert"]');
    expect(alerta?.textContent).toBe(
      'Já existe uma categoria chamada "Outono". Escolha outro nome.',
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    // continua editando: a lojista corrige o nome sem recomeçar
    expect(document.querySelector("input")).not.toBeNull();
  });

  it("duplo toque em 'Salvar nome' manda UM pedido só", async () => {
    let liberar: (v: unknown) => void = () => {};
    renameCategory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          liberar = resolve;
        }),
    );
    await abrir();
    await act(async () => {
      botao("Renomear Brinquedos").click();
    });
    await act(async () => {
      digitar("nome", "Brinquedos de Montar");
    });
    const salvar = botao("Salvar nome");
    await act(async () => {
      salvar.click();
      salvar.click();
    });
    expect(renameCategory).toHaveBeenCalledTimes(1);
    await act(async () => {
      liberar({
        id: "c-brinq",
        nomeAntigo: "Brinquedos",
        nome: "Brinquedos de Montar",
        slug: "x",
        mudou: true,
        produtos: 0,
        banners: 0,
        regraDeDevolucao: 0,
      });
      await espera();
    });
  });

  it("esconder e mostrar da vitrine: só liga e desliga, e explica que os produtos continuam à venda", async () => {
    await abrir();
    await act(async () => {
      botao("Esconder Brinquedos da vitrine").click();
      await espera();
    });
    expect(setCategoryActive).toHaveBeenCalledWith("c-brinq", false);
    expect(document.body.textContent).toMatch(
      /saiu do filtro da vitrine\. Os produtos continuam à venda em “Todas”\./,
    );
    await act(async () => {
      botao("Mostrar Outono na vitrine").click();
      await espera();
    });
    expect(setCategoryActive).toHaveBeenCalledWith("c-oculta", true);
    expect(renameCategory).not.toHaveBeenCalled();
    expect(deleteCategory).not.toHaveBeenCalled();
  });

  it("lista que não carrega: diz o motivo e deixa tentar de novo (nunca finge lista vazia)", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "Acesso negado." },
    });
    await abrir();
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(
      /administra a loja/,
    );
    expect(document.body.textContent).not.toMatch(/Nenhuma categoria ainda/);
    await act(async () => {
      botao("Tentar de novo").click();
      await espera();
    });
    expect(document.body.textContent).toMatch(/Em uso: 3 produtos/);
  });

  it("servidor sem nenhuma categoria: diz isso", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    await abrir();
    expect(document.body.textContent).toMatch(/Nenhuma categoria ainda/);
  });
});
