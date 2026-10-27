// @vitest-environment jsdom
//
// Lote 219 (caça 9), item 6: sem internet o cliente não via aviso nenhum (só um
// pontinho vermelho no logo, que nem aparece quando a loja tem logotipo). Agora
// o cabeçalho da LOJA mostra uma faixa fina "Sem internet — mostrando o que já
// foi carregado" enquanto o aparelho está offline, e ela some quando a rede
// volta. O painel tem a faixa dele (ConexaoDoPainel) e não passa por aqui.
//
// A região `role="status"` existe SEMPRE (vazia quando há rede): leitor de tela
// só anuncia de forma confiável texto que entra numa região já presente.
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

const FRASE = "Sem internet — mostrando o que já foi carregado";

describe("Header da loja — faixa de 'sem internet'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onLine: boolean;

  beforeEach(() => {
    onLine = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => onLine);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function montar() {
    const { Header } = await import("@/components/ui/custom/Header");
    await act(async () => {
      raiz.render(
        <StrictMode>
          <Header onNavigate={() => {}} />
        </StrictMode>,
      );
    });
  }

  const faixa = () =>
    [...hospedeiro.querySelectorAll('[role="status"]')].find((r) =>
      r.className.includes("top-full"),
    );

  it("com rede, a região existe mas está vazia (nada para ler)", async () => {
    await montar();
    expect(faixa()).toBeDefined();
    expect(faixa()!.textContent).toBe("");
  });

  it("já abre offline: a faixa aparece na primeira pintura (navigator.onLine inicial)", async () => {
    onLine = false;
    await montar();
    expect(faixa()!.textContent).toBe(FRASE);
  });

  it("cair a rede mostra a faixa; a rede voltando some com ela", async () => {
    await montar();
    onLine = false;
    await act(async () => {
      globalThis.dispatchEvent(new Event("offline"));
    });
    expect(faixa()!.textContent).toBe(FRASE);

    onLine = true;
    await act(async () => {
      globalThis.dispatchEvent(new Event("online"));
    });
    expect(faixa()!.textContent).toBe("");
  });

  it("não empurra o layout: fica pendurada abaixo da barra (absolute), sem clique", async () => {
    onLine = false;
    await montar();
    const f = faixa()!;
    expect(f.className).toContain("absolute");
    expect(f.className).toContain("inset-x-0");
    expect(f.className).toContain("pointer-events-none");
    // letra de 12 px (text-xs), contraste escuro sobre fundo claro
    const texto = f.querySelector("p");
    expect(texto!.className).toContain("text-xs");
    expect(texto!.className).toContain("text-amber-900");
  });
});
