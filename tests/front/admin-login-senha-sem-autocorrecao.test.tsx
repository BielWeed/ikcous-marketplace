// @vitest-environment jsdom
//
// "MOSTRAR SENHA" FAZIA O CELULAR MEXER NA SENHA DO LOJISTA.
//
// Com o olho ligado o campo da senha vira type="text", e o teclado do celular
// passa a tratá-lo como texto comum: põe a primeira letra em maiúscula e
// "corrige" o que acha que é erro. Quem confere a senha vê uma coisa, envia
// outra e não consegue entrar no painel. A tela da cliente (AuthView) já pede
// ao teclado que não mexa; esta é a mesma regra na tela do lojista. O e-mail
// também não pode começar com maiúscula automática.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { login } = vi.hoisted(() => ({ login: vi.fn() }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ login }) }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AdminLoginView — campos de entrada pedem ao teclado que não mexa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    login.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function abrir() {
    const { AdminLoginView } = await import("@/views/admin/AdminLoginView");
    await act(async () =>
      raiz.render(<AdminLoginView onLogin={vi.fn()} onNavigate={vi.fn()} />),
    );
  }

  function exigirSenhaSemAutocorrecao() {
    const campo = document.getElementById(
      "admin-password",
    ) as HTMLInputElement | null;
    expect(campo, "campo #admin-password").not.toBeNull();
    expect(campo?.getAttribute("autocapitalize")).toBe("none");
    expect(campo?.getAttribute("autocorrect")).toBe("off");
    expect(campo?.getAttribute("spellcheck")).toBe("false");
  }

  it("a senha escondida e depois mostrada mantém os três atributos", async () => {
    await abrir();
    const campo = document.getElementById("admin-password") as HTMLInputElement;
    expect(campo.type).toBe("password");
    exigirSenhaSemAutocorrecao();

    const olho = document.querySelector(
      'button[aria-label="Mostrar senha"]',
    ) as HTMLButtonElement;
    await act(async () => olho.click());
    expect(campo.type).toBe("text");
    exigirSenhaSemAutocorrecao();
  });

  function digitar(id: string, valor: string) {
    const el = document.getElementById(id) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const credencialIncorreta = {
    success: false,
    error: { status: 400, code: "invalid_credentials" },
  };

  async function preencher() {
    await abrir();
    await act(async () => {
      digitar("admin-email", "lojista@example.com");
      digitar("admin-password", "senha-errada");
    });
    return hospedeiro.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
  }

  function aviso() {
    return hospedeiro.querySelector('[role="alert"]');
  }

  it.each(["admin-email", "admin-password"])(
    "editar %s limpa só o aviso antigo e não esconde o erro da nova tentativa",
    async (campo) => {
      const erro = "E-mail ou senha administrativos incorretos.";
      login.mockResolvedValue(credencialIncorreta);
      const botao = await preencher();
      await act(async () => botao.click());
      expect(aviso()?.textContent).toBe(erro);

      await act(async () => {
        digitar(
          campo,
          campo === "admin-email" ? "outro@example.com" : "outra-senha",
        );
      });
      expect(aviso()).toBeNull();

      await act(async () => botao.click());
      expect(login).toHaveBeenCalledTimes(2);
      expect(aviso()?.textContent).toBe(erro);
    },
  );

  it("o aviso de limite de tentativas fica mesmo após editar os campos", async () => {
    login.mockResolvedValue({ success: false, error: { status: 429 } });
    const botao = await preencher();
    await act(async () => botao.click());
    expect(aviso()?.textContent).toContain("Muitas tentativas");

    await act(async () => digitar("admin-password", "outra-senha"));
    expect(aviso()?.textContent).toContain("Muitas tentativas");
    await act(async () => digitar("admin-email", "outro@example.com"));
    expect(aviso()?.textContent).toContain("Muitas tentativas");
  });

  it("o aviso de e-mail não confirmado fica até trocar de endereço", async () => {
    login.mockResolvedValue({
      success: false,
      error: { status: 400, code: "email_not_confirmed" },
    });
    const botao = await preencher();
    await act(async () => botao.click());
    expect(aviso()?.textContent).toContain("ainda não foi confirmado");

    await act(async () => digitar("admin-password", "outra-senha"));
    expect(aviso()?.textContent).toContain("ainda não foi confirmado");
    await act(async () => digitar("admin-email", "outro@example.com"));
    expect(aviso()).toBeNull();
  });

  it("não mostra erro de credencial da tentativa anterior se a senha foi editada durante o envio", async () => {
    let responder!: (resultado: typeof credencialIncorreta) => void;
    login.mockReturnValueOnce(
      new Promise<typeof credencialIncorreta>((resolve) => {
        responder = resolve;
      }),
    );
    const botao = await preencher();
    await act(async () => botao.click());
    expect(botao.disabled).toBe(true);
    await act(async () => digitar("admin-password", "outra-senha"));
    await act(async () => responder(credencialIncorreta));
    expect(login).toHaveBeenCalledTimes(1);
    expect(aviso()).toBeNull();
  });

  it("a resposta de conta bloqueada não aparece sobre outro e-mail digitado durante a espera", async () => {
    const bloqueada = {
      success: false,
      error: { status: 400, code: "user_banned" },
    };
    let responder!: (resultado: typeof bloqueada) => void;
    login.mockReturnValueOnce(
      new Promise<typeof bloqueada>((resolve) => {
        responder = resolve;
      }),
    );
    const botao = await preencher();
    await act(async () => botao.click());
    await act(async () => digitar("admin-email", "outro@example.com"));
    await act(async () => responder(bloqueada));
    expect(aviso()).toBeNull();
  });

  it("a resposta de conta bloqueada aparece quando o e-mail não mudou", async () => {
    login.mockResolvedValue({
      success: false,
      error: { status: 400, code: "user_banned" },
    });
    const botao = await preencher();
    await act(async () => botao.click());
    expect(aviso()?.textContent).toContain("Não foi possível entrar");
  });

  it("mostra o aviso de conexão lenta mesmo quando a lojista edita os campos durante a espera", async () => {
    const semResposta = {
      success: false,
      message:
        "A conexão está lenta e a entrada não foi confirmada. Tente de novo em instantes.",
    };
    let responder!: (resultado: typeof semResposta) => void;
    login.mockReturnValueOnce(
      new Promise<typeof semResposta>((resolve) => {
        responder = resolve;
      }),
    );
    const botao = await preencher();
    await act(async () => botao.click());
    expect(botao.disabled).toBe(true);

    await act(async () => {
      digitar("admin-email", "outro@example.com");
      digitar("admin-password", "outra-senha");
    });
    await act(async () => responder(semResposta));

    expect(botao.disabled).toBe(false);
    expect(aviso()?.textContent).toBe(semResposta.message);
  });

  it("o e-mail do lojista não ganha maiúscula automática", async () => {
    await abrir();
    const campo = document.getElementById("admin-email") as HTMLInputElement;
    expect(campo.getAttribute("autocapitalize")).toBe("none");
  });

  it("o autopreenchimento do gerenciador de senhas continua declarado", async () => {
    await abrir();
    expect(
      document.getElementById("admin-email")?.getAttribute("autocomplete"),
    ).toBe("username");
    expect(
      document.getElementById("admin-password")?.getAttribute("autocomplete"),
    ).toBe("current-password");
  });
});
