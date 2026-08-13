// @vitest-environment jsdom
//
// Issue #200 (AUTH-070) — quem se cadastra e some antes de confirmar o
// e-mail não tinha caminho de autoatendimento: `resendConfirmationEmail`
// (AuthContext) só era renderizado sob `showConfirmation`, que só existe na
// MESMA sessão de navegador em que a pessoa se cadastrou. Fechar de volta
// (fechar a aba, voltar depois) deixava a conta presa.
//
// A tela de login já distingue "E-mail ou senha incorretos" de "Seu e-mail
// ainda não foi confirmado" (oráculo pré-existente, não criado por esta
// correção — ver AuthView.tsx handleSubmit, ramo de erro de login). Achado
// bloqueante da revisão da #200: o Supabase Auth devolve HTTP 400 tanto para
// credenciais inválidas quanto para e-mail não confirmado, então o ramo
// precisa checar `error.code === "email_not_confirmed"` ANTES da condição
// genérica de 400 — checar depois nunca é alcançado. Os mocks abaixo
// refletem o formato real da API (status 400 + code), não o status 401
// usado antes da correção. Este teste cobre o botão de reenvio que passa a
// aparecer JUNTO dessa segunda mensagem, e só dela: não pode aparecer no
// caso de credenciais incorretas, senão vira um oráculo NOVO que a issue
// #120 fechou de propósito no fluxo de "Esqueci a senha".
//
// Mesmo padrão de auth-view-reset-prompt-copy.test.tsx: render de verdade
// (react-dom/client + jsdom), useAuth mockado por inteiro (login e
// resendConfirmationEmail controláveis por teste), sonner mockado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const login = vi.fn();
const resendConfirmationEmail = vi.fn();
const setIsPasswordRecovery = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    login,
    signUp: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    resendConfirmationEmail,
    isPasswordRecovery: false,
    setIsPasswordRecovery,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// auth-view-reset-prompt-copy.test.tsx: sem ela o React reclama "not
// configured to support act(...)" em todo render, mesmo dentro de act().
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

describe("AuthView — botão de reenvio de confirmação no erro de login (issue #200)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    login.mockReset();
    resendConfirmationEmail.mockReset();
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

  async function montarELogar(email: string, senha: string) {
    const { AuthView } = await import("@/views/shared/AuthView");
    const onNavigate = vi.fn();

    await act(async () => {
      raiz.render(<AuthView onNavigate={onNavigate} />);
    });

    await act(async () => {
      digitar("email", email);
      digitar("password", senha);
    });

    const entrarBotao = localizarBotaoPorTexto("ENTRAR AGORA")!;
    await act(async () => {
      entrarBotao.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  it("mostra 'Reenviar link de confirmação' quando o login falha por e-mail não confirmado", async () => {
    login.mockResolvedValue({
      success: false,
      // O Supabase Auth devolve status 400 tanto para "Invalid login
      // credentials" quanto para "Email not confirmed" (ver
      // https://supabase.com/docs/guides/auth/debugging/error-codes) — o
      // `code` é o campo estável que distingue os dois casos, e é isso que
      // AuthView.tsx passa a checar primeiro (ver AuthView.tsx ~140-160).
      error: {
        status: 400,
        code: "email_not_confirmed",
        message: "Email not confirmed",
      },
    });

    await montarELogar("presa@example.com", "senha123");

    expect(hospedeiro.textContent).toMatch(
      /seu e-?mail ainda não foi confirmado/i,
    );
    const botaoReenviar = localizarBotaoPorTexto(
      "Reenviar link de confirmação",
    );
    expect(botaoReenviar).toBeDefined();
  });

  it("NÃO mostra o botão de reenviar quando o login falha por credenciais incorretas (não pode virar oráculo novo)", async () => {
    login.mockResolvedValue({
      success: false,
      error: {
        status: 400,
        code: "invalid_credentials",
        message: "Invalid login credentials",
      },
    });

    await montarELogar("alguem@example.com", "senha-errada");

    expect(hospedeiro.textContent).toMatch(/e-?mail ou senha incorretos/i);
    const botaoReenviar = localizarBotaoPorTexto(
      "Reenviar link de confirmação",
    );
    expect(botaoReenviar).toBeUndefined();
  });

  // Teste de regressão — trava o defeito bloqueante achado na revisão da
  // #200: o Supabase Auth devolve HTTP 400 tanto para "Invalid login
  // credentials" quanto para "Email not confirmed" (registro oficial de
  // códigos de erro do Supabase Auth), então checar `error.status === 400`
  // ANTES de checar o motivo capturava os dois casos e o ramo de "e-mail não
  // confirmado" nunca era alcançado em produção — quem tinha conta só ainda
  // não confirmada via "E-mail ou senha incorretos" e nunca via o botão de
  // reenvio. Este teste falha se essa ordem voltar a ser a de cima.
  it("com status 400 + code email_not_confirmed (o formato real da API), mostra a mensagem de e-mail não confirmado, não a de credenciais incorretas", async () => {
    login.mockResolvedValue({
      success: false,
      error: {
        status: 400,
        code: "email_not_confirmed",
        message: "Email not confirmed",
      },
    });

    await montarELogar("presa@example.com", "senha123");

    expect(hospedeiro.textContent).toMatch(
      /seu e-?mail ainda não foi confirmado/i,
    );
    expect(hospedeiro.textContent).not.toMatch(/e-?mail ou senha incorretos/i);
    const botaoReenviar = localizarBotaoPorTexto(
      "Reenviar link de confirmação",
    );
    expect(botaoReenviar).toBeDefined();
  });

  it("clicar no botão chama resendConfirmationEmail com o e-mail digitado no login e mostra estado de carregando enquanto está pendente", async () => {
    login.mockResolvedValue({
      success: false,
      // O Supabase Auth devolve status 400 tanto para credenciais inválidas
      // quanto para e-mail não confirmado; `code` é o campo estável que
      // AuthView.tsx usa para distinguir os dois (ver AuthView.tsx ~140-160).
      error: {
        status: 400,
        code: "email_not_confirmed",
        message: "Email not confirmed",
      },
    });
    let resolverReenvio: (valor: boolean) => void;
    resendConfirmationEmail.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolverReenvio = resolve;
      }),
    );

    await montarELogar("presa@example.com", "senha123");

    const botaoReenviar = localizarBotaoPorTexto(
      "Reenviar link de confirmação",
    )!;
    await act(async () => {
      botaoReenviar.click();
      await esperarMicrotarefas();
    });

    expect(resendConfirmationEmail).toHaveBeenCalledWith("presa@example.com");
    expect(resendConfirmationEmail).toHaveBeenCalledTimes(1);

    // Estado de carregando: o botão fica desabilitado enquanto a promise
    // ainda não resolveu — segue o padrão de feedback já usado no botão
    // principal de submit (Loader2 + disabled).
    expect(botaoReenviar.disabled).toBe(true);

    await act(async () => {
      resolverReenvio(true);
      await esperarMicrotarefas();
    });

    // Depois de resolver, o botão volta a ficar disponível (não fica preso
    // em carregando para sempre).
    expect(botaoReenviar.disabled).toBe(false);
  });

  it("duplo clique no botão de reenviar não dispara dois reenvios", async () => {
    login.mockResolvedValue({
      success: false,
      // O Supabase Auth devolve status 400 tanto para credenciais inválidas
      // quanto para e-mail não confirmado; `code` é o campo estável que
      // AuthView.tsx usa para distinguir os dois (ver AuthView.tsx ~140-160).
      error: {
        status: 400,
        code: "email_not_confirmed",
        message: "Email not confirmed",
      },
    });
    let resolverReenvio: (valor: boolean) => void;
    resendConfirmationEmail.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolverReenvio = resolve;
      }),
    );

    await montarELogar("presa@example.com", "senha123");

    const botaoReenviar = localizarBotaoPorTexto(
      "Reenviar link de confirmação",
    )!;

    await act(async () => {
      botaoReenviar.click();
      await esperarMicrotarefas();
    });
    // Segundo clique real do DOM: um botão `disabled` não dispara `onClick`
    // nem em jsdom nem em navegador real — é essa barreira que protege
    // contra o duplo clique, mesmo padrão de
    // admin-product-form-draft-e-duplo-clique.test.tsx.
    await act(async () => {
      botaoReenviar.click();
      await esperarMicrotarefas();
    });

    expect(resendConfirmationEmail).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolverReenvio(true);
      await esperarMicrotarefas();
    });
  });

  it("quando o reenvio falha (promise rejeitada), o botão sai do estado de carregando em vez de ficar preso (não engole o erro em silêncio)", async () => {
    login.mockResolvedValue({
      success: false,
      // O Supabase Auth devolve status 400 tanto para credenciais inválidas
      // quanto para e-mail não confirmado; `code` é o campo estável que
      // AuthView.tsx usa para distinguir os dois (ver AuthView.tsx ~140-160).
      error: {
        status: 400,
        code: "email_not_confirmed",
        message: "Email not confirmed",
      },
    });
    resendConfirmationEmail.mockRejectedValue(new Error("falha de rede"));

    await montarELogar("presa@example.com", "senha123");

    const botaoReenviar = localizarBotaoPorTexto(
      "Reenviar link de confirmação",
    )!;

    await act(async () => {
      botaoReenviar.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(resendConfirmationEmail).toHaveBeenCalledTimes(1);
    // Critério de aceite: mesmo com a promise rejeitada, o botão não fica
    // preso em "carregando" para sempre — a pessoa consegue tentar de novo.
    expect(botaoReenviar.disabled).toBe(false);
  });

  // Achado da revisão desta branch: "Esqueceu?" era a única das cinco
  // transições que NÃO limpava o erro de login — e-mail (onChange), senha
  // (onChange), toggle login/cadastro e novo submit já limpavam. O banner e o
  // botão de reenvio junto com ele viajavam para a tela "Recuperar senha",
  // onde não fazem sentido nenhum. Não era vazamento (o e-mail é o mesmo, já
  // provado pela senha correta), era UI velha grudada na tela seguinte.
  it("ir para 'Esqueceu?' limpa o banner e leva o botão de reenvio junto, em vez de deixá-los grudados na tela de recuperação", async () => {
    login.mockResolvedValue({
      success: false,
      error: {
        status: 400,
        code: "email_not_confirmed",
        message: "Email not confirmed",
      },
    });

    await montarELogar("presa@example.com", "senha123");

    // Pré-condição: o banner e o botão estão na tela de login.
    expect(
      localizarBotaoPorTexto("Reenviar link de confirmação"),
    ).toBeDefined();

    const esqueceu = localizarBotaoPorTexto("Esqueceu?")!;
    await act(async () => {
      esqueceu.click();
      await esperarMicrotarefas();
    });

    expect(hospedeiro.textContent).toMatch(/recuperar/i);
    expect(localizarBotaoPorTexto("Reenviar link de confirmação")).toBe(
      undefined,
    );
    expect(hospedeiro.textContent).not.toMatch(
      /seu e-?mail ainda não foi confirmado/i,
    );
  });
});
