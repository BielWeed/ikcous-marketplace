import { branding } from "@/config/branding";
import { useAuth } from "@/hooks/useAuth";
import { MENSAGEM_ERRO_LOGIN_GENERICA_LOJISTA } from "@/lib/mensagens-auth";
import type { View } from "@/types";
import { ArrowRight, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import type React from "react";
import { useState } from "react";

interface AdminLoginViewProps {
  readonly onLogin: () => void;
  readonly onNavigate: (view: View) => void;
}

// Simple admin password - in production, this should be handled server-side
// Password legacy removed

// Defeito relatado: a tela desestruturava só `{ success }` do retorno de
// `login` (AuthContext) e por isso só conseguia emitir UMA frase — inclusive
// num bloqueio por excesso de tentativas (429), quando ela afirmava "senha
// incorreta" com a senha CERTA e o lojista tentava de novo, estendendo o
// próprio bloqueio. Mesma tradução por causa de AuthContext.login (doc
// oficial do Supabase Auth: https://supabase.com/docs/guides/auth/debugging/error-codes),
// copiada aqui porque a mensagem é específica desta tela ("administrativos").
//
// A1-fix2 (achado BLOQUEANTE) — o ramo genérico abaixo tinha um literal
// PRÓPRIO ("Não foi possível entrar. Tente novamente."), diferente do que o
// TOAST global de `login` disparava para o mesmo erro
// (`MENSAGEM_ERRO_LOGIN_GENERICA`, que fala em "fale com a loja"). Duas
// frases diferentes na tela ao mesmo tempo, e a que sobrava mandava o DONO
// da loja falar com a loja. Agora o ramo GENÉRICO usa
// `MENSAGEM_ERRO_LOGIN_GENERICA_LOJISTA` (`@/lib/mensagens-auth.ts` — não
// mais AuthContext.tsx, A1-fix4 moveu a constante), a MESMA frase
// que `login(email, senha, "admin")` (abaixo, em handleSubmit) usa para o
// toast — nunca mais duas versões do mesmo erro NESSE ramo. Os outros três
// ramos (e-mail não confirmado, 429, credenciais inválidas) continuam com
// literal PRÓPRIO desta tela ("administrativos"), de propósito — a
// divergência ali é deliberada, não o defeito que este comentário descreve.
function mensagemDeErroAdminLogin(error: any): string {
  if (
    error?.code === "email_not_confirmed" ||
    error?.message?.includes("Email not confirmed")
  ) {
    return "Este e-mail administrativo ainda não foi confirmado. Verifique a caixa de entrada.";
  }
  if (error?.status === 429) {
    // Verificado na doc oficial: o limite de login é POR ENDEREÇO IP, não
    // por usuário — não revela se a senha está certa ou errada.
    return "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.";
  }
  if (
    error?.code === "user_banned" ||
    error?.message?.includes("User is banned")
  ) {
    // A1-fix3 (achado BLOQUEANTE) — PRECISA vir antes do `if (error?.status
    // === 400 ...)` abaixo. `user_banned` é HTTP 400 (conferido na fonte do
    // GoTrue: internal/api/token.go, `user.IsBanned()` devolve
    // `apierrors.NewBadRequestError`, não `NewForbiddenError`/403 — a versão
    // anterior deste arquivo não tinha ramo nenhum para isto e o `status ===
    // 400` genérico abaixo capturava a conta banida como credencial errada).
    //
    // A1-fix5 — ressalva: "400, não 403" vale só no password grant (este
    // caminho). `user_banned` É 403 em OUTROS endpoints do GoTrue
    // (internal/api/auth.go:38, internal/api/verify.go:670,727, via
    // `NewForbiddenError`). E uma nuance que falta acima: `IsBanned()` é
    // checado ANTES de `Authenticate()` — a conta banida devolve
    // `user_banned` com a senha CERTA OU ERRADA, não só com a certa.
    // Fica a genérica-do-lojista, não uma frase própria de banimento — ver
    // o comentário de `MENSAGEM_ERRO_LOGIN_GENERICA_LOJISTA` em
    // `@/lib/mensagens-auth.ts` para o motivo (não mais em AuthContext.tsx,
    // A1-fix4 moveu a constante).
    return MENSAGEM_ERRO_LOGIN_GENERICA_LOJISTA;
  }
  if (
    error?.status === 400 ||
    error?.message?.includes("Invalid login credentials")
  ) {
    return "Email ou senha administrativos incorretos.";
  }
  // Causa não distinguível (rede, erro inesperado do servidor, provedor de
  // e-mail desativado): nunca presumir "senha incorreta" sem confirmação, e
  // nunca instruir "fale com a loja" — quem lê esta tela É a loja. Conta
  // banida tem ramo PRÓPRIO acima (não cai mais aqui).
  return MENSAGEM_ERRO_LOGIN_GENERICA_LOJISTA;
}

export function AdminLoginView({ onLogin, onNavigate }: AdminLoginViewProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const { login } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      // A1-fix2 — "admin" faz `login` (AuthContext) disparar o toast global
      // com `MENSAGEM_ERRO_LOGIN_GENERICA_LOJISTA` no ramo genérico, em vez
      // da frase escrita para o cliente ("fale com a loja"). É a MESMA
      // frase que `mensagemDeErroAdminLogin` usa para o banner inline.
      const { success, error: loginError } = await login(
        email,
        password,
        "admin",
      );
      if (success) {
        onLogin();
      } else {
        setError(mensagemDeErroAdminLogin(loginError));
      }
    } catch (err) {
      // Só roda se `login` LANÇAR (não devolver `{ error }`) — não gera um
      // toast divergente (não há toast neste caminho), mas ainda assim não
      // pode inventar uma TERCEIRA frase para uma causa que é a mesma
      // família "não distinguível" do ramo genérico de `mensagemDeErroAdminLogin`.
      setError(MENSAGEM_ERRO_LOGIN_GENERICA_LOJISTA);
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#09090b] text-zinc-100 selection:bg-admin-gold/30">
      {/* Header */}
      <div className="admin-glass flex items-center justify-between border-b border-white/5 px-6 py-4">
        <button
          onClick={() => onNavigate("home")}
          className="text-[10px] font-black uppercase tracking-widest text-zinc-400 transition-colors hover:text-white"
        >
          Voltar à loja
        </button>
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">
          {branding.appName} Admin
        </span>
        <div className="w-20" />
      </div>

      {/* Login Form */}
      <div className="flex flex-1 flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="mb-10 text-center">
            <div className="mx-auto mb-6 flex size-20 items-center justify-center rounded-[20px] border border-white/10 bg-zinc-950 text-white shadow-premium">
              <span className="text-3xl font-black italic">
                {branding.appName.trim().charAt(0).toUpperCase()}
              </span>
            </div>
            <h1 className="text-xl font-black uppercase tracking-tighter text-white">
              Painel Administrativo
            </h1>
            <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
              Acesso exclusivo à gestão do lojista
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} action="#" className="space-y-4">
            <div>
              <label
                htmlFor="admin-email"
                className="mb-2 ml-1 block text-[10px] font-black uppercase tracking-widest text-zinc-500"
              >
                Email
              </label>
              <input
                type="email"
                id="admin-email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                placeholder="admin@exemplo.com"
                className="mb-4 w-full rounded-2xl border border-white/10 bg-zinc-900/50 px-5 py-4 text-sm font-medium text-white transition-all placeholder:text-zinc-700 focus:border-admin-gold focus:outline-none focus:ring-4 focus:ring-admin-gold/20"
                required
              />
              <label
                htmlFor="admin-password"
                title="Senha de Acesso"
                className="mb-2 ml-1 block text-[10px] font-black uppercase tracking-widest text-zinc-500"
              >
                Senha de Acesso
              </label>
              <div className="group relative">
                <Lock className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-zinc-500 transition-colors group-focus-within:text-admin-gold" />
                <input
                  type={showPassword ? "text" : "password"}
                  id="admin-password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Digite a senha"
                  className="w-full rounded-2xl border border-white/10 bg-zinc-900/50 py-4 pl-11 pr-12 text-sm font-medium text-white transition-all placeholder:text-zinc-700 focus:border-admin-gold focus:outline-none focus:ring-4 focus:ring-admin-gold/20"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!email || !password || isLoading}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-admin-gold py-5 text-[10px] font-black uppercase tracking-[0.3em] text-black shadow-[0_0_30px_rgba(212,175,55,0.2)] transition-all hover:bg-admin-gold/90 hover:shadow-[0_0_40px_rgba(212,175,55,0.3)] active:scale-95 disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-zinc-900 disabled:text-zinc-600"
            >
              {isLoading ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <>
                  Entrar no Sistema
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </form>

          {/* Security: No default password hints in source code */}
        </div>
      </div>
    </div>
  );
}
