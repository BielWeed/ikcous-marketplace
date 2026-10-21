// @vitest-environment jsdom
//
// A tela "Gerenciar categorias" (migration 20261237000000). A lojista só
// conseguia CRIAR categoria. Esta tela deixa renomear, esconder da vitrine e
// apagar, sem produto órfão: quem conta o que está em uso e quem troca o nome
// nos quatro lugares é o BANCO; a tela só mostra o que o servidor contou, só
// habilita "Apagar" quando a conta é zero e mostra o motivo se o banco recusar.
//
// Sem `@testing-library/react`: `createRoot` + `act`, padrão da casa.
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  updateCategory,
  toastSuccess,
} = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  renameCategory: vi.fn(),
  deleteCategory: vi.fn(),
  setCategoryActive: vi.fn(),
  updateCategory: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcMock } }));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    renameCategory,
    deleteCategory,
    setCategoryActive,
    updateCategory,
    categories: [{ id: "c-brinq", name: "Brinquedos", icone: "casa" }],
  }),
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

import { GerenciarCategorias } from "@/components/admin/categorias/GerenciarCategorias";
import { esquecerOCatalogoCarregado } from "@/lib/catalogo-de-icones";
import { ErroDeCategoria } from "@/lib/gestao-de-categorias";

const USOS = [
  {
    id: "c-brinq",
    nome: "Brinquedos",
    slug: "brinquedos",
    ativo: true,
    produtos: 3,
    produtos_excluidos: 0,
    banners: 1,
    regra_devolucao: 1,
  },
  {
    id: "c-vazia",
    nome: "Promoção antiga",
    slug: "promocao-antiga",
    ativo: true,
    produtos: 0,
    produtos_excluidos: 0,
    banners: 0,
    regra_devolucao: 0,
  },
  {
    // 2 produtos, 1 deles excluído: a lojista só enxerga 1 na lista de produtos
    id: "c-oculta",
    nome: "Outono",
    slug: "outono",
    ativo: false,
    produtos: 2,
    produtos_excluidos: 1,
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

// O catálogo que o painel serve (public/icons/categorias.json): a tela o busca por fetch ao abrir o seletor.
const CATALOGO: { chave: string; d: string }[] = JSON.parse(
  readFileSync(
    join(__dirname, "..", "..", "public", "icons", "categorias.json"),
    "utf8",
  ),
);
const fetchMock = vi.fn();

async function abrirSeletor(dentro: ParentNode = document) {
  const gatilho = [...dentro.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Escolher ícone",
  ) as HTMLButtonElement;
  await act(async () => {
    gatilho.click();
  });
  await act(async () => {
    await espera();
  });
}

describe("Gerenciar categorias", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    esquecerOCatalogoCarregado();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => CATALOGO });
    vi.stubGlobal("fetch", fetchMock);
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

  it("oferece os clássicos e o catálogo, mostra a prévia e salva a escolha nas duas colunas de uma vez", async () => {
    await abrir();
    const linha = [...document.querySelectorAll("li")].find((li) =>
      li.textContent?.includes("Brinquedos"),
    ) as HTMLElement;
    expect(
      linha.querySelector("svg[data-icone]")?.getAttribute("data-icone"),
    ).toBe("casa");
    // O catálogo só é pedido quando o seletor abre.
    expect(fetchMock).not.toHaveBeenCalled();
    await abrirSeletor(linha);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const classicos = linha.querySelector('section[aria-label="Clássicos"]');
    expect(classicos?.querySelectorAll("button")).toHaveLength(15);
    await act(async () => {
      botao("Ícone Moda para Brinquedos").click();
    });
    expect(updateCategory).toHaveBeenCalledWith(
      "c-brinq",
      { icone: "moda", iconeForma: null },
      true,
    );
    await act(async () => {
      botao("Ícone Automático para Brinquedos").click();
    });
    expect(updateCategory).toHaveBeenCalledWith(
      "c-brinq",
      { icone: null, iconeForma: null },
      true,
    );
    // Escolha do catálogo: guarda a FORMA e esvazia a chave antiga, no mesmo pedido.
    await act(async () => {
      botao("Ícone Blusa para Brinquedos").click();
    });
    const blusa = CATALOGO.find((i) => i.chave === "blusa");
    expect(updateCategory).toHaveBeenLastCalledWith(
      "c-brinq",
      { icone: null, iconeForma: blusa?.d },
      true,
    );
  });

  it("falha ao salvar o ícone fica na linha e não anuncia sucesso", async () => {
    updateCategory.mockRejectedValueOnce(new Error("Sem conexão"));
    await abrir();
    await abrirSeletor();
    await act(async () => {
      botao("Ícone Moda para Brinquedos").click();
    });
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("catálogo que não chega: os clássicos continuam e o aviso deixa tentar de novo", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await abrir();
    await abrirSeletor();
    expect(document.body.textContent).toMatch(
      /Não deu para carregar os ícones novos agora/,
    );
    expect(botao("Ícone Moda para Brinquedos")).toBeTruthy();
    await act(async () => {
      botao("Tentar de novo").click();
    });
    await act(async () => {
      await espera();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(botao("Ícone Blusa para Brinquedos")).toBeTruthy();
  });

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

  it("produto EXCLUIDO conta, mas a tela explica que ele nao aparece na lista e o que fazer", async () => {
    await abrir();
    const texto = document.body.textContent ?? "";
    expect(texto).toMatch(
      /Em uso: 2 produtos \(1 excluído, que não aparece na lista\)\./,
    );
    expect(texto).toMatch(
      /Produto excluído não aparece na lista de produtos e só sai da categoria com a ajuda do suporte\./,
    );
    // quem nao tem produto excluido nao ganha o aviso
    expect(
      texto.match(/só sai da categoria com a ajuda do suporte/g),
    ).toHaveLength(1);
  });

  it("a lista aparece na ordem do idioma pt-BR, nao na do banco (sem acento no meio da lista)", async () => {
    const linha = (id: string, nome: string) => ({
      id,
      nome,
      slug: id,
      ativo: true,
      produtos: 0,
      produtos_excluidos: 0,
      banners: 0,
      regra_devolucao: 0,
    });
    // a ordem do banco e' por byte: maiuscula antes de minuscula, acentuada no fim
    rpcMock.mockResolvedValueOnce({
      data: [
        linha("c1", "Outlet"),
        linha("c2", "bijuterias"),
        linha("c3", "Íntimos"),
        linha("c4", "Joias"),
      ],
      error: null,
    });
    await abrir();
    const nomes = [...document.querySelectorAll("li > div:first-child > span")]
      .map((s) => s.textContent)
      .filter((t) => t && !/Escondida/.test(t));
    expect(nomes).toEqual(["bijuterias", "Íntimos", "Joias", "Outlet"]);
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

  it("teclado: abrir 'Renomear' leva o foco ao campo; 'Cancelar' devolve o foco ao botao Renomear", async () => {
    await abrir();
    await act(async () => {
      botao("Renomear Brinquedos").click();
    });
    const campo = document.querySelector<HTMLInputElement>(
      'input[id^="nome-da-categoria-"]',
    );
    expect(campo).not.toBeNull();
    expect(document.activeElement).toBe(campo);

    await act(async () => {
      botao("Cancelar").click();
    });
    expect(document.activeElement).toBe(botao("Renomear Brinquedos"));
  });

  it("teclado: depois de renomear, o foco volta ao botao Renomear da mesma linha", async () => {
    await abrir();
    await act(async () => {
      botao("Renomear Brinquedos").click();
    });
    await act(async () => {
      digitar("nome", "Brinquedos de Montar");
    });
    await act(async () => {
      botao("Salvar nome").click();
      await espera();
    });
    await act(async () => {
      await espera();
    });
    expect(document.activeElement).toBe(botao("Renomear Brinquedos"));
  });

  it("teclado: 'Apagar' leva o foco ao 'Manter' (o lado seguro); 'Manter' devolve o foco ao botao Apagar", async () => {
    await abrir();
    await act(async () => {
      botao("Apagar Promoção antiga").click();
    });
    expect(document.activeElement).toBe(botao("Manter"));
    await act(async () => {
      botao("Manter").click();
    });
    expect(document.activeElement).toBe(botao("Apagar Promoção antiga"));
  });

  it("'Todas' e 'all' (o filtro da vitrine e o do painel) nao passam: avisa na tela, desabilita o Salvar e nao chama o banco", async () => {
    await abrir();
    await act(async () => {
      botao("Renomear Brinquedos").click();
    });
    for (const nome of ["Todas", "  TODAS ", "all", "All"]) {
      await act(async () => {
        digitar("nome", nome);
      });
      expect(botao("Salvar nome").disabled, nome).toBe(true);
      expect(
        document.querySelector('[role="alert"]')?.textContent,
        nome,
      ).toMatch(/já é do filtro que mostra todos os produtos/);
    }
    // com outro nome o aviso some e o Salvar volta
    await act(async () => {
      digitar("nome", "Todas as festas");
    });
    expect(botao("Salvar nome").disabled).toBe(false);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(renameCategory).not.toHaveBeenCalled();
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
