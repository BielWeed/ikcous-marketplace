import { useState } from 'react';
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
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="admin-glass px-6 py-4 flex items-center justify-between border-b border-white/5">
        <button
          onClick={() => onNavigate('home')}
          className="text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-zinc-950 transition-colors"
        >
          Voltar à loja
        </button>
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-950">IKCOUS Admin</span>
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
            <h1 className="text-xl font-black text-zinc-950 uppercase tracking-tighter">Painel Administrativo</h1>
            <p className="text-[10px] font-bold text-zinc-400 mt-2 uppercase tracking-[0.2em]">
              Acesso exclusivo à gestão do lojista
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} action="#" className="space-y-4">
            <div>
              <label htmlFor="admin-email" className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1">
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
                className="w-full px-5 py-4 bg-white border border-zinc-100 rounded-2xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-zinc-950/5 focus:border-zinc-950 transition-all mb-4 shadow-premium-sm"
                required
              />
              <label htmlFor="admin-password" title="Senha de Acesso" className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1">
                Senha de Acesso
              </label>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-300 group-focus-within:text-zinc-950 transition-colors" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="admin-password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Digite a senha"
                  className="w-full pl-11 pr-12 py-4 bg-white border border-zinc-100 rounded-2xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-zinc-950/5 focus:border-zinc-950 transition-all shadow-premium-sm"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!email || !password || isLoading}
              className="w-full py-5 bg-zinc-950 text-white font-black uppercase tracking-[0.3em] text-[10px] rounded-2xl hover:bg-black disabled:bg-zinc-100 disabled:text-zinc-400 disabled:cursor-not-allowed transition-all active:scale-95 flex items-center justify-center gap-3 shadow-premium border border-white/10"
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
