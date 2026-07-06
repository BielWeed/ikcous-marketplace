import React, { useState } from 'react';
import { Lock, Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react';
import type { View } from '@/types';
import { useAuth } from '@/hooks/useAuth';

interface AdminLoginViewProps {
  readonly onLogin: () => void;
  readonly onNavigate: (view: View) => void;
}

// Simple admin password - in production, this should be handled server-side
// Password legacy removed

export function AdminLoginView({ onLogin, onNavigate }: AdminLoginViewProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const { success } = await login(email, password);
      if (success) {
        onLogin();
      } else {
        setError('Email ou senha administrativos incorretos.');
      }
    } catch (err) {
      setError('Ocorreu um erro ao tentar fazer login.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] flex flex-col text-zinc-100 selection:bg-admin-gold/30">
      {/* Header */}
      <div className="admin-glass px-6 py-4 flex items-center justify-between border-b border-white/5">
        <button
          onClick={() => onNavigate('home')}
          className="text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-colors"
        >
          Voltar à loja
        </button>
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">IKCOUS Admin</span>
        <div className="w-20" />
      </div>

      {/* Login Form */}
      <div className="flex-1 flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="text-center mb-10">
            <div className="w-20 h-20 bg-zinc-950 text-white rounded-[20px] flex items-center justify-center mx-auto mb-6 shadow-premium border border-white/10">
              <span className="text-3xl font-black italic">I</span>
            </div>
            <h1 className="text-xl font-black text-white uppercase tracking-tighter">Painel Administrativo</h1>
            <p className="text-[10px] font-bold text-zinc-500 mt-2 uppercase tracking-[0.2em]">
              Acesso exclusivo à gestão do lojista
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} action="#" className="space-y-4">
            <div>
              <label htmlFor="admin-email" className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 ml-1">
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
                className="w-full px-5 py-4 bg-zinc-900/50 border border-white/10 rounded-2xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-admin-gold/20 focus:border-admin-gold transition-all mb-4 text-white placeholder:text-zinc-700"
                required
              />
              <label htmlFor="admin-password" title="Senha de Acesso" className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 ml-1">
                Senha de Acesso
              </label>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-admin-gold transition-colors" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="admin-password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Digite a senha"
                  className="w-full pl-11 pr-12 py-4 bg-zinc-900/50 border border-white/10 rounded-2xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-admin-gold/20 focus:border-admin-gold transition-all text-white placeholder:text-zinc-700"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!email || !password || isLoading}
              className="w-full py-5 bg-admin-gold text-black font-black uppercase tracking-[0.3em] text-[10px] rounded-2xl hover:bg-admin-gold/90 disabled:bg-zinc-900 disabled:text-zinc-600 disabled:border-white/5 disabled:cursor-not-allowed transition-all active:scale-95 flex items-center justify-center gap-3 shadow-[0_0_30px_rgba(212,175,55,0.2)] hover:shadow-[0_0_40px_rgba(212,175,55,0.3)]"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  Entrar no Sistema
                  <ArrowRight className="w-4 h-4" />
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
