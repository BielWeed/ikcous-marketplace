// @vitest-environment jsdom
//
// "Não consigo salvar o produto" (cliente pagante, 03/10/2026; selo "SLOW" na
// barra do painel = conexão lenta). Dois jeitos de o formulário prender a
// lojista sem dizer nada:
//
//  1. Foto subindo: enquanto `isImageUploading` o botão Publicar fica
//     desligado, e a compressão/o upload do celular em rede ruim não tinham
//     prazo -- uma promessa que nunca responde segurava o botão para sempre,
//     sem aviso na tela. Agora cada foto tem prazo; a que estoura (ou falha)
//     vira um item "Tentar de novo / Remover" e NUNCA impede salvar o resto.
//  2. Produto novo cuja grade não gravou: o formulário dava "Salvo", apagava o
//     rascunho e saía da tela. Agora fica, mantém o rascunho, diz o motivo, e
//     o próximo "Salvar" ATUALIZA o produto já criado (não cria outro).
//
// Mesmo padrão dos testes irmãos: createRoot + act, hooks de dados mockados.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  addProduct: vi.fn(),
  updateProduct: vi.fn(),
  upsertVariants: vi.fn(),
  uploadProductImages: vi.fn(),
  rpc: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: mocks.addProduct,
    updateProduct: mocks.updateProduct,
    upsertVariants: mocks.upsertVariants,
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: mocks.uploadProductImages,
    fetchProduct: vi.fn(),
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

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));

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

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: mocks.toastError,
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PRAZO_DA_FOTO_MS = 90_000;

function botaoPorTexto(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function clicar(texto: string) {
  const botao = botaoPorTexto(texto);
  if (!botao) throw new Error(`Botão "${texto}" não está na tela.`);
  botao.click();
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function digitarTextarea(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLTextAreaElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function selecionarCategoria(valor: string) {
  const el = document.querySelector(
    '[data-testid="select-category"]',
  ) as HTMLSelectElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLSelectElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function escolherFotos(arquivos: File[]) {
  const input = document.getElementById(
    "product-image-upload",
  ) as HTMLInputElement;
  Object.defineProperty(input, "files", {
    value: arquivos,
    configurable: true,
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

const foto = (nome: string) =>
  new File(["x"], nome, { type: "image/jpeg", lastModified: 1 });

const textoDe = (testid: string): string | null => {
  const el = document.querySelector(`[data-testid="${testid}"]`);
  return el ? (el.textContent?.replace(/\s+/g, " ").trim() ?? "") : null;
};

describe("AdminProductFormView — foto e grade não prendem a lojista em silêncio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  let removeItem: ReturnType<typeof vi.fn>;
  let onNavigate: Mock<
    (view: string, id?: string, bypassDirtyCheck?: boolean) => void
  >;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addProduct.mockResolvedValue({ id: "novo-1" });
    mocks.updateProduct.mockResolvedValue({ id: "p-1" });
    mocks.upsertVariants.mockResolvedValue(true);
    mocks.rpc.mockResolvedValue({
      data: { encontrado: false },
      error: null,
    });
    armazem = new Map();
    removeItem = vi.fn((c: string) => {
      armazem.delete(c);
    });
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem,
    });
    onNavigate = vi.fn();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montarPreenchido(extra?: { codigoBarras?: string }) {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView onNavigate={onNavigate} onSetDirty={vi.fn()} />,
      );
    });
    await act(async () => {
      digitar("product-name", "Camiseta");
      digitarTextarea("product-description", "Algodão");
      digitar("product-sale-price", "5000");
      digitar("product-stock", "3");
      if (extra?.codigoBarras)
        digitar("product-codigo-barras", extra.codigoBarras);
      selecionarCategoria("Geral");
      await new Promise((r) => setTimeout(r, 300));
    });
  }

  /** Só `setTimeout`/`clearTimeout` falsos: o resto (microtarefas, rAF) segue. */
  const relogioFalso = () =>
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  const avancar = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  const botaoPublicar = () => botaoPorTexto("Publicar") as HTMLButtonElement;

  describe("foto que nunca responde", () => {
    it("enquanto envia, o aviso diz 'Enviando fotos (1 de 2)' e o botão está desligado", async () => {
      await montarPreenchido();
      mocks.uploadProductImages.mockImplementation(
        () => new Promise<string[]>(() => {}),
      );
      relogioFalso();

      await act(async () => {
        escolherFotos([foto("a.jpg"), foto("b.jpg")]);
      });

      expect(botaoPublicar().disabled).toBe(true);
      const aviso = textoDe("motivo-do-bloqueio");
      expect(aviso).not.toBeNull();
      expect(aviso).toMatch(/Enviando fotos/i);
      expect(aviso).toContain("1 de 2");
    });

    it("estourado o prazo: a foto vira 'tentar de novo / remover', o botão LIBERA e o formulário não fica preso", async () => {
      await montarPreenchido();
      mocks.uploadProductImages.mockImplementation(
        () => new Promise<string[]>(() => {}),
      );
      relogioFalso();

      await act(async () => {
        escolherFotos([foto("a.jpg")]);
      });
      expect(botaoPublicar().disabled).toBe(true);

      await avancar(PRAZO_DA_FOTO_MS + 1);

      // O envio acabou: o aviso de "enviando" some e o botão volta a ligar.
      expect(textoDe("motivo-do-bloqueio")).toBeNull();
      expect(botaoPublicar().disabled).toBe(false);
      // A foto que falhou aparece, nomeada, com as duas saídas.
      const lista = textoDe("fotos-com-falha");
      expect(lista).not.toBeNull();
      expect(lista).toContain("a.jpg");
      expect(lista).toMatch(/demorou demais/i);
      expect(botaoPorTexto("Tentar de novo")).toBeDefined();
      expect(botaoPorTexto("Remover")).toBeDefined();
      // E diz que pode publicar sem ela (foto não é obrigatória).
      expect(lista).toMatch(/sem (ela|essa foto)/i);
    });

    it("antes do prazo ainda segue 'enviando' (o prazo não dispara cedo)", async () => {
      await montarPreenchido();
      mocks.uploadProductImages.mockImplementation(
        () => new Promise<string[]>(() => {}),
      );
      relogioFalso();

      await act(async () => {
        escolherFotos([foto("a.jpg")]);
      });
      await avancar(PRAZO_DA_FOTO_MS - 1000);

      expect(botaoPublicar().disabled).toBe(true);
      expect(textoDe("fotos-com-falha")).toBeNull();
    });
  });

  describe("foto que falha, e a que funciona", () => {
    it("upload devolve lista vazia (o hook engoliu o erro): foto marcada como não enviada", async () => {
      await montarPreenchido();
      mocks.uploadProductImages.mockResolvedValue([]);

      await act(async () => {
        escolherFotos([foto("a.jpg")]);
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(textoDe("fotos-com-falha")).toMatch(/a\.jpg.*não foi enviada/i);
      expect(botaoPublicar().disabled).toBe(false);
    });

    it("duas fotos, a segunda falha: a primeira entra, e Publicar leva só a que subiu", async () => {
      await montarPreenchido();
      mocks.uploadProductImages
        .mockResolvedValueOnce(["https://cdn/a.jpg"])
        .mockResolvedValueOnce([]);

      await act(async () => {
        escolherFotos([foto("a.jpg"), foto("b.jpg")]);
        await new Promise((r) => setTimeout(r, 0));
      });

      const lista = textoDe("fotos-com-falha");
      expect(lista).toContain("b.jpg");
      expect(lista).not.toContain("a.jpg");

      await act(async () => {
        botaoPublicar().click();
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(mocks.addProduct).toHaveBeenCalledTimes(1);
      expect(mocks.addProduct.mock.calls[0][0].images).toEqual([
        "https://cdn/a.jpg",
      ]);
    });

    it("Tentar de novo: a foto sobe, entra no produto e sai da lista de falhas", async () => {
      await montarPreenchido();
      mocks.uploadProductImages
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(["https://cdn/a.jpg"]);

      await act(async () => {
        escolherFotos([foto("a.jpg")]);
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(textoDe("fotos-com-falha")).not.toBeNull();

      await act(async () => {
        clicar("Tentar de novo");
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(textoDe("fotos-com-falha")).toBeNull();
      expect(mocks.uploadProductImages).toHaveBeenCalledTimes(2);
      expect(
        [...document.querySelectorAll("img")].some(
          (i) => i.getAttribute("src") === "https://cdn/a.jpg",
        ),
      ).toBe(true);
    });

    it("Remover: a foto some da lista de falhas e não volta", async () => {
      await montarPreenchido();
      mocks.uploadProductImages.mockResolvedValue([]);

      await act(async () => {
        escolherFotos([foto("a.jpg")]);
        await new Promise((r) => setTimeout(r, 0));
      });
      await act(async () => {
        clicar("Remover");
      });

      expect(textoDe("fotos-com-falha")).toBeNull();
      expect(mocks.uploadProductImages).toHaveBeenCalledTimes(1);
    });
  });

  describe("produto novo cuja grade não gravou", () => {
    const grade = {
      variantesNaoSalvas: {
        motivo:
          "Este SKU já está em outra variação da loja. Cada variação precisa de um SKU diferente.",
      },
    };

    async function publicarComGradeFalha() {
      mocks.addProduct.mockResolvedValueOnce({ id: "p-1", ...grade });
      await act(async () => {
        botaoPublicar().click();
        await new Promise((r) => setTimeout(r, 0));
      });
    }

    it("NÃO dá 'Salvo', NÃO sai da tela, mantém o rascunho e mostra o motivo", async () => {
      await montarPreenchido();
      await publicarComGradeFalha();
      // Passa da janela de 1,5 s em que o "Salvo" antigo navegava para fora.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1700));
      });

      expect(botaoPorTexto("Salvo")).toBeUndefined();
      expect(onNavigate).not.toHaveBeenCalled();
      expect(removeItem).not.toHaveBeenCalledWith("ikcous_product_form_draft");
      const aviso = textoDe("grade-nao-salva");
      expect(aviso).toContain("produto foi criado");
      expect(aviso).toContain("Este SKU já está em outra variação");
      // O botão agora é "Salvar" (produto existente), e está ligado.
      expect(botaoPorTexto("Salvar")?.disabled).toBe(false);
    });

    it("salvar de novo ATUALIZA o produto criado (id p-1) e grava a grade -- não cria outro", async () => {
      await montarPreenchido();
      await publicarComGradeFalha();

      await act(async () => {
        clicar("Salvar");
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(mocks.addProduct).toHaveBeenCalledTimes(1);
      expect(mocks.updateProduct).toHaveBeenCalledTimes(1);
      expect(mocks.updateProduct.mock.calls[0][0]).toBe("p-1");
      expect(mocks.upsertVariants).toHaveBeenCalledTimes(0); // sem grade na tela
      // Deu certo: agora sim "Salvo", rascunho do produto novo limpo.
      expect(botaoPorTexto("Salvo")).toBeDefined();
      expect(removeItem).toHaveBeenCalledWith("ikcous_product_form_draft");
      expect(textoDe("grade-nao-salva")).toBeNull();
    });

    it("o código de barras do PRÓPRIO produto criado não bloqueia a nova tentativa", async () => {
      await montarPreenchido({ codigoBarras: "7891234567890" });
      await publicarComGradeFalha();

      // Agora o banco já TEM o produto com esse código: é o próprio p-1.
      mocks.rpc.mockResolvedValue({
        data: {
          encontrado: true,
          origem: "produto",
          produto: { id: "p-1", nome: "Camiseta" },
        },
        error: null,
      });
      await act(async () => {
        clicar("Salvar");
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(mocks.updateProduct).toHaveBeenCalledTimes(1);
    });

    it("se a nova tentativa também falha, continua na tela e sem produto duplicado", async () => {
      await montarPreenchido();
      await publicarComGradeFalha();
      mocks.updateProduct.mockRejectedValueOnce(new Error("rede"));

      await act(async () => {
        clicar("Salvar");
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(botaoPorTexto("Salvo")).toBeUndefined();
      expect(mocks.addProduct).toHaveBeenCalledTimes(1);
      expect(botaoPorTexto("Salvar")?.disabled).toBe(false);
    });
  });
});
