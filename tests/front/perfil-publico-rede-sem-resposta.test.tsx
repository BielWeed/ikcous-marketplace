// @vitest-environment jsdom
import { UserProfileView } from "@/views/customer/UserProfileView";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { single, rpc } = vi.hoisted(() => ({ single: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
    rpc,
  },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

// O teste mede a consulta, não a animação de saída entre as abas.
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
}));

let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  single.mockReset().mockResolvedValue({
    data: {
      id: "autor",
      full_name: "Perfil preservado",
      created_at: "2026-01-01T12:00:00Z",
    },
    error: null,
  });
  rpc.mockReset().mockResolvedValue({ data: [], error: null });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["perfil", "avaliações", "perguntas"])(
  "%s sem resposta encerra o esqueleto e oferece nova tentativa",
  async (consulta) => {
    const pendente = () => new Promise<never>(() => {});
    if (consulta === "perfil") single.mockImplementation(pendente);
    else
      rpc.mockImplementation((nome: string) =>
        nome ===
        (consulta === "avaliações"
          ? "perfil_publico_avaliacoes"
          : "perfil_publico_perguntas")
          ? pendente()
          : Promise.resolve({ data: [], error: null }),
      );

    await act(async () =>
      raiz.render(<UserProfileView userId="autor" onNavigate={() => {}} />),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_001);
    });
    if (consulta === "perguntas") {
      const aba = [...hospedeiro.querySelectorAll("button")].find(
        (botao) => botao.textContent?.trim() === "Perguntas",
      );
      expect(aba).toBeDefined();
      await act(async () => aba!.click());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
    }
    expect(hospedeiro.textContent).toContain("Tentar de novo");
    if (consulta !== "perfil") {
      expect(hospedeiro.textContent).toContain("Perfil preservado");
      expect(hospedeiro.textContent).toContain("Não conseguimos carregar");
    }
  },
);
