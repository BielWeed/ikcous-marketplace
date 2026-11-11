// @vitest-environment jsdom
import { setCachedCouponsData } from "@/utils/admin_cache";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listar, rede } = vi.hoisted(() => ({
  listar: vi.fn(),
  rede: { offline: false },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => ({ order: () => listar() }) }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableCoupons: true },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => rede.offline,
}));
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
  code: "VOLTE10",
  type: "percentage",
  value: 10,
  usage_count: 0,
  usage_limit: 5,
  active: true,
};
const sucesso = { data: [cupom], error: null };

describe("Cupons — relê ao voltar ao app sem perder a lista", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(console, "error").mockImplementation(() => {});
    listar.mockReset().mockResolvedValue(sucesso);
    rede.offline = false;
    setCachedCouponsData(null);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    setCachedCouponsData(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function abrir(active = true) {
    const { AdminCouponsView } = await import("@/views/admin/AdminCouponsView");
    await act(async () => {
      raiz.render(<AdminCouponsView active={active} onNavigate={vi.fn()} />);
    });
    expect(hospedeiro.textContent).toContain(cupom.code);
  }

  async function visibilidade(estado: DocumentVisibilityState) {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue(estado);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  function chave() {
    return hospedeiro.querySelector(
      '[role="switch"][aria-label="Ativação manual de VOLTE10"]',
    );
  }

  it.each([
    { active: false, usage_count: 2, rotulo: "Inativo" },
    { active: true, usage_count: 5, rotulo: "Esgotado" },
  ])(
    "atualiza o cartão para $rotulo mantendo a rede online",
    async (atualizado) => {
      await abrir();
      expect(chave()?.getAttribute("aria-checked")).toBe("true");
      expect(hospedeiro.textContent).toContain("0 / 5 usos");
      listar.mockResolvedValue({
        data: [{ ...cupom, ...atualizado }],
        error: null,
      });

      await visibilidade("hidden");
      expect(listar).toHaveBeenCalledTimes(1);
      await visibilidade("visible");

      expect(listar).toHaveBeenCalledTimes(2);
      expect(chave()?.getAttribute("aria-checked")).toBe(
        String(atualizado.active),
      );
      expect(hospedeiro.textContent).toContain(atualizado.rotulo);
      expect(hospedeiro.textContent).toContain(
        `${atualizado.usage_count} / 5 usos`,
      );
      expect(rede.offline).toBe(false);
    },
  );

  it("releitura pendente não trava a lista e falha preserva o cartão antigo", async () => {
    await abrir();
    let responder!: (resposta: {
      data: null;
      error: { message: string };
    }) => void;
    listar.mockReturnValueOnce(
      new Promise((resolve) => {
        responder = resolve;
      }),
    );
    await visibilidade("hidden");
    await visibilidade("visible");

    expect(listar).toHaveBeenCalledTimes(2);
    expect(hospedeiro.textContent).toContain(cupom.code);
    expect(chave()?.getAttribute("aria-checked")).toBe("true");
    expect(
      hospedeiro.querySelector(".opacity-50.pointer-events-none"),
    ).toBeNull();
    expect(hospedeiro.textContent).not.toContain("Atualizando cupons...");

    await act(async () => {
      responder({ data: null, error: { message: "Rede indisponível" } });
    });
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Não conseguimos carregar os cupons agora.",
    );
    expect(hospedeiro.textContent).toContain(cupom.code);
    expect(hospedeiro.textContent).toContain("0 / 5 usos");
    expect(chave()?.getAttribute("aria-checked")).toBe("true");
  });

  it("não relê quando a tela de cupons está inativa", async () => {
    await abrir(false);
    await visibilidade("hidden");
    await visibilidade("visible");
    expect(listar).toHaveBeenCalledTimes(1);
  });

  it("não relê sem rede", async () => {
    rede.offline = true;
    await abrir();
    await visibilidade("hidden");
    await visibilidade("visible");
    expect(listar).toHaveBeenCalledTimes(1);
  });

  it("remove o listener ao desmontar", async () => {
    await abrir();
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await visibilidade("hidden");
    await visibilidade("visible");
    expect(listar).toHaveBeenCalledTimes(1);
  });
});
