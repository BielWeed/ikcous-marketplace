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
//     rascunho e saía da tela. Agora o rascunho muda para a chave de EDIÇÃO do
//     produto criado (a de produto novo é apagada, e o auto-save não a
//     recria) e a lojista é levada para a edição desse produto, com o motivo
//     escrito -- recarregar o app ou voltar em "Novo produto" nunca cria uma
//     segunda "Camiseta".
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
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  fetchProduct: vi.fn(),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: mocks.addProduct,
    updateProduct: mocks.updateProduct,
    upsertVariants: mocks.upsertVariants,
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: mocks.uploadProductImages,
    fetchProduct: mocks.fetchProduct,
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
    info: mocks.toastInfo,
    success: mocks.toastSuccess,
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
    const CHAVE_NOVO = "ikcous_product_form_draft";
    const CHAVE_EDICAO = "ikcous_product_form_draft_edit_p-1";

    async function publicarComGradeFalha() {
      mocks.addProduct.mockResolvedValueOnce({ id: "p-1", ...grade });
      await act(async () => {
        botaoPublicar().click();
        await new Promise((r) => setTimeout(r, 0));
      });
    }

    it("leva a lojista para a EDIÇÃO do produto criado, com o motivo escrito, sem 'Salvo' e sem criar de novo", async () => {
      await montarPreenchido();
      await publicarComGradeFalha();
      // Passa da janela de 1,5 s em que o "Salvo" antigo navegava para a lista.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1700));
      });

      expect(botaoPorTexto("Salvo")).toBeUndefined();
      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith(
        "admin-product-form",
        "p-1",
        true,
      );
      expect(mocks.addProduct).toHaveBeenCalledTimes(1);
      const [mensagem] = mocks.toastError.mock.calls.at(-1) as [string];
      expect(mensagem).toContain("produto foi criado");
      expect(mensagem).toContain("variações NÃO foram salvas");
      expect(mensagem).toContain("Este SKU já está em outra variação");
      expect(mensagem).toMatch(/tentar de novo/i);
    });

    it("se a ida para a edição se perde (o App descarta navegação seguida), um segundo Publicar NÃO cria outro produto", async () => {
      await montarPreenchido();
      await publicarComGradeFalha();
      // onNavigate é um dublê: a tela continua montada, como quando o App
      // descarta a navegação. O formulário ainda está preenchido.
      await act(async () => {
        botaoPublicar().click();
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(mocks.addProduct).toHaveBeenCalledTimes(1);
      const [mensagem] = mocks.toastError.mock.calls.at(-1) as [string];
      expect(mensagem).toContain("já foi criado");
    });

    it("o rascunho muda para a chave de edição de p-1, a de produto novo some, e o auto-save não a recria", async () => {
      await montarPreenchido();
      // O auto-save de 1 s da última digitação ainda está agendado: é ele que
      // reescreveria a chave de produto novo se nada o segurasse.
      await publicarComGradeFalha();
      expect(armazem.has(CHAVE_NOVO)).toBe(false);
      const movido = JSON.parse(armazem.get(CHAVE_EDICAO) ?? "null");
      expect(movido?.name).toBe("Camiseta");
      expect(movido?.stock).toBe("3");

      await act(async () => {
        await new Promise((r) => setTimeout(r, 1500));
      });
      expect(armazem.has(CHAVE_NOVO)).toBe(false);
      expect(armazem.has(CHAVE_EDICAO)).toBe(true);
    });

    it("recarregar o app e abrir 'Novo produto' NÃO recupera rascunho nem deixa criar outra Camiseta", async () => {
      await montarPreenchido();
      // O auto-save (1 s) já gravou o rascunho de produto novo, como na vida real.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1200));
      });
      expect(armazem.has(CHAVE_NOVO)).toBe(true);
      await publicarComGradeFalha();

      // Recarregar = a tela some e uma nova nasce; o localStorage fica.
      await act(async () => {
        raiz.render(<div />);
      });
      const { AdminProductFormView } = await import(
        "@/views/admin/AdminProductFormView"
      );
      await act(async () => {
        raiz.render(
          <AdminProductFormView onNavigate={onNavigate} onSetDirty={vi.fn()} />,
        );
        await new Promise((r) => setTimeout(r, 1300));
      });

      expect(mocks.toastSuccess).not.toHaveBeenCalledWith(
        expect.stringMatching(/Rascunho recuperado/),
        expect.anything(),
      );
      expect(
        (document.getElementById("product-name") as HTMLInputElement).value,
      ).toBe("");
      expect(botaoPublicar().disabled).toBe(true);
      expect(mocks.addProduct).toHaveBeenCalledTimes(1);
      expect(armazem.has(CHAVE_NOVO)).toBe(false);
    });

    it("na MESMA tela, trocar para productId p-1 (como o painel faz) abre a edição e oferece o rascunho com a grade", async () => {
      await montarPreenchido();
      await publicarComGradeFalha();
      // O que a lojista tinha na tela incluía uma grade; o banco só tem o produto.
      const rascunho = JSON.parse(armazem.get(CHAVE_EDICAO) as string);
      rascunho.variants = [
        {
          id: "v-1",
          productId: "",
          name: "Tamanho",
          value: "M",
          stockIncrement: 1,
          stock: 3,
          active: true,
        },
      ];
      armazem.set(CHAVE_EDICAO, JSON.stringify(rascunho));
      mocks.fetchProduct.mockResolvedValue({
        id: "p-1",
        name: "Camiseta",
        description: "Algodão",
        price: 50,
        stock: 3,
        category: "Geral",
        images: [],
        freeShipping: false,
        isBestseller: false,
        isActive: true,
        variants: [],
      });
      const { AdminProductFormView } = await import(
        "@/views/admin/AdminProductFormView"
      );

      await act(async () => {
        raiz.render(
          <AdminProductFormView
            productId="p-1"
            onNavigate={onNavigate}
            onSetDirty={vi.fn()}
          />,
        );
        await new Promise((r) => setTimeout(r, 100));
      });

      expect(mocks.fetchProduct).toHaveBeenCalledWith("p-1");
      expect(mocks.toastInfo).toHaveBeenCalledWith(
        "Rascunho não salvo encontrado para este produto",
        expect.anything(),
      );
      // O rascunho com a grade continua guardado, esperando "Restaurar".
      expect(
        JSON.parse(armazem.get(CHAVE_EDICAO) as string).variants,
      ).toHaveLength(1);
      expect(botaoPorTexto("Salvar")).toBeDefined();
    });

    it("a edição começa do zero: foto com falha do formulário de produto novo não vaza para a edição de p-1", async () => {
      await montarPreenchido();
      mocks.uploadProductImages.mockResolvedValue([]);
      await act(async () => {
        escolherFotos([foto("a.jpg")]);
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(textoDe("fotos-com-falha")).not.toBeNull();
      await publicarComGradeFalha();
      mocks.fetchProduct.mockResolvedValue({
        id: "p-1",
        name: "Camiseta",
        description: "Algodão",
        price: 50,
        stock: 3,
        category: "Geral",
        images: [],
        freeShipping: false,
        isBestseller: false,
        isActive: true,
        variants: [],
      });
      const { AdminProductFormView } = await import(
        "@/views/admin/AdminProductFormView"
      );

      await act(async () => {
        raiz.render(
          <AdminProductFormView
            productId="p-1"
            onNavigate={onNavigate}
            onSetDirty={vi.fn()}
          />,
        );
        await new Promise((r) => setTimeout(r, 100));
      });

      expect(textoDe("fotos-com-falha")).toBeNull();
    });

    it("se o navegador recusa gravar o rascunho de edição (cota cheia), ainda assim vai para a edição e apaga a chave de produto novo", async () => {
      await montarPreenchido();
      // Rascunho de produto novo já gravado pelo auto-save (1 s).
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1200));
      });
      expect(armazem.has(CHAVE_NOVO)).toBe(true);
      vi.stubGlobal("localStorage", {
        getItem: (c: string) => armazem.get(c) ?? null,
        setItem: (c: string, v: string) => {
          if (c === CHAVE_EDICAO) throw new Error("QuotaExceededError");
          armazem.set(c, v);
        },
        removeItem,
      });

      await publicarComGradeFalha();

      expect(onNavigate).toHaveBeenCalledWith(
        "admin-product-form",
        "p-1",
        true,
      );
      expect(armazem.has(CHAVE_NOVO)).toBe(false);
      expect(mocks.addProduct).toHaveBeenCalledTimes(1);
    });
  });
});
