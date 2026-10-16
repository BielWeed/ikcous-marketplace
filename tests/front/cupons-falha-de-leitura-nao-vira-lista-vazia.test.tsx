// @vitest-environment jsdom
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listar, recarregar } = vi.hoisted(() => ({
  listar: vi.fn(),
  recarregar: vi.fn<() => Promise<void>>(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => ({ order: () => listar() }) }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true }),
}));
vi.mock("@/hooks/useCoupons", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/hooks/useCoupons")>();
  const { useEffect } = await import("react");
  return {
    ...original,
    useCoupons: (...args: Parameters<typeof original.useCoupons>) => {
      const estado = original.useCoupons(...args);
      useEffect(() => {
        recarregar.mockImplementation(estado.refreshCoupons);
      }, [estado.refreshCoupons]);
      return estado;
    },
  };
});
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableCoupons: true },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const cupom = {
  id: "cupom-1",
  code: "PROMO10",
  type: "percentage",
  value: 10,
  usage_count: 0,
  active: true,
};
const falha = { data: null, error: { message: "Falha de conexão" } };
const sucesso = { data: [cupom], error: null };

describe("Cupons — falha de leitura não vira lista vazia", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    listar.mockReset();
    recarregar.mockReset();
    const { setCachedCouponsData } = await import("@/utils/admin_cache");
    setCachedCouponsData(null);
    vi.stubGlobal("ResizeObserver", ObservadorStub);
    vi.stubGlobal("IntersectionObserver", ObservadorStub);
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: false,
      media,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function abrir() {
    const { AdminCouponsView } = await import("@/views/admin/AdminCouponsView");
    await act(async () => {
      raiz.render(<AdminCouponsView active={true} onNavigate={vi.fn()} />);
    });
  }

  function conferirFalha() {
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Não conseguimos carregar os cupons agora.",
    );
    expect(hospedeiro.textContent).not.toMatch(
      /Nenhum cupom|Criar Primeiro Cupom/,
    );
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
      (elemento) => elemento.textContent?.trim() === "Tentar de novo",
    );
    expect(botao).toBeDefined();
    return botao!;
  }

  it("primeira leitura falha: avisa e oferece tentar de novo sem afirmar vazio", async () => {
    listar.mockResolvedValue(falha);
    await abrir();
    conferirFalha();
  });

  it("tentar de novo carrega os cupons e retira o aviso", async () => {
    listar.mockResolvedValueOnce(falha).mockResolvedValue(sucesso);
    await abrir();
    const botao = conferirFalha();
    await act(async () => botao.click());
    expect(listar).toHaveBeenCalledTimes(2);
    expect(hospedeiro.textContent).toContain(cupom.code);
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });

  it("releitura que falha mantém os cards e mostra o aviso acima deles", async () => {
    listar.mockResolvedValueOnce(sucesso).mockResolvedValue(falha);
    await abrir();
    expect(hospedeiro.textContent).toContain(cupom.code);
    await act(async () => recarregar());
    conferirFalha();
    expect(hospedeiro.textContent).toContain(cupom.code);
    const alerta = hospedeiro.querySelector('[role="alert"]')!;
    const codigo = Array.from(hospedeiro.querySelectorAll("span")).find(
      (elemento) => elemento.textContent?.includes(cupom.code),
    );
    expect(codigo).toBeDefined();
    expect(
      alerta.compareDocumentPosition(codigo!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("leitura válida realmente vazia mantém o estado vazio e a criação", async () => {
    listar.mockResolvedValue({ data: [], error: null });
    await abrir();
    expect(hospedeiro.textContent).toContain("Nenhum cupom ativo");
    expect(hospedeiro.textContent).toContain("Criar Primeiro Cupom");
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });
});
