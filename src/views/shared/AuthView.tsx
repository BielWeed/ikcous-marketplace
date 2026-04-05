import { useState } from 'react';
import { Lock, Mail, Eye, EyeOff, ArrowRight, Loader2, ArrowLeft, Sparkles, User, Smartphone } from 'lucide-react';
import { motion, type Variants } from 'framer-motion';
import type { View } from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

interface AuthViewProps {
    onNavigate: (view: View) => void;
    onSuccess?: () => void;
}

const containerVariants: Variants = {
    hidden: { opacity: 0, y: 30 },
    visible: {
        opacity: 1,
        y: 0,
        transition: {
            duration: 0.8,
            ease: [0.16, 1, 0.3, 1],
            staggerChildren: 0.12
        }
    }
};

const itemVariants: Variants = {
    hidden: { opacity: 0, y: 20 },
    visible: { 
        opacity: 1, 
        y: 0,
        transition: { duration: 0.5, ease: "easeOut" }
    }
};

export function AuthView({ onNavigate, onSuccess }: AuthViewProps) {
    const { login, signUp, resetPassword, updatePassword, isPasswordRecovery, setIsPasswordRecovery } = useAuth();
    const [viewMode, setViewMode] = useState<'login' | 'signup' | 'forgot' | 'reset-prompt' | 'new-password'>(
        isPasswordRecovery ? 'new-password' : 'login'
    );
    const isLogin = viewMode === 'login';
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState('');
    const [phone, setPhone] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [showConfirmation, setShowConfirmation] = useState(false);
    const [loginError, setLoginError] = useState<string | null>(null);

    const formatPhone = (value: string) => {
        const numbers = value.replace(/\D/g, '');
        if (numbers.length <= 11) {
            let formatted = numbers;
            if (numbers.length > 2) formatted = `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
            if (numbers.length > 7) formatted = `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7, 11)}`;
            return formatted;
        }
        return value.slice(0, 15);
    };

    const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setPhone(formatPhone(e.target.value));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoginError(null);

        // Auditoria do Payload
        if (viewMode === 'login') {
            if (!email.trim() || !password.trim()) {
                setLoginError('Por favor, preencha todos os campos.');
                return;
            }
        }

        setIsLoading(true);

        try {
            if (viewMode === 'login') {
                const { success, error } = await login(email.trim(), password);
                if (success) {
                    toast.success('Acesso concedido. Bem-vindo!');
                    if (onSuccess) onSuccess();
                    else onNavigate('profile');
                } else if (error) {
                    // Tratamento de Erro - Localização de mensagens do Supabase
                    let message = 'Ocorreu um erro ao entrar. Tente novamente.';
                    
                    if (error.status === 400 || error.message?.includes('Invalid login credentials')) {
                        message = 'E-mail ou senha incorretos. Verifique suas credenciais.';
                    } else if (error.message?.includes('Email not confirmed')) {
                        message = 'Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada.';
                    } else if (error.status === 429) {
                        message = 'Muitas tentativas. Tente novamente em alguns minutos.';
                    } else if (error.message) {
                        message = error.message;
                    }
                    
                    setLoginError(message);
                }
            } else if (viewMode === 'signup') {
                if (!fullName.trim() || !phone.trim() || !email.trim() || !password.trim()) {
                    toast.error('Preencha todos os campos para o cadastro.');
                    setIsLoading(false);
                    return;
                }
                const success = await signUp(email.trim(), password, fullName.trim(), phone.trim());
                if (success) {
                    setShowConfirmation(true);
                }
            } else if (viewMode === 'forgot') {
                if (!email.trim()) {
                    toast.error('Informe seu e-mail para recuperação.');
                    setIsLoading(false);
                    return;
                }
                const success = await resetPassword(email.trim());
                if (success) {
                    setViewMode('reset-prompt');
                }
            } else if (viewMode === 'new-password') {
                if (!password.trim() || password.length < 6) {
                    toast.error('A senha deve ter pelo menos 6 caracteres.');
                    setIsLoading(false);
                    return;
                }
                const success = await updatePassword(password);
                if (success) {
                    if (onSuccess) onSuccess();
                    else onNavigate('profile');
                }
            }
        } catch (err) {
            console.error(err);
            setLoginError('Ocorreu um erro inesperado na autenticação.');
        } finally {
            setIsLoading(false);
        }
    };

    if (showConfirmation) {
        return (
            <div className="h-full bg-white flex flex-col items-center justify-center p-6 relative overflow-hidden">
                {/* Decorative Elements */}
                <div className="absolute top-0 right-0 w-96 h-96 bg-zinc-100/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2" />
                <div className="absolute bottom-0 left-0 w-96 h-96 bg-zinc-200/20 rounded-full blur-[100px] translate-y-1/2 -translate-x-1/2" />

                <motion.div 
                    initial="hidden"
                    animate="visible"
                    variants={containerVariants}
                    className="w-full max-w-md z-10"
                >
                    <div className="bg-white rounded-[2.5rem] sm:rounded-[3rem] p-8 sm:p-10 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.08)] border border-zinc-100 flex flex-col items-center text-center">
                        <motion.div variants={itemVariants} className="w-16 h-16 sm:w-20 sm:h-20 bg-amber-50 rounded-2xl sm:rounded-[2rem] flex items-center justify-center mb-6 sm:mb-8 ring-1 ring-amber-100 italic">
                            <Mail className="w-6 h-6 sm:w-8 sm:h-8 text-amber-600" />
                        </motion.div>

                        <motion.h1 variants={itemVariants} className="text-2xl sm:text-3xl font-black tracking-tighter text-zinc-900 mb-3 sm:mb-4">
                            Verifique seu e-mail
                        </motion.h1>
                        
                        <motion.p variants={itemVariants} className="text-xs sm:text-sm text-zinc-500 font-medium mb-8 sm:mb-10 leading-relaxed max-w-[240px] sm:max-w-none mx-auto">
                            Um link de acesso exclusivo foi enviado para <br/>
                            <span className="text-zinc-900 font-bold">{email}</span>.
                        </motion.p>

                        <motion.div variants={itemVariants} className="w-full space-y-3 sm:space-y-4">
                            <Button
                                onClick={() => {
                                    setViewMode('login');
                                    setShowConfirmation(false);
                                    setIsPasswordRecovery(false);
                                }}
                                className="w-full h-14 sm:h-16 bg-zinc-900 text-white rounded-2xl sm:rounded-3xl text-[10px] sm:text-xs font-black uppercase tracking-[0.2em] hover:bg-black transition-all active:scale-95 shadow-xl shadow-zinc-200"
                            >
                                Retornar ao Login
                            </Button>
                            
                            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                                Não recebeu? <button className="text-amber-600 hover:underline">Reenviar link</button>
                            </p>
                        </motion.div>
                    </div>

                    <motion.div variants={itemVariants} className="mt-6 sm:mt-8 flex justify-center">
                        <button
                            onClick={() => onNavigate('home')}
                            className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-zinc-900 transition-colors group"
                        >
                            <ArrowLeft className="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
                            Explorar marketplace
                        </button>
                    </motion.div>
                </motion.div>
            </div>
        );
    }

    if (viewMode === 'reset-prompt') {
        return (
            <div className="h-full bg-white flex flex-col items-center justify-center p-6 relative overflow-hidden">
                {/* Decorative Elements */}
                <div className="absolute top-0 right-0 w-96 h-96 bg-zinc-100/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2" />
                <div className="absolute bottom-0 left-0 w-96 h-96 bg-zinc-200/20 rounded-full blur-[100px] translate-y-1/2 -translate-x-1/2" />

                <motion.div 
                    initial="hidden"
                    animate="visible"
                    variants={containerVariants}
                    className="w-full max-w-md z-10"
                >
                    <div className="bg-white rounded-[2.5rem] sm:rounded-[3rem] p-8 sm:p-10 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.08)] border border-zinc-100 flex flex-col items-center text-center">
                        <motion.div variants={itemVariants} className="w-16 h-16 sm:w-20 sm:h-20 bg-amber-50 rounded-2xl sm:rounded-[2rem] flex items-center justify-center mb-6 sm:mb-8 ring-1 ring-amber-100 italic">
                            <Mail className="w-6 h-6 sm:w-8 sm:h-8 text-amber-600" />
                        </motion.div>

                        <motion.h1 variants={itemVariants} className="text-2xl sm:text-3xl font-black tracking-tighter text-zinc-900 mb-3 sm:mb-4">
                            E-mail enviado!
                        </motion.h1>
                        
                        <motion.p variants={itemVariants} className="text-xs sm:text-sm text-zinc-500 font-medium mb-8 sm:mb-10 leading-relaxed max-w-[240px] sm:max-w-none mx-auto">
                            Se houver uma conta associada a <br/>
                            <span className="text-zinc-900 font-bold">{email}</span>, <br/>
                            você receberá um link de recuperação em instantes.
                        </motion.p>

                        <motion.div variants={itemVariants} className="w-full">
                            <Button
                                onClick={() => setViewMode('login')}
                                className="w-full h-14 sm:h-16 bg-zinc-900 text-white rounded-2xl sm:rounded-3xl text-[10px] sm:text-xs font-black uppercase tracking-[0.2em] hover:bg-black transition-all active:scale-95 shadow-xl shadow-zinc-200"
                            >
                                Voltar para o Login
                            </Button>
                        </motion.div>
                    </div>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="flex-1 w-full flex flex-col items-center p-6 pb-20 sm:pb-8 relative overflow-hidden bg-white">
            {/* Immersive Ambient Background - Enhanced for screen filling */}
            <div className="absolute top-[-20%] right-[-10%] w-[800px] h-[800px] bg-zinc-100/30 rounded-full blur-[140px] pointer-events-none" />
            <div className="absolute bottom-[-10%] left-[-20%] w-[1000px] h-[1000px] bg-zinc-200/20 rounded-full blur-[180px] pointer-events-none" />
            <div className="absolute top-[20%] left-[-10%] w-[600px] h-[600px] bg-zinc-100/10 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-20%] right-[-15%] w-[700px] h-[700px] bg-zinc-100/20 rounded-full blur-[150px] pointer-events-none" />

            <motion.div 
                initial="hidden"
                animate="visible"
                variants={containerVariants}
                className="w-full max-w-[440px] flex-1 flex flex-col justify-between z-10"
            >
                <div className="flex flex-col flex-1 justify-center sm:justify-start">
                    {/* Header Section - Spaced out on taller screens */}
                    <div className="flex flex-col items-center mb-6 sm:mb-10 text-center">
                        <motion.div variants={itemVariants} className="w-12 h-12 sm:w-20 sm:h-20 bg-white rounded-2xl sm:rounded-[2rem] shadow-sm border border-zinc-100 flex items-center justify-center mb-4 sm:mb-8">
                            <User className="w-6 h-6 sm:w-8 sm:h-8 text-zinc-900" />
                        </motion.div>
                        
                         <motion.h1 variants={itemVariants} className="text-3xl sm:text-5xl font-black tracking-tighter text-zinc-900 leading-none">
                            {viewMode === 'login' && 'Bem-vindo'}
                            {viewMode === 'signup' && 'Criar Conta'}
                            {viewMode === 'forgot' && 'Recuperar'}
                            {viewMode === 'new-password' && 'Nova Senha'}
                        </motion.h1>
                        <motion.p variants={itemVariants} className="mt-3 sm:mt-4 text-[10px] sm:text-sm font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest max-w-[280px] sm:max-w-none px-4">
                            {viewMode === 'login' && 'O seu acesso VIP aos achadinhos mais baratos de Monte Carmelo.'}
                            {viewMode === 'signup' && 'Inicie sua jornada no marketplace premium.'}
                            {viewMode === 'forgot' && 'Insira seu e-mail para receber o link de recuperação.'}
                            {viewMode === 'new-password' && 'Escolha uma nova senha segura para sua conta.'}
                        </motion.p>
                    </div>

                    {/* Login Card */}
                    <div className="bg-white rounded-[2.5rem] sm:rounded-[3rem] p-6 sm:p-10 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.06)] border border-white/50 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none transform translate-x-4 -translate-y-4">
                            <Sparkles className="w-32 h-32 text-zinc-900" />
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
                            {viewMode === 'signup' && (
                                <>
                                    <motion.div variants={itemVariants} className="space-y-2">
                                        <label htmlFor="fullName" className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 ml-1 block">
                                            NOME COMPLETO
                                        </label>
                                        <div className="relative group/field">
                                            <User className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-300 group-focus-within/field:text-zinc-900 transition-colors" />
                                            <Input
                                                id="fullName"
                                                name="fullName"
                                                type="text"
                                                autoComplete="name"
                                                placeholder="Seu nome"
                                                value={fullName}
                                                onChange={(e) => {
                                                    setFullName(e.target.value);
                                                    if (loginError) setLoginError(null);
                                                }}
                                                className="pl-14 h-14 sm:h-16 bg-zinc-50/50 border-zinc-100 focus-visible:ring-1 focus-visible:ring-zinc-900/10 focus-visible:border-zinc-200 transition-all rounded-2xl sm:rounded-[2rem] font-bold text-zinc-900 placeholder:text-zinc-300 shadow-none"
                                                required={viewMode === 'signup'}
                                            />
                                        </div>
                                    </motion.div>

                                    <motion.div variants={itemVariants} className="space-y-2">
                                        <label htmlFor="phone" className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 ml-1 block">
                                            WHATSAPP
                                        </label>
                                        <div className="relative group/field">
                                            <Smartphone className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-300 group-focus-within/field:text-zinc-900 transition-colors" />
                                            <Input
                                                id="phone"
                                                name="phone"
                                                type="text"
                                                autoComplete="tel"
                                                placeholder="(34) 99999-9999"
                                                value={phone}
                                                onChange={(e) => {
                                                    handlePhoneChange(e);
                                                    if (loginError) setLoginError(null);
                                                }}
                                                className="pl-14 h-14 sm:h-16 bg-zinc-50/50 border-zinc-100 focus-visible:ring-1 focus-visible:ring-zinc-900/10 focus-visible:border-zinc-200 transition-all rounded-2xl sm:rounded-[2rem] font-bold text-zinc-900 placeholder:text-zinc-300 shadow-none"
                                                required={viewMode === 'signup'}
                                            />
                                        </div>
                                    </motion.div>
                                </>
                            )}

                            {(viewMode === 'login' || viewMode === 'signup' || viewMode === 'forgot') && (
                                <motion.div variants={itemVariants} className="space-y-2">
                                    <label htmlFor="email" className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 ml-1">
                                        Email
                                    </label>
                                    <div className="relative group/field">
                                        <Mail className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-300 group-focus-within/field:text-zinc-900 transition-colors" />
                                        <Input
                                            id="email"
                                            name="email"
                                            type="email"
                                            autoComplete="username"
                                            placeholder="seu@email.com"
                                            value={email}
                                            onChange={(e) => {
                                                setEmail(e.target.value);
                                                if (loginError) setLoginError(null);
                                            }}
                                            className="pl-14 h-14 sm:h-16 bg-zinc-50/50 border-zinc-100 focus-visible:ring-1 focus-visible:ring-zinc-900/10 focus-visible:border-zinc-200 transition-all rounded-2xl sm:rounded-[2rem] font-bold text-zinc-900 placeholder:text-zinc-300 shadow-none"
                                            required
                                        />
                                    </div>
                                </motion.div>
                            )}

                            {(viewMode === 'login' || viewMode === 'signup' || viewMode === 'new-password') && (
                                <motion.div variants={itemVariants} className="space-y-2">
                                    <div className="flex items-center justify-between ml-1">
                                        <label htmlFor="password" className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
                                            Senha
                                        </label>
                                        {viewMode === 'login' && (
                                            <button 
                                                type="button" 
                                                onClick={() => setViewMode('forgot')}
                                                className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest hover:text-zinc-900 transition-colors"
                                            >
                                                Esqueceu?
                                            </button>
                                        )}
                                    </div>
                                    <div className="relative group/field">
                                        <Lock className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-300 group-focus-within/field:text-zinc-900 transition-colors" />
                                        <Input
                                            id="password"
                                            name="password"
                                            type={showPassword ? 'text' : 'password'}
                                            autoComplete={viewMode === 'login' ? "current-password" : "new-password"}
                                            placeholder={viewMode === 'new-password' ? "Nova senha" : "••••••••"}
                                            value={password}
                                            onChange={(e) => {
                                                setPassword(e.target.value);
                                                if (loginError) setLoginError(null);
                                            }}
                                            className="pl-14 pr-14 h-14 sm:h-16 bg-zinc-50/50 border-zinc-100 focus-visible:ring-1 focus-visible:ring-zinc-900/10 focus-visible:border-zinc-200 transition-all rounded-2xl sm:rounded-[2rem] font-bold text-zinc-900 placeholder:text-zinc-300 shadow-none"
                                            required
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute right-5 top-1/2 -translate-y-1/2 p-2 text-zinc-300 hover:text-zinc-600 transition-colors"
                                        >
                                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </motion.div>
                            )}

                            {loginError && (
                                <motion.div 
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    className="px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-[10px] font-black uppercase tracking-widest text-red-600 text-center"
                                >
                                    {loginError}
                                </motion.div>
                            )}

                            <motion.button
                                variants={itemVariants}
                                whileHover={{ scale: 1.01 }}
                                whileTap={{ scale: 0.98 }}
                                type="submit"
                                disabled={isLoading}
                                className="w-full h-14 bg-zinc-900 text-white rounded-2xl sm:rounded-[1.5rem] font-black text-xs uppercase tracking-[0.2em] shadow-lg shadow-zinc-200/50 flex items-center justify-center gap-3 group disabled:opacity-70 mt-2 sm:mt-4"
                            >
                                {isLoading ? (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                    <>
                                        {viewMode === 'login' && 'ENTRAR AGORA'}
                                        {viewMode === 'signup' && 'FINALIZAR REGISTRO'}
                                        {viewMode === 'forgot' && 'SOLICITAR LINK'}
                                        {viewMode === 'new-password' && 'ATUALIZAR SENHA'}
                                        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                                    </>
                                )}
                            </motion.button>
                        </form>
                    </div>

                    <motion.div 
                        variants={itemVariants}
                        className="flex flex-col items-center gap-2 mt-8 mb-4 sm:mb-0"
                    >
                        <span className="text-[10px] sm:text-xs font-semibold text-zinc-400">
                            {viewMode === 'login' ? 'Não possui conta?' : viewMode === 'signup' ? 'Já possui conta?' : 'Lembrou a senha?'}
                        </span>
                        <button 
                            onClick={() => {
                                if (loginError) setLoginError(null);
                                if (viewMode === 'forgot' || viewMode === 'new-password') {
                                    setViewMode('login');
                                    setIsPasswordRecovery(false);
                                } else setViewMode(isLogin ? 'signup' : 'login');
                            }}
                            className="text-[11px] sm:text-sm font-black text-zinc-900 uppercase tracking-widest border-b-2 border-zinc-900/10 hover:border-zinc-900 transition-colors"
                        >
                            {viewMode === 'login' ? 'CADASTRO' : viewMode === 'signup' ? 'IDENTIFICAR-SE' : 'LOGAR AGORA'}
                        </button>
                    </motion.div>
                </div>

                {/* Suble Footer to anchor the layout - Visible on all screens now */}
                <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1, duration: 1 }}
                    className="w-full text-center mt-auto py-6 sm:mt-8 sm:py-4 pointer-events-none"
                >
                    <p className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-300 px-4">
                        IKCOUS Imports • Monte Carmelo, MG
                    </p>
                </motion.div>
            </motion.div>
        </div>
    );
}
