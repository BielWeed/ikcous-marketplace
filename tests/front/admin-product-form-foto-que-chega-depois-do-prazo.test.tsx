// @vitest-environment jsdom
//
// Foto órfã no armazenamento (achado do PR #764, comentário 4174692699).
//
// O envio de cada foto tem prazo de 90 s (`comPrazo`). Estourado o prazo, a tela
// dá o envio por falha e oferece "Tentar de novo" -- mas `comPrazo` NÃO cancela
// o upload por baixo (o `upload` do cliente de storage não aceita
// `AbortSignal`). Se a requisição original termina COM SUCESSO depois do prazo,
// ela já gravou um objeto com nome aleatório (UUID) no bucket `products`, e a
// URL dele é descartada: arquivo órfão, e um novo a cada "Tentar de novo".
//
// A correção apaga, e só ele, o objeto que ESTE envio criou, quando o resultado
// chega depois de a tela ter dado o envio por falha. Estes testes cobrem os dois
// pontos de uso do prazo: o lote de fotos novas e o recorte ("tesoura").
//
// Mesmo padrão dos testes irmãos: createRoot + act, hooks de dados mockados.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addProduct: vi.fn(),
  updateProduct: vi.fn(),
  upsertVariants: vi.fn(),
  uploadProductImages: vi.fn(),
  rpc: vi.fn(),
  storageFrom: vi.fn(),
  storageRemove: vi.fn(),
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

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: mocks.rpc,
    storage: { from: mocks.storageFrom },
  },
}));

// O recorte real precisa de canvas; o dublê só expõe o botão que o confirma.
vi.mock("@/components/ui/custom/ImageAdjuster", () => ({
  ImageAdjuster: ({ onConfirm }: { onConfirm: (blob: Blob) => void }) => (
    <button
      type="button"
      data-testid="confirmar-recorte"
      onClick={() => onConfirm(new Blob(["recorte"], { type: "image/webp" }))}
    >
      Confirmar recorte
    </button>
  ),
}));

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
const BASE = "https://loja.supabase.co/storage/v1/object/public/products/";
const urlDe = (caminho: string) => `${BASE}${caminho}`;

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

const fotoNaTela = (url: string) =>
  [...document.querySelectorAll("img")].some(
    (i) => i.getAttribute("src") === url,
  );

/** Promessa que o teste resolve na hora que quiser (upload "lento"). */
function envioAdiado() {
  let resolver!: (urls: string[]) => void;
  const promessa = new Promise<string[]>((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}

describe("AdminProductFormView — foto que chega DEPOIS do prazo não vira arquivo órfão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    // `clearAllMocks` não esvazia a fila dos `...Once`: um teste que falha antes
    // de consumi-la vazaria envio pendente para o seguinte.
    mocks.uploadProductImages.mockReset();
    mocks.storageRemove.mockReset();
    mocks.addProduct.mockResolvedValue({ id: "novo-1" });
    mocks.rpc.mockResolvedValue({ data: { encontrado: false }, error: null });
    mocks.storageRemove.mockResolvedValue({ data: [], error: null });
    mocks.storageFrom.mockReturnValue({ remove: mocks.storageRemove });
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
      },
    });
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

  async function montarPreenchido() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView onNavigate={vi.fn()} onSetDirty={vi.fn()} />,
      );
    });
    await act(async () => {
      digitar("product-name", "Camiseta");
      digitarTextarea("product-description", "Algodão");
      digitar("product-sale-price", "5000");
      digitar("product-stock", "3");
      selecionarCategoria("Geral");
      await new Promise((r) => setTimeout(r, 300));
    });
  }

  /** Só `setTimeout`/`clearTimeout` falsos: o resto (microtarefas) segue. */
  const relogioFalso = () =>
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  const avancar = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  /** Deixa as continuações pendentes (microtarefas) correrem dentro do act. */
  const drenar = () =>
    act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });

  describe("lote de fotos novas", () => {
    it("o envio termina com sucesso DEPOIS do prazo: a tela dá a foto por falha e apaga o objeto que esse envio criou", async () => {
      await montarPreenchido();
      const envio = envioAdiado();
      mocks.uploadProductImages.mockReturnValueOnce(envio.promessa);
      relogioFalso();

      await act(async () => {
        escolherFotos([foto("a.jpg")]);
      });
      expect(mocks.uploadProductImages).toHaveBeenCalledTimes(1);
      await avancar(PRAZO_DA_FOTO_MS + 1);
      expect(textoDe("fotos-com-falha")).toMatch(/a\.jpg.*demorou demais/i);
      expect(mocks.storageRemove).not.toHaveBeenCalled();

      // O upload original, que ninguém cancelou, termina: o objeto JÁ existe.
      envio.resolver([urlDe("uuid-atrasado.jpg")]);
      await drenar();

      expect(mocks.storageFrom).toHaveBeenCalledWith("products");
      expect(mocks.storageRemove).toHaveBeenCalledTimes(1);
      expect(mocks.storageRemove).toHaveBeenCalledWith(["uuid-atrasado.jpg"]);
      // A foto que a tela deu por falha NÃO entrou no produto.
      expect(fotoNaTela(urlDe("uuid-atrasado.jpg"))).toBe(false);
      expect(textoDe("fotos-com-falha")).toContain("a.jpg");
    });

    it("tentar de novo depois do atraso: o objeto atrasado é apagado, o da nova tentativa (aceito) NÃO", async () => {
      await montarPreenchido();
      const primeiro = envioAdiado();
      mocks.uploadProductImages
        .mockReturnValueOnce(primeiro.promessa)
        .mockResolvedValueOnce([urlDe("uuid-da-segunda.jpg")]);
      relogioFalso();

      await act(async () => {
        escolherFotos([foto("a.jpg")]);
      });
      await avancar(PRAZO_DA_FOTO_MS + 1);
      primeiro.resolver([urlDe("uuid-da-primeira.jpg")]);
      await drenar();

      await act(async () => {
        clicar("Tentar de novo");
      });
      await drenar();

      expect(fotoNaTela(urlDe("uuid-da-segunda.jpg"))).toBe(true);
      expect(mocks.storageRemove).toHaveBeenCalledTimes(1);
      expect(mocks.storageRemove).toHaveBeenCalledWith([
        "uuid-da-primeira.jpg",
      ]);
    });

    it("controle: o envio termina DENTRO do prazo -- a foto entra no produto e nada é apagado", async () => {
      await montarPreenchido();
      const envio = envioAdiado();
      mocks.uploadProductImages.mockReturnValueOnce(envio.promessa);
      relogioFalso();

      await act(async () => {
        escolherFotos([foto("a.jpg")]);
      });
      await avancar(PRAZO_DA_FOTO_MS - 1000);
      envio.resolver([urlDe("uuid-no-prazo.jpg")]);
      await drenar();
      // Passa do instante do prazo: o relógio já foi desarmado e não apaga nada.
      await avancar(5000);

      expect(fotoNaTela(urlDe("uuid-no-prazo.jpg"))).toBe(true);
      expect(textoDe("fotos-com-falha")).toBeNull();
      expect(mocks.storageRemove).not.toHaveBeenCalled();
    });

    it("o upload atrasado devolve lista vazia (falhou de verdade): não há objeto, então nada é apagado", async () => {
      await montarPreenchido();
      const envio = envioAdiado();
      mocks.uploadProductImages.mockReturnValueOnce(envio.promessa);
      relogioFalso();

      await act(async () => {
        escolherFotos([foto("a.jpg")]);
      });
      await avancar(PRAZO_DA_FOTO_MS + 1);
      envio.resolver([]);
      await drenar();

      expect(mocks.storageRemove).not.toHaveBeenCalled();
    });

    it("apagar falha (o storage devolve erro ou lança): nada derruba a tela e a foto segue na lista de falhas", async () => {
      const erroLog = vi.spyOn(console, "error").mockImplementation(() => {});
      await montarPreenchido();
      const primeiro = envioAdiado();
      const segundo = envioAdiado();
      mocks.uploadProductImages
        .mockReturnValueOnce(primeiro.promessa)
        .mockReturnValueOnce(segundo.promessa);
      relogioFalso();

      // 1) o storage responde com erro (RLS, rede...).
      mocks.storageRemove.mockResolvedValueOnce({
        data: null,
        error: { message: "negado" },
      });
      await act(async () => {
        escolherFotos([foto("a.jpg")]);
      });
      await avancar(PRAZO_DA_FOTO_MS + 1);
      primeiro.resolver([urlDe("uuid-1.jpg")]);
      await drenar();
      expect(mocks.storageRemove).toHaveBeenCalledTimes(1);

      // 2) o storage LANÇA. Rejeição sem dono derrubaria o vitest.
      mocks.storageRemove.mockRejectedValueOnce(new Error("rede caiu"));
      await act(async () => {
        escolherFotos([foto("b.jpg")]);
      });
      await avancar(PRAZO_DA_FOTO_MS + 1);
      segundo.resolver([urlDe("uuid-2.jpg")]);
      await drenar();
      expect(mocks.storageRemove).toHaveBeenCalledTimes(2);

      // A tela segue de pé e mostrando as duas falhas.
      expect(textoDe("fotos-com-falha")).toContain("a.jpg");
      expect(textoDe("fotos-com-falha")).toContain("b.jpg");
      expect(erroLog).toHaveBeenCalled();
    });

    it("URL fora do bucket de produtos (ou de outra pasta): nada é apagado", async () => {
      await montarPreenchido();
      const envio = envioAdiado();
      mocks.uploadProductImages.mockReturnValueOnce(envio.promessa);
      relogioFalso();

      await act(async () => {
        escolherFotos([foto("a.jpg")]);
      });
      await avancar(PRAZO_DA_FOTO_MS + 1);
      envio.resolver([
        "https://loja.supabase.co/storage/v1/object/public/banners/b.jpg",
        urlDe("backup/antigo_123.jpg"),
        "https://placehold.co/600x600",
      ]);
      await drenar();

      expect(mocks.storageRemove).not.toHaveBeenCalled();
    });
  });

  describe("recorte (tesoura)", () => {
    async function abrirRecorteDeUmaFotoJaNoProduto() {
      mocks.uploadProductImages.mockResolvedValueOnce([urlDe("original.jpg")]);
      await act(async () => {
        escolherFotos([foto("a.jpg")]);
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(fotoNaTela(urlDe("original.jpg"))).toBe(true);
      const tesoura = document.querySelector(
        'button[title="Ajustar e Cortar"]',
      ) as HTMLButtonElement;
      await act(async () => {
        tesoura.click();
      });
    }

    const confirmarRecorte = () =>
      act(async () => {
        (
          document.querySelector(
            '[data-testid="confirmar-recorte"]',
          ) as HTMLButtonElement
        ).click();
      });

    it("o envio do recorte termina DEPOIS do prazo: a tela avisa erro, mantém a foto original e apaga o objeto do recorte", async () => {
      await montarPreenchido();
      await abrirRecorteDeUmaFotoJaNoProduto();
      const envio = envioAdiado();
      mocks.uploadProductImages.mockReturnValueOnce(envio.promessa);
      relogioFalso();

      await confirmarRecorte();
      expect(mocks.uploadProductImages).toHaveBeenCalledTimes(2);
      await avancar(PRAZO_DA_FOTO_MS + 1);
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Erro ao salvar imagem ajustada",
        expect.anything(),
      );
      expect(mocks.storageRemove).not.toHaveBeenCalled();

      envio.resolver([urlDe("uuid-do-recorte.webp")]);
      await drenar();

      expect(mocks.storageFrom).toHaveBeenCalledWith("products");
      expect(mocks.storageRemove).toHaveBeenCalledTimes(1);
      expect(mocks.storageRemove).toHaveBeenCalledWith([
        "uuid-do-recorte.webp",
      ]);
      // A foto original continua; o recorte descartado não entrou.
      expect(fotoNaTela(urlDe("original.jpg"))).toBe(true);
      expect(fotoNaTela(urlDe("uuid-do-recorte.webp"))).toBe(false);
    });

    it("controle: o recorte termina DENTRO do prazo -- troca a foto e nada é apagado", async () => {
      await montarPreenchido();
      await abrirRecorteDeUmaFotoJaNoProduto();
      mocks.uploadProductImages.mockResolvedValueOnce([
        urlDe("uuid-do-recorte-ok.webp"),
      ]);

      await confirmarRecorte();
      await drenar();

      expect(fotoNaTela(urlDe("uuid-do-recorte-ok.webp"))).toBe(true);
      expect(mocks.storageRemove).not.toHaveBeenCalled();
    });
  });
});
