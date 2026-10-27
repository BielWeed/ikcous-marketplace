import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { AddressList } from "@/components/ui/custom/AddressList";
import { BotaoWhatsapp } from "@/components/ui/custom/BotaoWhatsapp";
import { CustomerPaymentBadge } from "@/components/ui/custom/CustomerPaymentBadge";
import { OrderTimeline } from "@/components/ui/custom/OrderTimeline";
import { ProfileSkeleton } from "@/components/ui/custom/Skeletons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAddresses } from "@/hooks/useAddresses";
import { useAuth } from "@/hooks/useAuth";
import { useOrders } from "@/hooks/useOrders";
import { useVoltarFechaAFolha } from "@/hooks/useVoltarFechaAFolha";
import type { View } from "@/types";
import {
  PREDEFINED_AVATARS,
  compressImage,
  getPredefinedAvatarSvg,
  mensagemDaFalhaDeImagem,
} from "@/utils/avatars";
import {
  PREDEFINED_COVERS,
  compressCoverImage,
  getPredefinedCoverSvg,
} from "@/utils/covers";
import { AnimatePresence, motion } from "framer-motion";
import {
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Loader2,
  LogOut,
  Package,
  Plus,
  Shield,
  Trash2,
  UploadCloud,
  User,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.05,
    },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring",
      stiffness: 260,
      damping: 24,
    },
  },
} as const;

import { useStore } from "@/contexts/StoreContext";
import { abrirWhatsapp } from "@/lib/abrir-whatsapp";
import { marcarOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import { lojaTemWhatsapp } from "@/lib/loja-tem-whatsapp";
import { numeroDoPedido } from "@/lib/numero-do-pedido";
import { podeRetomarPagamento } from "@/lib/pode-retomar-pagamento";
import { haptic } from "@/utils/haptic";
import { formatarWhatsAppParaExibicao } from "@/utils/telefone";

// Rótulo mono de seção, cartão e cabeçalho de seção do Perfil (linguagem Tinta).
const ROTULO =
  "font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground";
const CARTAO = "rounded-[18px] border border-border bg-background";
const CABECALHO = "flex min-h-11 items-center justify-between gap-3";

// Linha de atalho do cartão "Conta" (Segurança e conta, Sobre a loja): alvo de
// toque de 64 px, título, descrição e seta.
function LinhaDoMenu({
  titulo,
  descricao,
  onClick,
}: {
  titulo: string;
  descricao: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-foreground">
          {titulo}
        </span>
        <span className="block text-sm text-muted-foreground">{descricao}</span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-5 shrink-0 text-muted-foreground"
      />
    </button>
  );
}

interface ProfileViewProps {
  onNavigate: (view: View, id?: string) => void;
  /** A aba fica montada escondida; `true` quando é a aba visível. */
  isActive?: boolean;
  /**
   * Atalho do cartão "Pedidos em Andamento" para voltar ao pagamento de um
   * pedido ainda não pago. Mesma porta do detalhe do pedido; sem ela, o botão
   * não aparece.
   */
  onRetomarPagamento?: (orderId: string) => void;
}

export function ProfileView({
  onNavigate,
  isActive = true,
  onRetomarPagamento,
}: ProfileViewProps) {
  const {
    user,
    profile,
    logout,
    isAdmin,
    loading: authLoading,
    updateProfile,
  } = useAuth();
  const {
    addresses,
    fetchAddresses,
    deleteAddress,
    loading: addressesLoading,
    erroAoCarregar,
  } = useAddresses();
  const { orders, fetchUserOrders } = useOrders(true, false);
  // "Encerrar sessão" espera a limpeza do aviso (push) da conta, até 3 s: sem
  // reação na tela a pessoa tocava de novo e a saída rodava duas vezes. O ref
  // barra o segundo toque no mesmo instante (o estado só muda no render).
  const [saindo, setSaindo] = useState(false);
  const saidaEmCursoRef = useRef(false);
  const encerrarSessao = async () => {
    if (saidaEmCursoRef.current) return;
    saidaEmCursoRef.current = true;
    setSaindo(true);
    try {
      await logout();
    } catch (err) {
      // `logout` não costuma lançar (a falha do servidor vira toast lá dentro);
      // se lançar, que não vire erro solto do clique.
      console.error("[Profile] Erro ao encerrar a sessão:", err);
    } finally {
      // Normalmente a tela sai de cena com a sessão; se continuar montada
      // (a saída falhou), o botão volta a servir.
      saidaEmCursoRef.current = false;
      setSaindo(false);
    }
  };
  // "Encerrar sessão" só pede a confirmação; quem encerra é o "Sim, sair".
  const [confirmandoSaida, setConfirmandoSaida] = useState(false);
  const { config } = useStore();
  const [isOrdersExpanded, setIsOrdersExpanded] = useState(false);
  const [isAddressesExpanded, setIsAddressesExpanded] = useState(false);

  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const [isUpdatingAvatar, setIsUpdatingAvatar] = useState(false);
  const [modalTab, setModalTab] = useState<"avatars" | "upload">("avatars");

  const [isCoverModalOpen, setIsCoverModalOpen] = useState(false);
  const [isUpdatingCover, setIsUpdatingCover] = useState(false);
  const [coverModalTab, setCoverModalTab] = useState<"presets" | "upload">(
    "presets",
  );

  // O Voltar do celular fecha só a janela aberta (foto, capa ou a pergunta de
  // sair) e a tela de Perfil fica: cada uma ganha a sua entrada de histórico.
  useVoltarFechaAFolha(isAvatarModalOpen, () => setIsAvatarModalOpen(false));
  useVoltarFechaAFolha(isCoverModalOpen, () => setIsCoverModalOpen(false));
  useVoltarFechaAFolha(confirmandoSaida, () => setConfirmandoSaida(false));

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
    const desmarcar = marcarOperacaoSensivel("foto-de-perfil");
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
      desmarcar();
      setIsUpdatingAvatar(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const contaDonaId = user?.id;
    const file = e.target.files?.[0];
    // Sem zerar, escolher a MESMA foto de novo não dispara nada.
    e.target.value = "";
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

        const desmarcar = marcarOperacaoSensivel("foto-de-perfil");
        try {
          const compressed = await compressImage(base64, 200, 200);
          const success = await updateProfile(
            { avatar_url: compressed },
            contaDonaId,
          );
          if (success) {
            toast.success("Foto de perfil atualizada!");
            setIsAvatarModalOpen(false);
          }
          setIsUpdatingAvatar(false);
        } catch (error) {
          console.error("Error uploading photo:", error);
          toast.error(
            mensagemDaFalhaDeImagem(error, "Erro ao processar foto."),
          );
          setIsUpdatingAvatar(false);
        } finally {
          desmarcar();
        }
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
    const desmarcar = marcarOperacaoSensivel("foto-de-perfil");
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
      desmarcar();
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
    const contaDonaId = user?.id;
    const file = e.target.files?.[0];
    // Sem zerar, escolher a MESMA foto de novo não dispara nada.
    e.target.value = "";
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

        try {
          const compressed = await compressCoverImage(base64);
          const success = await updateProfile(
            { cover_url: compressed },
            contaDonaId,
          );
          if (success) {
            toast.success("Capa de perfil personalizada atualizada!");
            setIsCoverModalOpen(false);
          }
        } catch (error) {
          console.error("Error uploading cover:", error);
          toast.error(
            mensagemDaFalhaDeImagem(error, "Erro ao processar imagem."),
          );
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

  const profileName = useMemo(() => {
    if (!user) return "Seu Nome";
    return (
      profile?.full_name ||
      user.user_metadata?.name ||
      user.email?.split("@")[0] ||
      "Seu Nome"
    );
  }, [user, profile]);

  const handleWhatsAppSupport = (orderId: string) => {
    const message = `Olá! Tenho uma dúvida sobre meu pedido #${numeroDoPedido(orderId)}.`;
    let phone = (config.whatsappNumber || "").replace(/\D/g, "");
    if (phone.length === 11 || phone.length === 10) {
      phone = `55${phone}`;
    }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    abrirWhatsapp(url);
    haptic.light();
  };

  // Laudo 31/08 (C1): mesma régua do ProductView e do OrderDetailsView —
  // sem número configurado, o botão de WhatsApp do pedido some em vez de
  // abrir `wa.me/` sem destinatário.
  const lojaTemWhatsappAgora = lojaTemWhatsapp(config.whatsappNumber);

  useEffect(() => {
    if (user) {
      fetchAddresses();
    } else if (!authLoading) {
      onNavigate("auth");
    }
  }, [user, fetchAddresses, authLoading, onNavigate]);

  // `useOrders` não busca ao montar: só lê o cache do aparelho, que só a
  // busca grava, e cada tela tem a SUA cópia da lista. Sem esta chamada o
  // cartão "Pedidos em Andamento" some logo depois do login (o logout apaga o
  // cache) — defeito do print de 25/09/2026. Busca de novo sempre que a aba
  // volta a ser a visível: ela fica montada escondida, e a busca feita em
  // Meus Pedidos não chega nesta cópia. Silenciosa: cartão secundário.
  useEffect(() => {
    if (user && isActive) fetchUserOrders(true);
  }, [user, isActive, fetchUserOrders]);

  const activeOrders = useMemo(() => {
    return orders.filter((o) =>
      ["pending", "processing", "shipping"].includes(o.status),
    );
  }, [orders]);

  // "Cliente desde mês/ano": só com a data de criação que a conta JÁ traz no
  // contexto de auth; sem ela (ou ilegível) o selo some, nada é inventado.
  const clienteDesde = useMemo(() => {
    const bruto = user?.created_at ?? profile?.created_at;
    const data = bruto ? new Date(bruto) : null;
    if (!data || Number.isNaN(data.getTime())) return null;
    const mes = data
      .toLocaleDateString("pt-BR", { month: "short" })
      .replace(".", "");
    return `${mes}/${data.getFullYear()}`;
  }, [user, profile]);
  const whatsapp = String(profile?.whatsapp ?? "").trim();

  if (authLoading) {
    return <ProfileSkeleton />;
  }

  if (!user) {
    return null;
  }

  return (
    <div className="pb-customer min-h-full bg-background text-foreground">
      <div className="relative h-[120px] w-full overflow-hidden bg-muted">
        <img
          src={profile?.cover_url || defaultCover}
          alt="Capa de Perfil"
          className="size-full object-cover"
        />

        {/* Trocar capa: chip com texto (antes era só um ícone) */}
        <button
          type="button"
          onClick={() => {
            setIsCoverModalOpen(true);
            haptic.light();
          }}
          className="absolute right-4 top-4 z-10 flex h-11 items-center gap-2 rounded-full bg-background/90 px-4 text-sm font-semibold text-foreground backdrop-blur-md transition-colors hover:bg-background"
          title="Alterar capa de fundo"
          aria-label="Alterar capa de fundo"
        >
          <Camera aria-hidden="true" className="size-4" />
          Alterar capa
        </button>
      </div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="mx-auto max-w-md space-y-7 px-4"
      >
        {/* Cabeçalho: avatar sobreposto à capa, nome e e-mail legíveis */}
        <motion.div variants={itemVariants} className="relative z-10 -mt-11">
          <div className="flex items-end gap-4">
            <button
              type="button"
              aria-label="Trocar foto de perfil"
              onClick={openAvatarModal}
              className="relative block size-[88px] shrink-0 cursor-pointer rounded-[28px] focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <span className="flex size-full items-center justify-center overflow-hidden rounded-[28px] border-4 border-solid border-background bg-muted">
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt="Sua foto de perfil"
                    className="size-full object-cover duration-300 animate-in fade-in"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="text-4xl font-bold text-muted-foreground"
                  >
                    {profileName.trim().charAt(0).toUpperCase()}
                  </span>
                )}
                {isUpdatingAvatar && (
                  <span className="absolute inset-0 flex items-center justify-center rounded-[28px] bg-background/80">
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  </span>
                )}
              </span>
              {/* Emblema sempre visível (no celular não existe hover) */}
              <span
                aria-hidden="true"
                className="absolute -bottom-1 -right-1 flex size-8 items-center justify-center rounded-full border-2 border-solid border-background bg-foreground text-background"
              >
                <Camera className="size-4" />
              </span>
            </button>
            {clienteDesde && (
              <span className={`${ROTULO} mb-2 min-w-0 break-words`}>
                Cliente desde {clienteDesde}
              </span>
            )}
          </div>

          <h1 className="mt-4 break-words text-[26px] font-bold leading-8 tracking-tight text-foreground">
            {profileName}
          </h1>
          <p className="mt-1 break-all text-sm text-muted-foreground">
            {user.email}
          </p>

          {isAdmin && (
            <div className="mt-5 flex items-center justify-between gap-3 rounded-[20px] bg-foreground p-3 text-background">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-background/10"
                >
                  <Shield className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-base font-bold leading-tight">
                    Modo admin
                  </p>
                  <p className="text-sm text-background/70">
                    Painel de controle ativo
                  </p>
                </div>
              </div>
              <Button
                onClick={() => onNavigate("admin-dashboard")}
                className="h-11 shrink-0 rounded-xl bg-background px-4 text-sm font-semibold text-foreground hover:bg-background/90"
              >
                Acessar painel
              </Button>
            </div>
          )}
        </motion.div>

        {/* Pedidos em andamento: o que o cliente mais quer ver vem primeiro */}
        {activeOrders.length > 0 && (
          <motion.section variants={itemVariants}>
            <div className={CABECALHO}>
              <h2 className={`${ROTULO} flex items-center gap-2`}>
                Pedidos em andamento
              </h2>
              <span
                data-testid="contagem-em-andamento"
                className="flex size-7 items-center justify-center rounded-full bg-muted text-sm font-bold text-foreground"
              >
                {activeOrders.length}
              </span>
            </div>
            <div className="mt-1 space-y-3">
              {(isOrdersExpanded ? activeOrders : activeOrders.slice(0, 1)).map(
                (order) => {
                  const firstItem = order.items?.[0];
                  const firstItemImage = firstItem?.image;
                  const firstItemName = firstItem?.name || "Pedido";

                  return (
                    <div
                      key={order.id}
                      className="space-y-4 rounded-[18px] border border-border bg-muted/30 p-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-muted">
                          {firstItemImage ? (
                            <img
                              src={firstItemImage}
                              alt={firstItemName}
                              className="size-full object-cover"
                            />
                          ) : (
                            <Package
                              aria-hidden="true"
                              className="size-6 text-muted-foreground"
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-base font-bold text-foreground">
                            {firstItemName}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            #{numeroDoPedido(order.id)} ·{" "}
                            {new Date(order.createdAt).toLocaleDateString(
                              "pt-BR",
                            )}
                            {order.items.length > 1 && (
                              <>
                                {" "}
                                · +{order.items.length - 1}{" "}
                                {order.items.length - 1 === 1
                                  ? "outro item"
                                  : "outros itens"}
                              </>
                            )}
                          </p>
                          {/* Pedido pago pelo app e ainda não pago: o cartão não
                              pode parecer um pedido "Recebido" qualquer (em 30
                              min ele é cancelado). Mesmo selo da lista de
                              pedidos e mesma regra de "Retomar pagamento" do
                              detalhe. Sem moldura: ponto/ícone e texto na cor. */}
                          <CustomerPaymentBadge
                            paymentStatus={order.paymentStatus}
                            orderStatus={order.status}
                            variant="perfil"
                            className="mt-1 border-transparent bg-transparent px-0"
                          />
                        </div>
                      </div>

                      <OrderTimeline
                        compacto
                        status={order.status}
                        retiradaNaLoja={order.retiradaNaLoja}
                      />

                      {onRetomarPagamento &&
                        podeRetomarPagamento({
                          status: order.status,
                          paymentStatus: order.paymentStatus,
                          logado: !!user,
                        }) && (
                          <Button
                            onClick={() => onRetomarPagamento(order.id)}
                            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-foreground text-base font-semibold text-background hover:bg-foreground/90"
                          >
                            <CreditCard className="size-4" aria-hidden="true" />
                            Retomar pagamento
                          </Button>
                        )}

                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() => onNavigate("order-details", order.id)}
                          className="h-12 flex-1 rounded-2xl bg-foreground text-base font-semibold text-background hover:bg-foreground/90"
                        >
                          Ver detalhes
                        </Button>
                        {lojaTemWhatsappAgora && (
                          <BotaoWhatsapp
                            onClick={() => handleWhatsAppSupport(order.id)}
                            aria-label={`Falar pelo WhatsApp sobre o pedido #${numeroDoPedido(order.id)}`}
                            className="flex-1"
                          >
                            WhatsApp
                          </BotaoWhatsapp>
                        )}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
            {activeOrders.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setIsOrdersExpanded(!isOrdersExpanded);
                  haptic.light();
                }}
                className="mt-2 flex h-11 w-full items-center justify-center gap-1 text-base font-semibold text-muted-foreground hover:text-foreground"
              >
                {isOrdersExpanded
                  ? "Ver menos"
                  : `Ver mais (${activeOrders.length - 1} ${
                      activeOrders.length - 1 === 1 ? "outro" : "outros"
                    })`}
                <ChevronDown
                  aria-hidden="true"
                  className={`size-4 transition-transform ${isOrdersExpanded ? "rotate-180" : ""}`}
                />
              </button>
            )}
          </motion.section>
        )}

        {/* Meus dados: o que a conta já tem; Editar abre Segurança e conta */}
        <motion.section variants={itemVariants}>
          <div className={CABECALHO}>
            <h2 className={ROTULO}>Meus dados</h2>
            <button
              type="button"
              onClick={() => onNavigate("account-settings")}
              className="flex h-11 items-center px-1 text-[15px] font-semibold text-foreground"
            >
              Editar
            </button>
          </div>
          <div className={`${CARTAO} mt-1 divide-y divide-border px-4`}>
            <div className="py-3.5">
              <p className={ROTULO}>Nome completo</p>
              <p className="mt-1 break-words text-[15px] text-foreground">
                {profileName}
              </p>
            </div>
            {profile &&
              (whatsapp ? (
                <div className="py-3.5">
                  <p className={ROTULO}>WhatsApp</p>
                  <p className="mt-1 text-[15px] text-foreground">
                    {formatarWhatsAppParaExibicao(whatsapp)}
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate("account-settings")}
                  className="flex min-h-11 w-full items-center justify-between gap-3 py-3.5 text-left"
                >
                  <span>
                    <span className={`${ROTULO} block`}>WhatsApp</span>
                    <span className="mt-1 block text-[15px] text-muted-foreground">
                      Adicionar WhatsApp
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-5 shrink-0 text-muted-foreground"
                  />
                </button>
              ))}
            <div className="py-3.5">
              <p className={ROTULO}>E-mail</p>
              <p className="mt-1 break-all text-[15px] text-foreground">
                {user.email}
              </p>
            </div>
          </div>
        </motion.section>

        {/* Endereços de entrega: carregando, erro, vazio ou lista */}
        <motion.section variants={itemVariants}>
          <div className={CABECALHO}>
            <h2 className={ROTULO}>Endereços de entrega</h2>
            <Button
              onClick={() => onNavigate("address-form")}
              className="h-11 gap-1 rounded-xl bg-transparent px-2 text-[15px] font-semibold text-foreground hover:bg-muted"
            >
              <Plus aria-hidden="true" className="size-4" />
              Novo
            </Button>
          </div>
          <div className={`${CARTAO} mt-1 px-4 py-1`}>
            {addressesLoading && addresses.length === 0 ? (
              <div
                role="status"
                aria-busy="true"
                className="animate-pulse space-y-4 py-3"
              >
                <span className="sr-only">Carregando endereços</span>
                {[0, 1].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="size-12 shrink-0 rounded-[14px] bg-muted" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-full rounded bg-muted" />
                      <div className="h-3 w-2/5 rounded bg-muted" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                {erroAoCarregar && (
                  <div
                    role="alert"
                    className="my-3 rounded-2xl border border-red-300 p-4 text-red-600 dark:text-red-400"
                  >
                    <p className="text-base">
                      Não conseguimos carregar seus endereços agora.
                    </p>
                    <button
                      type="button"
                      onClick={() => void fetchAddresses()}
                      disabled={addressesLoading}
                      className="mt-3 min-h-11 rounded-xl border border-solid border-red-300 bg-background px-4 text-sm font-semibold text-red-600 hover:bg-muted disabled:opacity-50 dark:text-red-400"
                    >
                      Tentar de novo
                    </button>
                  </div>
                )}
                {(addresses.length > 0 || !erroAoCarregar) && (
                  <AddressList
                    addresses={addresses}
                    compact={!isAddressesExpanded}
                    showMaps
                    onAdd={() => onNavigate("address-form")}
                    onEdit={(addr) => {
                      onNavigate("address-form", addr.id);
                    }}
                    onDelete={deleteAddress}
                  />
                )}
                {addresses.length > 0 && (
                  <div className="border-t border-border">
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddressesExpanded(!isAddressesExpanded);
                        haptic.light();
                      }}
                      className="flex h-11 w-full items-center justify-center gap-1 text-base font-semibold text-muted-foreground hover:text-foreground"
                    >
                      {isAddressesExpanded
                        ? "Ver menos detalhes"
                        : "Ver detalhes dos endereços"}
                      <ChevronDown
                        aria-hidden="true"
                        className={`size-4 transition-transform ${isAddressesExpanded ? "rotate-180" : ""}`}
                      />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </motion.section>

        {/* Conta. "Sobre a loja" — a marca do lojista assinante (peça 24;
            ordem do dono, 14/09): logo ABAIXO de Segurança e conta, no mesmo
            cartão, visível a TODOS os usuários (não mora em isAdmin nem em
            outro ramo condicional). */}
        <motion.section variants={itemVariants}>
          <div className={CABECALHO}>
            <h2 className={ROTULO}>Conta</h2>
          </div>
          <div
            className={`${CARTAO} mt-1 divide-y divide-border overflow-hidden`}
          >
            <LinhaDoMenu
              titulo="Segurança e conta"
              descricao="Alterar senha e dados pessoais"
              onClick={() => onNavigate("account-settings")}
            />
            <LinhaDoMenu
              titulo="Sobre a loja"
              descricao="A loja por trás deste app"
              onClick={() => onNavigate("about-store")}
            />
          </div>
        </motion.section>

        {/* Encerrar sessão — botão PRÓPRIO no fim do perfil (ordem do dono,
            14/09): a ação destrutiva fica separada das navegações. */}
        <motion.div variants={itemVariants}>
          <button
            type="button"
            onClick={() => setConfirmandoSaida(true)}
            disabled={saindo}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl border border-solid border-red-300 bg-background text-base font-semibold text-red-600 transition-colors hover:bg-muted disabled:opacity-60 dark:text-red-400"
          >
            <LogOut aria-hidden="true" className="size-4" />
            {saindo ? "Saindo…" : "Encerrar sessão"}
            <span className="sr-only">. Sair da sua conta</span>
          </button>
        </motion.div>
      </motion.div>

      <AlertDialog open={confirmandoSaida} onOpenChange={setConfirmandoSaida}>
        <AlertDialogContent
          overlayClassName="z-[130]"
          className="z-[130] sm:max-w-sm"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Sair da sua conta?</AlertDialogTitle>
            <AlertDialogDescription>
              Para ver seus pedidos de novo, você vai precisar entrar outra vez.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">
              Continuar na conta
            </AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              onClick={() => void encerrarSessao()}
            >
              Sim, sair
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Custom Avatar Sheet/Dialog Modal */}
      <Dialog open={isAvatarModalOpen} onOpenChange={setIsAvatarModalOpen}>
        <DialogContent
          overlayClassName="z-[130]"
          className="z-[130] max-h-[85dvh] max-w-xs overflow-y-auto overflow-x-hidden rounded-[18px] border border-border bg-background p-5 text-foreground sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle className="text-center text-base font-bold tracking-tight text-foreground">
              Escolher Avatar ou Foto
            </DialogTitle>
            <DialogDescription className="sr-only">
              Escolha um avatar predefinido ou envie sua própria foto para
              personalizar seu perfil.
            </DialogDescription>
          </DialogHeader>

          {/* Modal Tab Selector */}
          <div className="relative z-10 my-2 flex w-full rounded-xl bg-muted p-1">
            <button
              type="button"
              onClick={() => {
                setModalTab("avatars");
                haptic.light();
              }}
              className={`relative min-h-11 flex-1 rounded-lg py-2 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zinc-900/50 ${
                modalTab === "avatars"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {modalTab === "avatars" && (
                <motion.div
                  layoutId="modalTabBackground"
                  className="absolute inset-0 rounded-lg border border-solid border-border bg-background"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <span className="relative z-10 flex items-center justify-center gap-1.5">
                <User className="size-4" />
                Avatares
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setModalTab("upload");
                haptic.light();
              }}
              className={`relative min-h-11 flex-1 rounded-lg py-2 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zinc-900/50 ${
                modalTab === "upload"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {modalTab === "upload" && (
                <motion.div
                  layoutId="modalTabBackground"
                  className="absolute inset-0 rounded-lg border border-solid border-border bg-background"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <span className="relative z-10 flex items-center justify-center gap-1.5">
                <Camera className="size-4" />
                Foto Própria
              </span>
            </button>
          </div>

          <div className="relative space-y-4 py-2">
            {isUpdatingAvatar && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center space-y-2 rounded-2xl bg-background/85">
                <Loader2 className="size-6 animate-spin text-foreground" />
                <span className="animate-pulse text-sm font-semibold text-muted-foreground">
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
                    <p className={`${ROTULO} mb-3 text-center`}>
                      Avatares Prontos
                    </p>
                    <div className="grid max-h-[250px] select-none grid-cols-4 gap-3 overflow-y-auto p-1">
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
                            type="button"
                            whileTap={{ scale: 0.95 }}
                            onClick={() => handleSelectPredefinedAvatar(avatar)}
                            className={`relative flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 border-solid transition-colors ${
                              isSelected
                                ? "border-foreground"
                                : "border-transparent hover:border-border"
                            }`}
                            style={{
                              background: `linear-gradient(135deg, ${avatar.start}, ${avatar.end})`,
                            }}
                            title={avatar.label}
                          >
                            <span className="select-none text-4xl">
                              {avatar.emoji}
                            </span>

                            {/* Selected Checkmark Badge */}
                            {isSelected && (
                              <div className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-foreground text-background">
                                <Check className="size-3 stroke-[3.5]" />
                              </div>
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
                    <p className={`${ROTULO} mb-3 text-center`}>
                      Sua Foto de Perfil
                    </p>

                    {profile?.avatar_url &&
                    !profile.avatar_url.includes("data:image/svg+xml") ? (
                      /* High fidelity preview of custom photo */
                      <div className="flex flex-col items-center justify-center space-y-4 py-2">
                        <div className="relative">
                          <div className="flex size-28 items-center justify-center overflow-hidden rounded-full border-4 border-solid border-background bg-muted">
                            <img
                              src={profile.avatar_url}
                              alt="Foto customizada"
                              className="size-full object-cover duration-300 animate-in fade-in"
                            />
                          </div>
                          <div className="absolute -bottom-2 -right-2 flex size-11 cursor-pointer items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-foreground/90">
                            <label
                              htmlFor="profile-avatar-upload-icon"
                              className="flex size-full cursor-pointer items-center justify-center"
                            >
                              <input
                                id="profile-avatar-upload-icon"
                                name="avatar"
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handlePhotoUpload}
                                disabled={isUpdatingAvatar}
                              />
                              <span className="sr-only">
                                Trocar foto de perfil
                              </span>
                              <Camera className="size-4" />
                            </label>
                          </div>
                        </div>

                        <p className="text-center text-xs font-medium leading-relaxed text-muted-foreground">
                          Esta foto é exibida publicamente no marketplace.
                          <br />
                          Você pode trocá-la ou removê-la a qualquer momento.
                        </p>

                        <div className="flex w-full flex-col gap-2">
                          <label
                            htmlFor="profile-avatar-upload-button"
                            className="w-full"
                          >
                            <input
                              id="profile-avatar-upload-button"
                              name="avatar"
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={handlePhotoUpload}
                              disabled={isUpdatingAvatar}
                            />
                            <span className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-foreground text-sm font-semibold text-background transition-colors hover:bg-foreground/90">
                              <Camera className="size-4" />
                              Escolher Outra Foto
                            </span>
                          </label>
                          <Button
                            variant="outline"
                            onClick={handleRemoveAvatar}
                            disabled={isUpdatingAvatar}
                            className="flex h-12 w-full items-center justify-center gap-1.5 rounded-2xl border border-solid border-red-300 bg-background text-sm font-semibold text-red-600 transition-colors hover:bg-muted dark:text-red-400"
                          >
                            <Trash2 className="size-4" />
                            Remover Foto
                          </Button>
                        </div>
                      </div>
                    ) : (
                      /* Interactive drag and drop style upload area */
                      <div className="space-y-4">
                        <label
                          htmlFor="avatar_file_input_profile"
                          className="block cursor-pointer"
                        >
                          <span className="sr-only">Fazer upload de foto</span>
                          <input
                            id="avatar_file_input_profile"
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handlePhotoUpload}
                            disabled={isUpdatingAvatar}
                          />
                          <motion.div
                            whileTap={{ scale: 0.99 }}
                            className="flex cursor-pointer flex-col items-center justify-center space-y-3 rounded-[18px] border-2 border-dashed border-border bg-muted/30 p-8 text-center transition-colors hover:border-foreground/40"
                          >
                            <div className="flex size-12 items-center justify-center rounded-[14px] border border-solid border-border bg-background text-foreground">
                              <UploadCloud className="size-6" />
                            </div>
                            <div className="space-y-1">
                              <p className="text-sm font-semibold text-foreground">
                                Enviar foto do dispositivo
                              </p>
                              <p className="px-4 text-xs leading-normal text-muted-foreground">
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
                            className="flex h-12 w-full items-center justify-center gap-1.5 rounded-2xl border border-solid border-red-300 bg-background text-sm font-semibold text-red-600 transition-colors hover:bg-muted dark:text-red-400"
                          >
                            <Trash2 className="size-4" />
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
        <DialogContent
          overlayClassName="z-[130]"
          className="z-[130] mx-auto max-h-[85dvh] w-[90%] max-w-sm overflow-y-auto overflow-x-hidden rounded-[18px] border border-border bg-background p-5 text-foreground"
        >
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-base font-bold tracking-tight text-foreground">
              Capa de Fundo
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
              Personalize a capa do seu perfil com gradientes premium ou uma
              imagem de sua preferência.
            </DialogDescription>
          </DialogHeader>

          {/* Live Preview Banner */}
          <div className="relative mb-2 mt-3 h-20 w-full overflow-hidden rounded-2xl border border-border">
            <img
              src={profile?.cover_url || defaultCover}
              alt="Capa de Perfil"
              className="size-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-black/30" />
            <div className="absolute inset-0 flex flex-col justify-between p-2.5">
              <span className="self-start rounded-md bg-black/40 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-md">
                Pré-visualização Real
              </span>
              <div className="mt-auto flex items-center gap-2 self-start">
                <div className="flex size-6 items-center justify-center overflow-hidden rounded-lg border border-white/20 bg-white/10 backdrop-blur-sm">
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
                <p className="max-w-[160px] truncate text-xs font-semibold leading-none text-white">
                  {profileName}
                </p>
              </div>
            </div>
          </div>

          {/* Tabs navigation */}
          <div className="my-3.5 flex rounded-xl bg-muted p-1">
            <button
              type="button"
              onClick={() => {
                setCoverModalTab("presets");
                haptic.light();
              }}
              className={`min-h-11 flex-1 rounded-lg text-sm font-semibold transition-colors ${
                coverModalTab === "presets"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
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
              className={`min-h-11 flex-1 rounded-lg text-sm font-semibold transition-colors ${
                coverModalTab === "upload"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Enviar Foto
            </button>
          </div>

          <div className="flex min-h-[160px] flex-col justify-between">
            {coverModalTab === "presets" ? (
              <div className="max-h-[220px] overflow-y-auto">
                <div className="grid grid-cols-3 gap-2 p-1">
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
                        whileTap={{ scale: 0.96 }}
                        type="button"
                        key={cover.id}
                        onClick={() => handleSelectPredefinedCover(cover)}
                        disabled={isUpdatingCover}
                        className={`relative flex aspect-[16/10] flex-col justify-end overflow-hidden rounded-xl border-2 border-solid p-1.5 transition-colors ${
                          isSelected || isDefault
                            ? "border-foreground"
                            : "border-border hover:border-foreground/40"
                        }`}
                        title={cover.label}
                      >
                        <img
                          src={svgPreview}
                          alt={cover.label}
                          className="absolute inset-0 size-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />

                        <span className="relative z-10 w-full truncate text-xs font-semibold text-white">
                          {cover.label}
                        </span>

                        {(isSelected || isDefault) && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                            <div className="flex size-6 items-center justify-center rounded-full bg-foreground text-background">
                              <Check className="size-3.5" />
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
                <label htmlFor="cover_file_input_profile" className="w-full">
                  <span className="sr-only">Fazer upload de foto de capa</span>
                  <input
                    id="cover_file_input_profile"
                    type="file"
                    accept="image/*"
                    onChange={handleCoverUpload}
                    disabled={isUpdatingCover}
                    className="hidden"
                  />
                  <motion.div
                    whileTap={{ scale: 0.99 }}
                    className="flex cursor-pointer flex-col items-center justify-center space-y-3 rounded-[18px] border-2 border-dashed border-border bg-muted/30 p-6 text-center transition-colors hover:border-foreground/40"
                  >
                    <div className="flex size-10 items-center justify-center rounded-[14px] border border-solid border-border bg-background text-foreground">
                      <UploadCloud className="size-5" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-foreground">
                        Escolher Imagem do Dispositivo
                      </p>
                      <p className="px-4 text-xs leading-normal text-muted-foreground">
                        Formatos aceitos: JPEG e PNG. A imagem será ajustada
                        para a proporção ideal.
                      </p>
                    </div>
                  </motion.div>
                </label>
              </div>
            )}

            <div className="mt-4 flex gap-2 border-t border-border pt-4">
              {profile?.cover_url && (
                <motion.div whileTap={{ scale: 0.97 }} className="flex-1">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleRemoveCover}
                    disabled={isUpdatingCover}
                    className="flex h-11 w-full items-center justify-center gap-1.5 rounded-2xl border border-solid border-red-300 bg-background text-sm font-semibold text-red-600 shadow-none transition-colors hover:bg-muted dark:text-red-400"
                  >
                    <Trash2 className="size-4" />
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
                  className="flex h-11 w-full items-center justify-center rounded-2xl bg-foreground text-sm font-semibold text-background transition-colors hover:bg-foreground/90"
                >
                  {isUpdatingCover ? (
                    <>
                      <Loader2 className="mr-1.5 size-4 animate-spin" />
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
