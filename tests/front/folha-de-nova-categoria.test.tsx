// @vitest-environment jsdom
//
// "Nova categoria" de dentro do formulário de produto: uma folha de baixo com a galeria de ícones (a mesma de
// Gerenciar categorias), no lugar da janela antiga (diálogo central, rótulos em caixa-alta, botão dourado).
// A categoria é criada SEM ícone no banco (addCategory não mexe nas colunas de ícone, para loja com banco antigo
// não quebrar); o ícone escolhido vai num segundo passo, depois que a categoria existe.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { esquecerOCatalogoCarregado } from "@/lib/catalogo-de-icones";
import { ErroDeCategoria } from "@/lib/gestao-de-categorias";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CATALOGO: { chave: string; nome: string; grupo: string; d: string }[] =
  JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do próprio repositório, não entrada de usuário
    readFileSync(
      join(__dirname, "..", "..", "public", "icons", "categorias.json"),
      "utf8",
    ),
  );
const forma = (chave: string) => CATALOGO.find((i) => i.chave === chave)?.d;
const fetchMock = vi.fn();

const fetchProduct = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    salvarProdutoComGrade: vi.fn(),
    upsertVariants: vi.fn(),
    deleteVariants: vi.fn(),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct,
  }),
}));

const addCategory = vi.fn();
const updateCategory = vi.fn();
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [
      { id: "cat-1", name: "Geral", slug: "geral" },
      { id: "cat-2", name: "Vestuário", slug: "vestuario" },
    ],
    addCategory,
    updateCategory,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
const toastWarning = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: toastSuccess,
    error: toastError,
    warning: toastWarning,
    loading: vi.fn(() => "toast-1"),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const AVISO_ICONE_NAO_SALVO =
  "Categoria criada, mas o ícone não foi salvo. Escolha o ícone em Organizar categorias.";

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) throw new Error(`Campo "${id}" não está na tela.`);
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function digitarNome(valor: string) {
  await act(async () => {
    digitar("cat-name", valor);
    // O campo só entrega o valor à folha depois de uma pausa.
    await new Promise((r) => setTimeout(r, 300));
  });
}

const esperar = (ms = 0) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

const botaoPorTexto = (texto: string, dentro: ParentNode = document) =>
  [...dentro.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;
const botaoPorRotulo = (rotulo: string) =>
  document.querySelector(`button[aria-label="${rotulo}"]`) as
    | HTMLButtonElement
    | undefined;
// O Radix liga o título à janela sozinho (aria-labelledby gerado): acha-se a
// folha pelo título "Nova categoria" que ela mesma mostra.
const folha = () =>
  ([...document.querySelectorAll('[role="dialog"]')].find((d) =>
    [...d.querySelectorAll("h2")].some(
      (h) => h.textContent?.trim() === "Nova categoria",
    ),
  ) ?? null) as HTMLElement | null;

describe("AdminProductFormView — folha de 'Nova categoria'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    esquecerOCatalogoCarregado();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => CATALOGO });
    vi.stubGlobal("fetch", fetchMock);
    addCategory.mockResolvedValue({ id: "cat-novo" });
    updateCategory.mockResolvedValue(undefined);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
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

  async function abrirNovaCategoria() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    if (!document.getElementById("product-category")) {
      await act(async () => {
        raiz.render(
          <AdminProductFormView
            userId="lojista-1"
            onNavigate={vi.fn()}
            onSetDirty={vi.fn()}
          />,
        );
      });
    }
    await act(async () => {
      document.getElementById("product-category")?.click();
    });
    await act(async () => {
      botaoPorTexto("Nova categoria")?.click();
    });
    // A folha é baixada sob demanda (import dinâmico) e o catálogo de ícones vem por fetch.
    await esperar(50);
    await esperar(50);
  }

  const botaoCriar = () =>
    botaoPorTexto("Criar categoria", folha() ?? document);
  const botaoCancelar = () => botaoPorTexto("Cancelar", folha() ?? document);
  const botaoFechar = () =>
    folha()?.querySelector('button[aria-label="Fechar"]') as
      | HTMLButtonElement
      | null
      | undefined;
  const textoDoCampoDeCategoria = () =>
    document.getElementById("product-category-valor")?.textContent;

  async function tocarEm(botao: HTMLButtonElement | undefined) {
    await act(async () => {
      botao?.click();
    });
  }

  it("abre a folha NOVA, com a galeria de ícones, e não a janela antiga", async () => {
    await abrirNovaCategoria();

    const f = folha();
    expect(f).not.toBeNull();
    expect(f?.querySelector("h2")?.textContent).toBe("Nova categoria");
    // O título está ligado à janela (leitor de tela) sem id escrito à mão.
    const idDoTitulo = f?.getAttribute("aria-labelledby");
    expect(idDoTitulo).toBeTruthy();
    expect(document.getElementById(idDoTitulo ?? "")?.textContent).toBe(
      "Nova categoria",
    );
    // A galeria de ícones está na folha, já aberta.
    expect(
      botaoPorRotulo("Ícone Automático para nova categoria"),
    ).toBeDefined();
    expect(
      f?.querySelectorAll('button[aria-label^="Ícone "]').length,
    ).toBeGreaterThan(10);
    // Nada da janela antiga.
    expect(document.body.textContent).not.toContain("Nova Categoria");
    expect(document.body.textContent).not.toContain(
      "Nova categoria para organizar a loja",
    );
    expect(f?.innerHTML).not.toContain("#f8d658");
    expect(f?.innerHTML).not.toContain("uppercase");
    // O campo de nome continua com o mesmo id e nome de sempre.
    const campo = document.getElementById("cat-name") as HTMLInputElement;
    expect(campo.name).toBe("categoryName");
    expect(campo.getAttribute("placeholder")).toBe("Ex.: Vestuário");
  });

  it("criar SEM ícone: cria uma vez, não mexe em ícone, seleciona a categoria e fecha", async () => {
    await abrirNovaCategoria();
    await digitarNome("Calçados");
    await tocarEm(botaoCriar());

    expect(addCategory).toHaveBeenCalledTimes(1);
    expect(addCategory).toHaveBeenCalledWith(
      { name: "Calçados", description: "", isActive: true },
      true,
    );
    expect(updateCategory).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith("Categoria criada com sucesso!", {
      id: "toast-1",
    });
    expect(folha()).toBeNull();
    expect(textoDoCampoDeCategoria()).toBe("Calçados");
  });

  it("criar com ícone do catálogo: primeiro cria, depois grava a forma no id DEFINITIVO", async () => {
    await abrirNovaCategoria();
    await digitarNome("Calçados");
    await tocarEm(botaoPorRotulo("Ícone Tênis para Calçados"));
    // Escolher não grava nada ainda, só marca.
    expect(addCategory).not.toHaveBeenCalled();
    expect(updateCategory).not.toHaveBeenCalled();
    expect(
      botaoPorRotulo("Ícone Tênis para Calçados")?.getAttribute("aria-pressed"),
    ).toBe("true");

    await tocarEm(botaoCriar());

    expect(addCategory).toHaveBeenCalledTimes(1);
    expect(updateCategory).toHaveBeenCalledTimes(1);
    expect(updateCategory).toHaveBeenCalledWith(
      "cat-novo",
      { icone: null, iconeForma: forma("tenis") },
      true,
    );
    expect(addCategory.mock.invocationCallOrder[0]).toBeLessThan(
      updateCategory.mock.invocationCallOrder[0],
    );
    expect(toastWarning).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(folha()).toBeNull();
    expect(textoDoCampoDeCategoria()).toBe("Calçados");
  });

  it("criar com ícone clássico: grava a chave e deixa a forma vazia", async () => {
    await abrirNovaCategoria();
    await digitarNome("Calçados");
    await tocarEm(botaoPorRotulo("Ícone Casa para Calçados"));
    await tocarEm(botaoCriar());

    expect(updateCategory).toHaveBeenCalledWith(
      "cat-novo",
      { icone: "casa", iconeForma: null },
      true,
    );
  });

  it("voltar para 'Automático' depois de escolher um ícone não grava ícone nenhum", async () => {
    await abrirNovaCategoria();
    await digitarNome("Calçados");
    await tocarEm(botaoPorRotulo("Ícone Casa para Calçados"));
    await tocarEm(botaoPorRotulo("Ícone Automático para Calçados"));
    await tocarEm(botaoCriar());

    expect(addCategory).toHaveBeenCalledTimes(1);
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it("se gravar o ícone falhar, a categoria JÁ existe: continua escolhida, a folha fecha e o aviso é curto (não é erro)", async () => {
    updateCategory.mockRejectedValue(new Error("sem rede"));
    await abrirNovaCategoria();
    await digitarNome("Calçados");
    await tocarEm(botaoPorRotulo("Ícone Tênis para Calçados"));
    await tocarEm(botaoCriar());

    expect(addCategory).toHaveBeenCalledTimes(1);
    expect(updateCategory).toHaveBeenCalledTimes(1);
    expect(toastWarning).toHaveBeenCalledTimes(1);
    expect(toastWarning).toHaveBeenCalledWith(AVISO_ICONE_NAO_SALVO, {
      id: "toast-1",
    });
    expect(toastError).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(folha()).toBeNull();
    expect(textoDoCampoDeCategoria()).toBe("Calçados");
  });

  it("nome que só difere em maiúscula ou acento avisa qual já existe e NÃO tenta criar", async () => {
    await abrirNovaCategoria();
    await digitarNome("VESTUARIO");
    await tocarEm(botaoPorRotulo("Ícone Casa para VESTUARIO"));
    await tocarEm(botaoCriar());

    expect(addCategory).not.toHaveBeenCalled();
    expect(updateCategory).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0][0])).toBe(
      "Já existe uma categoria parecida: Vestuário",
    );
    // A folha segue aberta, com o que ela digitou e o ícone que escolheu.
    expect(folha()).not.toBeNull();
    expect(
      (document.getElementById("cat-name") as HTMLInputElement).value,
    ).toBe("VESTUARIO");
    expect(
      botaoPorRotulo("Ícone Casa para VESTUARIO")?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("duplo toque rápido em 'Criar categoria' cria UMA vez só; o botão e a saída ficam travados enquanto cria", async () => {
    let terminar: (v: unknown) => void = () => {};
    addCategory.mockReturnValue(
      new Promise((resolve) => {
        terminar = resolve;
      }),
    );
    await abrirNovaCategoria();
    await digitarNome("Calçados");
    await tocarEm(botaoPorRotulo("Ícone Casa para Calçados"));

    await act(async () => {
      botaoCriar()?.click();
      botaoCriar()?.click();
    });

    expect(addCategory).toHaveBeenCalledTimes(1);
    expect(botaoCriar()?.disabled).toBe(true);
    expect(botaoCancelar()?.disabled).toBe(true);
    expect(botaoFechar()?.disabled).toBe(true);
    // Os ícones também travam: a escolha já foi levada para o segundo passo.
    expect(botaoPorRotulo("Ícone Casa para Calçados")?.disabled).toBe(true);

    // Esc e toque fora NÃO abandonam uma criação em andamento.
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(folha()).not.toBeNull();

    await act(async () => {
      terminar({ id: "cat-novo" });
    });
    expect(addCategory).toHaveBeenCalledTimes(1);
    expect(updateCategory).toHaveBeenCalledTimes(1);
    expect(folha()).toBeNull();
  });

  it("se a criação falhar, a folha continua aberta com o que foi digitado e o botão volta a funcionar", async () => {
    addCategory.mockRejectedValueOnce(new Error("sem rede"));
    await abrirNovaCategoria();
    await digitarNome("Calçados");
    await tocarEm(botaoCriar());

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith("Erro ao salvar categoria", {
      id: "toast-1",
    });
    expect(updateCategory).not.toHaveBeenCalled();
    expect(folha()).not.toBeNull();
    expect(botaoCriar()?.disabled).toBe(false);
    expect(botaoFechar()?.disabled).toBe(false);

    await tocarEm(botaoCriar());
    expect(addCategory).toHaveBeenCalledTimes(2);
    expect(folha()).toBeNull();
  });

  it("erro de categoria conhecido mostra a mensagem dele", async () => {
    addCategory.mockRejectedValueOnce(
      new ErroDeCategoria("Já existe uma categoria com esse nome."),
    );
    await abrirNovaCategoria();
    await digitarNome("Calçados");
    await tocarEm(botaoCriar());

    expect(toastError).toHaveBeenCalledWith(
      "Já existe uma categoria com esse nome.",
      { id: "toast-1" },
    );
  });

  it("nome vazio (ou só espaços): o botão fica desligado e nada é criado", async () => {
    await abrirNovaCategoria();
    const desligado = () => botaoCriar()?.getAttribute("aria-disabled");
    expect(desligado()).toBe("true");

    await digitarNome("   ");
    expect(desligado()).toBe("true");
    await tocarEm(botaoCriar());
    expect(addCategory).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();

    await digitarNome("Calçados");
    expect(desligado()).toBe("false");
  });

  it("Esc fecha e zera: ao abrir de novo o nome e o ícone voltam vazios", async () => {
    await abrirNovaCategoria();
    await digitarNome("Calçados");
    await tocarEm(botaoPorRotulo("Ícone Casa para Calçados"));

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(folha()).toBeNull();
    expect(addCategory).not.toHaveBeenCalled();

    await abrirNovaCategoria();
    expect(folha()).not.toBeNull();
    expect(
      (document.getElementById("cat-name") as HTMLInputElement).value,
    ).toBe("");
    // Sem escolha nenhuma, só o "Automático" está marcado.
    expect(
      [
        ...document.querySelectorAll(
          'button[aria-label^="Ícone "][aria-pressed="true"]',
        ),
      ].map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Ícone Automático para nova categoria"]);
    expect(botaoCriar()?.getAttribute("aria-disabled")).toBe("true");
  });

  it("o X (Fechar) e o Cancelar fecham sem criar, e a categoria que estava escolhida segue escolhida", async () => {
    await abrirNovaCategoria();
    await digitarNome("Calçados");
    await tocarEm(botaoFechar() ?? undefined);
    expect(folha()).toBeNull();
    expect(addCategory).not.toHaveBeenCalled();
    expect(textoDoCampoDeCategoria()).toBe("Escolher categoria");

    await abrirNovaCategoria();
    await tocarEm(botaoCancelar());
    expect(folha()).toBeNull();
    expect(addCategory).not.toHaveBeenCalled();
    expect(textoDoCampoDeCategoria()).toBe("Escolher categoria");
  });

  it("o X tem pelo menos 44 px de toque e os botões do rodapé têm contorno visível", async () => {
    await abrirNovaCategoria();
    expect(botaoFechar()?.className).toContain("size-11");
    const rodape = folha()?.querySelectorAll(
      '[data-slot="sheet-footer"] button',
    );
    expect(rodape?.length).toBe(2);
    for (const b of rodape ?? []) {
      expect(b.className, b.textContent ?? "").toContain("min-h-12");
      expect(b.className, b.textContent ?? "").toContain("border-solid");
    }
  });

  it("o formulário só baixa a folha sob demanda: import dinâmico (lazy), nunca estático", () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do próprio repositório, não entrada de usuário
    const fonte = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "src",
        "views",
        "admin",
        "AdminProductFormView.tsx",
      ),
      "utf8",
    );
    expect(fonte).toMatch(
      /lazy\(\s*\(\)\s*=>\s*import\(\s*"@\/components\/admin\/products\/FolhaDeNovaCategoria"/,
    );
    expect(fonte).not.toMatch(
      /^import[^;]*from "@\/components\/admin\/products\/FolhaDeNovaCategoria"/m,
    );
    // E os restos da janela antiga saíram.
    expect(fonte).not.toContain("titulo-da-categoria");
    expect(fonte).not.toContain("criandoCategoriaRef");
    expect(fonte).not.toContain("Nova Categoria");
    expect(fonte).not.toContain("cat-name");
  });
});
