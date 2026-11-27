// @vitest-environment jsdom
//
// LOJA QUE NÃO CONSEGUE MANDAR E-MAIL — cadastro, reenvio da confirmação e
// recuperação de senha dizem a verdade para a cliente.
//
// Numa loja nova (projeto Supabase sem SMTP próprio nem gancho de e-mail), o
// Supabase Auth recusa o envio: `email_address_not_authorized` (o SMTP padrão
// só manda para membros da organização) ou, com SMTP quebrado, um 500 "Error
// sending confirmation/recovery email". O app mostrava "Tente novamente" — e a
// cliente tentava de novo para sempre. Já o limite de e-mails da LOJA INTEIRA
// (429 `over_email_send_rate_limit`, mensagem "email rate limit exceeded")
// virava "Muitas tentativas", culpando a cliente na primeira tentativa.
//
// Códigos e mensagens conferidos na doc oficial
// (https://supabase.com/docs/guides/auth/debugging/error-codes) e na fonte do
// supabase/auth (internal/api/mail.go: `sendEmail`,
// `validateSentWithinFrequencyLimit`; internal/api/errors.go:
// `generateFrequencyLimitErrorMessage`). O MESMO código
// `over_email_send_rate_limit` também sai para o intervalo POR ENDEREÇO
// ("For security purposes, you can only request this after N seconds."): esse
// é a própria cliente pedindo de novo cedo demais e continua com a frase de
// antes. Mesmo padrão de auth-context-cadastro-e-nova-senha-cada-sinal-do-erro
// (AuthProvider de verdade, supabase dublado).
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      getUser: vi.fn(),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn(),
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      updateUser: vi.fn(),
      resend: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({
              data: null,
              error: { message: "não usado nestes testes" },
            }),
        }),
      }),
    })),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function criarLocalStorageFake() {
  const armazem = new Map<string, string>();
  return {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
    clear: () => {
      armazem.clear();
    },
    key: (index: number) => Array.from(armazem.keys()).at(index) ?? null,
    get length() {
      return armazem.size;
    },
  };
}

interface ResultadoRecuperacao {
  success: boolean;
  status: string;
  message?: string;
}

interface Snapshot {
  signUp: (
    email: string,
    senha: string,
    fullName: string,
    phone: string,
  ) => Promise<boolean>;
  resendConfirmationEmail: (email: string) => Promise<boolean>;
  resetPassword: (email: string) => Promise<ResultadoRecuperacao>;
}

function Sonda({
  authContext,
  aoAtualizar,
}: {
  readonly authContext: React.Context<any>;
  readonly aoAtualizar: (snapshot: Snapshot) => void;
}) {
  const ctx = useContext(authContext) as Snapshot;
  aoAtualizar({
    signUp: ctx.signUp,
    resendConfirmationEmail: ctx.resendConfirmationEmail,
    resetPassword: ctx.resetPassword,
  });
  return null;
}

// Endereço fictício: aparece na mensagem do servidor e NÃO pode ir ao console.
const EMAIL = "cliente.ficticia@exemplo.test";

const FRASE_CADASTRO_SEM_ENVIO =
  "Esta loja não está conseguindo enviar e-mails de confirmação agora, então o cadastro por e-mail não foi concluído. Avise a loja para ela resolver.";
const DICA_GOOGLE_NO_CADASTRO =
  " Enquanto isso, você pode criar a conta pelo botão Continuar com Google.";
const FRASE_REENVIO_SEM_ENVIO =
  "Esta loja não está conseguindo enviar e-mails de confirmação agora. Avise a loja para ela resolver.";
const FRASE_RECUPERACAO_SEM_ENVIO =
  "Esta loja não está conseguindo enviar e-mails de recuperação de senha agora. Avise a loja para ela resolver.";
const FRASE_LIMITE_DA_LOJA =
  "A loja atingiu o limite de envio de e-mails por agora. Tente de novo daqui a alguns minutos.";
// O gancho de e-mail da loja (Gmail da loja) falhou: pode ser passageiro.
const FRASE_CADASTRO_ENVIO_DA_LOJA_FALHOU =
  "A loja não conseguiu enviar o e-mail de confirmação agora, então o cadastro por e-mail não foi concluído. Tente de novo em alguns minutos; se continuar, avise a loja.";
const FRASE_REENVIO_ENVIO_DA_LOJA_FALHOU =
  "A loja não conseguiu enviar o e-mail de confirmação agora. Tente de novo em alguns minutos; se continuar, avise a loja.";
const FRASE_RECUPERACAO_ENVIO_DA_LOJA_FALHOU =
  "A loja não conseguiu enviar o e-mail de recuperação de senha agora. Tente de novo em alguns minutos; se continuar, avise a loja.";

// Frases de ANTES, que continuam valendo para as outras causas.
const FRASE_MUITAS_TENTATIVAS_CADASTRO =
  "Muitas tentativas. Tente novamente em alguns minutos.";
const FRASE_GENERICA_CADASTRO =
  "Não foi possível concluir o cadastro. Tente novamente.";
const FRASE_MUITAS_TENTATIVAS_REENVIO =
  "Muitas tentativas. Aguarde alguns minutos antes de pedir um novo e-mail. Se você já pediu um, use o e-mail mais recente.";
const FRASE_GENERICA_REENVIO =
  "Não foi possível reenviar o e-mail agora. Tente novamente em instantes.";
const FRASE_GENERICA_RECUPERACAO =
  "Não foi possível enviar o link agora. Se você acabou de pedir um, ele já pode estar na sua caixa de entrada (confira também o spam): use o e-mail mais recente. Senão, tente novamente em instantes.";

// Sinais do servidor, um por caso.
const NAO_AUTORIZADO_PELO_CODIGO = {
  status: 400,
  code: "email_address_not_authorized",
  message: "mensagem-desconhecida",
};
const NAO_AUTORIZADO_SO_PELA_MENSAGEM = {
  status: 400,
  message: `Email address "${EMAIL}" cannot be used as it is not authorized`,
};
const SMTP_QUEBRADO_CONFIRMACAO = {
  status: 500,
  code: "unexpected_failure",
  message: "Error sending confirmation email",
};
const SMTP_QUEBRADO_RECUPERACAO = {
  status: 500,
  code: "unexpected_failure",
  message: "Error sending recovery email",
};
const LIMITE_DA_LOJA = {
  status: 429,
  code: "over_email_send_rate_limit",
  message: "email rate limit exceeded",
};
const LIMITE_DA_LOJA_SEM_CODIGO = {
  status: 429,
  message: "email rate limit exceeded",
};
const INTERVALO_DO_ENDERECO = {
  status: 429,
  code: "over_email_send_rate_limit",
  message: "For security purposes, you can only request this after 42 seconds.",
};
// Gancho de e-mail da loja (Send Email Hook): o Auth não repassa o corpo da
// edge; ver tests/front/falha-de-envio-de-email-gancho-da-loja.test.ts.
const GANCHO_500 = {
  status: 500,
  code: "unexpected_failure",
  message: "Unexpected status code returned from hook: 500",
};
const GANCHO_ESTOUROU_O_TEMPO = {
  status: 422,
  code: "hook_timeout",
  message: "Failed to reach hook within maximum time of 5.000000 seconds",
};
const LIMITE_DO_IP = {
  status: 429,
  code: "over_request_rate_limit",
  message: "Request rate limit reached",
};

describe("loja que não consegue mandar e-mail: a cliente lê a causa certa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let consoleErro: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    consoleErro = vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar({ google = false } = {}) {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ external: { google } }),
      }),
    );
    // A sonda do Google é a mesma que acende o botão na tela: sem ela
    // confirmada, a frase não pode citar um botão que não está lá.
    const { googleLigadoNestaLoja } = await import("@/lib/google-login");
    await googleLigadoNestaLoja();

    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const { supabase } = await import("@/lib/supabase");
    const { toast } = await import("sonner");

    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    });
    vi.mocked(supabase.auth.onAuthStateChange).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    } as unknown as ReturnType<typeof supabase.auth.onAuthStateChange>);

    const aoAtualizar = vi.fn();
    await act(async () => {
      raiz.render(
        <AuthProvider>
          <Sonda authContext={AuthContext} aoAtualizar={aoAtualizar} />
        </AuthProvider>,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    const estado = aoAtualizar.mock.calls.at(-1)?.[0] as Snapshot;
    return { supabase, toast, ...estado };
  }

  function respostaComErro(erro: Record<string, unknown>) {
    return { data: { user: null, session: null }, error: erro } as never;
  }

  const ultimaFrase = (toast: { error: unknown }) =>
    vi.mocked(toast.error as (m: string) => void).mock.calls.at(-1)?.[0];

  function consoleNaoViuOEmail() {
    const tudo = JSON.stringify(consoleErro.mock.calls);
    expect(tudo).not.toContain(EMAIL);
  }

  describe("cadastro (signUp)", () => {
    async function cadastrar(
      erro: Record<string, unknown>,
      opcoes?: { google?: boolean },
    ) {
      const { supabase, toast, signUp } = await montar(opcoes);
      vi.mocked(supabase.auth.signUp).mockResolvedValue(respostaComErro(erro));
      let resultado = true;
      await act(async () => {
        resultado = await signUp(
          EMAIL,
          "senha-ficticia-1",
          "Pessoa Ficticia",
          "11999999999",
        );
      });
      return { resultado, frase: ultimaFrase(toast) };
    }

    it.each([
      ["só o código email_address_not_authorized", NAO_AUTORIZADO_PELO_CODIGO],
      [
        "só a mensagem do servidor (sem código)",
        NAO_AUTORIZADO_SO_PELA_MENSAGEM,
      ],
      [
        "SMTP quebrado (500 Error sending confirmation email)",
        SMTP_QUEBRADO_CONFIRMACAO,
      ],
    ])(
      "loja sem envio por %s: frase honesta, sem 'tente novamente'",
      async (_sinal, erro) => {
        const { resultado, frase } = await cadastrar(erro);
        expect(resultado).toBe(false);
        expect(frase).toBe(FRASE_CADASTRO_SEM_ENVIO);
        expect(frase).not.toMatch(/tente novamente/i);
        consoleNaoViuOEmail();
      },
    );

    it.each([
      ["500 do gancho", GANCHO_500],
      ["gancho estourou o tempo", GANCHO_ESTOUROU_O_TEMPO],
    ])(
      "Gmail da loja falhou (%s): manda tentar daqui a pouco e, se continuar, avisar a loja",
      async (_sinal, erro) => {
        const { resultado, frase } = await cadastrar(erro);
        expect(resultado).toBe(false);
        expect(frase).toBe(FRASE_CADASTRO_ENVIO_DA_LOJA_FALHOU);
        consoleNaoViuOEmail();
      },
    );

    it("Gmail da loja falhou com o Google ligado: a frase aponta o botão do Google", async () => {
      const { frase } = await cadastrar(GANCHO_500, { google: true });
      expect(frase).toBe(
        FRASE_CADASTRO_ENVIO_DA_LOJA_FALHOU + DICA_GOOGLE_NO_CADASTRO,
      );
    });

    it("com o Google ligado nesta loja, a frase aponta o botão que está na tela", async () => {
      const { frase } = await cadastrar(NAO_AUTORIZADO_PELO_CODIGO, {
        google: true,
      });
      expect(frase).toBe(FRASE_CADASTRO_SEM_ENVIO + DICA_GOOGLE_NO_CADASTRO);
    });

    it.each([
      ["código + mensagem do limite global", LIMITE_DA_LOJA],
      [
        "só a mensagem do limite global (sem código)",
        LIMITE_DA_LOJA_SEM_CODIGO,
      ],
    ])(
      "limite de e-mails da LOJA por %s: não culpa a cliente",
      async (_sinal, erro) => {
        const { frase } = await cadastrar(erro);
        expect(frase).toBe(FRASE_LIMITE_DA_LOJA);
        expect(frase).not.toMatch(/muitas tentativas/i);
      },
    );

    it.each([
      [
        "intervalo POR ENDEREÇO (a própria cliente pediu de novo cedo)",
        INTERVALO_DO_ENDERECO,
      ],
      ["limite por IP (over_request_rate_limit)", LIMITE_DO_IP],
      [
        "código do limite de e-mail com mensagem desconhecida",
        { status: 429, code: "over_email_send_rate_limit", message: "x" },
      ],
    ])("%s continua 'Muitas tentativas'", async (_sinal, erro) => {
      const { frase } = await cadastrar(erro);
      expect(frase).toBe(FRASE_MUITAS_TENTATIVAS_CADASTRO);
    });

    it("cadastro por e-mail desligado (email_provider_disabled) não vira 'loja sem envio'", async () => {
      const { frase } = await cadastrar({
        status: 422,
        code: "email_provider_disabled",
        message: "Email signups are disabled",
      });
      expect(frase).toBe(FRASE_GENERICA_CADASTRO);
    });

    it("500 de outra causa continua genérico", async () => {
      const { frase } = await cadastrar({
        status: 500,
        code: "unexpected_failure",
        message: "Database error saving new user",
      });
      expect(frase).toBe(FRASE_GENERICA_CADASTRO);
    });
  });

  describe("reenviar a confirmação (resendConfirmationEmail)", () => {
    async function reenviar(erro: Record<string, unknown>) {
      const { supabase, toast, resendConfirmationEmail } = await montar({
        google: true,
      });
      vi.mocked(supabase.auth.resend).mockResolvedValue(respostaComErro(erro));
      let resultado = true;
      await act(async () => {
        resultado = await resendConfirmationEmail(EMAIL);
      });
      return { resultado, frase: ultimaFrase(toast) };
    }

    it.each([
      ["código", NAO_AUTORIZADO_PELO_CODIGO],
      ["mensagem", NAO_AUTORIZADO_SO_PELA_MENSAGEM],
      ["SMTP quebrado", SMTP_QUEBRADO_CONFIRMACAO],
    ])(
      "loja sem envio (%s): frase honesta, sem Google (a tela de confirmação não tem o botão)",
      async (_sinal, erro) => {
        const { resultado, frase } = await reenviar(erro);
        expect(resultado).toBe(false);
        expect(frase).toBe(FRASE_REENVIO_SEM_ENVIO);
        consoleNaoViuOEmail();
      },
    );

    it.each([
      ["500 do gancho", GANCHO_500],
      ["gancho estourou o tempo", GANCHO_ESTOUROU_O_TEMPO],
    ])(
      "Gmail da loja falhou (%s): frase própria, sem Google",
      async (_sinal, erro) => {
        const { resultado, frase } = await reenviar(erro);
        expect(resultado).toBe(false);
        expect(frase).toBe(FRASE_REENVIO_ENVIO_DA_LOJA_FALHOU);
        consoleNaoViuOEmail();
      },
    );

    it("limite de e-mails da loja: não culpa a cliente", async () => {
      const { frase } = await reenviar(LIMITE_DA_LOJA);
      expect(frase).toBe(FRASE_LIMITE_DA_LOJA);
    });

    it("intervalo por endereço continua com a frase de antes", async () => {
      const { frase } = await reenviar(INTERVALO_DO_ENDERECO);
      expect(frase).toBe(FRASE_MUITAS_TENTATIVAS_REENVIO);
    });

    it("erro desconhecido continua genérico", async () => {
      const { frase } = await reenviar({
        status: 500,
        message: "mensagem-desconhecida",
      });
      expect(frase).toBe(FRASE_GENERICA_REENVIO);
    });
  });

  describe("recuperar a senha (resetPassword)", () => {
    async function recuperar(erro: Record<string, unknown>) {
      const { supabase, resetPassword } = await montar({ google: true });
      vi.mocked(supabase.auth.resetPasswordForEmail).mockResolvedValue(
        respostaComErro(erro),
      );
      let resultado: ResultadoRecuperacao | undefined;
      await act(async () => {
        resultado = await resetPassword(EMAIL);
      });
      return resultado as ResultadoRecuperacao;
    }

    it.each([
      ["código", NAO_AUTORIZADO_PELO_CODIGO],
      ["mensagem", NAO_AUTORIZADO_SO_PELA_MENSAGEM],
      ["SMTP quebrado", SMTP_QUEBRADO_RECUPERACAO],
    ])("loja sem envio (%s): frase honesta", async (_sinal, erro) => {
      const resultado = await recuperar(erro);
      expect(resultado.success).toBe(false);
      expect(resultado.status).toBe("error");
      expect(resultado.message).toBe(FRASE_RECUPERACAO_SEM_ENVIO);
      consoleNaoViuOEmail();
    });

    it.each([
      ["500 do gancho", GANCHO_500],
      ["gancho estourou o tempo", GANCHO_ESTOUROU_O_TEMPO],
    ])("Gmail da loja falhou (%s): frase própria", async (_sinal, erro) => {
      const resultado = await recuperar(erro);
      expect(resultado.success).toBe(false);
      expect(resultado.status).toBe("error");
      expect(resultado.message).toBe(FRASE_RECUPERACAO_ENVIO_DA_LOJA_FALHOU);
      consoleNaoViuOEmail();
    });

    it("limite de e-mails da loja: não culpa a cliente", async () => {
      const resultado = await recuperar(LIMITE_DA_LOJA);
      expect(resultado.success).toBe(false);
      expect(resultado.message).toBe(FRASE_LIMITE_DA_LOJA);
    });

    it.each([
      ["intervalo por endereço", INTERVALO_DO_ENDERECO],
      ["erro desconhecido", { status: 500, message: "mensagem-desconhecida" }],
    ])("%s continua com a frase única de antes", async (_sinal, erro) => {
      const resultado = await recuperar(erro);
      expect(resultado.message).toBe(FRASE_GENERICA_RECUPERACAO);
    });
  });
});
