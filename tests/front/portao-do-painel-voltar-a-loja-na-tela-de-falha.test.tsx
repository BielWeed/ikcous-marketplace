// @vitest-environment jsdom
//
// Caça de provas fracas (24/11/2026), papéis: quando o portão do painel não
// consegue confirmar o acesso (servidor sem responder), a tela oferece duas
// saídas — "Tentar de novo" e "Voltar à loja". A primeira já tem teste
// (`portao-do-painel-engasgo-de-rede-nao-expulsa`); a segunda não: o botão podia
// não fazer nada e a lojista com internet ruim ficava presa numa tela sem saída
// a não ser F5. Aqui: "Voltar à loja" leva à vitrine, SEM acusar falta de
// permissão (nada de "Acesso restrito"), e sem abrir o painel.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: async () => ({ data: null, error: { message: "network error" } }),
  },
}));

vi.mock("@/components/layouts/AdminArea", () => ({
  AdminArea: () => <div data-testid="painel-de-verdade">PAINEL ABERTO</div>,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Portão do painel — 'Voltar à loja' na tela de falha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn();

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
  });

  async function abrirPortao() {
    const { AdminAreaGate } = await import(
      "@/components/layouts/AdminAreaGate"
    );
    await act(async () => {
      raiz.render(
        <AdminAreaGate
          currentView={"admin-dashboard" as never}
          onNavigate={onNavigate}
          selectedProductId={null}
          setIsAdminDirty={vi.fn()}
          setBackOverride={vi.fn()}
          handleAdminUserDetailBack={vi.fn()}
          backOverride={null}
          isTransitionSupported={false}
          fallback={<div data-testid="carregando">Verificando…</div>}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("o botão 'Voltar à loja' navega para a vitrine, sem aviso de acesso restrito e sem abrir o painel", async () => {
    await abrirPortao();
    expect(onNavigate).not.toHaveBeenCalled();

    const voltar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /voltar à loja/i.test(b.textContent || ""),
    );
    expect(voltar).toBeDefined();

    await act(async () => {
      voltar?.click();
    });

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("home");
    expect(toastError).not.toHaveBeenCalled();
    expect(
      hospedeiro.querySelector('[data-testid="painel-de-verdade"]'),
    ).toBeNull();
  });
});
