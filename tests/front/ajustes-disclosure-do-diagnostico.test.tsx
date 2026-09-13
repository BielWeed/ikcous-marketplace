// @vitest-environment jsdom
//
// Dívida do PR #555 (redesenho SALÃO+PORÃO da tela de Ajustes): o disclosure
// do diagnóstico de conexão é hand-rolled — não passa pelo SecaoColapsavel,
// que já declara aria-expanded — e o botão que abre/fecha o painel de
// latência não declarava estado nenhum. Para leitor de tela, o painel
// aparecia e sumia sem aviso. Este teste fixa o contrato: o botão declara
// aria-expanded desde o primeiro render e o valor acompanha os cliques.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-a" },
    session: { user: { id: "admin-a" } },
    isAdmin: true,
    adminStatus: "admin",
  }),
}));
vi.mock("@/lib/env-valores", () => ({
  lerSupabaseUrl: () => "https://abcdefghijklmnopqrst.supabase.co",
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AdminSettingsView — disclosure do diagnóstico de conexão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  function botaoPorTexto(trecho: string): HTMLButtonElement {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(trecho),
    );
    expect(botao, `botão ausente: "${trecho}"`).toBeDefined();
    return botao as HTMLButtonElement;
  }

  async function clicar(botao: HTMLButtonElement) {
    await act(async () => {
      botao.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  it("declara aria-expanded e ele acompanha fechar/abrir (padrão expanded:false → clique → true)", async () => {
    const { AdminSettingsView } = await import(
      "@/views/admin/AdminSettingsView"
    );
    await act(async () => {
      raiz.render(<AdminSettingsView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // O disclosure mora DENTRO de "Minha loja está no ar?" — seção que nasce
    // fechada (decisão do dono, 02/09). Só ao abrir é que ele monta.
    await clicar(botaoPorTexto("Minha loja está no ar?"));

    // O painel do diagnóstico NASCE ABERTO (isOpen=true): o estado tem de
    // estar declarado desde o primeiro render.
    expect(botaoPorTexto("Diagnóstico de Conexão").getAttribute("aria-expanded")).toBe(
      "true",
    );

    // Fechar: o estado declarado vira false.
    await clicar(botaoPorTexto("Diagnóstico de Conexão"));
    const fechado = [...hospedeiro.querySelectorAll("button")].find(
      (b) =>
        b.textContent?.includes("Diagnóstico de Conexão") &&
        b.getAttribute("aria-expanded") === "false",
    );
    expect(fechado, "após fechar, aria-expanded deveria ser false").toBeDefined();

    // Reabrir — o padrão do lote E: acha o botão com expanded=false, clica,
    // e o estado volta a true.
    await clicar(fechado as HTMLButtonElement);
    expect(botaoPorTexto("Diagnóstico de Conexão").getAttribute("aria-expanded")).toBe(
      "true",
    );
  });
});
