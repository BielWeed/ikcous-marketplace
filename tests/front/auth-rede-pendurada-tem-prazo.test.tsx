// @vitest-environment jsdom
//
// Rede "pendurada" (conecta e não responde) na AUTENTICAÇÃO: as cinco chamadas
// do AuthContext ao Supabase Auth (entrar, criar conta, "esqueci a senha",
// código de recuperação e nova senha) não tinham prazo, então o botão da tela
// girava para sempre — sem erro e sem saída. Cada chamada agora é limitada a
// 15 s (`aguardarComPrazo`) e devolve uma frase em português.
//
// O que cada teste fixa:
//  - promessa que NUNCA resolve + relógio falso: a função volta depois do
//    prazo, e NÃO antes dele;
//  - a frase de signUp e updatePassword manda CONFERIR antes de repetir (o
//    servidor pode ter concluído);
//  - resetPassword continua com a frase GENÉRICA (#120: não reabrir a
//    enumeração de e-mail) — nunca a de sucesso ("se este e-mail estiver
//    cadastrado") nem "e-mail não cadastrado";
//  - controle: resposta rápida e erro de verdade seguem exatamente como eram.
//
// Mesmo padrão de auth-mensagem-traduzida.test.tsx (Sonda + createRoot sobre o
// AuthContext real, supabase mockado, sem @testing-library/react).
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
      verifyOtp: vi.fn(),
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

const PRAZO_MS = 15_000;

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
  login: (
    email: string,
    senha: string,
    audience: "customer" | "admin",
  ) => Promise<{ success: boolean; error?: any; message?: string }>;
  signUp: (
    email: string,
    senha: string,
    fullName: string,
    phone: string,
  ) => Promise<boolean>;
  resetPassword: (email: string) => Promise<{
    success: boolean;
    status: "success" | "error";
    message?: string;
  }>;
  verifyRecoveryCode: (email: string, code: string) => Promise<boolean>;
  updatePassword: (newPassword: string) => Promise<boolean>;
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
    login: ctx.login,
    signUp: ctx.signUp,
    resetPassword: ctx.resetPassword,
    verifyRecoveryCode: ctx.verifyRecoveryCode,
    updatePassword: ctx.updatePassword,
  });
  return null;
}

/** Promessa que conecta e nunca responde. */
function nuncaResolve<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

describe("AuthContext — rede pendurada na autenticação tem prazo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    vi.useRealTimers();
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

    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: null }, error: null });
    (
      supabase.auth.onAuthStateChange as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });

    const aoAtualizar = vi.fn();
    await act(async () => {
      raiz.render(
        <AuthProvider>
          <Sonda authContext={AuthContext} aoAtualizar={aoAtualizar} />
        </AuthProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const ctx = aoAtualizar.mock.calls.at(-1)?.[0] as Snapshot;
    return {
      ctx,
      toast: toast as unknown as { error: ReturnType<typeof vi.fn> },
      auth: supabase.auth as unknown as Record<
        string,
        ReturnType<typeof vi.fn>
      >,
    };
  }

  /**
   * Chama `executar` com relógio falso, deixa passar `ms` e devolve o que a
   * função devolveu — ou `PENDENTE` se ela ainda não voltou nesse tempo.
   */
  const PENDENTE = Symbol("pendente");
  async function chamarEEsperar<T>(
    executar: () => Promise<T>,
    ms: number,
  ): Promise<T | typeof PENDENTE> {
    vi.useFakeTimers();
    let resultado: T | typeof PENDENTE = PENDENTE;
    let falha: unknown;
    let falhou = false;
    await act(async () => {
      executar().then(
        (valor) => {
          resultado = valor;
        },
        (erro) => {
          falha = erro;
          falhou = true;
        },
      );
      await vi.advanceTimersByTimeAsync(ms);
    });
    if (falhou) throw falha;
    return resultado;
  }

  describe("entrar (signInWithPassword)", () => {
    it("promessa que nunca resolve: só volta no prazo, com success:false e frase de conexão lenta", async () => {
      const { ctx, auth } = await montar();
      auth.signInWithPassword.mockReturnValue(nuncaResolve());
      const consoleErro = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      // Um milissegundo antes do prazo: ainda girando.
      expect(
        await chamarEEsperar(
          () => ctx.login("a@b.com", "senha1234", "customer"),
          PRAZO_MS - 1,
        ),
      ).toBe(PENDENTE);

      // Completa o prazo da MESMA chamada (nova chamada = novo relógio).
      vi.useRealTimers();
      auth.signInWithPassword.mockReturnValue(nuncaResolve());
      const resultado = await chamarEEsperar(
        () => ctx.login("a@b.com", "senha1234", "customer"),
        PRAZO_MS,
      );

      expect(resultado).not.toBe(PENDENTE);
      const r = resultado as Awaited<ReturnType<Snapshot["login"]>>;
      expect(r.success).toBe(false);
      expect(r.message).toMatch(/^A conexão está lenta/);
      // Não finge ser credencial errada, nem e-mail não confirmado.
      expect(r.message).not.toMatch(/incorretos|confirmado|loja/i);
      expect(consoleErro).not.toHaveBeenCalledWith(
        "[Auth] Erro ao entrar:",
        expect.anything(),
      );
    });

    it("controle: resposta rápida de sucesso segue igual (success:true, sem message)", async () => {
      const { ctx, auth } = await montar();
      auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });

      const resultado = await chamarEEsperar(
        () => ctx.login("a@b.com", "senha1234", "customer"),
        0,
      );

      expect(resultado).toEqual({ success: true });
    });

    it("controle: erro de verdade (400) continua devolvendo o erro e a frase de credencial", async () => {
      const { ctx, auth } = await montar();
      const erro = { status: 400, message: "Invalid login credentials" };
      auth.signInWithPassword.mockResolvedValue({ data: {}, error: erro });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const resultado = (await chamarEEsperar(
        () => ctx.login("a@b.com", "errada", "customer"),
        0,
      )) as Awaited<ReturnType<Snapshot["login"]>>;

      expect(resultado.success).toBe(false);
      expect(resultado.error).toBe(erro);
      expect(resultado.message).toMatch(/e-mail ou senha incorretos/i);
    });

    it("controle: exceção de verdade (não é prazo) continua LANÇANDO — o prazo não engole outras falhas", async () => {
      const { ctx, auth } = await montar();
      auth.signInWithPassword.mockRejectedValue(new Error("boom"));

      await expect(
        chamarEEsperar(() => ctx.login("a@b.com", "senha1234", "admin"), 0),
      ).rejects.toThrow("boom");
    });
  });

  describe("criar conta (signUp)", () => {
    it("promessa que nunca resolve: false no prazo, toast manda CONFERIR antes de repetir", async () => {
      const { ctx, auth, toast } = await montar();
      auth.signUp.mockReturnValue(nuncaResolve());

      expect(
        await chamarEEsperar(
          () => ctx.signUp("a@b.com", "senha1234", "Ana", "11999999999"),
          PRAZO_MS - 1,
        ),
      ).toBe(PENDENTE);
      expect(toast.error).not.toHaveBeenCalled();

      vi.useRealTimers();
      auth.signUp.mockReturnValue(nuncaResolve());
      const resultado = await chamarEEsperar(
        () => ctx.signUp("a@b.com", "senha1234", "Ana", "11999999999"),
        PRAZO_MS,
      );

      expect(resultado).toBe(false);
      expect(toast.error).toHaveBeenCalledTimes(1);
      const frase = String(toast.error.mock.calls[0][0]);
      expect(frase).toMatch(/^A conexão está lenta/);
      // O servidor pode ter criado a conta: manda conferir o e-mail / tentar entrar.
      expect(frase).toMatch(/e-mail/i);
      expect(frase).toMatch(/entrar/i);
      // Não é nenhuma das frases de erro conhecidas do cadastro.
      expect(frase).not.toMatch(/já está cadastrado|Senha muito fraca/i);
    });

    it("controle: cadastro rápido com sucesso segue igual (true, sem toast de erro)", async () => {
      const { ctx, auth, toast } = await montar();
      auth.signUp.mockResolvedValue({
        data: { user: { id: "u1" }, session: null },
        error: null,
      });

      const resultado = await chamarEEsperar(
        () => ctx.signUp("a@b.com", "senha1234", "Ana", "11999999999"),
        0,
      );

      expect(resultado).toBe(true);
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("controle: e-mail já cadastrado continua com a própria frase", async () => {
      const { ctx, auth, toast } = await montar();
      auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: { code: "user_already_exists", message: "x", status: 422 },
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const resultado = await chamarEEsperar(
        () => ctx.signUp("a@b.com", "senha1234", "Ana", "11999999999"),
        0,
      );

      expect(resultado).toBe(false);
      expect(toast.error).toHaveBeenCalledWith(
        "Este e-mail já está cadastrado. Tente entrar ou recuperar sua senha.",
      );
    });
  });

  describe("esqueci a senha (resetPasswordForEmail)", () => {
    it("promessa que nunca resolve: success:false no prazo com a frase GENÉRICA (não enumera e-mail)", async () => {
      const { ctx, auth } = await montar();
      auth.resetPasswordForEmail.mockReturnValue(nuncaResolve());
      vi.spyOn(console, "error").mockImplementation(() => {});

      expect(
        await chamarEEsperar(() => ctx.resetPassword("a@b.com"), PRAZO_MS - 1),
      ).toBe(PENDENTE);

      vi.useRealTimers();
      auth.resetPasswordForEmail.mockReturnValue(nuncaResolve());
      const resultado = (await chamarEEsperar(
        () => ctx.resetPassword("a@b.com"),
        PRAZO_MS,
      )) as Awaited<ReturnType<Snapshot["resetPassword"]>>;

      expect(resultado.success).toBe(false);
      expect(resultado.status).toBe("error");
      // Mesma frase do erro genuíno (#120): igual exista a conta ou não.
      expect(resultado.message).toBe(
        "Não foi possível enviar o link agora. Se você acabou de pedir um, ele já pode estar na sua caixa de entrada (confira também o spam): use o e-mail mais recente. Senão, tente novamente em instantes.",
      );
      expect(resultado.message).not.toMatch(/cadastrad|lenta/i);
    });

    it("controle: resposta rápida de sucesso segue com a frase neutra de sucesso", async () => {
      const { ctx, auth } = await montar();
      auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });

      const resultado = (await chamarEEsperar(
        () => ctx.resetPassword("a@b.com"),
        0,
      )) as Awaited<ReturnType<Snapshot["resetPassword"]>>;

      expect(resultado.success).toBe(true);
      expect(resultado.message).toBe(
        "Se este e-mail estiver cadastrado, enviamos um link de recuperação.",
      );
    });
  });

  describe("código de recuperação (verifyOtp)", () => {
    it("promessa que nunca resolve: false no prazo, toast de conexão lenta (não 'código inválido' nem 'erro ao verificar')", async () => {
      const { ctx, auth, toast } = await montar();
      auth.verifyOtp.mockReturnValue(nuncaResolve());
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});

      expect(
        await chamarEEsperar(
          () => ctx.verifyRecoveryCode("a@b.com", "123456"),
          PRAZO_MS - 1,
        ),
      ).toBe(PENDENTE);

      vi.useRealTimers();
      auth.verifyOtp.mockReturnValue(nuncaResolve());
      const resultado = await chamarEEsperar(
        () => ctx.verifyRecoveryCode("a@b.com", "123456"),
        PRAZO_MS,
      );

      expect(resultado).toBe(false);
      expect(toast.error).toHaveBeenCalledTimes(1);
      const frase = String(toast.error.mock.calls[0][0]);
      expect(frase).toMatch(/^A conexão está lenta/);
      expect(frase).not.toBe("Código inválido ou expirado.");
      expect(frase).not.toBe("Erro ao verificar código.");
    });

    it("controle: código errado (erro devolvido) continua com 'Código inválido ou expirado.'", async () => {
      const { ctx, auth, toast } = await montar();
      auth.verifyOtp.mockResolvedValue({
        data: {},
        error: { message: "Token has expired or is invalid", status: 403 },
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});

      const resultado = await chamarEEsperar(
        () => ctx.verifyRecoveryCode("a@b.com", "000000"),
        0,
      );

      expect(resultado).toBe(false);
      expect(toast.error).toHaveBeenCalledWith("Código inválido ou expirado.");
    });

    it("controle: exceção de verdade continua com 'Erro ao verificar código.'", async () => {
      const { ctx, auth, toast } = await montar();
      auth.verifyOtp.mockRejectedValue(new Error("boom"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});

      const resultado = await chamarEEsperar(
        () => ctx.verifyRecoveryCode("a@b.com", "123456"),
        0,
      );

      expect(resultado).toBe(false);
      expect(toast.error).toHaveBeenCalledWith("Erro ao verificar código.");
    });
  });

  describe("nova senha (updateUser)", () => {
    it("promessa que nunca resolve: false no prazo, toast manda CONFERIR (tentar entrar com a senha nova) antes de repetir", async () => {
      const { ctx, auth, toast } = await montar();
      auth.updateUser.mockReturnValue(nuncaResolve());

      expect(
        await chamarEEsperar(
          () => ctx.updatePassword("novaSenha123"),
          PRAZO_MS - 1,
        ),
      ).toBe(PENDENTE);
      expect(toast.error).not.toHaveBeenCalled();

      vi.useRealTimers();
      auth.updateUser.mockReturnValue(nuncaResolve());
      const resultado = await chamarEEsperar(
        () => ctx.updatePassword("novaSenha123"),
        PRAZO_MS,
      );

      expect(resultado).toBe(false);
      expect(toast.error).toHaveBeenCalledTimes(1);
      const frase = String(toast.error.mock.calls[0][0]);
      expect(frase).toMatch(/^A conexão está lenta/);
      expect(frase).toMatch(/senha/i);
      expect(frase).toMatch(/entrar/i);
      expect(frase).not.toMatch(/Senha muito fraca|diferente da senha atual/i);
    });

    it("controle: troca rápida com sucesso segue igual (true + toast de sucesso)", async () => {
      const { ctx, auth, toast } = await montar();
      auth.updateUser.mockResolvedValue({ data: {}, error: null });
      const { toast: toastReal } = await import("sonner");

      const resultado = await chamarEEsperar(
        () => ctx.updatePassword("novaSenha123"),
        0,
      );

      expect(resultado).toBe(true);
      expect(toast.error).not.toHaveBeenCalled();
      expect(toastReal.success).toHaveBeenCalledWith(
        "Senha atualizada com sucesso!",
      );
    });

    it("controle: senha igual à atual (erro devolvido) continua com a própria frase", async () => {
      const { ctx, auth, toast } = await montar();
      auth.updateUser.mockResolvedValue({
        data: {},
        error: { code: "same_password", message: "x", status: 422 },
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const resultado = await chamarEEsperar(
        () => ctx.updatePassword("novaSenha123"),
        0,
      );

      expect(resultado).toBe(false);
      expect(toast.error).toHaveBeenCalledWith(
        "A nova senha precisa ser diferente da senha atual.",
      );
    });
  });
});
