// @vitest-environment jsdom
//
// Sete pontos onde a MENSAGEM CRUA de erro do Supabase chegava à tela em
// inglês (`toast.error(\`... ${error.message}\`)`), inclusive um sétimo em
// que a tela de admin nem tinha o dado: `AdminLoginView.tsx` desestruturava
// só `{ success }` do retorno de `login`, então um bloqueio por excesso de
// tentativas (429) mostrava "Email ou senha administrativos incorretos." com
// a senha CERTA — o lojista tentava de novo e ESTENDIA o próprio bloqueio.
//
// Cada `describe` cobre um dos 7 pontos. A regra que decide toda tradução
// aqui: causa verificada na doc oficial do Supabase Auth vira frase
// específica; causa ambígua ou não documentada (updateProfile — a RPC
// `update_my_profile_secure` não tem nenhum `RAISE EXCEPTION`, ver
// supabase/migrations/20260806000000_baseline_do_schema_vivo.sql:3433-3453)
// fica genérica.
//
// Mesmo padrão de auth-reset-password-enumeration.test.tsx e
// auth-logout-cleanup.test.tsx para os testes de AuthContext (Sonda +
// createRoot, sem @testing-library/react — vitest.config.ts documenta a
// escolha), e de auth-view-reenvio-confirmacao-no-login.test.tsx para o de
// AdminLoginView (useAuth mockado por inteiro).
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros arquivos que testam AuthContext diretamente.
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
  // A1-fix3 (R1) — `audience` é OBRIGATÓRIO no `login` real de AuthContext
  // (sem default); este tipo local precisa exigi-lo também, senão o cast
  // `ctx.login as Snapshot` (abaixo, em `Sonda`) esconde a mudança do
  // typecheck e os 5 call sites deste arquivo continuariam compilando
  // mesmo omitindo o argumento.
  login: (
    email: string,
    senha: string,
    audience: "customer" | "admin",
  ) => Promise<{ success: boolean; error?: any }>;
  signUp: (
    email: string,
    senha: string,
    fullName: string,
    phone: string,
  ) => Promise<boolean>;
  logout: () => Promise<void>;
  resendConfirmationEmail: (email: string) => Promise<boolean>;
  updatePassword: (newPassword: string) => Promise<boolean>;
  updateProfile: (updates: { full_name?: string | null }) => Promise<boolean>;
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
    logout: ctx.logout,
    resendConfirmationEmail: ctx.resendConfirmationEmail,
    updatePassword: ctx.updatePassword,
    updateProfile: ctx.updateProfile,
  });
  return null;
}

function ultimoEstado(
  aoAtualizar: ReturnType<typeof vi.fn>,
): Snapshot | undefined {
  return aoAtualizar.mock.calls.at(-1)?.[0];
}

describe("AuthContext — as seis mensagens deixam de vazar o erro cru do Supabase", () => {
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
      await esperarMicrotarefas();
    });

    const estado = ultimoEstado(aoAtualizar)!;
    return { supabase, toast, ...estado };
  }

  // --- Ponto 1: signUp (linha ~597) ---------------------------------------
  describe("signUp", () => {
    it("e-mail já cadastrado (code user_already_exists): mensagem própria, sem a frase crua do servidor", async () => {
      const { supabase, toast, signUp } = await montar();
      (
        supabase.auth.signUp as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        data: {},
        error: {
          code: "user_already_exists",
          status: 422,
          message: "User already registered",
        },
      });

      await act(async () => {
        await signUp("existe@example.com", "senha123", "Fulano", "34999999999");
      });

      const mensagem = (toast.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(mensagem).toMatch(/já está cadastrado/i);
      expect(mensagem).not.toMatch(/already registered/i);
    });

    it("senha fraca (code weak_password): mensagem própria, sem a frase crua do servidor", async () => {
      const { supabase, toast, signUp } = await montar();
      (
        supabase.auth.signUp as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        data: {},
        error: {
          code: "weak_password",
          status: 422,
          message: "Password should be at least 6 characters",
        },
      });

      await act(async () => {
        await signUp("novo@example.com", "123", "Fulano", "34999999999");
      });

      const mensagem = (toast.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(mensagem).toMatch(/fraca/i);
      expect(mensagem).not.toMatch(/at least 6 characters/i);
    });

    it("limite de envio (status 429): 'muitas tentativas', não 'senha fraca' nem a frase crua", async () => {
      const { supabase, toast, signUp } = await montar();
      (
        supabase.auth.signUp as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        data: {},
        error: {
          code: "over_email_send_rate_limit",
          status: 429,
          message:
            "For security purposes, you can only request this after 58 seconds.",
        },
      });

      await act(async () => {
        await signUp("novo2@example.com", "senha123", "Fulano", "34999999999");
      });

      const mensagem = (toast.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(mensagem).toMatch(/muitas tentativas/i);
      expect(mensagem).not.toMatch(/security purposes|seconds/i);
    });

    it("causa desconhecida (sem code, rede): mensagem genérica honesta, erro cru só no console", async () => {
      const { supabase, toast, signUp } = await montar();
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      (
        supabase.auth.signUp as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        data: {},
        error: { message: "Network request failed" },
      });

      await act(async () => {
        await signUp("novo3@example.com", "senha123", "Fulano", "34999999999");
      });

      const mensagem = (toast.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(mensagem).not.toMatch(/network request failed/i);
      expect(mensagem.length).toBeGreaterThan(0);
      expect(consoleErrorSpy).toHaveBeenCalled();
      const argsConsole = consoleErrorSpy.mock.calls[0];
      expect(argsConsole.join(" ")).toMatch(/network request failed/i);
    });
  });

  // --- Ponto 2: login (linha ~616) ----------------------------------------
  describe("login", () => {
    it("e-mail não confirmado: mensagem própria, e a ordem vence o 400 genérico (mesmo #200 de AuthView.tsx)", async () => {
      const { supabase, toast, login } = await montar();
      (
        supabase.auth.signInWithPassword as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        data: {},
        error: {
          status: 400,
          code: "email_not_confirmed",
          message: "Email not confirmed",
        },
      });

      await act(async () => {
        await login("presa@example.com", "senha123", "customer");
      });

      const mensagem = (toast.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(mensagem).toMatch(/ainda não foi confirmado/i);
      expect(mensagem).not.toMatch(/incorretos/i);
    });

    it("credenciais inválidas (status 400): 'E-mail ou senha incorretos', sem a frase crua", async () => {
      const { supabase, toast, login } = await montar();
      (
        supabase.auth.signInWithPassword as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        data: {},
        error: {
          status: 400,
          code: "invalid_credentials",
          message: "Invalid login credentials",
        },
      });

      await act(async () => {
        await login("alguem@example.com", "senha-errada", "customer");
      });

      const mensagem = (toast.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(mensagem).toMatch(/e-?mail ou senha incorretos/i);
      expect(mensagem).not.toMatch(/invalid login credentials/i);
    });

    // O caso que motivou o lote inteiro: bloqueio por IP não pode virar
    // "senha incorreta" — nem no toast global, nem (ponto 7) na tela de admin.
    it("bloqueio por excesso de tentativas (status 429): 'muitas tentativas', NUNCA 'incorretos'", async () => {
      const { supabase, toast, login } = await montar();
      (
        supabase.auth.signInWithPassword as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        data: {},
        error: { status: 429, message: "Too many requests" },
      });

      await act(async () => {
        await login("alguem@example.com", "senha-certa", "customer");
      });

      const mensagem = (toast.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(mensagem).toMatch(/muitas tentativas/i);
      expect(mensagem).not.toMatch(/incorretos/i);
    });

    // Achado da revisão de contexto limpo: este era o ÚNICO dos 6 pontos sem
    // teste, e ele é o mais importante de cobrir — o genérico do `login` é a
    // última barreira antes de `error.message` chegar à tela no ponto mais
    // movimentado do app. O revisor provou a lacuna por canário: trocou a
    // frase por lixo e a suíte continuou 22/22 verde.
    //
    // `status: 0` não é inventado: é o que o @supabase/auth-js devolve quando
    // o `fetch` falha (AuthRetryableFetchError, lib/fetch.js) — ou seja, o
    // caminho de rede caída, que é justamente o que não casa com 400 nem 429.
    it("causa desconhecida (rede caída, status 0): frase genérica e NENHUM traço do erro cru", async () => {
      const { supabase, toast, login } = await montar();
      (
        supabase.auth.signInWithPassword as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        data: {},
        error: { status: 0, message: "Failed to fetch" },
      });

      await act(async () => {
        await login("alguem@example.com", "senha-certa", "customer");
      });

      const mensagem = (toast.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(mensagem).toMatch(/não foi possível entrar/i);
      expect(mensagem).not.toMatch(/failed to fetch/i);
      // Não pode culpar a senha: a causa é rede, e afirmar "incorretos" aqui
      // faria a pessoa trocar uma senha que está certa.
      expect(mensagem).not.toMatch(/incorretos/i);
    });

    it("o retorno continua trazendo { success: false, error } inteiro (assinatura não muda)", async () => {
      const { supabase, login } = await montar();
      const erroOriginal = { status: 429, message: "Too many requests" };
      (
        supabase.auth.signInWithPassword as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ data: {}, error: erroOriginal });

      let resultado: { success: boolean; error?: any };
      await act(async () => {
        resultado = await login(
          "alguem@example.com",
          "senha-certa",
          "customer",
        );
      });

      expect(resultado!.success).toBe(false);
      expect(resultado!.error).toEqual(erroOriginal);
    });

    // A1-fix5 (revisão de contexto limpo) — C1: o `else if (user_banned)`
    // que a A1-fix3 acrescentou em AuthContext.tsx tem corpo VAZIO e não
    // tinha nenhum teste que o exercitasse diretamente — só existia
    // cobertura indireta via AuthView (que simula `login` por inteiro e
    // nunca chega a rodar este trecho). Prova por mutação: apagar este
    // `else if` faz este teste cair (a mensagem voltaria a ser
    // "incorretos", porque cairia no `status === 400` genérico logo abaixo).
    it("conta banida (status 400, code user_banned, senha certa): mensagem genérica da audiência, nunca 'incorretos'", async () => {
      const { supabase, toast, login } = await montar();
      (
        supabase.auth.signInWithPassword as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        data: {},
        error: {
          status: 400,
          code: "user_banned",
          message: "User is banned",
        },
      });

      await act(async () => {
        await login("banido@example.com", "senha-certa", "customer");
      });

      const mensagem = (toast.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(mensagem).toMatch(/não foi possível entrar agora/i);
      expect(mensagem).not.toMatch(/incorretos/i);
      // As DUAS constantes genéricas começam com a mesma frase ("Não foi
      // possível entrar agora..."), então a asserção acima NÃO distingue a do
      // cliente da do lojista. O discriminador é a cláusula de saída: só a do
      // cliente diz "fale com a loja". Sem esta linha, trocar a constante por
      // engano passaria com a suíte inteira verde.
      expect(mensagem).toMatch(/fale com a loja/i);
      expect(mensagem).not.toMatch(/user is banned/i);
    });
  });

  // --- Ponto 3: logout (linha ~632) ---------------------------------------
  describe("logout", () => {
    it("signOut() com erro: mensagem genérica honesta (a sessão local É limpa de qualquer forma), sem a frase crua", async () => {
      const { supabase, toast, logout } = await montar();
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      (
        supabase.auth.signOut as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ error: { message: "Failed to fetch" } });

      await act(async () => {
        await logout();
      });

      const mensagem = (toast.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(mensagem).not.toMatch(/failed to fetch/i);
      expect(mensagem.length).toBeGreaterThan(0);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  // --- Ponto 4: resendConfirmationEmail (linha ~675) ----------------------
  describe("resendConfirmationEmail", () => {
    it("limite de envio (status 429): mensagem de 'aguarde', sem a frase crua", async () => {
      const { supabase, toast, resendConfirmationEmail } = await montar();
      (
        supabase.auth.resend as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        data: {},
        error: {
          status: 429,
          message:
            "For security purposes, you can only request this after 58 seconds.",
        },
      });

      await act(async () => {
        await resendConfirmationEmail("presa@example.com");
      });

      const mensagem = (toast.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(mensagem).toMatch(/aguarde|muitas tentativas/i);
      expect(mensagem).not.toMatch(/security purposes|seconds/i);
    });

    it("causa desconhecida: mensagem genérica de reenvio, sem a frase crua", async () => {
      const { supabase, toast, resendConfirmationEmail } = await montar();
      (
        supabase.auth.resend as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        data: {},
        error: { message: "Network request failed" },
      });

      await act(async () => {
        await resendConfirmationEmail("presa2@example.com");
      });

      const mensagem = (toast.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(mensagem).not.toMatch(/network request failed/i);
      // Não pode ser a mesma frase do limite de envio — são causas diferentes.
      expect(mensagem).not.toMatch(/aguarde|muitas tentativas/i);
    });
  });

  // --- Ponto 5: updatePassword (linha ~786) -------------------------------
  describe("updatePassword", () => {
    it("mesma senha (code same_password): mensagem própria, sem a frase crua", async () => {
      const { supabase, toast, updatePassword } = await montar();
      (
        supabase.auth.updateUser as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        data: {},
        error: {
          code: "same_password",
          message: "New password should be different from the old password.",
        },
      });

      await act(async () => {
        await updatePassword("mesma-senha-123");
      });

      const mensagem = (toast.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(mensagem).toMatch(/diferente da senha atual/i);
      expect(mensagem).not.toMatch(/old password/i);
    });

    it("senha fraca (code weak_password): mensagem própria", async () => {
      const { supabase, toast, updatePassword } = await montar();
      (
        supabase.auth.updateUser as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        data: {},
        error: {
          code: "weak_password",
          message: "Password should be at least 6 characters",
        },
      });

      await act(async () => {
        await updatePassword("123");
      });

      const mensagem = (toast.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(mensagem).toMatch(/fraca/i);
    });

    it("reautenticação exigida (code reauthentication_needed): orienta a entrar de novo", async () => {
      const { supabase, toast, updatePassword } = await montar();
      (
        supabase.auth.updateUser as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        data: {},
        error: {
          code: "reauthentication_needed",
          message: "Reauthentication needed",
        },
      });

      await act(async () => {
        await updatePassword("senhaNova123");
      });

      const mensagem = (toast.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(mensagem).toMatch(/login novamente/i);
      expect(mensagem).not.toMatch(/reauthentication/i);
    });

    it("causa desconhecida: mensagem genérica, sem a frase crua", async () => {
      const { supabase, toast, updatePassword } = await montar();
      (
        supabase.auth.updateUser as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        data: {},
        error: { message: "Network request failed" },
      });

      await act(async () => {
        await updatePassword("senhaNova123");
      });

      const mensagem = (toast.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(mensagem).not.toMatch(/network request failed/i);
      expect(mensagem).not.toMatch(/fraca|senha atual|login novamente/i);
    });
  });

  // --- Ponto 6: updateProfile (linha ~818-819) ----------------------------
  describe("updateProfile", () => {
    it("erro da RPC (sem causa distinguível): mensagem genérica, e NÃO usa err.message como reserva", async () => {
      const { supabase, toast, updateProfile } = await montar();
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: null,
        error: { message: 'column "whatsapp" violates check constraint' },
      });

      await act(async () => {
        await updateProfile({ full_name: "Novo Nome" });
      });

      const mensagem = (toast.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(mensagem).not.toMatch(/check constraint|whatsapp/i);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it("erro sem message nenhuma: a mensagem exibida é a MESMA de quando há message (prova que o '||' de reserva saiu)", async () => {
      const { supabase, toast, updateProfile } = await montar();
      vi.spyOn(console, "error").mockImplementation(() => {});
      (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: null,
        error: {},
      });

      await act(async () => {
        await updateProfile({ full_name: "Novo Nome 2" });
      });

      const mensagemSemDetalhe = (toast.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;

      (toast.error as ReturnType<typeof vi.fn>).mockClear();
      (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: null,
        error: { message: "detalhe interno do banco" },
      });

      await act(async () => {
        await updateProfile({ full_name: "Novo Nome 3" });
      });

      const mensagemComDetalhe = (toast.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;

      expect(mensagemSemDetalhe).toBe(mensagemComDetalhe);
      expect(mensagemComDetalhe).not.toMatch(/detalhe interno do banco/i);
    });
  });
});

// --- Ponto 7: AdminLoginView.tsx:30 ---------------------------------------
//
// Suíte isolada porque este ponto testa a VIEW, não o contexto — a `login`
// aqui é um dublê de `useAuth`, mesmo padrão de
// auth-view-reenvio-confirmacao-no-login.test.tsx.
describe("AdminLoginView — o erro deixa de virar sempre 'senha incorreta'", () => {
  const login = vi.fn();

  vi.doMock("@/hooks/useAuth", () => ({
    useAuth: () => ({ login }),
  }));

  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    login.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
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

  async function montarESubmeter() {
    const { AdminLoginView } = await import("@/views/admin/AdminLoginView");
    const onLogin = vi.fn();
    const onNavigate = vi.fn();

    await act(async () => {
      raiz.render(<AdminLoginView onLogin={onLogin} onNavigate={onNavigate} />);
    });

    await act(async () => {
      digitar("admin-email", "lojista@example.com");
      digitar("admin-password", "senha-certa");
    });

    const form = hospedeiro.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await esperarMicrotarefas();
    });

    return { onLogin };
  }

  // O defeito relatado: a tela lia só `success` e por isso um bloqueio por
  // excesso de tentativas (senha CERTA) virava "senha incorreta" — o lojista
  // tentava de novo e ESTENDIA o próprio bloqueio.
  it("bloqueio por excesso de tentativas (429, senha certa): NÃO mostra 'Email ou senha administrativos incorretos'", async () => {
    login.mockResolvedValue({
      success: false,
      error: { status: 429, message: "Too many requests" },
    });

    await montarESubmeter();

    expect(hospedeiro.textContent).not.toMatch(
      /email ou senha administrativos incorretos/i,
    );
    expect(hospedeiro.textContent).toMatch(/muitas tentativas/i);
  });

  it("credenciais realmente inválidas (status 400): continua mostrando 'Email ou senha administrativos incorretos'", async () => {
    login.mockResolvedValue({
      success: false,
      error: {
        status: 400,
        code: "invalid_credentials",
        message: "Invalid login credentials",
      },
    });

    await montarESubmeter();

    expect(hospedeiro.textContent).toMatch(
      /email ou senha administrativos incorretos/i,
    );
  });

  it("e-mail administrativo não confirmado: mensagem própria, não 'incorretos'", async () => {
    login.mockResolvedValue({
      success: false,
      error: {
        code: "email_not_confirmed",
        message: "Email not confirmed",
      },
    });

    await montarESubmeter();

    expect(hospedeiro.textContent).toMatch(/não foi confirmado/i);
    expect(hospedeiro.textContent).not.toMatch(
      /email ou senha administrativos incorretos/i,
    );
  });

  it("causa desconhecida (sem status nem code): mensagem genérica, NUNCA 'incorretos' por presunção", async () => {
    login.mockResolvedValue({
      success: false,
      error: { message: "Network request failed" },
    });

    await montarESubmeter();

    expect(hospedeiro.textContent).not.toMatch(
      /email ou senha administrativos incorretos/i,
    );
    expect(hospedeiro.textContent).not.toMatch(/network request failed/i);
  });

  // A1-fix5 (revisão de contexto limpo) — C1: o ramo `user_banned` de
  // `mensagemDeErroAdminLogin` (AdminLoginView.tsx) não tinha nenhum teste
  // próprio. Prova por mutação: apagar este `if` faz este teste cair (a
  // mensagem voltaria a ser "incorretos", porque cairia no `status === 400`
  // genérico logo abaixo).
  it("conta banida (status 400, code user_banned, senha certa): mensagem genérica do lojista, NUNCA 'incorretos'", async () => {
    login.mockResolvedValue({
      success: false,
      error: {
        status: 400,
        code: "user_banned",
        message: "User is banned",
      },
    });

    await montarESubmeter();

    expect(hospedeiro.textContent).toMatch(/não foi possível entrar agora/i);
    // 🔴 O discriminador que faltava: as DUAS constantes genéricas abrem com a
    // mesma frase, então a asserção acima casa com a do cliente TAMBÉM. Sem
    // esta linha, trocar `MENSAGEM_ERRO_LOGIN_GENERICA_LOJISTA` pela do
    // cliente (nomes vizinhos, um sufixo de diferença) mandaria o DONO da loja
    // "falar com a loja" — o invariante que este lote existiu para fechar — e
    // a suíte passaria inteira.
    expect(hospedeiro.textContent).not.toMatch(/fale com a loja/i);
    expect(hospedeiro.textContent).not.toMatch(
      /email ou senha administrativos incorretos/i,
    );
    expect(hospedeiro.textContent).not.toMatch(/user is banned/i);
  });

  it("login bem-sucedido continua chamando onLogin (não regrediu o caminho feliz)", async () => {
    login.mockResolvedValue({ success: true });

    const { onLogin } = await montarESubmeter();

    expect(onLogin).toHaveBeenCalledTimes(1);
  });
});
