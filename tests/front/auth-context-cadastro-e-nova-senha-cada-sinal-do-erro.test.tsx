// @vitest-environment jsdom
//
// CADASTRO e NOVA SENHA no AuthContext — a frase por TIPO de erro, sinal a sinal.
//
// O servidor devolve o mesmo problema por caminhos diferentes (código novo,
// código antigo, só a mensagem). O código do app aceita qualquer um deles, mas
// os testes existentes sempre davam os sinais juntos — então tirar um sinal
// (por exemplo o código `email_exists`, que o Supabase usa hoje) não derrubava
// nada, e a pessoa cadastrada passaria a ler "Não foi possível concluir o
// cadastro" em vez de "Este e-mail já está cadastrado". Cada caso abaixo dá UM
// sinal só.
//
// Também prova o que vai ao servidor (senha exatamente como digitada, nada
// aparado) e o que a tela recebe de volta. Mesmo padrão de
// auth-mensagem-traduzida.test.tsx (AuthProvider de verdade, supabase dublado).
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

interface Snapshot {
  signUp: (
    email: string,
    senha: string,
    fullName: string,
    phone: string,
  ) => Promise<boolean>;
  updatePassword: (novaSenha: string) => Promise<boolean>;
}

function Sonda({
  authContext,
  aoAtualizar,
}: {
  readonly authContext: React.Context<any>;
  readonly aoAtualizar: (snapshot: Snapshot) => void;
}) {
  const ctx = useContext(authContext) as Snapshot;
  aoAtualizar({ signUp: ctx.signUp, updatePassword: ctx.updatePassword });
  return null;
}

const FRASE_JA_CADASTRADO =
  "Este e-mail já está cadastrado. Tente entrar ou recuperar sua senha.";
const FRASE_GENERICA_CADASTRO =
  "Não foi possível concluir o cadastro. Tente novamente.";
const FRASE_SENHA_FRACA = "Senha muito fraca. Escolha outra senha.";

describe("AuthContext — cadastro e nova senha: cada sinal do erro, sozinho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    vi.spyOn(console, "error").mockImplementation(() => {});
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

  async function montar() {
    vi.resetModules();
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
    return { data: {}, error: erro } as never;
  }

  const ultimaFrase = (toast: { error: unknown }) =>
    vi.mocked(toast.error as (m: string) => void).mock.calls.at(-1)?.[0];

  describe("cadastro (signUp)", () => {
    it.each([
      ["só o código email_exists (o de hoje)", { code: "email_exists" }],
      [
        "só o código user_already_exists",
        { code: "user_already_exists", message: "mensagem-desconhecida" },
      ],
      [
        "só a mensagem (cliente antigo, sem código)",
        { message: "User already registered" },
      ],
    ])("e-mail já cadastrado por %s: frase própria", async (_sinal, erro) => {
      const { supabase, toast, signUp } = await montar();
      vi.mocked(supabase.auth.signUp).mockResolvedValue(
        respostaComErro({ status: 422, ...erro }),
      );

      let resultado = true;
      await act(async () => {
        resultado = await signUp(
          "pessoa.ficticia@exemplo.com",
          "senha-ficticia-1",
          "Pessoa Ficticia",
          "11999999999",
        );
      });

      expect(resultado).toBe(false);
      expect(ultimaFrase(toast)).toBe(FRASE_JA_CADASTRADO);
    });

    it("senha fraca só pelo código weak_password (mensagem qualquer)", async () => {
      const { supabase, toast, signUp } = await montar();
      vi.mocked(supabase.auth.signUp).mockResolvedValue(
        respostaComErro({
          status: 422,
          code: "weak_password",
          message: "mensagem-desconhecida",
        }),
      );

      await act(async () => {
        await signUp("a@exemplo.com", "x", "Pessoa Ficticia", "11999999999");
      });

      expect(ultimaFrase(toast)).toBe(FRASE_SENHA_FRACA);
    });

    it("e-mail com erro de digitação só pelo código email_address_invalid", async () => {
      const { supabase, toast, signUp } = await montar();
      vi.mocked(supabase.auth.signUp).mockResolvedValue(
        respostaComErro({
          status: 400,
          code: "email_address_invalid",
          message: "mensagem-desconhecida",
        }),
      );

      await act(async () => {
        await signUp("a@exemplo.com", "x", "Pessoa Ficticia", "11999999999");
      });

      expect(ultimaFrase(toast)).toBe(
        "Confira o e-mail: ele parece ter um erro de digitação.",
      );
    });

    it("limite de tentativas só pelo status 429 (sem código, mensagem qualquer)", async () => {
      const { supabase, toast, signUp } = await montar();
      vi.mocked(supabase.auth.signUp).mockResolvedValue(
        respostaComErro({ status: 429, message: "mensagem-desconhecida" }),
      );

      await act(async () => {
        await signUp("a@exemplo.com", "x", "Pessoa Ficticia", "11999999999");
      });

      expect(ultimaFrase(toast)).toBe(
        "Muitas tentativas. Tente novamente em alguns minutos.",
      );
    });

    it.each([400, 401, 403, 500])(
      "status %i sem código conhecido: frase genérica, nem 'já cadastrado' nem 'muitas tentativas'",
      async (status) => {
        const { supabase, toast, signUp } = await montar();
        vi.mocked(supabase.auth.signUp).mockResolvedValue(
          respostaComErro({ status, message: "mensagem-desconhecida" }),
        );

        await act(async () => {
          await signUp("a@exemplo.com", "x", "Pessoa Ficticia", "11999999999");
        });

        expect(ultimaFrase(toast)).toBe(FRASE_GENERICA_CADASTRO);
      },
    );

    it("vai ao servidor com o e-mail e a senha exatamente como recebidos, e o nome e o WhatsApp nos dados da conta", async () => {
      const { supabase, signUp } = await montar();
      vi.mocked(supabase.auth.signUp).mockResolvedValue({
        data: { user: null, session: null },
        error: null,
      } as never);

      let resultado = false;
      await act(async () => {
        resultado = await signUp(
          "Pessoa.Ficticia@Exemplo.com",
          "  Senha Ficticia 1  ",
          "Pessoa Ficticia",
          "(11) 99999-9999",
        );
      });

      expect(resultado).toBe(true);
      expect(supabase.auth.signUp).toHaveBeenCalledTimes(1);
      const enviado = vi.mocked(supabase.auth.signUp).mock.calls[0]?.[0] as {
        email: string;
        password: string;
        options?: { data?: Record<string, unknown> };
      };
      expect(enviado.email).toBe("Pessoa.Ficticia@Exemplo.com");
      expect(enviado.password).toBe("  Senha Ficticia 1  ");
      expect(enviado.options?.data).toEqual({
        full_name: "Pessoa Ficticia",
        phone: "(11) 99999-9999",
      });
    });
  });

  describe("nova senha (updatePassword)", () => {
    it("link já usado ou vencido (AuthSessionMissingError): diz que o link expirou", async () => {
      const { supabase, toast, updatePassword } = await montar();
      vi.mocked(supabase.auth.updateUser).mockResolvedValue({
        data: { user: null },
        error: { name: "AuthSessionMissingError", message: "x", status: 400 },
      } as never);

      let resultado = true;
      await act(async () => {
        resultado = await updatePassword("senha-ficticia-1");
      });

      expect(resultado).toBe(false);
      expect(ultimaFrase(toast)).toBe(
        "Este link expirou ou já foi usado. Peça um novo link.",
      );
    });

    it.each([
      ["same_password", "A nova senha precisa ser diferente da senha atual."],
      ["weak_password", FRASE_SENHA_FRACA],
      [
        "reauthentication_needed",
        "Por segurança, é preciso fazer login novamente antes de trocar a senha.",
      ],
    ])(
      "só o código %s (mensagem qualquer): frase própria",
      async (code, frase) => {
        const { supabase, toast, updatePassword } = await montar();
        vi.mocked(supabase.auth.updateUser).mockResolvedValue({
          data: { user: null },
          error: { code, message: "mensagem-desconhecida", status: 422 },
        } as never);

        await act(async () => {
          await updatePassword("senha-ficticia-1");
        });

        expect(ultimaFrase(toast)).toBe(frase);
      },
    );

    it("erro sem causa conhecida: frase genérica", async () => {
      const { supabase, toast, updatePassword } = await montar();
      vi.mocked(supabase.auth.updateUser).mockResolvedValue({
        data: { user: null },
        error: { message: "mensagem-desconhecida", status: 500 },
      } as never);

      await act(async () => {
        await updatePassword("senha-ficticia-1");
      });

      expect(ultimaFrase(toast)).toBe(
        "Não foi possível atualizar sua senha. Tente novamente.",
      );
    });

    it("sucesso: manda a senha exatamente como veio, avisa e devolve true", async () => {
      const { supabase, toast, updatePassword } = await montar();
      vi.mocked(supabase.auth.updateUser).mockResolvedValue({
        data: { user: {} },
        error: null,
      } as never);

      let resultado = false;
      await act(async () => {
        resultado = await updatePassword("  Nova Senha 1  ");
      });

      expect(resultado).toBe(true);
      expect(supabase.auth.updateUser).toHaveBeenCalledExactlyOnceWith({
        password: "  Nova Senha 1  ",
      });
      expect(toast.success).toHaveBeenCalledExactlyOnceWith(
        "Senha atualizada com sucesso!",
      );
      expect(toast.error).not.toHaveBeenCalled();
    });
  });
});
