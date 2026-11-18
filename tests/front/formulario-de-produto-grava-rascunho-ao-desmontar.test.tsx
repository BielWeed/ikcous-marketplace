// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    upsertVariants: vi.fn(),
    deleteVariants: vi.fn(),
    uploadProductImages: vi.fn(),
    fetchProduct: vi.fn(),
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], addCategory: vi.fn() }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) },
}));
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    success: vi.fn(),
    dismiss: vi.fn(),
  },
}));
// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE = "ikcous_product_form_draft:lojista-1";
let raiz: Root;
let hospedeiro: HTMLDivElement;
let desmontou: boolean;
let armazem: Map<string, string>;
const gravar = vi.fn();
function sair() {
  act(() => raiz.unmount());
  desmontou = true;
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  armazem = new Map();
  gravar.mockImplementation((chave: string, valor: string) =>
    armazem.set(chave, valor),
  );
  vi.stubGlobal("localStorage", {
    getItem: (c: string) => armazem.get(c) ?? null,
    setItem: gravar,
    removeItem: (c: string) => armazem.delete(c),
  });
  desmontou = false;
  hospedeiro = document.createElement("div");
  document.body.append(hospedeiro);
  raiz = createRoot(hospedeiro);
  const { AdminProductFormView } = await import(
    "@/views/admin/AdminProductFormView"
  );
  await act(async () =>
    raiz.render(
      <AdminProductFormView
        userId="lojista-1"
        onNavigate={vi.fn()}
        onSetDirty={vi.fn()}
      />,
    ),
  );
});
afterEach(() => {
  if (!desmontou) sair();
  hospedeiro.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function digitarNome(valor: string) {
  await act(async () => {
    const input = document.getElementById("product-name") as HTMLInputElement;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Só o debounce do campo; ainda não passou o segundo do rascunho.
    await vi.advanceTimersByTimeAsync(300);
  });
}
const nomeGuardado = () => JSON.parse(armazem.get(CHAVE) ?? "{}").name;

it("desmontar antes de um segundo grava o estado mais recente", async () => {
  await digitarNome("Primeiro nome");
  await digitarNome("Último nome");
  expect(armazem.has(CHAVE)).toBe(false);
  sair();
  expect(nomeGuardado()).toBe("Último nome");
});

it.each(["pagehide", "hidden"])(
  "%s grava imediatamente e não duplica depois",
  async (evento) => {
    await digitarNome("Produto pendente");
    expect(armazem.has(CHAVE)).toBe(false);
    await act(async () => {
      if (evento === "pagehide") {
        window.dispatchEvent(new Event("pagehide"));
      } else {
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        document.dispatchEvent(new Event("visibilitychange"));
      }
    });
    expect(nomeGuardado()).toBe("Produto pendente");
    const chamadas = gravar.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    sair();
    expect(gravar).toHaveBeenCalledTimes(chamadas);
  },
);

it("continuar visível não antecipa o salvamento", async () => {
  await digitarNome("Ainda editando");
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(armazem.has(CHAVE)).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  expect(nomeGuardado()).toBe("Ainda editando");
});

it("sair do formulário vazio não cria rascunho", () => {
  sair();
  expect(armazem.has(CHAVE)).toBe(false);
});

it("depois de voltar ao estado inicial não grava um rascunho vazio", async () => {
  await digitarNome("Nome provisório");
  await digitarNome("");
  sair();
  expect(armazem.has(CHAVE)).toBe(false);
});
