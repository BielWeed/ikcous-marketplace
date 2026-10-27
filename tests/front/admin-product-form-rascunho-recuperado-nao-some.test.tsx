// @vitest-environment jsdom
//
// Produto NOVO com rascunho recuperado ("Rascunho recuperado automaticamente!"):
// a tela abre com os campos do rascunho. Se a lojista mexia num campo e
// desfazia (voltava ao texto recuperado), o salvamento automático achava que o
// formulário "voltou ao estado de abertura" e APAGAVA o rascunho do aparelho,
// sem aviso — fechar a tela perdia tudo. O rascunho recuperado só sai quando
// ela salva ou toca em "Descartar".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addProduct = vi.fn();
const onNavigate = vi.fn();
const onSetDirty = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct,
    updateProduct: vi.fn(),
    upsertVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
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

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: toastSuccess,
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE = "ikcous_product_form_draft:lojista-1";

function digitarInput(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const rascunhoRecuperado = {
  name: "Vestido recuperado",
  description: "Descrição do rascunho",
  price: "10.00",
  stock: "5",
  category: "Geral",
  images: [],
  variants: [],
  salvoEm: Date.now(),
};

describe("AdminProductFormView — rascunho recuperado de produto novo não some sozinho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    addProduct.mockResolvedValue({ id: "novo-1" });
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
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function abrir(comRascunho: boolean) {
    if (comRascunho) armazem.set(CHAVE, JSON.stringify(rascunhoRecuperado));
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          userId="lojista-1"
          onNavigate={onNavigate}
          onSetDirty={onSetDirty}
        />,
      );
      await vi.advanceTimersByTimeAsync(50);
    });
  }

  async function digitarNome(valor: string) {
    await act(async () => {
      digitarInput("product-name", valor);
      // 200 ms de espera do campo, antes de o valor chegar ao formulário.
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      // 1 s do salvamento automático, agendado só depois de o valor chegar.
      await vi.advanceTimersByTimeAsync(1100);
    });
  }

  const nomeGuardado = () =>
    JSON.parse(armazem.get(CHAVE) ?? "{}").name as string | undefined;

  it("o rascunho é recuperado de verdade (ponto de partida do teste)", async () => {
    await abrir(true);
    expect(toastSuccess).toHaveBeenCalledWith(
      "Rascunho recuperado automaticamente!",
      expect.anything(),
    );
    expect(
      (document.getElementById("product-name") as HTMLInputElement).value,
    ).toBe("Vestido recuperado");
  });

  it("mexer e desfazer NÃO apaga o rascunho recuperado (e ele guarda o texto recuperado)", async () => {
    await abrir(true);

    await digitarNome("Vestido recuperado X");
    expect(nomeGuardado()).toBe("Vestido recuperado X");

    await digitarNome("Vestido recuperado");

    expect(armazem.has(CHAVE)).toBe(true);
    expect(nomeGuardado()).toBe("Vestido recuperado");
  });

  it("mexer e desfazer duas vezes seguidas continua guardando", async () => {
    await abrir(true);
    for (let i = 0; i < 2; i++) {
      await digitarNome("Outro nome");
      await digitarNome("Vestido recuperado");
    }
    expect(armazem.has(CHAVE)).toBe(true);
    expect(nomeGuardado()).toBe("Vestido recuperado");
  });

  it("'Descartar' do aviso apaga o rascunho, e mexer e desfazer depois NÃO o traz de volta", async () => {
    await abrir(true);
    await digitarNome("Vestido recuperado X");

    const opcoes = toastSuccess.mock.calls[0][1] as {
      action: { onClick: () => void };
    };
    await act(async () => {
      opcoes.action.onClick();
    });
    expect(armazem.has(CHAVE)).toBe(false);

    await digitarNome("Vestido novo");
    await digitarNome("");
    // Sem rascunho recuperado vigente, voltar ao vazio apaga o que o
    // salvamento automático gravou (comportamento de sempre).
    expect(armazem.has(CHAVE)).toBe(false);
  });

  it("publicar apaga o rascunho recuperado e o salvamento automático não o replanta", async () => {
    await abrir(true);
    await digitarNome("Vestido recuperado X");
    await digitarNome("Vestido recuperado");
    expect(armazem.has(CHAVE)).toBe(true);

    const barra = document.querySelector<HTMLElement>(
      '[aria-label="Ações do produto"]',
    );
    const botao = [...(barra?.querySelectorAll("button") ?? [])].find((b) =>
      b.textContent?.includes("Publicar"),
    );
    expect(botao).toBeDefined();
    await act(async () => {
      botao?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(addProduct).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(armazem.has(CHAVE)).toBe(false);
  });

  it("sem rascunho recuperado, mexer e desfazer continua limpando o que o próprio salvamento automático gravou", async () => {
    await abrir(false);
    await digitarNome("Teste");
    expect(armazem.has(CHAVE)).toBe(true);

    await digitarNome("");
    expect(armazem.has(CHAVE)).toBe(false);
  });
});
