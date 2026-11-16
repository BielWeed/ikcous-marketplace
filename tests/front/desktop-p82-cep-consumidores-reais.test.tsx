// @vitest-environment jsdom
// P82: consumidores e formulário reais; árvore/classes, nunca geometria.
import { readFileSync } from "node:fs";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  usuario: {
    id: "conta-inventada",
    user_metadata: { full_name: "Pessoa Teste" },
  },
  produto: {
    id: "produto-inventado",
    name: "Produto Teste",
    price: 100,
    description: "",
    images: [],
    category: "Teste",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-11-15T00:00:00Z",
    variants: [],
  },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      storeName: "Loja de ensaio",
      shippingCoverage: "local",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
      whatsappNumber: "",
    },
    isLoaded: true,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: estado.usuario, profile: null, loading: false }),
}));
vi.mock("@/hooks/useAddresses", () => {
  const valor = {
    addresses: [],
    loading: false,
    erroAoCarregar: false,
    fetchAddresses: vi.fn(async () => []),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
  };
  return { useAddresses: () => valor };
});
vi.mock("@/hooks/useCart", () => {
  const escolher = vi.fn();
  return {
    useCart: () => ({
      cart: [{ product: estado.produto, quantity: 1 }],
      cartTotal: 100,
      shippingFee: 0,
      clearCart: vi.fn(),
      removeFromCart: vi.fn(),
      addToCart: vi.fn(),
      selectedShippingOption: {
        id: "local-delivery",
        name: "Entrega Local",
        price: 0,
        deliveryDays: 1,
        provider: "local",
      },
      shippingCep: "01310-100",
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
      enderecoSelecionadoId: null,
      setEnderecoSelecionadoId: escolher,
    }),
  };
});
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", async (original) => ({
  ...(await original<typeof import("@/hooks/useOrders")>()),
  useOrders: () => ({ createOrder: vi.fn(), updateOrderStatus: vi.fn() }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));
vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: vi.fn(async () => true),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/hooks/useBuscaCep", async (original) => {
  const real = await original<typeof import("@/hooks/useBuscaCep")>();
  const { useState } = await import("react");
  return {
    ...real,
    useBuscaCep: () => {
      const [resultado, setResultado] = useState<{
        tipo: "indisponivel";
      } | null>(null);
      return {
        buscando: false,
        resultado,
        buscar: async () => {
          setResultado({ tipo: "indisponivel" });
        },
        limpar: () => setResultado(null),
      };
    },
  };
});

// @ts-expect-error flag interna de teste React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const rolagemOriginal = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);
let raiz: Root;
let host: HTMLDivElement;
beforeEach(() => {
  const valores = new Map<string, string>();
  const armazenamento = {
    getItem: (k: string) => valores.get(k) ?? null,
    setItem: (k: string, v: string) => {
      valores.set(k, v);
    },
    removeItem: (k: string) => {
      valores.delete(k);
    },
    clear: () => valores.clear(),
  };
  vi.stubGlobal("localStorage", armazenamento);
  vi.stubGlobal("sessionStorage", armazenamento);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Rede proibida nesta prova");
    }),
  );
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  host = document.createElement("div");
  document.body.append(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  if (rolagemOriginal) {
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      rolagemOriginal,
    );
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
  vi.unstubAllGlobals();
});

const caixaCep = () => {
  const campo = host.querySelector<HTMLInputElement>("#cep");
  expect(campo).not.toBeNull();
  return campo!.parentElement!;
};
const exigirCompacto = () =>
  expect(caixaCep().classList.contains("lg:max-w-xs")).toBe(true);
async function provocarErro() {
  const input = host.querySelector<HTMLInputElement>("#cep")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "12345678");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(input.getAttribute("aria-invalid")).toBe("true");
  const caixa = caixaCep();
  expect(caixa.classList.contains("relative")).toBe(true);
  const glifo = caixa.querySelector(
    "svg.lucide-circle-alert, svg.lucide-alert-circle",
  );
  expect(glifo).not.toBeNull();
  const posicionador = glifo!.parentElement!;
  expect(posicionador.parentElement).toBe(caixa);
  for (const classe of ["absolute", "right-4", "top-1/2", "-translate-y-1/2"]) {
    expect(posicionador.classList.contains(classe), classe).toBe(true);
  }
  const aviso = host.querySelector("#aviso-cep")!;
  expect(aviso.textContent).toContain("Não deu para buscar o CEP agora");
  expect(caixa.contains(aviso)).toBe(false);
  const link = host.querySelector('a[href*="buscacepinter.correios.com.br"]');
  expect(link).not.toBeNull();
  expect(caixa.contains(link)).toBe(false);
}

async function contaReal() {
  const { AddressFormView } = await import("@/views/customer/AddressFormView");
  await act(async () => {
    raiz.render(<AddressFormView onBack={vi.fn()} />);
  });
}

describe("P82 — contrato do CEP nos consumidores reais", () => {
  it("a conta monta o formulário real compacto e ancora o glifo de erro na caixa do input", async () => {
    await contaReal();
    exigirCompacto();
    await provocarErro();
    exigirCompacto();
  });
  it("o ramo real Novo endereço do checkout mantém CEP largo, inclusive no erro", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView onNavigate={vi.fn()} onSetBackOverride={vi.fn()} />,
      );
    });
    const novo = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Novo",
    );
    expect(novo).toBeDefined();
    await act(async () => {
      novo!.click();
    });
    expect(host.textContent).toContain("Novo Endereço");
    expect(caixaCep().classList.contains("lg:max-w-xs")).toBe(false);
    await provocarErro();
    expect(caixaCep().classList.contains("lg:max-w-xs")).toBe(false);
  });
  it.each(["false", "removida"])(
    "mutante da conta com opção %s é rejeitado pelo pai real de #cep",
    async (tipo) => {
      const fonte = readFileSync(
        "src/views/customer/AddressFormView.tsx",
        "utf8",
      );
      const mutante = fonte.replace(
        "          cepCompacto\n",
        tipo === "false" ? "          cepCompacto={false}\n" : "",
      );
      expect(mutante).not.toBe(fonte);
      const ts = await import("typescript");
      const codigo = ts.transpileModule(mutante, {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText;
      const modulos = new Map<string, unknown>([
        ["react", await import("react")],
        ["react/jsx-runtime", await import("react/jsx-runtime")],
        ["framer-motion", await import("framer-motion")],
        [
          "@/components/ui/custom/AddressForm",
          await import("@/components/ui/custom/AddressForm"),
        ],
        ["@/contexts/StoreContext", await import("@/contexts/StoreContext")],
        ["@/hooks/useAddresses", await import("@/hooks/useAddresses")],
        ["@/hooks/useAuth", await import("@/hooks/useAuth")],
        ["@/lib/nome-da-loja", await import("@/lib/nome-da-loja")],
        ["@/lib/utils", await import("@/lib/utils")],
      ]);
      const saida: {
        AddressFormView?: React.ComponentType<{ onBack: () => void }>;
      } = {};
      // Só fonte versionada local, alterada em memória; nunca entrada externa.
      const executar = new Function("require", "exports", codigo);
      executar((nome: string) => {
        if (!modulos.has(nome)) throw new Error(`Import inesperado: ${nome}`);
        return modulos.get(nome);
      }, saida);
      const ContaMutante = saida.AddressFormView!;
      await act(async () => {
        raiz.render(<ContaMutante onBack={vi.fn()} />);
      });
      expect(host.querySelector("#cep")).not.toBeNull();
      expect(() => exigirCompacto()).toThrow();
      console.info(
        `MUTANTE ${tipo}: rejeitado pela ausência de lg:max-w-xs na caixa real do CEP`,
      );
    },
  );
});
