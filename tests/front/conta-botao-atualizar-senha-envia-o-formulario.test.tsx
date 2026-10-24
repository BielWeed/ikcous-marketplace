// @vitest-environment jsdom
//
// O botão "Atualizar Senha" da Conta fica fora do <form> (rodapé fixo) e liga
// ao formulário pelo atributo `form="form-senha"`. Os testes antigos de senha
// disparam `submit` direto no <form>, então não pegariam o atributo apagado ou
// o id trocado: o botão pararia de trocar a senha e a suíte seguiria verde.
// Aqui o teste CLICA no botão, como a cliente faz.
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
          data: { session: { access_token: "t", user: USUARIO } },
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
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const botaoComTexto = (texto: string) =>
  [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;

describe("Conta — o botão 'Atualizar Senha' do rodapé envia o formulário de senha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    rpc.mockImplementation((nome: string) =>
      Promise.resolve({
        data:
          nome === "get_my_complete_profile"
            ? [{ full_name: "Fulano de Tal", whatsapp: "" }]
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
      botaoComTexto("Segurança")!.click();
    });
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function clicarAtualizarSenha() {
    const botao = botaoComTexto("Atualizar Senha");
    expect(botao).toBeTruthy();
    // O botão não está DENTRO do form: só o atributo `form` o liga a ele.
    expect(botao!.closest("form")).toBeNull();
    expect(botao!.getAttribute("form")).toBe(
      document.querySelector("form")!.id,
    );
    await act(async () => {
      botao!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("clicar no botão com senhas válidas chama updatePassword e limpa os campos", async () => {
    updatePassword.mockResolvedValue(true);
    digitar("new_password", "senhaNovaForte123");
    digitar("confirm_password", "senhaNovaForte123");

    await clicarAtualizarSenha();

    expect(updatePassword).toHaveBeenCalledTimes(1);
    expect(updatePassword).toHaveBeenCalledWith("senhaNovaForte123");
    expect(
      (document.getElementById("new_password") as HTMLInputElement).value,
    ).toBe("");
  });

  it("senhas diferentes: o clique não chama updatePassword e avisa", async () => {
    const { toast } = await import("sonner");
    digitar("new_password", "senhaNovaForte123");
    digitar("confirm_password", "outraSenhaForte456");

    await clicarAtualizarSenha();

    expect(updatePassword).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("As senhas não coincidem");
  });

  it("senha curta (7): o clique não chama updatePassword e avisa a regra dos 8", async () => {
    const { toast } = await import("sonner");
    digitar("new_password", "1234567");
    digitar("confirm_password", "1234567");

    await clicarAtualizarSenha();

    expect(updatePassword).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "A senha deve ter pelo menos 8 caracteres",
    );
  });

  it("campos vazios: o clique não chama updatePassword (validação nativa do form)", async () => {
    await clicarAtualizarSenha();
    expect(updatePassword).not.toHaveBeenCalled();
  });
});
