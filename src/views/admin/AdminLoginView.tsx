import { branding } from "@/config/branding";
import { useAuth } from "@/hooks/useAuth";
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
      const { success } = await login(email, password);
      if (success) {
        onLogin();
      } else {
        setError("Email ou senha administrativos incorretos.");
      }
    } catch (err) {
      setError("Ocorreu um erro ao tentar fazer login.");
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
