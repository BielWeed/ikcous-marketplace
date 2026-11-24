// @vitest-environment jsdom
//
// Protege o `pattern` do campo de e-mail da AuthView (entrar, cadastro e
// recuperar senha usam o mesmo campo). É a MESMA regra do `type="email"` do
// HTML, escrita à mão para o campo ser `type="text"` (e deixar o cursor
// funcionar). Os testes vizinhos só olham 3 endereços (com espaço no meio, com
// espaço no fim, com U+200B), então afrouxar ou apertar a expressão não
// derrubava nada: aceitar "a@b" sem ponto, "@x.com", rótulo de 64 letras,
// hífen colado no ponto, ou recusar "a@b" / rótulo de 63 letras mudaria quem
// consegue entrar ou criar conta, sem aviso.
//
// O teste lê o `pattern` que o campo realmente carrega e aplica do jeito que o
// navegador aplica (`^(?:padrão)$`, flag `v`).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    login: vi.fn(),
    signUp: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    resendConfirmationEmail: vi.fn(),
    isPasswordRecovery: false,
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

const rotulo = (tamanho: number) => "a".repeat(tamanho);

const ACEITOS: [string, string][] = [
  ["comum", "ana@example.com"],
  ["maiúsculas", "ANA.Silva@Example.COM.BR"],
  ["com +tag", "ana+loja@example.com"],
  ["sem ponto no domínio (o HTML aceita)", "ana@loja"],
  ["domínio de um caractere por parte", "a@b.c"],
  ["domínio só com números", "ana@123.456"],
  ["hífen no meio do rótulo", "ana@minha-loja.com"],
  ["vários subdomínios", "ana@a.b.c.d.example.com"],
  ["rótulo de 63 letras (o máximo)", `ana@${rotulo(63)}.com`],
  ["rótulo de 1 letra", "ana@a.com"],
  ["espaço comum no começo e no fim (o envio apara)", "  ana@example.com  "],
];

const RECUSADOS: [string, string][] = [
  ["vazio", ""],
  ["só o nome", "ana"],
  ["sem nada depois do @", "ana@"],
  ["sem nada antes do @", "@example.com"],
  ["dois @", "ana@@example.com"],
  ["@ no meio de outro endereço", "ana@loja@example.com"],
  ["espaço no domínio", "ana@exa mple.com"],
  ["espaço no nome", "ana maria@example.com"],
  ["hífen no começo do rótulo", "ana@-example.com"],
  ["hífen no fim do rótulo", "ana@example-.com"],
  ["hífen colado no ponto", "ana@exam-.com"],
  ["dois pontos seguidos", "ana@example..com"],
  ["ponto logo depois do @", "ana@.com"],
  ["ponto no fim", "ana@example.com."],
  ["rótulo de 64 letras (passa do máximo)", `ana@${rotulo(64)}.com`],
  ["sublinhado no domínio", "ana@exam_ple.com"],
  ["letra acentuada no domínio", "ana@exämple.com"],
  ["letra acentuada no nome", "çana@example.com"],
  ["dois endereços separados por vírgula", "ana@example.com,bia@example.com"],
  ["parêntese no nome", "ana(@example.com"],
];

describe("AuthView: o pattern do campo de e-mail", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let expressao: RegExp;

  beforeEach(async () => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const { AuthView } = await import("@/views/shared/AuthView");
    await act(async () => raiz.render(<AuthView onNavigate={vi.fn()} />));
    const campo = document.getElementById("email") as HTMLInputElement;
    expect(campo.pattern).not.toBe("");
    // eslint-disable-next-line security/detect-non-literal-regexp -- o teste aplica o pattern do próprio campo, do jeito que o navegador aplica
    expressao = new RegExp(`^(?:${campo.pattern})$`, "v");
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it.each(ACEITOS)("aceita: %s", (_descricao, endereco) => {
    expect(expressao.test(endereco)).toBe(true);
  });

  it.each(RECUSADOS)("recusa: %s", (_descricao, endereco) => {
    expect(expressao.test(endereco)).toBe(false);
  });

  it("aceita cada símbolo que o HTML permite no nome antes do @", () => {
    for (const simbolo of "!#$%&'*+/=?^_`{|}~-") {
      expect(expressao.test(`a${simbolo}b@example.com`)).toBe(true);
    }
  });

  it("recusa símbolos que o HTML não permite no nome antes do @", () => {
    for (const simbolo of '(),:;<>[]\\" ') {
      expect(expressao.test(`a${simbolo}b@example.com`)).toBe(false);
    }
  });

  it("o campo do navegador concorda com a expressão (checkValidity)", async () => {
    const campo = document.getElementById("email") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )!.set!;
    for (const [valor, esperado] of [
      ["ana@example.com", true],
      ["ana@@example.com", false],
    ] as const) {
      await act(async () => {
        setter.call(campo, valor);
        campo.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText" }),
        );
      });
      expect(campo.checkValidity()).toBe(esperado);
    }
  });
});
