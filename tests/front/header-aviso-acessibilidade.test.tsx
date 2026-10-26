// @vitest-environment jsdom
//
// Caça 8 (26/10/2026), item A: no celular o Sonner some e a cápsula do topo é
// o ÚNICO aviso. Ela cortava o texto em 1 linha (~115 px) e não era falada.
// Aqui: a região falada existe e carrega o texto COMPLETO; o texto visível não
// é mais cortado em 1 linha.
import { StrictMode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "LOJA DA PROVA" } }),
}));
vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({ unreadCount: 0 }),
}));
vi.mock("@/components/ui/custom/SearchBar", () => ({
  SearchBar: () => null,
}));

// @ts-expect-error flag interna do React, mesmo padrão de header-center-slot.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const AVISO = "Por favor, adicione o endereço de entrega antes de continuar";

describe("Header — cápsula de aviso acessível", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montarComAviso() {
    const { Header } = await import("@/components/ui/custom/Header");
    await act(async () => {
      raiz.render(
        <StrictMode>
          <Header onNavigate={() => {}} />
        </StrictMode>,
      );
    });
    await act(async () => {
      globalThis.dispatchEvent(
        new CustomEvent("header-toast-event", {
          detail: { id: "a1", message: AVISO, type: "error", duration: 60000 },
        }),
      );
    });
  }

  it("fala o texto completo do aviso numa região role=status educada", async () => {
    await montarComAviso();
    const regiao = [...hospedeiro.querySelectorAll('[role="status"]')].find(
      (r) => r.textContent === AVISO,
    );
    expect(regiao).toBeDefined();
    expect(regiao!.getAttribute("aria-live")).toBe("polite");
    expect(regiao!.textContent).toBe(AVISO);
    // fora do botão da cápsula, que sai com a animação
    expect(regiao!.closest("button")).toBeNull();
  });

  it("o texto visível não é cortado em 1 linha (sem truncate nem nowrap)", async () => {
    await montarComAviso();
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(AVISO),
    );
    expect(botao).toBeDefined();
    expect(botao!.className).not.toContain("whitespace-nowrap");
    const texto = [...botao!.querySelectorAll("span")].find(
      (s) => s.textContent === AVISO,
    );
    expect(texto).toBeDefined();
    expect(texto!.className).not.toContain("truncate");
    expect(texto!.className).toContain("line-clamp-2");
  });
});
