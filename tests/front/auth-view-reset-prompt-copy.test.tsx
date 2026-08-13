// @vitest-environment jsdom
//
// Issue #120, terceira frente: o vazamento por enumeração de e-mail tinha
// TRÊS portas — o valor de retorno de `resetPassword`, o toast, e a CÓPIA da
// tela `reset-prompt` (AuthView.tsx). As duas primeiras já têm teste
// (auth-reset-password-enumeration.test.tsx cobre o valor de retorno; o
// toast usa a mesma `res.message`, condicional por construção). Só a cópia
// da tela ficava sustentada por leitura humana — este arquivo fecha essa
// lacuna: prova que a tela mostrada depois de um `resetPassword`
// bem-sucedido nunca afirma categoricamente que o e-mail foi enviado, só que
// pode ter sido.
//
// POR QUE RENDER DE VERDADE (react-dom/client + jsdom), NÃO O DUBLÊ DE REACT:
// o texto em disputa só existe na árvore renderizada da tela `reset-prompt`,
// alcançada pelo fluxo real de estado do componente (viewMode). Mesmo padrão
// de checkout-view-flag-off.test.tsx — só que mais barato: AuthView consome
// um hook só (useAuth) e o sonner; não precisa de useAddresses, useCart,
// useCoupons, useOrders, useStore nem canvas-confetti.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resetPassword = vi.fn().mockResolvedValue({
  success: true,
  status: "success",
  message: "Se este e-mail estiver cadastrado, você receberá um link.",
});
const setIsPasswordRecovery = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    login: vi.fn(),
    signUp: vi.fn(),
    resetPassword,
    updatePassword: vi.fn(),
    resendConfirmationEmail: vi.fn(),
    isPasswordRecovery: false,
    setIsPasswordRecovery,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// checkout-view-flag-off.test.tsx: sem ela o React reclama "not configured
// to support act(...)" em todo render, mesmo dentro de act().
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Simula digitação de verdade: seta o valor pelo setter nativo do input (não
 * pelo `.value =` do React, que o próprio React ignora) e dispara `input` —
 * é o evento que o `onChange` controlado escuta. */
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

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AuthView — cópia da tela reset-prompt (issue #120, frente 3: a tela)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    resetPassword.mockClear();
    setIsPasswordRecovery.mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  /** Percorre o caminho real até a tela reset-prompt: login -> "Esqueceu?"
   * -> forgot -> submit com sucesso -> reset-prompt. Não pula estado. */
  async function chegarNaTelaResetPrompt() {
    const { AuthView } = await import("@/views/shared/AuthView");
    const onNavigate = vi.fn();

    await act(async () => {
      raiz.render(<AuthView onNavigate={onNavigate} />);
    });

    const esqueceuBotao = localizarBotaoPorTexto("Esqueceu?")!;
    await act(async () => {
      esqueceuBotao.click();
    });

    await act(async () => {
      digitar("email", "alguem@example.com");
    });

    const solicitarBotao = localizarBotaoPorTexto("SOLICITAR LINK")!;
    await act(async () => {
      solicitarBotao.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  it("mostra a ressalva condicional e nunca afirma categoricamente que o e-mail foi enviado", async () => {
    await chegarNaTelaResetPrompt();

    expect(resetPassword).toHaveBeenCalledWith("alguem@example.com");

    const texto = hospedeiro.textContent ?? "";

    // A ressalva condicional tem que estar presente — é o texto que fecha a
    // enumeração (o mesmo padrão do toast: "se... estiver cadastrado").
    expect(texto).toMatch(/se este e-?mail estiver cadastrado/i);

    // O cenário real que este teste tem que pegar: alguém reescrevendo o
    // parágrafo de volta para uma afirmação categórica de envio, do tipo
    // "Enviamos um link de recuperação para:" (sem a condicional antes) —
    // a forma que a tela usava antes da correção. Em vez de amarrar a
    // pontuação exata, a asserção verifica a ORDEM semântica: onde quer que
    // "enviamos" apareça no texto renderizado, a palavra "cadastrado" (o
    // núcleo da ressalva condicional) tem que aparecer ANTES dela. Se
    // alguém reescrever a frase como afirmação isolada — com ou sem vírgula,
    // com ou sem a palavra "e-mail" no meio — "cadastrado" deixa de vir
    // antes de "enviamos" (ou some do texto), e o teste quebra pelo motivo
    // certo.
    const indiceEnviamos = texto.search(/\benviamos\b/i);
    expect(indiceEnviamos).toBeGreaterThan(-1);
    const antesDeEnviamos = texto.slice(0, indiceEnviamos);
    expect(antesDeEnviamos).toMatch(/\bcadastrado\b/i);
  });
});
