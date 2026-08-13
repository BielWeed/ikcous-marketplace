import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { branding } from "@/config/branding";
import { useAuth } from "@/hooks/useAuth";
import type { View } from "@/types";
import { type Variants, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Smartphone,
  Sparkles,
  User,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
      staggerChildren: 0.12,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: "easeOut" },
  },
};

export function AuthView({ onNavigate, onSuccess }: AuthViewProps) {
  const {
    user,
    login,
    signUp,
    resetPassword,
    updatePassword,
    resendConfirmationEmail,
    isPasswordRecovery,
    setIsPasswordRecovery,
  } = useAuth();
  const [viewMode, setViewMode] = useState<
    "login" | "signup" | "forgot" | "reset-prompt" | "new-password"
  >(isPasswordRecovery ? "new-password" : "login");

  // Sync viewMode if password recovery mode is detected asynchronously
  useEffect(() => {
    if (isPasswordRecovery) {
      console.log(
        "[AuthView] Async recovery mode detected. Switching to new-password view.",
      );
      setViewMode("new-password");
    }
  }, [isPasswordRecovery]);

  const isLogin = viewMode === "login";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  useEffect(() => {
    if (user && !isPasswordRecovery) {
      console.log("[AuthView] User session detected. Redirecting to success.");
      if (onSuccess) onSuccess();
      else onNavigate("profile");
    }
  }, [user, isPasswordRecovery, onSuccess, onNavigate]);
  const [phone, setPhone] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  // #200 — distingue, dentro do erro de login, o caso "e-mail ainda não
  // confirmado" (ver handleSubmit) para exibir o botão de reenvio SÓ nele.
  // O oráculo que separa esse caso de "credenciais incorretas" já existia
  // antes desta issue; aqui só guardamos qual dos dois foi o motivo.
  const [emailNaoConfirmado, setEmailNaoConfirmado] = useState(false);
  const [reenviandoConfirmacao, setReenviandoConfirmacao] = useState(false);

  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, "");
    if (numbers.length <= 11) {
      let formatted = numbers;
      if (numbers.length > 2)
        formatted = `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
      if (numbers.length > 7)
        formatted = `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7, 11)}`;
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
    setEmailNaoConfirmado(false);

    // Auditoria do Payload
    if (viewMode === "login") {
      if (!email.trim() || !password.trim()) {
        setLoginError("Por favor, preencha todos os campos.");
        return;
      }
    }

    setIsLoading(true);

    try {
      if (viewMode === "login") {
        const { success, error } = await login(email.trim(), password);
        if (success) {
          toast.success("Acesso concedido. Bem-vindo!");
          if (onSuccess) onSuccess();
          else onNavigate("profile");
        } else if (error) {
          // Tratamento de Erro - Localização de mensagens do Supabase
          let message = "Ocorreu um erro ao entrar. Tente novamente.";

          // #200 — o Supabase Auth devolve HTTP 400 tanto para "Invalid
          // login credentials" quanto para "Email not confirmed" (registro
          // oficial de códigos de erro do Supabase Auth:
          // https://supabase.com/docs/guides/auth/debugging/error-codes).
          // Por isso "e-mail não confirmado" tem que ser checado ANTES da
          // condição genérica de 400 — checar depois nunca é alcançado,
          // porque o 400 genérico já capturou os dois casos. `error.code`
          // é o campo estável da API (AuthApiError expõe `code` e
          // `status`); a mensagem entra como reserva para clientes antigos
          // que não populam `code`.
          //
          // Isto NÃO reabre a enumeração de e-mail que a #120 fechou no
          // fluxo de "Esqueci a senha": no código-fonte do GoTrue
          // (internal/api/token.go, ResourceOwnerPasswordGrant) a checagem
          // de confirmação só roda DEPOIS de `user.Authenticate(...)`
          // validar a senha. Ou seja, `email_not_confirmed` só volta para
          // quem já acertou a senha — quem não sabe a senha continua vendo
          // "credenciais inválidas" de qualquer forma.
          if (
            error.code === "email_not_confirmed" ||
            error.message?.includes("Email not confirmed")
          ) {
            message =
              "Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada.";
            // #200 — este é o único ramo em que a conta comprovadamente
            // existe e só falta confirmar: o botão de reenvio (abaixo, no
            // JSX) só aparece quando esta flag está ligada.
            setEmailNaoConfirmado(true);
          } else if (
            error.status === 400 ||
            error.message?.includes("Invalid login credentials")
          ) {
            message = "E-mail ou senha incorretos. Verifique suas credenciais.";
          } else if (error.status === 429) {
            message = "Muitas tentativas. Tente novamente em alguns minutos.";
          } else if (error.message) {
            message = error.message;
          }

          setLoginError(message);
        }
      } else if (viewMode === "signup") {
        if (
          !fullName.trim() ||
          !phone.trim() ||
          !email.trim() ||
          !password.trim()
        ) {
          toast.error("Preencha todos os campos para o cadastro.");
          setIsLoading(false);
          return;
        }
        const success = await signUp(
          email.trim(),
          password,
          fullName.trim(),
          phone.trim(),
        );
        if (success) {
          setShowConfirmation(true);
        }
      } else if (viewMode === "forgot") {
        if (!email.trim()) {
          toast.error("Informe seu e-mail para recuperação.");
          setIsLoading(false);
          return;
        }
        // #120 — o resultado de `resetPassword` não distingue mais e-mail
        // cadastrado de não cadastrado (é assim que a enumeração se fecha):
        // só resta o caminho de sucesso, que sempre leva à mesma tela de
        // confirmação, e o de erro genuíno (rede, rate limit).
        const res = await resetPassword(email.trim());
        if (res.success) {
          toast.success(res.message);
          setViewMode("reset-prompt");
        } else {
          toast.error(res.message || "Erro ao solicitar link de recuperação.");
        }
      } else if (viewMode === "new-password") {
        if (!password.trim() || password.length < 6) {
          toast.error("A senha deve ter pelo menos 6 caracteres.");
          setIsLoading(false);
          return;
        }
        const success = await updatePassword(password);
        if (success) {
          if (onSuccess) onSuccess();
          else onNavigate("profile");
        }
      }
    } catch (err) {
      console.error(err);
      setLoginError("Ocorreu um erro inesperado na autenticação.");
    } finally {
      setIsLoading(false);
    }
  };

  // #200 — reenvia o link de confirmação a partir do erro de login (não do
  // fluxo showConfirmation, que só existe na sessão em que a pessoa se
  // cadastrou). `resendConfirmationEmail` (AuthContext) já mostra o toast de
  // sucesso/erro no caminho normal — aqui só cuidamos do estado de
  // carregando, de não disparar dois reenvios em paralelo, e do caminho
  // excepcional em que a promise rejeita (reaproveita o mesmo banner de erro
  // do login, não inventa feedback novo). `finally` garante que o botão sai
  // do "carregando" mesmo nesse caminho, então nunca fica travado nem o erro
  // fica preso em silêncio.
  const handleResendConfirmation = async () => {
    if (reenviandoConfirmacao) return;
    setReenviandoConfirmacao(true);
    try {
      await resendConfirmationEmail(email.trim());
    } catch (err) {
      console.error(err);
      setLoginError(
        "Não foi possível reenviar o e-mail de confirmação. Tente novamente.",
      );
    } finally {
      setReenviandoConfirmacao(false);
    }
  };

  if (showConfirmation) {
    return (
      <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-white p-6">
        {/* Decorative Elements */}
        <div className="absolute right-0 top-0 size-96 -translate-y-1/2 translate-x-1/2 rounded-full bg-zinc-100/10 blur-[100px]" />
        <div className="absolute bottom-0 left-0 size-96 -translate-x-1/2 translate-y-1/2 rounded-full bg-zinc-200/20 blur-[100px]" />

        <motion.div
          initial="hidden"
          animate="visible"
          variants={containerVariants}
          className="z-10 w-full max-w-md"
        >
          <div className="flex flex-col items-center rounded-[2.5rem] border border-zinc-100 bg-white p-8 text-center shadow-[0_32px_64px_-16px_rgba(0,0,0,0.08)] sm:rounded-[3rem] sm:p-10">
            <motion.div
              variants={itemVariants}
              className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-amber-50 italic ring-1 ring-amber-100 sm:mb-8 sm:size-20 sm:rounded-[2rem]"
            >
              <Mail className="size-6 text-amber-600 sm:size-8" />
            </motion.div>

            <motion.h1
              variants={itemVariants}
              className="mb-3 text-2xl font-black tracking-tighter text-zinc-900 sm:mb-4 sm:text-3xl"
            >
              Verifique seu e-mail
            </motion.h1>

            <motion.p
              variants={itemVariants}
              className="mx-auto mb-8 max-w-[240px] text-xs font-medium leading-relaxed text-zinc-500 sm:mb-10 sm:max-w-none sm:text-sm"
            >
              Um link de acesso exclusivo foi enviado para <br />
              <span className="font-bold text-zinc-900">{email}</span>.
            </motion.p>

            <motion.div
              variants={itemVariants}
              className="w-full space-y-3 sm:space-y-4"
            >
              <Button
                onClick={() => {
                  setViewMode("login");
                  setShowConfirmation(false);
                  setIsPasswordRecovery(false);
                }}
                className="h-14 w-full rounded-2xl bg-zinc-900 text-[10px] font-black uppercase tracking-[0.2em] text-white shadow-xl shadow-zinc-200 transition-all hover:bg-black active:scale-95 sm:h-16 sm:rounded-3xl sm:text-xs"
              >
                Retornar ao Login
              </Button>

              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                Não recebeu?{" "}
                <button
                  type="button"
                  onClick={() => resendConfirmationEmail(email.trim())}
                  className="text-amber-600 hover:underline"
                >
                  Reenviar link
                </button>
              </p>
            </motion.div>
          </div>

          <motion.div
            variants={itemVariants}
            className="mt-6 flex justify-center sm:mt-8"
          >
            <button
              onClick={() => onNavigate("home")}
              className="group flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-400 transition-colors hover:text-zinc-900"
            >
              <ArrowLeft className="size-3 transition-transform group-hover:-translate-x-1" />
              Explorar marketplace
            </button>
          </motion.div>
        </motion.div>
      </div>
    );
  }

  if (viewMode === "reset-prompt") {
    return (
      <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-white p-6">
        {/* Decorative Elements */}
        <div className="absolute right-0 top-0 size-96 -translate-y-1/2 translate-x-1/2 rounded-full bg-zinc-100/10 blur-[100px]" />
        <div className="absolute bottom-0 left-0 size-96 -translate-x-1/2 translate-y-1/2 rounded-full bg-zinc-200/20 blur-[100px]" />

        <motion.div
          initial="hidden"
          animate="visible"
          variants={containerVariants}
          className="z-10 w-full max-w-md"
        >
          <div className="flex flex-col items-center rounded-[2.5rem] border border-zinc-100 bg-white p-8 text-center shadow-[0_32px_64px_-16px_rgba(0,0,0,0.08)] sm:rounded-[3rem] sm:p-10">
            <motion.div
              variants={itemVariants}
              className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-amber-50 italic ring-1 ring-amber-100 sm:mb-8 sm:size-20 sm:rounded-[2rem]"
            >
              <Mail className="size-6 text-amber-600 sm:size-8" />
            </motion.div>

            <motion.h1
              variants={itemVariants}
              className="mb-3 text-2xl font-black tracking-tighter text-zinc-900 sm:mb-4 sm:text-3xl"
            >
              Verifique seu e-mail
            </motion.h1>

            <motion.p
              variants={itemVariants}
              className="mx-auto mb-8 max-w-[240px] text-xs font-medium leading-relaxed text-zinc-500 sm:mb-10 sm:max-w-none sm:text-sm"
            >
              {/* Revisão de contexto limpo do diff (achado 5) — "E-mail
              enviado!" afirmava um envio que pode não ter acontecido (o
              Supabase Auth responde a mesma coisa exista ou não a conta) e
              contradizia o toast desta MESMA ação, que já é condicional ("Se
              este e-mail estiver cadastrado..."). O endereço continua
              visível: ajuda quem digitou errado a perceber. */}
              Se este e-mail estiver cadastrado, enviamos um link de recuperação
              para:
              <br />
              <span className="font-bold text-zinc-900">{email}</span>
              <br />
              <br />
              Se você recebeu o e-mail, clique no link para definir sua nova
              senha.
            </motion.p>

            <motion.div variants={itemVariants} className="w-full">
              <Button
                onClick={() => setViewMode("login")}
                className="h-14 w-full rounded-2xl bg-zinc-900 text-[10px] font-black uppercase tracking-[0.2em] text-white shadow-xl shadow-zinc-200 transition-all hover:bg-black active:scale-95 sm:h-16 sm:rounded-3xl sm:text-xs"
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
    <div className="pb-customer relative flex min-h-full w-full flex-shrink-0 flex-col items-center overflow-x-hidden bg-white p-6 sm:pb-8">
      {/* Immersive Ambient Background - Enhanced for screen filling */}
      <div className="pointer-events-none absolute right-[-10%] top-[-20%] h-[800px] w-[800px] rounded-full bg-zinc-100/30 blur-[140px]" />
      <div className="pointer-events-none absolute bottom-[-10%] left-[-20%] h-[1000px] w-[1000px] rounded-full bg-zinc-200/20 blur-[180px]" />
      <div className="pointer-events-none absolute left-[-10%] top-[20%] h-[600px] w-[600px] rounded-full bg-zinc-100/10 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-[-20%] right-[-15%] h-[700px] w-[700px] rounded-full bg-zinc-100/20 blur-[150px]" />

      <motion.div
        initial="hidden"
        animate="visible"
        variants={containerVariants}
        className="z-10 flex w-full max-w-[440px] flex-1 flex-col justify-between"
      >
        <div className="flex flex-1 flex-col justify-center sm:justify-start">
          {/* Header Section - Spaced out on taller screens */}
          <div className="mb-4 flex flex-col items-center text-center sm:mb-10">
            <motion.div
              variants={itemVariants}
              className="mb-2 flex size-10 items-center justify-center rounded-xl border border-zinc-100 bg-white shadow-sm sm:mb-8 sm:size-20 sm:rounded-[2rem]"
            >
              <User className="size-5 text-zinc-900 sm:size-8" />
            </motion.div>

            <motion.h1
              variants={itemVariants}
              className="text-2xl font-black leading-none tracking-tighter text-zinc-900 sm:text-5xl"
            >
              {viewMode === "login" && "Bem-vindo"}
              {viewMode === "signup" && "Criar Conta"}
              {viewMode === "forgot" && "Recuperar"}
              {viewMode === "new-password" && "Nova Senha"}
            </motion.h1>
            <motion.p
              variants={itemVariants}
              className="mt-2 max-w-[280px] px-4 text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500 sm:mt-4 sm:max-w-none sm:text-sm"
            >
              {viewMode === "login" &&
                "O seu acesso VIP aos achadinhos mais baratos de Monte Carmelo."}
              {viewMode === "signup" &&
                "Inicie sua jornada no marketplace premium."}
              {viewMode === "forgot" &&
                "Insira seu e-mail para receber o link de recuperação."}
              {viewMode === "new-password" &&
                "Escolha uma nova senha segura para sua conta."}
            </motion.p>
          </div>

          {/* Login Card */}
          <div className="relative overflow-hidden rounded-[2.5rem] border border-white/50 bg-white p-6 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.06)] sm:rounded-[3rem] sm:p-10">
            <div className="pointer-events-none absolute right-0 top-0 -translate-y-4 translate-x-4 transform p-8 opacity-[0.03]">
              <Sparkles className="size-32 text-zinc-900" />
            </div>

            <form
              onSubmit={handleSubmit}
              action="#"
              className="space-y-4 sm:space-y-6"
            >
              {viewMode === "signup" && (
                <>
                  <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={itemVariants}
                    className="space-y-2"
                  >
                    <label
                      htmlFor="fullName"
                      className="ml-1 block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400"
                    >
                      NOME COMPLETO
                    </label>
                    <div className="group/field relative">
                      <User className="absolute left-5 top-1/2 size-4 -translate-y-1/2 text-zinc-300 transition-colors group-focus-within/field:text-zinc-900" />
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
                        className="h-14 rounded-2xl border-zinc-100 bg-zinc-50/50 pl-14 font-bold text-zinc-900 shadow-none transition-all placeholder:text-zinc-300 focus-visible:border-zinc-200 focus-visible:ring-1 focus-visible:ring-zinc-900/10 sm:h-16 sm:rounded-[2rem]"
                        required={viewMode === "signup"}
                      />
                    </div>
                  </motion.div>

                  <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={itemVariants}
                    className="space-y-2"
                  >
                    <label
                      htmlFor="phone"
                      className="ml-1 block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400"
                    >
                      WHATSAPP
                    </label>
                    <div className="group/field relative">
                      <Smartphone className="absolute left-5 top-1/2 size-4 -translate-y-1/2 text-zinc-300 transition-colors group-focus-within/field:text-zinc-900" />
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
                        className="h-14 rounded-2xl border-zinc-100 bg-zinc-50/50 pl-14 font-bold text-zinc-900 shadow-none transition-all placeholder:text-zinc-300 focus-visible:border-zinc-200 focus-visible:ring-1 focus-visible:ring-zinc-900/10 sm:h-16 sm:rounded-[2rem]"
                        required={viewMode === "signup"}
                      />
                    </div>
                  </motion.div>
                </>
              )}

              {(viewMode === "login" ||
                viewMode === "signup" ||
                viewMode === "forgot") && (
                <motion.div variants={itemVariants} className="space-y-2">
                  <label
                    htmlFor="email"
                    className="ml-1 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400"
                  >
                    Email
                  </label>
                  <div className="group/field relative">
                    <Mail className="absolute left-5 top-1/2 size-4 -translate-y-1/2 text-zinc-300 transition-colors group-focus-within/field:text-zinc-900" />
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
                        if (emailNaoConfirmado) setEmailNaoConfirmado(false);
                      }}
                      className="h-14 rounded-2xl border-zinc-100 bg-zinc-50/50 pl-14 font-bold text-zinc-900 shadow-none transition-all placeholder:text-zinc-300 focus-visible:border-zinc-200 focus-visible:ring-1 focus-visible:ring-zinc-900/10 sm:h-16 sm:rounded-[2rem]"
                      required
                    />
                  </div>
                </motion.div>
              )}

              {(viewMode === "login" ||
                viewMode === "signup" ||
                viewMode === "new-password") && (
                <motion.div variants={itemVariants} className="space-y-2">
                  <div className="ml-1 flex items-center justify-between">
                    <label
                      htmlFor="password"
                      className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400"
                    >
                      Senha
                    </label>
                    {viewMode === "login" && (
                      <button
                        type="button"
                        onClick={() => {
                          // Mesma limpeza das outras quatro transições (e-mail,
                          // senha, toggle login/cadastro, novo submit): sem
                          // isto o banner de erro — e o botão de reenvio junto
                          // com ele — sobrevive à ida para "Recuperar senha".
                          if (loginError) setLoginError(null);
                          if (emailNaoConfirmado) setEmailNaoConfirmado(false);
                          setViewMode("forgot");
                        }}
                        className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 transition-colors hover:text-zinc-900"
                      >
                        Esqueceu?
                      </button>
                    )}
                  </div>
                  <div className="group/field relative">
                    <Lock className="absolute left-5 top-1/2 size-4 -translate-y-1/2 text-zinc-300 transition-colors group-focus-within/field:text-zinc-900" />
                    <Input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete={
                        viewMode === "login"
                          ? "current-password"
                          : "new-password"
                      }
                      placeholder={
                        viewMode === "new-password" ? "Nova senha" : "••••••••"
                      }
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (loginError) setLoginError(null);
                        if (emailNaoConfirmado) setEmailNaoConfirmado(false);
                      }}
                      className="h-14 rounded-2xl border-zinc-100 bg-zinc-50/50 px-14 font-bold text-zinc-900 shadow-none transition-all placeholder:text-zinc-300 focus-visible:border-zinc-200 focus-visible:ring-1 focus-visible:ring-zinc-900/10 sm:h-16 sm:rounded-[2rem]"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-5 top-1/2 -translate-y-1/2 p-2 text-zinc-300 transition-colors hover:text-zinc-600"
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  </div>
                </motion.div>
              )}

              {loginError && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest text-red-600"
                >
                  {loginError}
                  {/* #200 — só aparece no ramo "e-mail ainda não confirmado":
                  esse é o único caso, dentro do erro de login, em que a
                  informação "esta conta existe e não está confirmada" já
                  era revelada ANTES desta mudança (oráculo pré-existente),
                  então o botão não abre um vazamento novo.

                  Cor: `text-amber-600` sobre o `bg-red-50` deste banner dava
                  2,91:1 — abaixo do 4,5:1 da WCAG AA — num texto de 10px
                  maiúsculo e espaçado. `text-red-700` sobre o mesmo fundo dá
                  5,94:1, e o sublinhado fixo (em vez de só no hover) mantém a
                  leitura de "ação" sem depender só da cor para se distinguir
                  do texto do banner ao lado. */}
                  {emailNaoConfirmado && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={handleResendConfirmation}
                        disabled={reenviandoConfirmacao}
                        className="text-red-700 underline underline-offset-2 disabled:no-underline disabled:opacity-60"
                      >
                        {reenviandoConfirmacao
                          ? "Reenviando..."
                          : "Reenviar link de confirmação"}
                      </button>
                    </div>
                  )}
                </motion.div>
              )}

              <motion.button
                variants={itemVariants}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={isLoading}
                className="group mt-2 flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-zinc-900 text-xs font-black uppercase tracking-[0.2em] text-white shadow-lg shadow-zinc-200/50 disabled:opacity-70 sm:mt-4 sm:rounded-3xl"
              >
                {isLoading ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <>
                    {viewMode === "login" && "ENTRAR AGORA"}
                    {viewMode === "signup" && "FINALIZAR REGISTRO"}
                    {viewMode === "forgot" && "SOLICITAR LINK"}
                    {viewMode === "new-password" && "ATUALIZAR SENHA"}
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </motion.button>
            </form>
          </div>

          <motion.div
            variants={itemVariants}
            className="mb-4 mt-6 flex flex-col items-center gap-2 sm:mb-0"
          >
            <span className="text-[10px] font-semibold text-zinc-400 sm:text-xs">
              {viewMode === "login"
                ? "Não possui conta?"
                : viewMode === "signup"
                  ? "Já possui conta?"
                  : "Lembrou a senha?"}
            </span>
            <button
              onClick={() => {
                if (loginError) setLoginError(null);
                if (emailNaoConfirmado) setEmailNaoConfirmado(false);
                if (viewMode === "forgot" || viewMode === "new-password") {
                  setViewMode("login");
                  setIsPasswordRecovery(false);
                } else setViewMode(isLogin ? "signup" : "login");
              }}
              className="border-b-2 border-zinc-900/10 text-[11px] font-black uppercase tracking-widest text-zinc-900 transition-colors hover:border-zinc-900 sm:text-sm"
            >
              {viewMode === "login"
                ? "CADASTRO"
                : viewMode === "signup"
                  ? "IDENTIFICAR-SE"
                  : "LOGAR AGORA"}
            </button>
          </motion.div>
        </div>

        {/* Subtle Footer to anchor the layout - Visible on all screens now */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 1 }}
          className="pointer-events-none mt-auto w-full py-4 text-center sm:mt-8 sm:py-4"
        >
          <p className="px-4 text-[10px] font-black uppercase tracking-[0.4em] text-zinc-300">
            {branding.appName} • Monte Carmelo, MG
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
