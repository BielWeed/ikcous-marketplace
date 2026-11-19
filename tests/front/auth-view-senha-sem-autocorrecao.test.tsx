// @vitest-environment jsdom
//
// "MOSTRAR SENHA" FAZIA O CELULAR MEXER NA SENHA.
//
// Com o olho ligado o campo vira type="text", e o teclado do celular passa a
// tratar a senha como texto comum: põe a primeira letra em maiúscula e
// "corrige" o que acha que é erro. Quem confere a senha vê uma coisa, envia
// outra e depois não consegue entrar. Os campos de senha (entrar, cadastrar,
// nova senha e a confirmação dela) precisam pedir ao teclado que NÃO mexa,
// seja qual for o type.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let emRecuperacao = false;

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    login: vi.fn(),
    signUp: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    resendConfirmationEmail: vi.fn(),
    isPasswordRecovery: emRecuperacao,
    setIsPasswordRecovery: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function botaoPorTexto(texto: string) {
  const botao = [...document.body.querySelectorAll("button")].find(
    (elemento) => elemento.textContent?.trim() === texto,
  );
  expect(botao).toBeDefined();
  return botao as HTMLButtonElement;
}

function exigirSemAutocorrecao(id: string) {
  const campo = document.getElementById(id) as HTMLInputElement | null;
  expect(campo, `campo #${id}`).not.toBeNull();
  expect(campo?.getAttribute("autocapitalize")).toBe("none");
  expect(campo?.getAttribute("autocorrect")).toBe("off");
  expect(campo?.getAttribute("spellcheck")).toBe("false");
}

function campo(id: string) {
  return document.getElementById(id) as HTMLInputElement;
}

function digitar(id: string, valor: string) {
  const input = campo(id);
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, valor);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AuthView — campos de senha pedem ao teclado que não mexa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    emRecuperacao = false;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrir() {
    const { AuthView } = await import("@/views/shared/AuthView");
    await act(async () => raiz.render(<AuthView onNavigate={vi.fn()} />));
  }

  it("entrar: a senha escondida e depois mostrada mantém os três atributos", async () => {
    await abrir();
    const campo = document.getElementById("password") as HTMLInputElement;
    expect(campo.type).toBe("password");
    exigirSemAutocorrecao("password");

    const olho = document.querySelector(
      'button[aria-label="Mostrar senha"]',
    ) as HTMLButtonElement;
    await act(async () => olho.click());
    expect(campo.type).toBe("text");
    exigirSemAutocorrecao("password");
  });

  it("cadastro: a senha mantém os três atributos com o olho ligado", async () => {
    await abrir();
    await act(async () => botaoPorTexto("CADASTRO").click());
    const olho = document.querySelector(
      'button[aria-label="Mostrar senha"]',
    ) as HTMLButtonElement;
    await act(async () => olho.click());
    expect((document.getElementById("password") as HTMLInputElement).type).toBe(
      "text",
    );
    exigirSemAutocorrecao("password");
  });

  it.each([
    { origem: "Entrar", destino: "Cadastro", abrirCadastro: false },
    { origem: "Cadastro", destino: "Entrar", abrirCadastro: true },
  ])(
    "$origem → $destino: mantém só o e-mail, com a senha vazia e mascarada",
    async ({ abrirCadastro }) => {
      await abrir();
      if (abrirCadastro) {
        await act(async () => botaoPorTexto("CADASTRO").click());
      }

      const email = "pessoa@example.com";
      const senha = "SenhaFicticia123!";
      await act(async () => {
        digitar("email", email);
        digitar("password", senha);
      });
      const olho = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Mostrar senha"]',
      );
      expect(olho).not.toBeNull();
      await act(async () => olho?.click());
      expect(campo("password").value).toBe(senha);
      expect(campo("password").type).toBe("text");

      await act(async () =>
        botaoPorTexto(abrirCadastro ? "Entrar" : "CADASTRO").click(),
      );

      expect(campo("email").value).toBe(email);
      expect(campo("password").value).toBe("");
      expect(campo("password").type).toBe("password");
    },
  );

  it("volta de Esqueceu? para Entrar com o e-mail e sem a senha visível", async () => {
    await abrir();
    const email = "pessoa@example.com";
    const senha = "SenhaFicticia123!";
    await act(async () => {
      digitar("email", email);
      digitar("password", senha);
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Mostrar senha"]')!
        .click();
    });
    expect(campo("password").value).toBe(senha);
    expect(campo("password").type).toBe("text");

    await act(async () => botaoPorTexto("Esqueceu?").click());
    expect(hospedeiro.textContent).toContain("SOLICITAR LINK");
    await act(async () => botaoPorTexto("Entrar").click());

    expect(campo("email").value).toBe(email);
    expect(campo("password").value).toBe("");
    expect(campo("password").type).toBe("password");
  });

  it("nova senha: a senha e a confirmação mantêm os três atributos com o olho ligado", async () => {
    emRecuperacao = true;
    await abrir();
    expect(hospedeiro.textContent).toContain("Nova Senha");
    const olho = document.querySelector(
      'button[aria-label="Mostrar senha"]',
    ) as HTMLButtonElement;
    await act(async () => olho.click());
    expect(
      (document.getElementById("password-confirmacao") as HTMLInputElement)
        .type,
    ).toBe("text");
    exigirSemAutocorrecao("password");
    exigirSemAutocorrecao("password-confirmacao");
  });
});
