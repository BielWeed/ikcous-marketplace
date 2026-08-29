// @vitest-environment jsdom
//
// Lote 1 do laudo "o que falta" (29/08, achado loja 4): o app ensinava
// "Mínimo 6 caracteres" nas duas telas de senha, mas o GoTrue do Supabase
// exige 8 (medido ao vivo na auditoria de 20/08 — senha de 7 rejeitada com
// "at least 8 characters"). O cliente digitava 6, confiava no que leu, e
// levava recusa em inglês. As duas telas passam a validar 8 e a DIZER 8.
//
// Prova nos dois sentidos (regra da casa):
//   - senha de 7: recusada localmente, com mensagem citando 8, e
//     `updatePassword` NUNCA chamado (o servidor não é consultado);
//   - senha de 8: chega a `updatePassword`.
// No código de antes, o caso de 7 CHAMAVA `updatePassword` (e o GoTrue
// recusava em inglês) — por isso este teste morre sem o conserto.
//
// Mesmo padrão de account-settings-senha-usa-o-hook-traduzido.test.tsx:
// `useAuth` mockado por inteiro, render de verdade (react-dom/client +
// jsdom), `sonner` mockado, stubs de ResizeObserver/IntersectionObserver.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updatePassword = vi.fn();
const fetchProfile = vi.fn();
const updateProfile = vi.fn();

const USUARIO = { id: "cliente-1", email: "cliente@example.com" };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: USUARIO,
    profile: { avatar_url: null, cover_url: null },
    fetchProfile,
    updateProfile,
    updatePassword,
    // A AuthView monta direto no modo "new-password" quando o contexto
    // detecta recuperação de senha — é o caminho que tem validação local
    // de tamanho (o cadastro não valida; a regra certa lá é o placeholder
    // dizer a regra, tratado no JSX do conserto).
    isPasswordRecovery: true,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// A AuthView lê a identidade da loja para o rodapé da tela.
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
      getSession: vi
        .fn()
        .mockResolvedValue({
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

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);

async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 10 } = {},
) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(
        `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
      );
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    });
  }
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function localizarBotaoPorTexto(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

async function submeterFormularioUnico() {
  const form = document.body.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("A regra de senha ensinada ao cliente é a mesma do servidor (8)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

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

  it("AccountSettingsView: senha de 7 é recusada localmente com a regra certa, sem consultar o servidor", async () => {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    const { toast } = await import("sonner");
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });

    const botaoSeguranca = localizarBotaoPorTexto("Segurança");
    expect(botaoSeguranca).toBeTruthy();
    await act(async () => {
      botaoSeguranca!.click();
    });
    await esperarAte(() => document.getElementById("new_password") !== null);

    // "abdefgh" tem 7 caracteres: um a mais que a regra velha (6) e um a
    // menos que a regra do servidor (8) — exatamente a zona que enganava.
    digitar("new_password", "abdefgh");
    digitar("confirm_password", "abdefgh");
    await submeterFormularioUnico();

    expect(updatePassword).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    const mensagem = vi.mocked(toast.error).mock.calls[0][0];
    expect(String(mensagem)).toContain("8");
    expect(String(mensagem)).not.toContain("6");

    // O placeholder ensina a regra certa antes de qualquer erro.
    const campo = document.getElementById("new_password") as HTMLInputElement;
    expect(campo.placeholder).toBe("Mínimo 8 caracteres");
  });

  it("AccountSettingsView: senha de 8 passa da validação local e chega ao updatePassword", async () => {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    updatePassword.mockResolvedValue(true);
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });

    const botaoSeguranca = localizarBotaoPorTexto("Segurança");
    await act(async () => {
      botaoSeguranca!.click();
    });
    await esperarAte(() => document.getElementById("new_password") !== null);

    digitar("new_password", "abdefghi");
    digitar("confirm_password", "abdefghi");
    await submeterFormularioUnico();

    expect(updatePassword).toHaveBeenCalledWith("abdefghi");
  });

  it("AuthView (nova senha da recuperação): senha de 7 é recusada localmente com a regra certa", async () => {
    const { AuthView } = await import("@/views/shared/AuthView");
    const { toast } = await import("sonner");
    await act(async () => {
      raiz.render(<AuthView onNavigate={() => {}} onSuccess={() => {}} />);
    });

    await esperarAte(() => document.getElementById("password") !== null);
    // Confirma que estamos no modo "Nova senha" (recuperação), não no login.
    const botaoAtualizar = localizarBotaoPorTexto("ATUALIZAR SENHA");
    expect(botaoAtualizar).toBeTruthy();

    digitar("password", "abdefgh");
    await submeterFormularioUnico();

    expect(updatePassword).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    const mensagem = vi.mocked(toast.error).mock.calls[0][0];
    expect(String(mensagem)).toContain("8");
    expect(String(mensagem)).not.toContain("6");
  });

  it("AuthView (nova senha da recuperação): senha de 8 chega ao updatePassword", async () => {
    const { AuthView } = await import("@/views/shared/AuthView");
    updatePassword.mockResolvedValue(true);
    await act(async () => {
      raiz.render(<AuthView onNavigate={() => {}} onSuccess={() => {}} />);
    });

    await esperarAte(() => document.getElementById("password") !== null);
    digitar("password", "abdefghi");
    await submeterFormularioUnico();

    expect(updatePassword).toHaveBeenCalledWith("abdefghi");
  });
});
