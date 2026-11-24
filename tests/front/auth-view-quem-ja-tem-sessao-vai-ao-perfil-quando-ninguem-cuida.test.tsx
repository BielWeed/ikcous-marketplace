// @vitest-environment jsdom
//
// TELA DE ENTRADA (AuthView) QUANDO JÁ EXISTE SESSÃO — o destino de reserva.
//
// Quem já está com a conta aberta não deve ver a tela de entrar: ela segue
// adiante sozinha e restaura o destino guardado do Google. Se a tela de cima
// cuida do destino (`onSuccess`), a decisão é dela; se NINGUÉM cuida, a pessoa
// vai para o Perfil. Trocar esse destino de reserva (por exemplo para a
// vitrine) não derrubava nenhum teste: todos os outros dão `onSuccess` à tela.
//
// As condições que seguram o redirecionamento na recuperação de senha já são
// derrubadas por painel-sem-sessao-pede-entrada, google-retorno-apos-limpar-hash
// e auth-link-de-recuperacao-vencido-e-reenvio-condicional (medido por mutação).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const restaurarDestinoGoogle = vi.fn();
let sessao: { email: string } | null = null;

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: sessao,
    login: vi.fn(),
    signUp: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    resendConfirmationEmail: vi.fn(),
    isPasswordRecovery: false,
    setIsPasswordRecovery: vi.fn(),
    restaurarDestinoGoogle,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeCity: "Sao Paulo", storeState: "SP" } }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AuthView — quem já tem sessão segue adiante", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    sessao = { email: "pessoa.ficticia@exemplo.com" };
    restaurarDestinoGoogle.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrir(onSuccess?: () => void) {
    const { AuthView } = await import("@/views/shared/AuthView");
    const onNavigate = vi.fn();
    await act(async () =>
      raiz.render(<AuthView onNavigate={onNavigate} onSuccess={onSuccess} />),
    );
    return onNavigate;
  }

  it("com sessão aberta e tela de cima cuidando do destino: entrega a decisão a onSuccess", async () => {
    const onSuccess = vi.fn();
    const onNavigate = await abrir(onSuccess);

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(restaurarDestinoGoogle).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("com sessão aberta e ninguém de cima cuidando: vai para o perfil", async () => {
    const onNavigate = await abrir();

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("profile");
    expect(restaurarDestinoGoogle).toHaveBeenCalledTimes(1);
  });

  it("sem sessão: fica na tela de entrar, sem navegar nem restaurar destino", async () => {
    sessao = null;
    const onSuccess = vi.fn();
    const onNavigate = await abrir(onSuccess);

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(restaurarDestinoGoogle).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toContain("ENTRAR AGORA");
  });
});
