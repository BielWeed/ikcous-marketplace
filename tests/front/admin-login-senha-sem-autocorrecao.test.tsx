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
