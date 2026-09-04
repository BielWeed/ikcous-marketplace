// @vitest-environment jsdom
//
// Laudo caça-bugs Savy (30/08), achado do Gabriel com print: o botão
// "Escolher Modelo Pronto (Presets)" do Atendimento não fazia NADA. Causa
// raiz: o painel era um createPortal DENTRO de <AnimatePresence> — que só
// aceita elementos de animação como filho direto e descartava o portal em
// silêncio (estado abria, painel nunca renderizava). A correção inverte a
// ordem: portal fora, AnimatePresence com contêiner motion (com key) dentro.
//
// Este teste fixa o contrato: clicar no botão abre o painel de modelos no
// document.body (portal), com a busca e a lista de modelos visíveis.
//
// ATUALIZAÇÃO da frente glm-visual-canais-avisar-0309 (03/09, MUDANÇA DE
// CASCA, não de regra): a tela entrou no padrão de seções colapsáveis dos
// Ajustes e a seção "Mensagem de Compartilhamento de Produtos" nasce
// FECHADA (o mockup pesado do WhatsApp deixa de empurrar o resto da tela).
// O botão de presets mora dentro dela, então o teste agora EXPANDE a seção
// antes de clicar — o comportamento provado (portal abre com busca e
// modelos) é exatamente o mesmo.
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

describe("Atendimento — botão de presets abre o painel de modelos", () => {
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

  it("clicar em 'Escolher Modelo Pronto' abre o painel com busca e modelos", async () => {
    const { AdminWhatsAppConfigView } = await import(
      "@/views/admin/AdminWhatsAppConfigView"
    );
    await act(async () => {
      raiz.render(<AdminWhatsAppConfigView active />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Casca nova: a seção da mensagem nasce FECHADA — expandir antes de
    // procurar o botão de presets (que mora dentro dela).
    const cabecalhoSecao = [
      ...hospedeiro.querySelectorAll("button[aria-expanded]"),
    ].find((b) =>
      (b.textContent ?? "").includes(
        "Mensagem de Compartilhamento de Produtos",
      ),
    ) as HTMLButtonElement;
    expect(cabecalhoSecao).toBeTruthy();
    await act(async () => {
      cabecalhoSecao.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const botao = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Escolher Modelo Pronto"),
    ) as HTMLButtonElement;
    expect(botao).toBeDefined();
    expect(botao.disabled).toBe(false);

    await act(async () => {
      botao.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
    });

    const texto = document.body.textContent ?? "";
    expect(texto).toContain("Modelos de Mensagem (Presets)");
    expect(texto).toContain("Aplicar");
  });
});
