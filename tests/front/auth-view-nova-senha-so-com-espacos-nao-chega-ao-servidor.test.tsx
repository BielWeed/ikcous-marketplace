// @vitest-environment jsdom
//
// Protege a tela de NOVA SENHA da recuperação (AuthView, modo "new-password")
// contra senha feita só de espaços. A conferência é
// `!password.trim() || password.length < 8`: tirando a primeira metade, uma
// senha de 8 espaços tem 8 caracteres, passa na régua do tamanho e ia para
// `updatePassword` — a conta ficava com uma senha que ninguém enxerga. Os
// testes vizinhos (senha-minima-e-oito-nas-duas-telas) só tentam 7 e 8 letras.
// O cadastro e o perfil já têm a mesma recusa com teste; faltava esta tela.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updatePassword = vi.fn<(senha: string) => Promise<boolean>>();

const USUARIO = { id: "cliente-1", email: "cliente@example.com" };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: USUARIO,
    profile: { avatar_url: null, cover_url: null },
    fetchProfile: vi.fn(),
    updateProfile: vi.fn(),
    updatePassword,
    // Recuperação de senha em andamento: a AuthView abre direto em "Nova senha".
    isPasswordRecovery: true,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      storeName: "Loja de Teste",
      storeCity: "Cidade",
      storeState: "SP",
    },
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: USUARIO } },
        error: null,
      }),
      updateUser: vi.fn(),
    },
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ObservadorFalso);
vi.stubGlobal("IntersectionObserver", ObservadorFalso);

function digitar(id: string, valor: string) {
  const campo = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

async function enviarFormulario() {
  const formulario = document.body.querySelector("form")!;
  await act(async () => {
    formulario.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("AuthView, nova senha da recuperação: senha só com espaços", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    updatePassword.mockReset().mockResolvedValue(true);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const { AuthView } = await import("@/views/shared/AuthView");
    await act(async () => {
      raiz.render(<AuthView onNavigate={() => {}} onSuccess={() => {}} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  });

  afterEach(async () => {
    const { toast } = await import("sonner");
    vi.mocked(toast.error).mockClear();
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it.each([
    ["oito espaços", "        "],
    ["dez espaços", "          "],
    [
      "oito espaços de largura diferente (tab e não separável)",
      "\t\u{a0}\t\u{a0}\t\u{a0}\t\u{a0}",
    ],
  ])(
    "%s, mesmo repetidos na confirmação, são recusados antes do servidor",
    async (_nome, senha) => {
      const { toast } = await import("sonner");
      digitar("password", senha);
      digitar("password-confirmacao", senha);
      await enviarFormulario();

      expect(updatePassword).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(String(vi.mocked(toast.error).mock.calls[0]?.[0])).toContain("8");
    },
  );

  it("senha com espaços no meio e no fim chega ao servidor exatamente como foi digitada", async () => {
    digitar("password", "abc def ");
    digitar("password-confirmacao", "abc def ");
    await enviarFormulario();

    expect(updatePassword).toHaveBeenCalledTimes(1);
    expect(updatePassword).toHaveBeenCalledWith("abc def ");
  });
});
