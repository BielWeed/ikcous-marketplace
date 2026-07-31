import { Button } from "@/components/ui/button";
import { AddressList } from "@/components/ui/custom/AddressList";
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
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Loader2,
  LogOut,
  MapPin,
  MessageCircle,
  Package,
  Plus,
  Settings,
  Shield,
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
import { haptic } from "@/utils/haptic";

interface ProfileViewProps {
  onNavigate: (view: View, id?: string) => void;
}

export function ProfileView({ onNavigate }: ProfileViewProps) {
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
  } = useAddresses();
  const { orders } = useOrders(true, false);
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
    const message = `Olá! Tenho uma dúvida sobre meu pedido #${orderId.slice(0, 8)}.`;
    let phone = (config.whatsappNumber || "").replace(/\D/g, "");
    if (phone.length === 11 || phone.length === 10) {
      phone = `55${phone}`;
    }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    globalThis.open(url, "_blank");
    haptic.light();
  };

  useEffect(() => {
    if (user) {
      fetchAddresses();
    } else if (!authLoading) {
      onNavigate("auth");
    }
  }, [user, fetchAddresses, authLoading, onNavigate]);

  const activeOrders = useMemo(() => {
    return orders.filter((o) =>
      ["pending", "processing", "shipping"].includes(o.status),
    );
  }, [orders]);

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

        {/* Edit Cover Button */}
        <button
          type="button"
          onClick={() => {
            setIsCoverModalOpen(true);
            haptic.light();
          }}
          className="absolute right-4 top-4 z-10 flex size-10 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white shadow-lg backdrop-blur-md transition-all hover:bg-black/60 active:scale-90"
          title="Alterar capa de fundo"
        >
          <Camera className="size-4" />
        </button>
      </div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="mx-auto max-w-md space-y-6 px-4"
      >
        {/* Header Info - Shifted Up to Overlap Cover */}
        <motion.div
          variants={itemVariants}
          className="relative z-10 -mt-14 flex flex-col items-center justify-center pb-4"
        >
          {/* Clickable Avatar with Hover Camera Overlay */}
          <div
            role="button"
            tabIndex={0}
            onClick={openAvatarModal}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openAvatarModal();
              }
            }}
            className="group/avatar hover:scale-102 relative mb-4 flex size-28 cursor-pointer items-center justify-center overflow-hidden rounded-[28px] border-[6px] border-white bg-white shadow-premium transition-transform duration-300 focus:outline-none focus:ring-2 focus:ring-zinc-900"
          >
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt="Profile Avatar"
                className="size-full object-cover duration-300 animate-in fade-in"
              />
            ) : (
              <User className="size-12 text-zinc-300 duration-300 animate-in fade-in" />
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition-opacity duration-300 group-hover/avatar:opacity-100">
              <Camera className="size-6" />
            </div>
            {isUpdatingAvatar && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80">
                <Loader2 className="size-6 animate-spin text-zinc-600" />
              </div>
            )}
          </div>

          <h1 className="text-3xl font-black leading-none tracking-tighter text-zinc-900 transition-all duration-500">
            {profileName}
          </h1>
          <p className="mt-3 text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400 opacity-60 transition-colors">
            {user.email}
          </p>

          {isAdmin && (
            <div className="mt-6 w-full rounded-3xl border border-zinc-800 bg-zinc-900 p-4 text-white">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-white/10 text-white">
                    <Settings className="size-5" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-white">
                      Modo Admin
                    </p>
                    <p className="text-[9px] font-bold uppercase tracking-tighter text-zinc-400">
                      Painel de Controle Ativo
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => onNavigate("admin-dashboard")}
                  className="h-9 rounded-full bg-white px-4 text-[9px] font-black uppercase tracking-widest text-zinc-900 transition-all hover:bg-zinc-100 active:scale-95"
                >
                  Acessar Painel
                </Button>
              </div>
            </div>
          )}
        </motion.div>

        {/* Delivery Addresses */}
        <motion.div
          variants={itemVariants}
          className={`overflow-hidden border border-zinc-100 bg-white shadow-sm transition-all duration-300 ${
            !isAddressesExpanded ? "rounded-[1.75rem]" : "rounded-[2.5rem]"
          }`}
        >
          <div
            className={`flex items-center justify-between border-b border-zinc-50 bg-zinc-50/50 transition-all duration-300 ${
              !isAddressesExpanded ? "px-5 py-3" : "p-6"
            }`}
          >
            <div className="flex items-center gap-2">
              <MapPin
                className={`text-zinc-400 transition-all duration-300 ${!isAddressesExpanded ? "size-3.5" : "size-4"}`}
              />
              <span
                className={`font-black uppercase tracking-[0.2em] text-zinc-500 transition-all duration-300 ${
                  !isAddressesExpanded ? "text-[9px]" : "text-[10px]"
                }`}
              >
                Endereços de Entrega
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigate("address-form")}
              className={`rounded-full border border-zinc-100 bg-white px-3 font-black uppercase tracking-widest transition-all duration-300 hover:bg-zinc-100 ${
                !isAddressesExpanded ? "h-7 text-[8px]" : "h-8 text-[9px]"
              }`}
            >
              <Plus
                className={`mr-1 transition-all duration-300 ${!isAddressesExpanded ? "size-2.5" : "size-3"}`}
              />
              Novo
            </Button>
          </div>
          <div
            className={`transition-all duration-300 ${!isAddressesExpanded ? "p-3.5" : "p-6"}`}
          >
            {addressesLoading ? (
              <div className="animate-pulse space-y-4">
                <div className="flex h-28 flex-col justify-between rounded-3xl border border-transparent bg-zinc-50/50 p-6">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-2xl bg-zinc-100" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-1/3 rounded bg-zinc-100" />
                      <div className="h-3 w-1/4 rounded bg-zinc-100" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="h-3 w-3/4 rounded bg-zinc-100" />
                    <div className="h-3 w-1/2 rounded bg-zinc-100" />
                  </div>
                </div>
              </div>
            ) : (
              <>
                <AddressList
                  addresses={addresses}
                  compact={!isAddressesExpanded}
                  onEdit={(addr) => {
                    onNavigate("address-form", addr.id);
                  }}
                  onDelete={deleteAddress}
                />
                {addresses.length > 0 && (
                  <button
                    onClick={() => {
                      setIsAddressesExpanded(!isAddressesExpanded);
                      haptic.light();
                    }}
                    className={`flex w-full items-center justify-center gap-1.5 rounded-xl border-t border-zinc-100 bg-zinc-50/10 font-black uppercase tracking-widest text-zinc-400 transition-all duration-300 hover:bg-zinc-50/35 hover:text-zinc-900 ${
                      !isAddressesExpanded
                        ? "mt-3 py-2 text-[8px]"
                        : "mt-4 py-3 text-[10px]"
                    }`}
                  >
                    {isAddressesExpanded ? (
                      <>
                        Ver menos detalhes
                        <ChevronUp className="size-3.5" />
                      </>
                    ) : (
                      <>
                        Ver mais detalhes
                        <ChevronDown className="size-3.5" />
                      </>
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        </motion.div>

        {/* Active Orders */}
        {activeOrders.length > 0 && (
          <motion.div
            variants={itemVariants}
            className="overflow-hidden rounded-[2.5rem] border border-zinc-100 bg-white shadow-sm"
          >
            <div className="flex items-center gap-3 border-b border-zinc-50 bg-zinc-50/50 p-6">
              <div className="size-2 animate-pulse rounded-full bg-emerald-500" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                Pedidos em Andamento
              </span>
            </div>
            <div className="space-y-6 p-6">
              {(isOrdersExpanded ? activeOrders : activeOrders.slice(0, 1)).map(
                (order, idx) => {
                  const firstItem = order.items?.[0];
                  const firstItemImage = firstItem?.image;
                  const firstItemName = firstItem?.name || "Pedido";

                  return (
                    <div
                      key={order.id}
                      className={`space-y-4 ${idx > 0 ? "border-t border-zinc-100 pt-6" : ""}`}
                    >
                      <div className="flex items-center gap-4">
                        {/* Circular product thumbnail */}
                        <div className="flex size-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-100 bg-zinc-50 shadow-sm">
                          {firstItemImage ? (
                            <img
                              src={firstItemImage}
                              alt={firstItemName}
                              className="size-full object-cover"
                            />
                          ) : (
                            <Package className="size-5 text-zinc-300" />
                          )}
                        </div>
                        {/* Product and order details */}
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-[11px] font-black uppercase tracking-wider text-zinc-900">
                            {firstItemName}
                          </h3>
                          {order.items.length > 1 && (
                            <p className="mt-0.5 text-[9px] font-bold uppercase tracking-widest text-zinc-400">
                              +{order.items.length - 1}{" "}
                              {order.items.length - 1 === 1
                                ? "outro item"
                                : "outros itens"}
                            </p>
                          )}
                          <div className="mt-1 flex items-center gap-2">
                            <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[9px] font-black tracking-widest text-zinc-500">
                              ID #{order.id.slice(0, 8)}
                            </span>
                            <span className="size-1.5 rounded-full bg-zinc-200" />
                            <span className="text-[9px] font-bold tracking-tight text-zinc-400">
                              {new Date(order.createdAt).toLocaleDateString(
                                "pt-BR",
                              )}
                            </span>
                          </div>
                        </div>
                      </div>

                      <OrderTimeline status={order.status} />

                      <div className="flex gap-2 pt-2">
                        <Button
                          variant="outline"
                          onClick={() => onNavigate("order-details", order.id)}
                          className="group h-12 flex-1 rounded-2xl border-2 text-[10px] font-black uppercase tracking-widest"
                        >
                          Ver Detalhes
                          <ArrowRight className="ml-2 size-3 transition-transform group-hover:translate-x-1" />
                        </Button>
                        <Button
                          onClick={() => handleWhatsAppSupport(order.id)}
                          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl border-none bg-emerald-600 text-[10px] font-black uppercase tracking-widest text-white shadow-sm shadow-emerald-600/10 transition-all hover:bg-emerald-700 active:scale-95"
                        >
                          <MessageCircle className="size-4" />
                          WhatsApp
                        </Button>
                      </div>
                    </div>
                  );
                },
              )}
            </div>
            {activeOrders.length > 1 && (
              <button
                onClick={() => {
                  setIsOrdersExpanded(!isOrdersExpanded);
                  haptic.light();
                }}
                className="flex w-full items-center justify-center gap-1.5 border-t border-zinc-100 bg-zinc-50/10 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 transition-colors hover:bg-zinc-50/35 hover:text-zinc-900"
              >
                {isOrdersExpanded ? (
                  <>
                    Ver menos
                    <ChevronUp className="size-3.5" />
                  </>
                ) : (
                  <>
                    Ver mais ({activeOrders.length - 1}{" "}
                    {activeOrders.length - 1 === 1 ? "outro" : "outros"})
                    <ChevronDown className="size-3.5" />
                  </>
                )}
              </button>
            )}
          </motion.div>
        )}

        {/* Order History & Menu */}
        <motion.div
          variants={itemVariants}
          className="overflow-hidden rounded-[2.5rem] border border-zinc-100 bg-white shadow-sm"
        >
          <button
            onClick={() => onNavigate("account-settings")}
            className="group flex w-full items-center justify-between border-b border-zinc-50 p-6 transition-colors hover:bg-zinc-50"
          >
            <div className="flex items-center gap-4">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-zinc-50 transition-colors group-hover:bg-white">
                <Shield className="size-5 text-zinc-400" />
              </div>
              <div className="text-left">
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-900">
                  Segurança e Conta
                </p>
                <p className="text-[9px] font-bold uppercase tracking-tighter text-zinc-400">
                  Alterar senha e dados pessoais
                </p>
              </div>
            </div>
            <ChevronRight className="size-4 text-zinc-300 transition-transform group-hover:translate-x-1" />
          </button>

          <button
            onClick={logout}
            className="group flex w-full items-center justify-between p-6 transition-colors hover:bg-red-50"
          >
            <div className="flex items-center gap-4">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-red-50 transition-colors group-hover:bg-white">
                <LogOut className="size-5 text-red-500" />
              </div>
              <div className="text-left">
                <p className="text-[10px] font-black uppercase tracking-widest text-red-600">
                  Encerrar Sessão
                </p>
                <p className="text-[9px] font-bold uppercase tracking-tighter text-red-400">
                  Sair da sua conta premium
                </p>
              </div>
            </div>
            <ChevronRight className="size-4 text-red-200 transition-transform group-hover:translate-x-1" />
          </button>
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
