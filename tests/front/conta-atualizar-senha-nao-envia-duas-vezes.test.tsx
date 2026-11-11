// @vitest-environment jsdom
// Sem disabled={updatingPassword}, outro clique envia a mesma troca ainda pendente.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updatePassword = vi.fn();
const rpc = vi.fn();
const USUARIO = { id: "cliente-1", email: "cliente@example.com" };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: USUARIO,
    profile: { avatar_url: null, cover_url: null },
    fetchProfile: vi.fn(),
    updateProfile: vi.fn(),
    updatePassword,
  }),
}));
vi.mock("@/components/account/PrivacidadeEMeusDados", () => ({
  PrivacidadeEMeusDados: () => null,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      updateUser: vi.fn(),
      getSession: () =>
        Promise.resolve({
          data: { session: { access_token: "sessao-ficticia", user: USUARIO } },
        }),
    },
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ObservadorMudo);
vi.stubGlobal("IntersectionObserver", ObservadorMudo);

function digitar(id: string, valor: string) {
  const campo = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Conta — não envia duas trocas de senha enquanto aguarda resposta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    vi.resetAllMocks();
    rpc.mockImplementation((nome: string) =>
      Promise.resolve({
        data:
          nome === "get_my_complete_profile"
            ? [{ full_name: "Pessoa Fictícia", whatsapp: "" }]
            : null,
        error: null,
      }),
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
    await act(async () => {
      [...hospedeiro.querySelectorAll("button")]
        .find((botao) => botao.textContent?.includes("Segurança"))!
        .click();
    });
    digitar("new_password", "senhaNovaFicticia123");
    digitar("confirm_password", "senhaNovaFicticia123");
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it("bloqueia o segundo clique pendente e permite tentar novamente após false; true limpa os campos", async () => {
    let concluir!: (sucesso: boolean) => void;
    const pendente = new Promise<boolean>((resolve) => {
      concluir = resolve;
    });
    updatePassword.mockReturnValueOnce(pendente);
    const botao = hospedeiro.querySelector<HTMLButtonElement>(
      'button[form="form-senha"]',
    )!;
    expect(botao.disabled).toBe(false);

    await act(async () => {
      botao.click();
    });
    expect(updatePassword).toHaveBeenCalledTimes(1);
    expect(updatePassword).toHaveBeenCalledWith("senhaNovaFicticia123");

    // Clique nativo: React/DOM devem impedir o segundo envio, não o dublê.
    await act(async () => {
      botao.click();
    });
    expect(updatePassword).toHaveBeenCalledTimes(1);
    expect(botao.disabled).toBe(true);

    await act(async () => {
      concluir(false);
      await pendente;
    });
    expect(botao.disabled).toBe(false);
    for (const id of ["new_password", "confirm_password"]) {
      expect((document.getElementById(id) as HTMLInputElement).value).toBe(
        "senhaNovaFicticia123",
      );
    }

    updatePassword.mockResolvedValueOnce(true);
    await act(async () => {
      botao.click();
    });
    expect(updatePassword).toHaveBeenCalledTimes(2);
    expect(botao.disabled).toBe(false);
    for (const id of ["new_password", "confirm_password"]) {
      expect((document.getElementById(id) as HTMLInputElement).value).toBe("");
    }
  });
});
