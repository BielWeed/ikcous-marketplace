import { Button } from "@/components/ui/button";
import { AddressList } from "@/components/ui/custom/AddressList";
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
import type { View } from "@/types";
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
import { AnimatePresence, motion } from "framer-motion";
import {
  Camera,
  Check,
  ChevronRight,
  CreditCard,
  Loader2,
  LogOut,
  type LucideIcon,
  Package,
  Plus,
  Shield,
  Store,
  Trash2,
  UploadCloud,
  User,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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

// Cartão branco padrão das seções do Perfil.
const CARTAO = "rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm";

// Linha de atalho (Segurança e conta, Sobre a loja, Encerrar sessão): alvo de
// toque de 64 px; `perigo` pinta de vermelho e some com a setinha.
function LinhaDoMenu({
  icone: Icone,
  titulo,
  descricao,
  onClick,
  perigo = false,
}: {
  icone: LucideIcon;
  titulo: string;
  descricao: string;
  onClick: () => void;
  perigo?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-16 w-full items-center gap-3 px-5 py-3 text-left transition-colors ${perigo ? "hover:bg-red-50" : "hover:bg-zinc-50"}`}
    >
      <span
        aria-hidden="true"
        className={`flex size-10 shrink-0 items-center justify-center rounded-full ${perigo ? "bg-red-50 text-red-600" : "bg-zinc-100 text-zinc-700"}`}
      >
        <Icone className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block text-base font-bold ${perigo ? "text-red-700" : "text-zinc-900"}`}
        >
          {titulo}
        </span>
        <span className="block text-sm text-zinc-600">{descricao}</span>
      </span>
      {!perigo && (
        <ChevronRight
          aria-hidden="true"
          className="size-5 shrink-0 text-zinc-500"
        />
      )}
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
        const success = await updateProfile(
          { cover_url: compressed },
          contaDonaId,
        );
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
    <div className="pb-customer min-h-full bg-gradient-to-b from-white to-zinc-50/50">
      <div className="group relative h-48 w-full overflow-hidden bg-zinc-100 shadow-inner">
        <img
          src={profile?.cover_url || defaultCover}
          alt="Capa de Perfil"
          className="group-hover:scale-102 size-full object-cover transition-transform duration-700"
        />

        {/* Visual Glassmorphism overlay for gradient/depth */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-black/10" />

        {/* Trocar capa: botão com a palavra "Capa" (antes era só um ícone) */}
        <button
          type="button"
          onClick={() => {
            setIsCoverModalOpen(true);
            haptic.light();
          }}
          className="absolute right-4 top-4 z-10 flex h-11 items-center gap-2 rounded-full bg-black/60 px-4 text-sm font-semibold text-white backdrop-blur-md transition-all hover:bg-black/70 active:scale-95"
          title="Alterar capa de fundo"
          aria-label="Alterar capa de fundo"
        >
          <Camera aria-hidden="true" className="size-4" />
          Capa
        </button>
      </div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="mx-auto max-w-md space-y-4 px-4"
      >
        {/* Cabeçalho: avatar sobreposto à capa, nome e e-mail legíveis */}
        <motion.div
          variants={itemVariants}
          className="relative z-10 -mt-14 pb-2"
        >
          <div className="flex items-end justify-between gap-3">
            <div
              role="button"
              tabIndex={0}
              aria-label="Trocar foto de perfil"
              onClick={openAvatarModal}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openAvatarModal();
                }
              }}
              className="relative size-28 shrink-0 cursor-pointer rounded-[28px] focus:outline-none focus:ring-2 focus:ring-zinc-900"
            >
              <div className="flex size-full items-center justify-center overflow-hidden rounded-[28px] border-[6px] border-white bg-zinc-100 shadow-premium">
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt="Profile Avatar"
                    className="size-full object-cover duration-300 animate-in fade-in"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="text-4xl font-bold text-zinc-600"
                  >
                    {profileName.trim().charAt(0).toUpperCase()}
                  </span>
                )}
                {isUpdatingAvatar && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-[28px] bg-white/80">
                    <Loader2 className="size-6 animate-spin text-zinc-600" />
                  </div>
                )}
              </div>
              {/* Emblema sempre visível (no celular não existe hover) */}
              <span
                aria-hidden="true"
                className="absolute -bottom-1 -right-1 flex size-9 items-center justify-center rounded-full border-2 border-white bg-zinc-900 text-white"
              >
                <Camera className="size-4" />
              </span>
            </div>
            {clienteDesde && (
              <span className="mb-2 rounded-full bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700">
                Cliente desde {clienteDesde}
              </span>
            )}
          </div>

          <h1 className="mt-3 break-words text-2xl font-bold leading-tight text-zinc-900">
            {profileName}
          </h1>
          <p className="mt-1 break-all text-base text-zinc-600">{user.email}</p>

          {isAdmin && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-zinc-900 p-3 text-white">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10"
                >
                  <Shield className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-base font-bold leading-tight">
                    Modo admin
                  </p>
                  <p className="text-sm text-zinc-300">
                    Painel de controle ativo
                  </p>
                </div>
              </div>
              <Button
                onClick={() => onNavigate("admin-dashboard")}
                className="h-11 shrink-0 rounded-full bg-white px-4 text-sm font-semibold text-zinc-900 hover:bg-zinc-100"
              >
                Acessar painel
              </Button>
            </div>
          )}
        </motion.div>

        {/* Meus dados: o que a conta já tem; Editar abre Segurança e conta */}
        <motion.section variants={itemVariants} className={CARTAO}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-zinc-900">Meus dados</h2>
            <button
              type="button"
              onClick={() => onNavigate("account-settings")}
              className="flex h-11 items-center gap-0.5 text-base font-semibold text-zinc-900"
            >
              Editar
              <ChevronRight aria-hidden="true" className="size-4" />
            </button>
          </div>
          <div className="divide-y divide-zinc-100 border-t border-zinc-100">
            <div className="py-3">
              <p className="text-sm text-zinc-600">Nome completo</p>
              <p className="break-words text-base font-medium text-zinc-900">
                {profileName}
              </p>
            </div>
            {profile &&
              (whatsapp ? (
                <div className="py-3">
                  <p className="text-sm text-zinc-600">WhatsApp</p>
                  <p className="text-base font-medium text-zinc-900">
                    {formatarWhatsAppParaExibicao(whatsapp)}
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate("account-settings")}
                  className="flex min-h-11 w-full items-center justify-between gap-3 py-3 text-left"
                >
                  <span>
                    <span className="block text-sm text-zinc-600">
                      WhatsApp
                    </span>
                    <span className="block text-base text-zinc-600">
                      Adicionar WhatsApp
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-5 shrink-0 text-zinc-500"
                  />
                </button>
              ))}
            <div className="pt-3">
              <p className="text-sm text-zinc-600">E-mail</p>
              <p className="break-all text-base font-medium text-zinc-900">
                {user.email}
              </p>
            </div>
          </div>
        </motion.section>

        {/* Pedidos em andamento (mesmo dado de antes, em cartão) */}
        {activeOrders.length > 0 && (
          <motion.section variants={itemVariants} className={CARTAO}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-bold text-zinc-900">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full bg-emerald-500"
                />
                Pedidos em andamento
              </h2>
              <span
                data-testid="contagem-em-andamento"
                className="flex size-8 items-center justify-center rounded-full bg-zinc-100 text-sm font-bold text-zinc-900"
              >
                {activeOrders.length}
              </span>
            </div>
            <div className="mt-4 space-y-4">
              {(isOrdersExpanded ? activeOrders : activeOrders.slice(0, 1)).map(
                (order) => {
                  const firstItem = order.items?.[0];
                  const firstItemImage = firstItem?.image;
                  const firstItemName = firstItem?.name || "Pedido";

                  return (
                    <div
                      key={order.id}
                      className="space-y-4 rounded-2xl border border-zinc-100 bg-zinc-50 p-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-zinc-200">
                          {firstItemImage ? (
                            <img
                              src={firstItemImage}
                              alt={firstItemName}
                              className="size-full object-cover"
                            />
                          ) : (
                            <Package
                              aria-hidden="true"
                              className="size-6 text-zinc-500"
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-base font-bold text-zinc-900">
                            {firstItemName}
                          </h3>
                          {order.items.length > 1 && (
                            <p className="text-sm text-zinc-600">
                              +{order.items.length - 1}{" "}
                              {order.items.length - 1 === 1
                                ? "outro item"
                                : "outros itens"}
                            </p>
                          )}
                        </div>
                      </div>

                      <p className="w-fit rounded-lg bg-zinc-100 px-2.5 py-1 text-sm font-medium text-zinc-700">
                        #{numeroDoPedido(order.id)} ·{" "}
                        {new Date(order.createdAt).toLocaleDateString("pt-BR")}
                      </p>

                      {/* Pedido pago pelo app e ainda não pago: o cartão não
                          pode parecer um pedido "Recebido" qualquer (em 30
                          min ele é cancelado). Mesmo selo da lista de pedidos
                          e mesma regra de "Retomar pagamento" do detalhe. */}
                      <div>
                        <CustomerPaymentBadge
                          paymentStatus={order.paymentStatus}
                          orderStatus={order.status}
                          variant="perfil"
                        />
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
                            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 text-base font-semibold text-white"
                          >
                            <CreditCard className="size-4" aria-hidden="true" />
                            Retomar pagamento
                          </Button>
                        )}

                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() => onNavigate("order-details", order.id)}
                          className="h-12 flex-1 rounded-2xl bg-zinc-900 text-base font-semibold text-white hover:bg-zinc-800"
                        >
                          Ver detalhes
                        </Button>
                        {lojaTemWhatsappAgora && (
                          <Button
                            variant="outline"
                            onClick={() => handleWhatsAppSupport(order.id)}
                            className="h-12 flex-1 rounded-2xl border-2 border-solid border-zinc-200 bg-white text-base font-semibold text-zinc-900 hover:bg-zinc-50"
                          >
                            WhatsApp
                          </Button>
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
                className="mt-2 flex h-11 w-full items-center justify-center gap-1 text-base font-semibold text-zinc-600 hover:text-zinc-900"
              >
                {isOrdersExpanded
                  ? "Ver menos"
                  : `Ver mais (${activeOrders.length - 1} ${
                      activeOrders.length - 1 === 1 ? "outro" : "outros"
                    })`}
                <ChevronRight
                  aria-hidden="true"
                  className={`size-4 ${isOrdersExpanded ? "-rotate-90" : ""}`}
                />
              </button>
            )}
          </motion.section>
        )}

        {/* Endereços de entrega: carregando, erro, vazio ou lista */}
        <motion.section variants={itemVariants} className={CARTAO}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-zinc-900">
              Endereços de entrega
            </h2>
            <Button
              onClick={() => onNavigate("address-form")}
              className="h-11 rounded-full bg-zinc-100 px-4 text-sm font-semibold text-zinc-900 hover:bg-zinc-200"
            >
              <Plus aria-hidden="true" className="size-4" />
              Novo
            </Button>
          </div>
          <div className="mt-3">
            {addressesLoading && addresses.length === 0 ? (
              <div
                role="status"
                aria-busy="true"
                className="animate-pulse space-y-4 py-2"
              >
                <span className="sr-only">Carregando endereços</span>
                {[0, 1].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="size-10 shrink-0 rounded-full bg-zinc-100" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-full rounded bg-zinc-100" />
                      <div className="h-3 w-2/5 rounded bg-zinc-100" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                {erroAoCarregar && (
                  <div
                    role="alert"
                    className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800"
                  >
                    <p className="text-base">
                      Não conseguimos carregar seus endereços agora.
                    </p>
                    <button
                      type="button"
                      onClick={() => void fetchAddresses()}
                      disabled={addressesLoading}
                      className="mt-3 min-h-11 rounded-xl border border-solid border-red-200 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
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
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddressesExpanded(!isAddressesExpanded);
                      haptic.light();
                    }}
                    className="mt-1 flex h-11 w-full items-center justify-center gap-1 text-base font-semibold text-zinc-600 hover:text-zinc-900"
                  >
                    {isAddressesExpanded
                      ? "Ver menos detalhes"
                      : "Ver detalhes dos endereços"}
                    <ChevronRight
                      aria-hidden="true"
                      className={`size-4 ${isAddressesExpanded ? "-rotate-90" : ""}`}
                    />
                  </button>
                )}
              </>
            )}
          </div>
        </motion.section>

        {/* Atalhos. "Sobre a loja" — a marca do lojista assinante (peça 24;
            ordem do dono, 14/09): logo ABAIXO de Segurança e conta, no mesmo
            cartão, visível a TODOS os usuários (não mora em isAdmin nem em
            outro ramo condicional). */}
        <motion.div
          variants={itemVariants}
          className="divide-y divide-zinc-100 overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm"
        >
          <LinhaDoMenu
            icone={Shield}
            titulo="Segurança e conta"
            descricao="Alterar senha e dados pessoais"
            onClick={() => onNavigate("account-settings")}
          />
          <LinhaDoMenu
            icone={Store}
            titulo="Sobre a loja"
            descricao="A loja por trás deste app"
            onClick={() => onNavigate("about-store")}
          />
        </motion.div>

        {/* Encerrar sessão — cartão PRÓPRIO no fim do perfil (ordem do dono,
            14/09): a ação destrutiva fica separada das navegações. */}
        <motion.div
          variants={itemVariants}
          className="overflow-hidden rounded-3xl border border-red-100 bg-white shadow-sm"
        >
          <LinhaDoMenu
            perigo
            icone={LogOut}
            titulo="Encerrar sessão"
            descricao="Sair da sua conta"
            onClick={logout}
          />
        </motion.div>
      </motion.div>

      {/* Custom Avatar Sheet/Dialog Modal */}
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
              className={`relative flex-1 rounded-lg py-1.5 text-xs font-bold outline-none transition-all focus-visible:ring-2 focus-visible:ring-zinc-900/50 ${
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
              className={`relative flex-1 rounded-lg py-1.5 text-xs font-bold outline-none transition-all focus-visible:ring-2 focus-visible:ring-zinc-900/50 ${
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
                          <div className="absolute -bottom-1 -right-1 flex size-8 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-colors hover:bg-primary/90">
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

                        <p className="text-center text-[10px] font-semibold leading-relaxed text-zinc-400">
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
                            <span className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary text-[10px] font-bold uppercase tracking-wider text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-95">
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
                    {profileName}
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
                  ? "bg-primary text-primary-foreground shadow-md"
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
                  ? "bg-primary text-primary-foreground shadow-md"
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
                  className="flex h-10 w-full items-center justify-center rounded-xl bg-primary text-[9px] font-black font-bold uppercase tracking-wider text-primary-foreground shadow-md transition-all hover:bg-primary/90"
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
