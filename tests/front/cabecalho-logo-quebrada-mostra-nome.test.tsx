// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      storeName: "Loja de ensaio",
      logoUrl:
        "https://gnjsrucsmjkajijrakzr.supabase.co/storage/v1/object/public/fotos/logo.png",
    },
  }),
}));
vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({ unreadCount: 0 }),
}));
vi.mock("@/hooks/useCart", () => ({
  useCartState: () => ({ cartCount: 0 }),
}));
vi.mock("@/components/ui/custom/SearchBar", () => ({ SearchBar: () => null }));
vi.mock("@/components/pwa/IlhaDeAtualizacao", () => ({
  IlhaDeAtualizacao: () => null,
}));
import { CabecalhoDoComputador } from "@/components/desktop/CabecalhoDoComputador";

// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("CabecalhoDoComputador esconde a logo só depois de a original também falhar", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <CabecalhoDoComputador
          currentView="home"
          onNavigate={vi.fn()}
          searchQuery=""
          onSearch={vi.fn()}
          selectedCategory=""
          onCategoryChange={vi.fn()}
          onCategorySelect={vi.fn()}
          onOpenNotifications={vi.fn()}
        />,
      ),
    );
    const logo = host.querySelector("img")!;
    await act(async () => logo.dispatchEvent(new Event("error")));
    expect(logo.src).toContain("/object/public/");
    expect(logo.hidden).toBe(false);
    await act(async () => logo.dispatchEvent(new Event("error")));
    expect(logo.hidden || !host.contains(logo)).toBe(true);
    expect(host.textContent).toContain("Loja de ensaio");
  } finally {
    act(() => root.unmount());
  }
});
