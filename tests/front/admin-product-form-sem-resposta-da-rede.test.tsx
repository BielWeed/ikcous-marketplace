// @vitest-environment jsdom
//
// Produto no painel com rede "pendurada" (conecta e não responde), visto da
// TELA. O prazo mora no hook (use-products-gravar-e-abrir-produto-com-prazo);
// aqui se prova o que a tela faz com o estouro:
//
// - Abrir um produto: o esqueleto cinza não fica para sempre. O estouro vira a
//   tela de erro que já existia ("Não foi possível carregar este produto" +
//   Recarregar) e agora com saída: "Voltar para Produtos".
// - Publicar sem resposta: o botão solta, o rascunho FICA (o produto novo pode
//   já ter sido criado; apagar o rascunho aqui é o que levava ao produto em
//   dobro) e a tela não dá "Salvo" nem sai para a lista.
// - Salvar edição sem resposta: o mesmo.
// - Grade sem resposta DEPOIS de o produto novo ser criado (o hook devolve o
//   produto com `variantesNaoSalvas.semResposta`): a tela vai para a edição dele
//   e tira a chave de produto novo, para o "Publicar" não criar a cópia.
import {
  MENSAGEM_PRODUTO_EDICAO_SEM_RESPOSTA,
  MENSAGEM_PRODUTO_LEITURA_SEM_RESPOSTA,
  MENSAGEM_PRODUTO_NOVO_GRADE_SEM_RESPOSTA,
  MENSAGEM_PRODUTO_NOVO_SEM_RESPOSTA,
  erroDeConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escolherCategoriaDoProduto } from "./helpers/escolher-categoria-do-produto";

const addProduct = vi.fn();
const updateProduct = vi.fn();
const fetchProduct = vi.fn();
const onNavigate = vi.fn();
const onSetDirty = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct,
    updateProduct,
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
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

const toastInfo = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: toastInfo,
    success: toastSuccess,
    error: toastError,
    loading: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE_NOVO = "ikcous_product_form_draft:lojista-1";
const CHAVE_EDICAO = "ikcous_product_form_draft_edit_prod-1:lojista-1";

const produtoDoBanco = {
  id: "prod-1",
  name: "Produto Existente",
  description: "Descrição existente",
  price: 100,
  costPrice: 50,
  originalPrice: null,
  stock: 10,
  category: "Geral",
  images: [] as string[],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  metaTitle: "",
  metaDescription: "",
  sku: "",
  variants: [] as unknown[],
  weightKg: null,
  widthCm: null,
  heightCm: null,
  lengthCm: null,
};

function digitarInput(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function digitarTextarea(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const botaoDaBarra = (texto: string) =>
  [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Ações do produto"] button',
    ),
  ].find((b) => b.textContent?.includes(texto));

const botaoPorTexto = (texto: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === texto,
  );

describe("AdminProductFormView — rede sem resposta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
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
    vi.useRealTimers();
  });

  async function montar(productId?: string) {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          userId="lojista-1"
          productId={productId}
          onNavigate={onNavigate}
          onSetDirty={onSetDirty}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("abrir produto sem resposta cai na tela de erro, que agora tem Voltar para Produtos", async () => {
    fetchProduct.mockRejectedValue(
      erroDeConsultaSemResposta(MENSAGEM_PRODUTO_LEITURA_SEM_RESPOSTA),
    );
    await montar("prod-1");

    expect(document.body.textContent).toContain(
      "Não foi possível carregar este produto",
    );
    // Não é mais o esqueleto cinza.
    expect(document.querySelector(".animate-pulse")).toBeNull();
    expect(botaoPorTexto("Recarregar")).toBeDefined();
    const voltar = botaoPorTexto("Voltar para Produtos");
    expect(voltar).toBeDefined();

    await act(async () => {
      voltar!.click();
    });
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("admin-products");
  });

  it("produto que NÃO existe mais continua indo para a lista com o aviso de antes", async () => {
    fetchProduct.mockResolvedValue(null);
    await montar("prod-1");

    expect(toastError).toHaveBeenCalledWith("Produto não encontrado");
    expect(onNavigate).toHaveBeenCalledWith("admin-products");
  });

  it("Publicar sem resposta solta o botão, guarda o rascunho e não diz Salvo nem sai da tela", async () => {
    addProduct.mockRejectedValue(
      erroDeConsultaSemResposta(MENSAGEM_PRODUTO_NOVO_SEM_RESPOSTA),
    );
    await montar();
    await act(async () => {
      digitarInput("product-name", "Produto Teste");
      digitarTextarea("product-description", "Descrição de teste");
      digitarInput("product-sale-price", "1000");
      digitarInput("product-stock", "5");
      escolherCategoriaDoProduto("Geral");
      await vi.advanceTimersByTimeAsync(300);
    });
    await passar(1500);
    // O rascunho do produto novo está guardado antes de publicar.
    const rascunhoAntes = armazem.get(CHAVE_NOVO);
    expect(rascunhoAntes).toBeDefined();

    const botao = botaoDaBarra("Publicar")!;
    expect(botao.disabled).toBe(false);
    await act(async () => {
      botao.click();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });
    await passar(2000);

    expect(addProduct).toHaveBeenCalledTimes(1);
    // Solto: de volta ao "Publicar", habilitado, sem "Salvando" nem "Salvo".
    const depois = botaoDaBarra("Publicar")!;
    expect(depois).toBeDefined();
    expect(depois.disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Salvando");
    expect(botaoDaBarra("Salvo")).toBeUndefined();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    // O rascunho FICA: o produto pode já existir no servidor e ela precisa
    // reencontrar o que digitou depois de conferir a lista.
    expect(armazem.has(CHAVE_NOVO)).toBe(true);
    expect(JSON.parse(armazem.get(CHAVE_NOVO)!).name).toBe("Produto Teste");
  });

  it("Salvar a edição sem resposta solta o botão e mantém o rascunho da edição", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco);
    updateProduct.mockRejectedValue(
      erroDeConsultaSemResposta(MENSAGEM_PRODUTO_EDICAO_SEM_RESPOSTA),
    );
    await montar("prod-1");
    await act(async () => {
      digitarInput("product-name", "Nome editado");
      await vi.advanceTimersByTimeAsync(200);
    });
    await passar(1500);
    expect(armazem.has(CHAVE_EDICAO)).toBe(true);

    const botao = botaoDaBarra("Salvar alterações")!;
    expect(botao.disabled).toBe(false);
    await act(async () => {
      botao.click();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });
    await passar(2000);

    expect(updateProduct).toHaveBeenCalledTimes(1);
    const depois = botaoDaBarra("Salvar alterações")!;
    expect(depois).toBeDefined();
    expect(depois.disabled).toBe(false);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(armazem.has(CHAVE_EDICAO)).toBe(true);
    expect(JSON.parse(armazem.get(CHAVE_EDICAO)!).name).toBe("Nome editado");
  });

  it("grade sem resposta depois de o produto ser criado: vai para a edição, move o rascunho e o Publicar NÃO cria segundo produto", async () => {
    addProduct.mockResolvedValue({
      id: "novo-1",
      variantesNaoSalvas: {
        motivo: MENSAGEM_PRODUTO_NOVO_GRADE_SEM_RESPOSTA,
        semResposta: true,
      },
    });
    await montar();
    await act(async () => {
      digitarInput("product-name", "Produto Teste");
      digitarTextarea("product-description", "Descrição de teste");
      digitarInput("product-sale-price", "1000");
      digitarInput("product-stock", "5");
      escolherCategoriaDoProduto("Geral");
      await vi.advanceTimersByTimeAsync(300);
    });
    await passar(1500);
    expect(armazem.has(CHAVE_NOVO)).toBe(true);

    await act(async () => {
      botaoDaBarra("Publicar")!.click();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });
    await passar(2000);

    expect(addProduct).toHaveBeenCalledTimes(1);
    // Vai para a edição do produto criado (bypass do aviso de alterações).
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(
      "admin-product-form",
      "novo-1",
      true,
    );
    // A chave de produto NOVO sumiu e não volta (nem recarregando); o
    // rascunho foi para a chave de edição, marcado como grade pendente.
    expect(armazem.has(CHAVE_NOVO)).toBe(false);
    const daEdicao = JSON.parse(
      armazem.get("ikcous_product_form_draft_edit_novo-1:lojista-1") ?? "{}",
    );
    expect(daEdicao.name).toBe("Produto Teste");
    expect(daEdicao.variacoesPendentes).toBe(true);
    // Sem o aviso "NÃO foram salvas" (não se sabe): o do hook é o único.
    expect(toastError).not.toHaveBeenCalledWith(
      expect.stringContaining("NÃO foram salvas"),
      expect.anything(),
    );
    expect(toastSuccess).not.toHaveBeenCalled();

    // A tela segue montada (o App troca de rota): um novo toque em Publicar
    // NÃO chama o cadastro de novo.
    const botao = botaoDaBarra("Publicar");
    if (botao && !botao.disabled) {
      await act(async () => {
        botao.click();
        await vi.advanceTimersByTimeAsync(0);
      });
    }
    await passar(3000);
    expect(addProduct).toHaveBeenCalledTimes(1);
    expect(armazem.has(CHAVE_NOVO)).toBe(false);
  });
});
