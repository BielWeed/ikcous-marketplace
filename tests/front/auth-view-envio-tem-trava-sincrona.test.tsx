// @vitest-environment jsdom
// Dois submits no mesmo act não podem enviar duas operações de autenticação.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const login = vi.fn();
const signUp = vi.fn();
const resetPassword = vi.fn();
const updatePassword = vi.fn();
let recuperando = false;

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    login,
    signUp,
    resetPassword,
    updatePassword,
    isPasswordRecovery: recuperando,
    setIsPasswordRecovery: vi.fn(),
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let host: HTMLDivElement;

function digitar(id: string, valor: string) {
  const campo = host.querySelector<HTMLInputElement>(`#${id}`)!;
  Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

async function clicar(texto: string) {
  const botao = [...host.querySelectorAll("button")].find(
    (elemento) => elemento.textContent?.trim() === texto,
  );
  expect(botao).toBeDefined();
  await act(async () => botao!.click());
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  recuperando = false;
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});

afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.restoreAllMocks();
});

it.each(["login", "signup", "forgot", "new-password"] as const)(
  "%s envia uma única vez antes do render e libera outra tentativa após a resposta",
  async (modo) => {
    recuperando = modo === "new-password";
    const operacao =
      modo === "login"
        ? login
        : modo === "signup"
          ? signUp
          : modo === "forgot"
            ? resetPassword
            : updatePassword;
    let responder!: (valor: unknown) => void;
    const pendente = new Promise((resolve) => {
      responder = resolve;
    });
    operacao.mockReturnValue(pendente);
    const { AuthView } = await import("@/views/shared/AuthView");
    await act(async () => raiz.render(<AuthView onNavigate={() => {}} />));
    if (modo === "signup") await clicar("CADASTRO");
    if (modo === "forgot") await clicar("Esqueceu?");
    await act(async () => {
      if (modo !== "new-password") digitar("email", "pessoa@fixture.invalid");
      if (modo !== "forgot") digitar("password", "senhaFicticia123");
      if (modo === "signup") {
        digitar("fullName", "Pessoa Fictícia");
        digitar("phone", "11999999999");
      }
      if (modo === "new-password") {
        digitar("password-confirmacao", "senhaFicticia123");
      }
    });
    const formulario = host.querySelector("form")!;
    await act(async () => {
      formulario.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      formulario.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    try {
      expect(operacao).toHaveBeenCalledTimes(1);
      expect(
        formulario.querySelector<HTMLButtonElement>('button[type="submit"]')!
          .disabled,
      ).toBe(true);
    } finally {
      await act(async () =>
        responder(
          modo === "login" || modo === "forgot" ? { success: false } : false,
        ),
      );
    }
    operacao.mockRejectedValueOnce(new Error("falha fictícia"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => formulario.requestSubmit());
    expect(operacao).toHaveBeenCalledTimes(2);
    expect(
      formulario.querySelector<HTMLButtonElement>('button[type="submit"]')!
        .disabled,
    ).toBe(false);
    operacao.mockResolvedValueOnce(
      modo === "login" || modo === "forgot" ? { success: false } : false,
    );
    await act(async () => formulario.requestSubmit());
    expect(operacao).toHaveBeenCalledTimes(3);
  },
);

it("corrigir um login vazio libera o primeiro envio válido", async () => {
  const { AuthView } = await import("@/views/shared/AuthView");
  await act(async () => raiz.render(<AuthView onNavigate={() => {}} />));
  const formulario = host.querySelector("form")!;
  await act(async () => {
    formulario.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  expect(login).not.toHaveBeenCalled();
  login.mockResolvedValueOnce({ success: false });
  await act(async () => {
    digitar("email", "pessoa@fixture.invalid");
    digitar("password", "senhaFicticia123");
  });
  await act(async () => formulario.requestSubmit());
  expect(login).toHaveBeenCalledTimes(1);
});
