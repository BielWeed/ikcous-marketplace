// @vitest-environment jsdom
import { cupomDoBanco } from "@/lib/cupom-do-banco";
import { cachedCouponsData, setCachedCouponsData } from "@/utils/admin_cache";
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
const sucesso = { data: [cupom], error: null };
const falha = { data: null, error: { code: "PGRST116" } };

function pendente<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

describe("Cupons — erro da consulta atual não confirma lista vazia", () => {
  let raiz: Root;
  let tela: HTMLDivElement;

  beforeEach(() => {
    listar.mockReset();
    recarregar.mockReset();
    setCachedCouponsData(null);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
    tela = document.createElement("div");
    document.body.appendChild(tela);
    raiz = createRoot(tela);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    tela.remove();
    setCachedCouponsData(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function abrir() {
    const { AdminCouponsView } = await import("@/views/admin/AdminCouponsView");
    await act(async () => {
      raiz.render(<AdminCouponsView onNavigate={vi.fn()} />);
    });
  }

  function conferirFalha() {
    expect(tela.querySelector('[role="alert"]')?.textContent).toContain(
      "Não conseguimos carregar os cupons agora.",
    );
    expect(tela.textContent).not.toContain("Nenhum cupom ativo");
    const botao = Array.from(tela.querySelectorAll("button")).find(
      (elemento) => elemento.textContent?.trim() === "Tentar de novo",
    );
    expect(botao).toBeDefined();
    return botao!;
  }

  it.each(["42501", "PGRST116", "rede"])(
    "falha inicial (%s) sem cache mostra aviso persistente e nova tentativa",
    async (codigo) => {
      if (codigo === "rede") listar.mockRejectedValue(new Error("rede"));
      else listar.mockResolvedValue({ data: null, error: { code: codigo } });
      await abrir();
      conferirFalha();
      expect(cachedCouponsData).toBeNull();
    },
  );

  it("tentar de novo consulta o banco, mostra a lista e limpa o erro", async () => {
    listar.mockResolvedValueOnce(falha).mockResolvedValue(sucesso);
    await abrir();
    const botao = conferirFalha();
    await act(async () => botao.click());
    expect(listar).toHaveBeenCalledTimes(2);
    expect(tela.textContent).toContain(cupom.code);
    expect(tela.querySelector('[role="alert"]')).toBeNull();
    expect(tela.textContent).not.toContain("Nenhum cupom ativo");
  });

  it("consulta bem-sucedida sem cupons mantém o vazio verdadeiro", async () => {
    listar.mockResolvedValue({ data: [], error: null });
    await abrir();
    expect(tela.textContent).toContain("Nenhum cupom ativo");
    expect(tela.querySelector('[role="alert"]')).toBeNull();
  });

  it("nova tentativa vazia bem-sucedida limpa o erro e confirma o vazio", async () => {
    listar
      .mockResolvedValueOnce(falha)
      .mockResolvedValue({ data: [], error: null });
    await abrir();
    const botao = conferirFalha();
    await act(async () => botao.click());
    expect(tela.textContent).toContain("Nenhum cupom ativo");
    expect(tela.querySelector('[role="alert"]')).toBeNull();
  });

  it.each(["cache", "consulta anterior"])(
    "falha preserva a lista confirmada por %s e seu cache",
    async (origem) => {
      if (origem === "cache") {
        setCachedCouponsData([cupomDoBanco(cupom)]);
        listar.mockResolvedValue(falha);
      } else {
        listar.mockResolvedValueOnce(sucesso).mockResolvedValue(falha);
      }
      await abrir();
      if (origem === "consulta anterior") {
        await act(async () => {
          await recarregar();
        });
      }
      conferirFalha();
      expect(tela.textContent).toContain(cupom.code);
      expect(cachedCouponsData?.map((c) => c.code)).toEqual([cupom.code]);
    },
  );

  it.each(["sucesso", "falha"])(
    "resposta antiga de %s não substitui o resultado da consulta atual",
    async (resultadoAntigo) => {
      const antiga = pendente<typeof sucesso | typeof falha>();
      listar
        .mockReturnValueOnce(antiga.promessa)
        .mockResolvedValue(resultadoAntigo === "sucesso" ? falha : sucesso);
      await abrir();
      await act(async () => {
        await recarregar();
      });
      await act(async () => {
        antiga.resolver(resultadoAntigo === "sucesso" ? sucesso : falha);
      });
      if (resultadoAntigo === "sucesso") {
        conferirFalha();
        expect(tela.textContent).not.toContain(cupom.code);
      } else {
        expect(tela.querySelector('[role="alert"]')).toBeNull();
        expect(tela.textContent).toContain(cupom.code);
      }
    },
  );
});
