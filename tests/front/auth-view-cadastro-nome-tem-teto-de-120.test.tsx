// @vitest-environment jsdom
//
// Nome do cadastro com teto de 120 (migration 20261399100000): o banco recusa nome de perfil acima de 120 caracteres e,
// no cadastro, a recusa derruba a criação da conta inteira com a mensagem genérica. A tela trava na digitação
// (`maxLength` do HTML conta unidades UTF-16, igual ou mais rígido que o `char_length` do banco: nada que ela aceita é recusado).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      getUser: vi.fn(),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn(),
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      updateUser: vi.fn(),
      resend: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeCity: "Sao Paulo", storeState: "SP" } }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("AuthView (cadastro) — teto do nome", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  it("o campo de nome completo limita a digitação a 120 caracteres", async () => {
    const { AuthProvider } = await import("@/contexts/AuthContext");
    const { AuthView } = await import("@/views/shared/AuthView");
    const { supabase } = await import("@/lib/supabase");
    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: null }, error: null });
    (
      supabase.auth.onAuthStateChange as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });

    await act(async () => {
      raiz.render(
        <AuthProvider>
          <AuthView onNavigate={vi.fn()} />
        </AuthProvider>,
      );
    });
    await act(async () => {
      await tick();
    });
    await act(async () => {
      [...document.body.querySelectorAll("button")]
        .find((b) => b.textContent?.includes("CADASTRO"))
        ?.click();
    });
    await act(async () => {
      await tick();
    });

    const campo = document.getElementById("fullName") as HTMLInputElement;
    expect(campo).not.toBeNull();
    expect(campo.getAttribute("maxlength")).toBe("120");
  });
});
