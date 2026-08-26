import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import {
  PREDEFINED_AVATARS,
  compressImage,
  getPredefinedAvatarSvg,
} from "@/utils/avatars";
import {
  PREDEFINED_COVERS,
  compressCoverImage,
  getPredefinedCoverSvg,
} from "@/utils/covers";
import { haptic } from "@/utils/haptic";
import {
  formatarWhatsAppDigitando,
  formatarWhatsAppParaExibicao,
  validarWhatsApp,
} from "@/utils/telefone";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Phone,
  Shield,
  Trash2,
  UploadCloud,
  User,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export function AccountSettingsView() {
  const { user, profile, fetchProfile, updateProfile, updatePassword } =
    useAuth();
  const [loading, setLoading] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [activeTab, setActiveTab] = useState<"profile" | "security">("profile");
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const [isUpdatingAvatar, setIsUpdatingAvatar] = useState(false);
  const [modalTab, setModalTab] = useState<"avatars" | "upload">("avatars");

  const [isCoverModalOpen, setIsCoverModalOpen] = useState(false);
  const [isUpdatingCover, setIsUpdatingCover] = useState(false);
  const [coverModalTab, setCoverModalTab] = useState<"presets" | "upload">(
    "presets",
  );

  const defaultCover = useMemo(
    () => getPredefinedCoverSvg("#FF512F", "#DD2476", "waves"),
    [],
  );

  const openAvatarModal = () => {
    setModalTab("avatars");
    setIsAvatarModalOpen(true);
    haptic.light();
  };

  const handleSelectPredefinedAvatar = async (avatar: any) => {
    setIsUpdatingAvatar(true);
    haptic.light();
    try {
      const svgUrl = getPredefinedAvatarSvg(
        avatar.emoji,
        avatar.start,
        avatar.end,
      );
      const success = await updateProfile({ avatar_url: svgUrl });
      if (success) {
        toast.success("Avatar atualizado com sucesso!");
        setIsAvatarModalOpen(false);
      }
    } catch (error) {
      console.error("Error setting avatar:", error);
      toast.error("Erro ao salvar avatar.");
    } finally {
      setIsUpdatingAvatar(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Por favor, selecione um arquivo de imagem.");
      return;
    }

    setIsUpdatingAvatar(true);
    haptic.light();
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        if (!base64) {
          toast.error("Erro ao ler a imagem.");
          setIsUpdatingAvatar(false);
          return;
        }

        const compressed = await compressImage(base64, 200, 200);
        const success = await updateProfile({ avatar_url: compressed });
        if (success) {
          toast.success("Foto de perfil atualizada!");
          setIsAvatarModalOpen(false);
        }
        setIsUpdatingAvatar(false);
      };
      reader.onerror = () => {
        toast.error("Erro ao ler o arquivo.");
        setIsUpdatingAvatar(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("Error uploading photo:", error);
      toast.error("Erro ao processar foto.");
      setIsUpdatingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setIsUpdatingAvatar(true);
    haptic.light();
    try {
      const success = await updateProfile({ avatar_url: "REMOVE" });
      if (success) {
        toast.success("Foto de perfil removida.");
        setIsAvatarModalOpen(false);
      }
    } catch (error) {
      console.error("Error removing avatar:", error);
      toast.error("Erro ao remover avatar.");
    } finally {
      setIsUpdatingAvatar(false);
    }
  };

  const handleSelectPredefinedCover = async (cover: any) => {
    setIsUpdatingCover(true);
    haptic.light();
    try {
      const svgUrl = getPredefinedCoverSvg(
        cover.start,
        cover.end,
        cover.patternType,
      );
      const success = await updateProfile({ cover_url: svgUrl });
      if (success) {
        toast.success("Capa de perfil atualizada!");
        setIsCoverModalOpen(false);
      }
    } catch (error) {
      console.error("Error setting cover:", error);
      toast.error("Erro ao salvar capa.");
    } finally {
      setIsUpdatingCover(false);
    }
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem.");
      return;
    }

    setIsUpdatingCover(true);
    haptic.light();
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        if (!base64) {
          toast.error("Erro ao ler imagem.");
          setIsUpdatingCover(false);
          return;
        }

        const compressed = await compressCoverImage(base64);
        const success = await updateProfile({ cover_url: compressed });
        if (success) {
          toast.success("Capa de perfil personalizada atualizada!");
          setIsCoverModalOpen(false);
        }
        setIsUpdatingCover(false);
      };
      reader.onerror = () => {
        toast.error("Erro ao ler arquivo.");
        setIsUpdatingCover(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("Error uploading cover:", error);
      toast.error("Erro ao processar imagem.");
      setIsUpdatingCover(false);
    }
  };

  const handleRemoveCover = async () => {
    setIsUpdatingCover(true);
    haptic.light();
    try {
      const success = await updateProfile({ cover_url: "REMOVE" });
      if (success) {
        toast.success("Capa de perfil removida.");
        setIsCoverModalOpen(false);
      }
    } catch (error) {
      console.error("Error removing cover:", error);
      toast.error("Erro ao remover capa.");
    } finally {
      setIsUpdatingCover(false);
    }
  };

  const [profileData, setProfileData] = useState({
    name: "",
    phone: "",
    email: "",
  });

  // CONTA-01: a carga do perfil tem três estados OBSERVÁVEIS, não só
  // "chegou dado válido". Antes desta correção o `useEffect` abaixo só
  // tratava `if (data && !error)`, sem nenhum `else` — em falha de rede o
  // formulário renderizava vazio como se o cadastro estivesse vazio de
  // verdade, com o botão Salvar já clicável, e salvar apagava o nome e o
  // WhatsApp reais (o `COALESCE` do banco não protege contra string vazia).
  const [profileLoadState, setProfileLoadState] = useState<
    "loading" | "loaded" | "error"
  >("loading");

  // CONTA-07 (auditoria de 26/08/2026) — a fonte da verdade do WhatsApp
  // enquanto a pessoa não mexeu no campo é O BANCO, nunca o valor mostrado
  // na tela. `formatarWhatsApp` (@/utils/telefone) TRUNCA para 11 dígitos de
  // propósito — é a mesma regra que o rastreio de pedido exige — então um
  // WhatsApp de 13 dígitos (ex.: "+55 34 99999-8888" cadastrado sem o app
  // barrar) virava, só de CARREGAR a tela, um número de 11 dígitos válido
  // pela validação — e se a pessoa salvasse só o nome, o número mutilado
  // regravava por cima do real, com "sucesso". Este flag marca se a PESSOA
  // editou o campo; só então `profileData.phone` (mascarado, já truncado) é
  // o valor correto para mandar à RPC.
  //
  // CONTA-08 (mesma auditoria) — a gravação parar de mentir não bastava: a
  // EXIBIÇÃO na carga usava a mesma `formatarWhatsApp` truncada, então a
  // pessoa que só queria CONFERIR o WhatsApp via um número de 11 dígitos
  // que não era o gravado, sem nenhum sinal de que aquilo estava truncado.
  // `carregarPerfil` (abaixo) usa `formatarWhatsAppParaExibicao`, que só
  // mascara quando o valor gravado cabe na máscara.
  const [whatsappEditado, setWhatsappEditado] = useState(false);

  const [passwordData, setPasswordData] = useState({
    newPassword: "",
    confirmPassword: "",
  });

  const carregarPerfil = useCallback(async () => {
    if (!user) return;
    setProfileLoadState("loading");
    try {
      const { data, error } = await (supabase as any).rpc(
        "get_my_complete_profile",
      );

      if (error || !data) {
        console.error("Error fetching profile:", error);
        setProfileLoadState("error");
        return;
      }

      const profile = (data as any)[0];
      if (!profile) {
        setProfileLoadState("error");
        return;
      }

      setProfileData({
        name: profile.full_name || "",
        phone: formatarWhatsAppParaExibicao(profile.whatsapp || ""),
        email: user.email || "",
      });
      // Toda carga é um cadastro "não editado" de novo — inclusive ao
      // tentar de novo depois de um erro.
      setWhatsappEditado(false);
      setProfileLoadState("loaded");
    } catch (error) {
      console.error("Error fetching profile:", error);
      setProfileLoadState("error");
    }
  }, [user]);

  useEffect(() => {
    carregarPerfil();
  }, [carregarPerfil]);

  const handleUpdateProfile = async () => {
    if (!user) return;

    // Camada 2 de defesa do CONTA-01: mesmo que o botão tivesse sido
    // clicado com a carga ainda não terminada (bug futuro na trava de UI
    // abaixo, ou o `disabled` sendo contornado por fora), esta função se
    // recusa a mandar `profileData` derivado de uma carga que não
    // aconteceu — nunca sobrescreve o cadastro real com o estado inicial
    // vazio.
    if (profileLoadState !== "loaded") {
      toast.error(
        "Aguarde os dados carregarem antes de salvar.",
        { description: "Ainda não conseguimos confirmar seus dados atuais." },
      );
      return;
    }

    // A validação só se aplica ao que a PESSOA digitou. Um WhatsApp inválido
    // que já estava salvo (dado legado) não pode travar a troca do nome —
    // ele nem vai ser reenviado (ver `p_whatsapp` abaixo).
    if (whatsappEditado) {
      const digitosWhatsapp = profileData.phone.replace(/\D/g, "");
      if (digitosWhatsapp.length > 0 && !validarWhatsApp(profileData.phone)) {
        toast.error("WhatsApp inválido", {
          description:
            "Informe DDD + número, com 10 ou 11 dígitos — por exemplo (34) 3333-4444 ou (34) 99999-8888.",
        });
        return;
      }
    }

    setLoading(true);
    try {
      // `update_my_profile_secure` faz `whatsapp = COALESCE(p_whatsapp,
      // whatsapp)` (SECURITY DEFINER, supabase/migrations) — mandar `null`
      // quando o campo não foi editado faz o banco PRESERVAR o valor real
      // que já estava salvo, em vez de regravar por cima com o que a tela
      // mostra (que pode estar truncado/mascarado por `formatarWhatsApp`).
      const { error } = await (supabase as any).rpc(
        "update_my_profile_secure",
        {
          p_full_name: profileData.name,
          p_whatsapp: whatsappEditado ? profileData.phone : null,
        },
      );

      if (error) throw error;

      // Refresh global profile in context (ZENITH v21.7)
      await fetchProfile();

      toast.success("Perfil atualizado com sucesso");
    } catch (error) {
      console.error("Update error:", error);
      toast.error("Erro ao atualizar perfil");
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error("As senhas não coincidem");
      return;
    }

    if (passwordData.newPassword.length < 6) {
      toast.error("A senha deve ter pelo menos 6 caracteres");
      return;
    }

    setUpdatingPassword(true);
    try {
      // A mensagem por causa (senha fraca, senha repetida, sessão pedindo
      // login de novo etc.) já é traduzida dentro de `updatePassword`
      // (AuthContext.tsx) — inclusive o toast de sucesso e o de erro. Chamar
      // `supabase.auth.updateUser` direto aqui duplicava essa tradução e
      // deixava a mensagem crua do GoTrue (`error.message` em inglês)
      // vazar para quem só quer trocar a senha.
      const success = await updatePassword(passwordData.newPassword);
      if (success) {
        setPasswordData({ newPassword: "", confirmPassword: "" });
      }
    } catch (error) {
      // `updatePassword` (AuthContext.tsx) não tem try/catch próprio em
      // volta de `supabase.auth.updateUser`: se o PUT no GoTrue tiver
      // sucesso — a senha JÁ trocou no servidor — e só a gravação da
      // sessão nova no storage falhar depois (ex.: `QuotaExceededError` do
      // `localStorage`, comum no Safari/iOS com a cota cheia), a promessa
      // REJEITA mesmo assim. Sem este `catch`, a rejeição virava promessa
      // não tratada (React não trata o retorno de um handler de evento) e
      // a pessoa não via nada — nem sucesso, nem erro — com a senha antiga
      // já morta.
      //
      // A frase não pode dizer "não foi possível alterar": mentiria no
      // caso em que a senha já mudou. Ela também não pode mandar "entrar
      // novamente": a pessoa está LOGADA em Conta > Segurança, e sair é o
      // movimento mais arriscado possível nesse estado — além de tirá-la da
      // única tela onde a senha nova, ainda preenchida no formulário,
      // continua visível.
      //
      // A saída verificada: tocar em "Atualizar Senha" de novo, com os
      // campos como estão, resolve a ambiguidade em UMA tentativa, sem sair
      // da conta e sem digitar nada. Confirmado nas duas pontas — doc do
      // Supabase ("A user that is updating their password must use a
      // different password than the one currently used") e
      // @supabase/auth-js@2.110.1 (GoTrueClient.js:2829-2833: erro do
      // servidor lança ANTES de `_saveSession`, então a segunda tentativa
      // não pode cair no mesmo erro de storage) — e `AuthContext.tsx` já
      // traduz `same_password` para "A nova senha precisa ser diferente da
      // senha atual.": se a troca já tinha acontecido, é essa confirmação
      // que a pessoa vê; se não tinha, a troca acontece agora.
      console.error("Erro inesperado ao trocar senha:", error);
      toast.error("Não conseguimos confirmar se a sua senha foi alterada.", {
        description:
          "Toque em Atualizar Senha de novo, sem mudar os campos: se aparecer que a nova senha precisa ser diferente da atual, é porque a troca já deu certo. Se precisar entrar de novo, use a senha nova — e, se ela não funcionar, a antiga.",
        duration: 10000,
      });
    } finally {
      setUpdatingPassword(false);
    }
  };

  if (!user) return null;

  return (
    <div className="pb-customer min-h-full bg-zinc-50/40">
      <div className="mx-auto max-w-md space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col gap-1 border-b border-zinc-100 pb-4 text-center"
        >
          <h1 className="text-xl font-extrabold tracking-tight text-zinc-900">
            Configurações da Conta
          </h1>
          <p className="text-xs text-zinc-500">
            Gerencie suas informações de perfil e segurança de acesso.
          </p>
        </motion.div>

        {/* Tabs Selector */}
        <div className="relative z-10 flex w-full rounded-xl bg-zinc-100/80 p-1 shadow-inner">
          <button
            type="button"
            onClick={() => setActiveTab("profile")}
            className={`relative flex-1 rounded-lg py-1.5 text-xs font-bold outline-none transition-all focus:outline-none ${
              activeTab === "profile"
                ? "text-zinc-900"
                : "text-zinc-500 hover:text-zinc-900"
            }`}
          >
            {activeTab === "profile" && (
              <motion.div
                layoutId="activeTabBackground"
                className="absolute inset-0 rounded-lg border border-zinc-200/40 bg-white shadow-sm"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
            <span className="relative z-10 flex items-center justify-center gap-1.5">
              <User className="size-3.5" />
              Perfil
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("security")}
            className={`relative flex-1 rounded-lg py-1.5 text-xs font-bold outline-none transition-all focus:outline-none ${
              activeTab === "security"
                ? "text-zinc-900"
                : "text-zinc-500 hover:text-zinc-900"
            }`}
          >
            {activeTab === "security" && (
              <motion.div
                layoutId="activeTabBackground"
                className="absolute inset-0 rounded-lg border border-zinc-200/40 bg-white shadow-sm"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
            <span className="relative z-10 flex items-center justify-center gap-1.5">
              <Shield className="size-3.5" />
              Segurança
            </span>
          </button>
        </div>

        {/* Animated Form container */}
        <div className="relative min-h-[300px] overflow-hidden">
          <AnimatePresence mode="wait">
            {activeTab === "profile" ? (
              <motion.section
                key="profile-tab"
                initial={{ opacity: 0, x: -15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 15 }}
                transition={{ duration: 0.2 }}
                className="space-y-4 rounded-2xl border border-zinc-200/50 bg-white p-5 shadow-sm"
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex size-7 items-center justify-center rounded-lg bg-zinc-900 shadow-sm">
                    <User className="size-3.5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-zinc-900">
                      Informações Pessoais
                    </h2>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                      Dados da sua conta pública
                    </p>
                  </div>
                </div>

                <div className="group relative mb-6 w-full overflow-hidden rounded-2xl border border-zinc-100 bg-zinc-100 shadow-inner">
                  {/* Cover Preview */}
                  <div className="relative h-28 w-full overflow-hidden">
                    <img
                      src={profile?.cover_url || defaultCover}
                      alt="Capa de Perfil"
                      className="size-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-black/10" />

                    {/* Edit Cover Button */}
                    <button
                      type="button"
                      onClick={() => {
                        setIsCoverModalOpen(true);
                        haptic.light();
                      }}
                      className="absolute right-2 top-2 flex items-center justify-center rounded-full border border-white/10 bg-black/40 p-2 text-white shadow-lg backdrop-blur-md transition-all hover:bg-black/60 active:scale-90"
                      title="Alterar capa de fundo"
                    >
                      <Camera className="size-3.5" />
                    </button>
                  </div>

                  {/* Avatar Preview, overlapping */}
                  <div className="relative z-10 -mt-10 flex flex-col items-center justify-center pb-4">
                    <div
                      role="button"
                      tabIndex={0}
                      className="group relative size-20 cursor-pointer overflow-hidden rounded-[20px] border-4 border-white bg-white shadow-premium focus:outline-none focus:ring-2 focus:ring-zinc-900"
                      onClick={openAvatarModal}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openAvatarModal();
                        }
                      }}
                    >
                      {profile?.avatar_url ? (
                        <img
                          src={profile.avatar_url}
                          alt="Profile Avatar"
                          className="size-full object-cover"
                        />
                      ) : (
                        <User className="size-10 text-zinc-300" />
                      )}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                        <Camera className="size-4" />
                      </div>
                      {isUpdatingAvatar && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/80">
                          <Loader2 className="size-4 animate-spin text-zinc-600" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-3.5">
                  {profileLoadState === "loading" && (
                    <div className="flex items-center justify-center gap-2 rounded-xl border border-zinc-100 bg-zinc-50/50 py-6">
                      <Loader2 className="size-4 animate-spin text-zinc-400" />
                      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                        Carregando seus dados...
                      </p>
                    </div>
                  )}

                  {profileLoadState === "error" && (
                    <div className="flex flex-col items-center gap-2 rounded-xl border border-red-100 bg-red-50/30 p-4 text-center">
                      <AlertTriangle className="size-4 text-red-500" />
                      <p className="text-xs font-semibold text-red-700">
                        Não conseguimos carregar seus dados de perfil.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={carregarPerfil}
                        className="h-8 rounded-xl border-red-200 px-3 text-[10px] font-bold uppercase tracking-wider text-red-600 hover:bg-red-50"
                      >
                        Tentar de novo
                      </Button>
                    </div>
                  )}

                  <div className="space-y-1">
                    <label
                      htmlFor="full_name"
                      className="ml-0.5 text-[10px] font-black uppercase tracking-wider text-zinc-500"
                    >
                      Nome Completo
                    </label>
                    <div className="group relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors group-focus-within:text-zinc-900">
                        <User className="size-4" />
                      </span>
                      <Input
                        id="full_name"
                        name="full_name"
                        autoComplete="name"
                        value={profileData.name}
                        disabled={profileLoadState !== "loaded"}
                        onChange={(e) =>
                          setProfileData((p) => ({
                            ...p,
                            name: e.target.value,
                          }))
                        }
                        className="h-10 rounded-xl border border-zinc-200 bg-zinc-50/70 pl-10 pr-4 text-sm font-semibold shadow-none transition-all hover:bg-zinc-50 focus-visible:border-zinc-900 focus-visible:bg-white focus-visible:ring-1 focus-visible:ring-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="phone"
                      className="ml-0.5 text-[10px] font-black uppercase tracking-wider text-zinc-500"
                    >
                      WhatsApp
                    </label>
                    <div className="group relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors group-focus-within:text-zinc-900">
                        <Phone className="size-4" />
                      </span>
                      <Input
                        id="phone"
                        name="phone"
                        autoComplete="tel"
                        inputMode="numeric"
                        value={profileData.phone}
                        disabled={profileLoadState !== "loaded"}
                        onChange={(e) => {
                          setWhatsappEditado(true);
                          setProfileData((p) => ({
                            ...p,
                            // CONTA-09 (auditoria de 26/08/2026, camada 5) —
                            // `formatarWhatsApp` puro trunca e REINTERPRETA
                            // dígitos acima de 11 em silêncio; usar a versão
                            // com guarda para não fabricar um número
                            // diferente do que a pessoa digitou/colou.
                            phone: formatarWhatsAppDigitando(e.target.value),
                          }));
                        }}
                        className="h-10 rounded-xl border border-zinc-200 bg-zinc-50/70 pl-10 pr-4 text-sm font-semibold shadow-none transition-all hover:bg-zinc-50 focus-visible:border-zinc-900 focus-visible:bg-white focus-visible:ring-1 focus-visible:ring-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                        placeholder="(00) 00000-0000"
                      />
                    </div>
                  </div>

                  <motion.div whileTap={{ scale: 0.995 }} className="pt-1">
                    <Button
                      onClick={handleUpdateProfile}
                      disabled={loading || profileLoadState !== "loaded"}
                      className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary text-[11px] font-bold uppercase tracking-wider text-white shadow-sm transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        "Salvar Alterações"
                      )}
                    </Button>
                  </motion.div>
                </div>
              </motion.section>
            ) : (
              <motion.section
                key="security-tab"
                initial={{ opacity: 0, x: 15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -15 }}
                transition={{ duration: 0.2 }}
                className="space-y-4 rounded-2xl border border-zinc-200/50 bg-white p-5 shadow-sm"
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex size-7 items-center justify-center rounded-lg bg-amber-500 shadow-sm">
                    <Shield className="size-3.5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-zinc-900">
                      Segurança
                    </h2>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                      Credenciais e chave de acesso
                    </p>
                  </div>
                </div>

                {/* Password compromised warning */}
                <div className="flex items-start gap-2.5 rounded-xl border border-red-100/50 bg-red-50/30 p-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" />
                  <div className="space-y-0.5">
                    <p className="text-[9px] font-extrabold uppercase tracking-wider text-red-600">
                      Dica de Segurança
                    </p>
                    <p className="text-[10px] font-semibold leading-normal text-red-700/80">
                      Evite reutilizar senhas de outros sites para proteção da
                      conta.
                    </p>
                  </div>
                </div>

                <form
                  onSubmit={handleChangePassword}
                  action="#"
                  className="space-y-3.5"
                >
                  <div className="space-y-1">
                    <label
                      htmlFor="email"
                      className="ml-0.5 text-[10px] font-black uppercase tracking-wider text-zinc-500"
                    >
                      E-mail (Login)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400">
                        <Mail className="size-4" />
                      </span>
                      <Input
                        id="email"
                        name="email"
                        autoComplete="email"
                        value={profileData.email}
                        disabled
                        className="h-10 cursor-not-allowed rounded-xl border border-zinc-200/50 bg-zinc-100/50 px-10 text-sm font-semibold text-zinc-500/80 shadow-none"
                      />
                      <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400">
                        <Lock className="size-3.5" />
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="new_password"
                      className="ml-0.5 text-[10px] font-black uppercase tracking-wider text-zinc-500"
                    >
                      Nova Chave de Acesso
                    </label>
                    <div className="group relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors group-focus-within:text-zinc-900">
                        <KeyRound className="size-4" />
                      </span>
                      <Input
                        id="new_password"
                        name="new_password"
                        type="password"
                        autoComplete="new-password"
                        value={passwordData.newPassword}
                        onChange={(e) =>
                          setPasswordData((d) => ({
                            ...d,
                            newPassword: e.target.value,
                          }))
                        }
                        className="h-10 rounded-xl border border-zinc-200 bg-zinc-50/70 pl-10 pr-4 text-sm font-semibold shadow-none transition-all hover:bg-zinc-50 focus-visible:border-zinc-900 focus-visible:bg-white focus-visible:ring-1 focus-visible:ring-zinc-900"
                        placeholder="Mínimo 6 caracteres"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="confirm_password"
                      className="ml-0.5 text-[10px] font-black uppercase tracking-wider text-zinc-500"
                    >
                      Confirmar Nova Chave
                    </label>
                    <div className="group relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors group-focus-within:text-zinc-900">
                        <KeyRound className="size-4" />
                      </span>
                      <Input
                        id="confirm_password"
                        name="confirm_password"
                        type="password"
                        autoComplete="new-password"
                        value={passwordData.confirmPassword}
                        onChange={(e) =>
                          setPasswordData((d) => ({
                            ...d,
                            confirmPassword: e.target.value,
                          }))
                        }
                        className="h-10 rounded-xl border border-zinc-200 bg-zinc-50/70 pl-10 pr-4 text-sm font-semibold shadow-none transition-all hover:bg-zinc-50 focus-visible:border-zinc-900 focus-visible:bg-white focus-visible:ring-1 focus-visible:ring-zinc-900"
                        placeholder="Repita a nova senha"
                        required
                      />
                    </div>
                  </div>

                  <motion.div whileTap={{ scale: 0.995 }} className="pt-1">
                    <Button
                      type="submit"
                      disabled={updatingPassword}
                      className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary text-[11px] font-bold uppercase tracking-wider text-white shadow-sm transition-all hover:bg-primary/90"
                    >
                      {updatingPassword ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <div className="flex items-center gap-2">
                          <Shield className="size-4" />
                          <span>Atualizar Senha</span>
                        </div>
                      )}
                    </Button>
                  </motion.div>
                </form>
              </motion.section>
            )}
          </AnimatePresence>
        </div>

        {/* Footer simple info */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="pt-2 text-center"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-100 bg-zinc-50 px-3 py-1">
            <CheckCircle2 className="size-3.5 text-emerald-500" />
            <span className="text-[9px] font-black uppercase tracking-wider text-zinc-400">
              Proteção Supabase Auth Ativa
            </span>
          </div>
        </motion.div>
      </div>

      <Dialog open={isAvatarModalOpen} onOpenChange={setIsAvatarModalOpen}>
        <DialogContent className="max-w-xs overflow-hidden rounded-[2.5rem] border border-zinc-100 bg-white p-6 shadow-premium sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center text-[11px] font-black uppercase tracking-wider text-zinc-900">
              Escolher Avatar ou Foto
            </DialogTitle>
            <DialogDescription className="sr-only">
              Escolha um avatar predefinido ou envie sua própria foto para
              personalizar seu perfil.
            </DialogDescription>
          </DialogHeader>

          {/* Modal Tab Selector */}
          <div className="relative z-10 my-2 flex w-full rounded-xl bg-zinc-100/80 p-1 shadow-inner">
            <button
              type="button"
              onClick={() => {
                setModalTab("avatars");
                haptic.light();
              }}
              className={`relative flex-1 rounded-lg py-1.5 text-xs font-bold outline-none transition-all focus:outline-none ${
                modalTab === "avatars"
                  ? "text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-900"
              }`}
            >
              {modalTab === "avatars" && (
                <motion.div
                  layoutId="modalTabBackground"
                  className="absolute inset-0 rounded-lg border border-zinc-200/40 bg-white shadow-sm"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <span className="relative z-10 flex items-center justify-center gap-1.5">
                <User className="size-3.5" />
                Avatares
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setModalTab("upload");
                haptic.light();
              }}
              className={`relative flex-1 rounded-lg py-1.5 text-xs font-bold outline-none transition-all focus:outline-none ${
                modalTab === "upload"
                  ? "text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-900"
              }`}
            >
              {modalTab === "upload" && (
                <motion.div
                  layoutId="modalTabBackground"
                  className="absolute inset-0 rounded-lg border border-zinc-200/40 bg-white shadow-sm"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <span className="relative z-10 flex items-center justify-center gap-1.5">
                <Camera className="size-3.5" />
                Foto Própria
              </span>
            </button>
          </div>

          <div className="relative space-y-4 py-2">
            {isUpdatingAvatar && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center space-y-2 rounded-[2rem] bg-white/85">
                <Loader2 className="size-6 animate-spin text-zinc-900" />
                <span className="animate-pulse text-[10px] font-black uppercase tracking-wider text-zinc-500">
                  Atualizando...
                </span>
              </div>
            )}

            <AnimatePresence mode="wait">
              {modalTab === "avatars" ? (
                <motion.div
                  key="avatars-tab"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                >
                  <div>
                    <p className="mb-3 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400">
                      Avatares Prontos
                    </p>
                    <div className="scrollbar-thin grid max-h-[250px] select-none grid-cols-4 gap-3 overflow-y-auto pr-1">
                      {PREDEFINED_AVATARS.map((avatar) => {
                        const svgUrl = getPredefinedAvatarSvg(
                          avatar.emoji,
                          avatar.start,
                          avatar.end,
                        );
                        const isSelected = profile?.avatar_url === svgUrl;
                        return (
                          <motion.button
                            key={avatar.id}
                            whileHover={{ scale: 1.08 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => handleSelectPredefinedAvatar(avatar)}
                            className={`group relative flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 transition-all duration-300 ${
                              isSelected
                                ? "scale-105 border-zinc-950 shadow-lg"
                                : "border-transparent shadow-sm hover:border-zinc-200/50"
                            }`}
                            style={{
                              background: `linear-gradient(135deg, ${avatar.start}, ${avatar.end})`,
                              boxShadow: isSelected
                                ? `0 0 14px ${avatar.start}66, 0 4px 12px rgba(0,0,0,0.12)`
                                : undefined,
                            }}
                            title={avatar.label}
                          >
                            {/* Animated Emoji on Hover */}
                            <motion.span
                              className="select-none text-4xl drop-shadow-sm filter"
                              initial={{ y: 0 }}
                              whileHover={{ y: [0, -6, 0] }}
                              transition={{ duration: 0.4, ease: "easeOut" }}
                            >
                              {avatar.emoji}
                            </motion.span>

                            {/* Selected Checkmark Badge */}
                            {isSelected && (
                              <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full border border-white bg-emerald-500 shadow-sm"
                              >
                                <Check className="size-2.5 stroke-[3.5] text-white" />
                              </motion.div>
                            )}
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="upload-tab"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                >
                  <div>
                    <p className="mb-3 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400">
                      Sua Foto de Perfil
                    </p>

                    {profile?.avatar_url &&
                    !profile.avatar_url.includes("data:image/svg+xml") ? (
                      /* High fidelity preview of custom photo */
                      <div className="flex flex-col items-center justify-center space-y-4 py-2">
                        <div className="group relative">
                          <div className="flex size-28 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-zinc-100 shadow-xl">
                            <img
                              src={profile.avatar_url}
                              alt="Foto customizada"
                              className="size-full object-cover duration-300 animate-in fade-in"
                            />
                          </div>
                          <div className="absolute -bottom-1 -right-1 flex size-8 cursor-pointer items-center justify-center rounded-full bg-primary text-white shadow-md transition-colors hover:bg-primary/90">
                            <label
                              htmlFor="account-avatar-upload-icon"
                              className="flex size-full cursor-pointer items-center justify-center"
                            >
                              <input
                                id="account-avatar-upload-icon"
                                name="avatar"
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handlePhotoUpload}
                                disabled={isUpdatingAvatar}
                              />
                              <Camera className="size-4" />
                            </label>
                          </div>
                        </div>

                        <p className="text-center text-[10px] font-semibold leading-relaxed text-zinc-400">
                          Esta foto é exibida publicamente no marketplace.
                          <br />
                          Você pode trocá-la ou removê-la a qualquer momento.
                        </p>

                        <div className="flex w-full flex-col gap-2">
                          <label
                            htmlFor="account-avatar-upload-button"
                            className="w-full"
                          >
                            <input
                              id="account-avatar-upload-button"
                              name="avatar"
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={handlePhotoUpload}
                              disabled={isUpdatingAvatar}
                            />
                            <span className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary text-[10px] font-bold uppercase tracking-wider text-white shadow-sm transition-all hover:bg-primary/90 active:scale-95">
                              <Camera className="size-3.5" />
                              Escolher Outra Foto
                            </span>
                          </label>
                          <Button
                            variant="outline"
                            onClick={handleRemoveAvatar}
                            disabled={isUpdatingAvatar}
                            className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-red-100 text-[10px] font-bold uppercase tracking-wider text-red-600 transition-colors hover:border-red-200 hover:bg-red-50/50"
                          >
                            <Trash2 className="size-3.5" />
                            Remover Foto
                          </Button>
                        </div>
                      </div>
                    ) : (
                      /* Interactive drag and drop style upload area */
                      <div className="space-y-4">
                        <label
                          htmlFor="avatar_file_input"
                          className="block cursor-pointer"
                        >
                          <span className="sr-only">Fazer upload de foto</span>
                          <input
                            id="avatar_file_input"
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handlePhotoUpload}
                            disabled={isUpdatingAvatar}
                          />
                          <motion.div
                            whileHover={{ scale: 1.01, borderColor: "#71717a" }}
                            whileTap={{ scale: 0.99 }}
                            className="flex cursor-pointer flex-col items-center justify-center space-y-3 rounded-[2rem] border-2 border-dashed border-zinc-200 bg-zinc-50/50 p-8 text-center transition-colors hover:border-zinc-300"
                          >
                            <div className="flex size-12 items-center justify-center rounded-2xl border border-zinc-100 bg-white text-zinc-400 shadow-sm">
                              <UploadCloud className="size-6 text-zinc-500" />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs font-bold text-zinc-700">
                                Enviar foto do dispositivo
                              </p>
                              <p className="px-4 text-[10px] font-semibold leading-normal text-zinc-400">
                                Selecione uma imagem para fazer upload. Ela será
                                redimensionada automaticamente.
                              </p>
                            </div>
                          </motion.div>
                        </label>

                        {profile?.avatar_url && (
                          <Button
                            variant="outline"
                            onClick={handleRemoveAvatar}
                            disabled={isUpdatingAvatar}
                            className="text-red-650 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-red-100 text-[10px] font-bold uppercase tracking-wider transition-colors hover:border-red-200 hover:bg-red-50/50"
                          >
                            <Trash2 className="size-3.5" />
                            Remover Avatar Atual
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </DialogContent>
      </Dialog>

      {/* Custom Cover Sheet/Dialog Modal */}
      <Dialog open={isCoverModalOpen} onOpenChange={setIsCoverModalOpen}>
        <DialogContent className="mx-auto w-[90%] max-w-sm overflow-hidden rounded-[2.5rem] border border-zinc-100 bg-white p-6 text-slate-800 shadow-2xl">
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-slate-800">
              <span className="size-1.5 animate-pulse rounded-full bg-secondary" />
              Capa de Fundo
            </DialogTitle>
            <DialogDescription className="text-[10px] leading-relaxed text-slate-500">
              Personalize a capa do seu perfil com gradientes premium ou uma
              imagem de sua preferência.
            </DialogDescription>
          </DialogHeader>

          {/* Live Preview Banner */}
          <div className="group relative mb-2 mt-3 h-20 w-full overflow-hidden rounded-2xl border border-zinc-100 shadow-inner">
            <img
              src={profile?.cover_url || defaultCover}
              alt="Capa de Perfil"
              className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-black/30" />
            <div className="absolute inset-0 flex flex-col justify-between p-2.5">
              <span className="self-start rounded-md border border-white/5 bg-white/5 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-white/70 backdrop-blur-md">
                Pré-visualização Real
              </span>
              <div className="mt-auto flex items-center gap-2 self-start">
                <div className="flex size-6 items-center justify-center overflow-hidden rounded-lg border border-white/20 bg-white/10 text-[10px] backdrop-blur-sm">
                  {profile?.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt="Avatar"
                      className="size-full object-cover"
                    />
                  ) : (
                    <User className="size-3 text-white/85" />
                  )}
                </div>
                <div className="leading-none">
                  <p className="max-w-[120px] truncate text-[9px] font-black text-white">
                    {profileData.name || "Seu Nome"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Tabs navigation */}
          <div className="my-3.5 flex rounded-2xl border border-zinc-100 bg-zinc-50/50 p-1">
            <button
              type="button"
              onClick={() => {
                setCoverModalTab("presets");
                haptic.light();
              }}
              className={`flex-1 rounded-xl py-1.5 text-[9px] font-black uppercase tracking-wider transition-all ${
                coverModalTab === "presets"
                  ? "bg-primary text-white shadow-md"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Gradientes
            </button>
            <button
              type="button"
              onClick={() => {
                setCoverModalTab("upload");
                haptic.light();
              }}
              className={`flex-1 rounded-xl py-1.5 text-[9px] font-black uppercase tracking-wider transition-all ${
                coverModalTab === "upload"
                  ? "bg-primary text-white shadow-md"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Enviar Foto
            </button>
          </div>

          <div className="flex min-h-[160px] flex-col justify-between">
            {coverModalTab === "presets" ? (
              <div className="scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent -mr-1.5 max-h-[220px] overflow-y-auto pr-1.5">
                <div className="grid grid-cols-3 gap-2 pb-1">
                  {PREDEFINED_COVERS.map((cover) => {
                    const svgPreview = getPredefinedCoverSvg(
                      cover.start,
                      cover.end,
                      cover.patternType,
                    );
                    const isSelected = profile?.cover_url === svgPreview;
                    const isDefault =
                      !profile?.cover_url && cover.id === "sunset";

                    return (
                      <motion.button
                        whileHover={{ scale: 1.04 }}
                        whileTap={{ scale: 0.96 }}
                        type="button"
                        key={cover.id}
                        onClick={() => handleSelectPredefinedCover(cover)}
                        disabled={isUpdatingCover}
                        className={`group relative flex aspect-[16/10] flex-col justify-end overflow-hidden rounded-xl border-2 p-1.5 transition-all active:scale-95 ${
                          isSelected || isDefault
                            ? "scale-98 border-primary bg-zinc-50/30 shadow-[0_0_12px_rgba(24,24,27,0.3)]"
                            : "border-zinc-100 bg-zinc-50/30 hover:border-zinc-300"
                        }`}
                        title={cover.label}
                      >
                        <img
                          src={svgPreview}
                          alt={cover.label}
                          className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent transition-opacity group-hover:opacity-75" />

                        <span className="relative z-10 w-full truncate text-[7px] font-black uppercase tracking-wider text-white/95">
                          {cover.label}
                        </span>

                        {(isSelected || isDefault) && (
                          <div className="absolute inset-0 flex items-center justify-center bg-secondary/10 backdrop-blur-[0.5px]">
                            <div className="flex size-5 items-center justify-center rounded-full border border-white/25 bg-secondary shadow-lg">
                              <Check className="size-3 text-white" />
                            </div>
                          </div>
                        )}
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center py-2">
                <label htmlFor="cover_file_input" className="w-full">
                  <span className="sr-only">Fazer upload de foto de capa</span>
                  <input
                    id="cover_file_input"
                    type="file"
                    accept="image/*"
                    onChange={handleCoverUpload}
                    disabled={isUpdatingCover}
                    className="hidden"
                  />
                  <motion.div
                    whileHover={{
                      scale: 1.01,
                    }}
                    whileTap={{ scale: 0.99 }}
                    className="flex cursor-pointer flex-col items-center justify-center space-y-3 rounded-2xl border-2 border-dashed border-zinc-100 bg-zinc-50/10 p-6 text-center transition-colors hover:border-primary/25 hover:bg-primary/[0.04]"
                  >
                    <div className="flex size-10 items-center justify-center rounded-xl border border-zinc-100 bg-zinc-50 text-primary">
                      <UploadCloud className="size-5 text-primary" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-700">
                        Escolher Imagem do Dispositivo
                      </p>
                      <p className="px-4 text-[8px] font-bold uppercase leading-normal tracking-tight text-slate-400">
                        Selecione JPEG, PNG até 5MB. A imagem será ajustada para
                        a proporção ideal.
                      </p>
                    </div>
                  </motion.div>
                </label>
              </div>
            )}

            <div className="mt-4 flex gap-2 border-t border-zinc-100 pt-3.5">
              {profile?.cover_url && (
                <motion.div whileTap={{ scale: 0.97 }} className="flex-1">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleRemoveCover}
                    disabled={isUpdatingCover}
                    className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border-zinc-100 bg-transparent text-[9px] font-black uppercase tracking-wider text-red-500 shadow-none transition-all hover:border-red-500/30 hover:bg-red-500/5"
                  >
                    <Trash2 className="size-3.5" />
                    Remover
                  </Button>
                </motion.div>
              )}
              <motion.div whileTap={{ scale: 0.97 }} className="flex-1">
                <Button
                  type="button"
                  onClick={() => {
                    setIsCoverModalOpen(false);
                    haptic.light();
                  }}
                  disabled={isUpdatingCover}
                  className="flex h-10 w-full items-center justify-center rounded-xl bg-primary text-[9px] font-black font-bold uppercase tracking-wider text-white shadow-md transition-all hover:bg-primary/90"
                >
                  {isUpdatingCover ? (
                    <>
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    "Fechar"
                  )}
                </Button>
              </motion.div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
