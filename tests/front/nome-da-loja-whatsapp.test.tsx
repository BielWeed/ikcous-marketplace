// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockConfig = {
  whatsappNumber: "",
  businessHours: "",
  shareText: "[link] [link_produto]",
};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
    updateConfig: vi.fn(),
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

describe("critério 5 — prévia do WhatsApp usa o endereço da loja", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("scrollTo", vi.fn());
    mockConfig.shareText = "[link] [link_produto]";
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function abrirPrevia() {
    const { AdminWhatsAppConfigView } = await import(
      "@/views/admin/AdminWhatsAppConfigView"
    );
    await act(async () => raiz.render(<AdminWhatsAppConfigView active />));
    const secao = [
      ...hospedeiro.querySelectorAll<HTMLButtonElement>(
        "button[aria-expanded]",
      ),
    ].find((b) =>
      b.textContent?.includes("Mensagem de Compartilhamento de Produtos"),
    );
    expect(secao).toBeDefined();
    await act(async () => secao?.click());
  }

  it("os dois marcadores geram links completos realçados e o rodapé usa o host", async () => {
    await abrirPrevia();
    const links = [...hospedeiro.querySelectorAll("span.underline")].map(
      (span) => span.textContent,
    );
    expect(links).toEqual([
      `${window.location.origin}/produtos?id=1`,
      `${window.location.origin}/produtos?id=1`,
    ]);
    expect(hospedeiro.textContent).not.toContain("ikcous.com");
    expect(
      [...hospedeiro.querySelectorAll("span")].some(
        (span) => span.textContent === window.location.host,
      ),
    ).toBe(true);
  });

  it("preserva o realce de endereço antigo digitado no preset", async () => {
    mockConfig.shareText = "Visite ikcous.com/produtos?id=antigo";
    await abrirPrevia();
    expect(hospedeiro.querySelector("span.underline")?.textContent).toBe(
      "ikcous.com/produtos?id=antigo",
    );
  });
});
