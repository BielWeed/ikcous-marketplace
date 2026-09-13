// @vitest-environment jsdom
//
// Laudo caça-bugs Savy (30/08), achado do Gabriel com print: o botão de
// modelos prontos do Atendimento não fazia NADA. Causa raiz: o painel era um
// createPortal DENTRO de <AnimatePresence> — que só aceita elementos de
// animação como filho direto e descartava o portal em silêncio (estado
// abria, painel nunca renderizava). A correção inverte a ordem: portal fora,
// AnimatePresence com contêiner motion (com key) dentro.
//
// Este teste fixa o contrato: clicar no botão abre o painel de modelos no
// document.body (portal), com a busca e a lista de modelos visíveis.
//
// ATUALIZAÇÃO da frente lote-b-telas-admin (12/09, MUDANÇA DE CASCA, não de
// regra): a tela saiu das seções colapsáveis e virou formulário direto
// (direção B aprovada pelo dono). O botão de modelos mora direto no bloco
// "Mensagem de compartilhamento" e se chama "Modelos prontos (30
// disponíveis)" — não há mais seção para expandir antes de clicar. O
// contrato provado é exatamente o mesmo: o clique abre o painel no portal,
// com busca e lista de modelos.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateConfig = vi.fn();
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    whatsappNumber: "",
    businessHours: "",
    shareText: "Olha que achei na Savy!",
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
    updateConfig,
    refresh: vi.fn(),
    products: [],
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Atendimento — botão de modelos prontos abre o painel de modelos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("clicar em 'Modelos prontos' abre o painel com busca e modelos", async () => {
    const { AdminWhatsAppConfigView } = await import(
      "@/views/admin/AdminWhatsAppConfigView"
    );
    await act(async () => {
      raiz.render(<AdminWhatsAppConfigView active />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Formulário direto: o botão vive direto no bloco 3, sem expandir nada.
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Modelos prontos"),
    ) as HTMLButtonElement;
    expect(botao).toBeDefined();
    expect(botao.disabled).toBe(false);

    await act(async () => {
      botao.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
    });

    const texto = document.body.textContent ?? "";
    expect(texto).toContain("Modelos prontos de mensagem");
    expect(texto).toContain("Aplicar");
    expect(document.getElementById("preset-search-input")).not.toBeNull();
  });
});
