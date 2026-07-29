import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import {
  LocalBufferedInput,
  LocalBufferedTextarea,
} from "@/components/admin/LocalBufferedInput";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useVOR } from "@/hooks/useVOR";
import { supabase } from "@/lib/supabase";
import type { View } from "@/types";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  HelpCircle,
  History,
  Info,
  Radio,
  Send,
  Smartphone,
  Sparkles,
  Target,
  Users,
  Zap,
} from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

interface AdminPushViewProps {
  onNavigate: (view: View, id?: string) => void;
  targetUserId?: string;
  onSetDirty?: (dirty: boolean) => void;
}

export const AdminPushView = memo(function AdminPushView({
  onNavigate,
  targetUserId,
  onSetDirty,
}: AdminPushViewProps) {
  const { user } = useAuth();
  const isOffline = useOnlineStatus();
  const { config, isLoaded: configLoaded, updateConfig } = useStore();
  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);
  const [isSocialProofExpanded, setIsSocialProofExpanded] = useState(false);

  const handleToggleRealTimeSalesAlerts = async (checked: boolean) => {
    if (isOffline) {
      toast.error("Você está offline");
      return;
    }
    setIsUpdatingConfig(true);
    try {
      await updateConfig({ realTimeSalesAlerts: checked });
      toast.success(
        checked
          ? "Notificações de prova social ativadas"
          : "Notificações de prova social desativadas",
      );
    } catch (err) {
      console.error(err);
      toast.error("Erro ao atualizar a configuração");
    } finally {
      setIsUpdatingConfig(false);
    }
  };
  const [loading, setLoading] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [subCount, setSubCount] = useState(0);
  const [notification, setNotification] = useState({
    title: "",
    body: "",
    url: "/",
  });
  const { isSupported, subscribe } = usePushNotifications();
  const { recordAction } = useVOR();
  const [isTestSubscribed, setIsTestSubscribed] = useState(false);
  const [segment, setSegment] = useState("all");
  const [predictedReach, setPredictedReach] = useState(0);
  const [history, setHistory] = useState<any[]>([]);
  const [targetUserName, setTargetUserName] = useState<string | null>(null);
  const [destType, setDestType] = useState<string>("home");
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [customPath, setCustomPath] = useState<string>("");
  const [products, setProducts] = useState<{ id: string; nome: string }[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  useEffect(() => {
    const loadProducts = async () => {
      setLoadingProducts(true);
      try {
        const { data, error } = await supabase
          .from("vw_produtos_public")
          .select("id, nome")
          .eq("ativo", true)
          .order("nome", { ascending: true });
        if (!error && data) {
          const validProducts = (data as any[])
            .filter((p) => p.id && p.nome)
            .map((p) => ({ id: p.id as string, nome: p.nome as string }));
          setProducts(validProducts);
          if (validProducts.length > 0) {
            setSelectedProductId(validProducts[0].id);
          }
        }
      } catch (err) {
        console.error("Erro ao carregar produtos:", err);
      } finally {
        setLoadingProducts(false);
      }
    };
    loadProducts();
  }, []);

  const updateUrl = (type: string, prodId: string, custom: string) => {
    let finalUrl = "/";
    if (type === "home") {
      finalUrl = "/";
    } else if (type === "search") {
      finalUrl = "/search";
    } else if (type === "cart") {
      finalUrl = "/cart";
    } else if (type === "favorites") {
      finalUrl = "/favorites";
    } else if (type === "orders") {
      finalUrl = "/orders";
    } else if (type === "profile") {
      finalUrl = "/profile";
    } else if (type === "product") {
      finalUrl = prodId ? `/product-detail?id=${prodId}` : "/product-detail";
    } else if (type === "custom") {
      finalUrl = custom;
    }
    setNotification((prev) => ({ ...prev, url: finalUrl }));
  };

  const handleDestTypeChange = (type: string) => {
    setDestType(type);
    updateUrl(type, selectedProductId, customPath);
  };

  const handleProductChange = (prodId: string) => {
    setSelectedProductId(prodId);
    updateUrl(destType, prodId, customPath);
  };

  const handleCustomPathChange = (val: string) => {
    setCustomPath(val);
    updateUrl(destType, selectedProductId, val);
  };

  useEffect(() => {
    const url = notification.url;
    if (url === "/" || url === "" || url === "/home") {
      if (destType !== "home") setDestType("home");
    } else if (url === "/search") {
      if (destType !== "search") setDestType("search");
    } else if (url === "/cart") {
      if (destType !== "cart") setDestType("cart");
    } else if (url === "/favorites") {
      if (destType !== "favorites") setDestType("favorites");
    } else if (url === "/orders") {
      if (destType !== "orders") setDestType("orders");
    } else if (url === "/profile") {
      if (destType !== "profile") setDestType("profile");
    } else if (
      url.startsWith("/product-detail?id=") ||
      url.startsWith("/product/")
    ) {
      if (destType !== "product") setDestType("product");
      const id = url.includes("?id=")
        ? url.split("?id=")[1] || ""
        : url.split("/product/")[1] || "";
      if (selectedProductId !== id) setSelectedProductId(id);
    } else {
      if (destType !== "custom") setDestType("custom");
      if (customPath !== url) setCustomPath(url);
    }
  }, [notification.url]);

  useEffect(() => {
    if (targetUserId) {
      setSegment(targetUserId);
      const fetchUserName = async () => {
        const { data, error } = await supabase
          .from("public_profiles")
          .select("full_name")
          .eq("id", targetUserId)
          .single();
        if (!error && data) {
          setTargetUserName(data.full_name);
        }
      };
      fetchUserName();
    } else {
      setTargetUserName(null);
      setSegment("all");
    }
  }, [targetUserId]);

  const fetchSubscribers = useCallback(async () => {
    const { count, error } = await supabase
      .from("push_subscriptions")
      .select("*", { count: "exact", head: true });

    if (!error) setSubCount(count || 0);
  }, []);

  const fetchHistory = useCallback(async () => {
    const { data, error } = await supabase
      .from("push_notifications_log")
      .select("*")
      .order("sent_at", { ascending: false })
      .limit(20);

    if (!error && data) setHistory(data);
  }, []);

  useEffect(() => {
    fetchSubscribers();
    fetchHistory();
  }, [fetchSubscribers, fetchHistory]);

  const calculateReach = useCallback(async () => {
    if (segment === "all") {
      setPredictedReach(subCount);
      return;
    }

    try {
      const { data, error } = await (supabase.rpc as any)(
        "get_segmented_push_targets",
        {
          p_segment: segment,
        },
      );
      if (!error && data) {
        setPredictedReach((data as any[]).length);
      }
    } catch (err) {
      console.error("Error calculating reach:", err);
    }
  }, [segment, subCount]);

  useEffect(() => {
    calculateReach();
  }, [calculateReach]);

  useEffect(() => {
    if (!onSetDirty) return;
    const isDirty =
      notification.title.trim().length > 0 ||
      notification.body.trim().length > 0;
    onSetDirty(isDirty);
    return () => {
      onSetDirty(false);
    };
  }, [notification.title, notification.body, onSetDirty]);

  const handleTestSubscription = async () => {
    if (isOffline) {
      toast.error("Você está offline", {
        description:
          "Não é possível se inscrever para notificações de teste sem conexão.",
      });
      return;
    }
    try {
      await subscribe();
      setIsTestSubscribed(true);
      fetchSubscribers();
    } catch {
      // Error handled in hook
    }
  };

  const handleSend = async () => {
    if (isOffline) {
      toast.error("Você está offline", {
        description: "Não é possível enviar notificações push sem conexão.",
      });
      return;
    }
    if (!notification.title || !notification.body) {
      toast.error("Preencha título e mensagem");
      return;
    }

    setLoading(true);
    try {
      if (!user) throw new Error("Administrador não autenticado");

      const { data: targets, error: targetError } = await (supabase.rpc as any)(
        "get_segmented_push_targets",
        {
          p_segment: segment,
        },
      );

      if (targetError) throw targetError;

      const targetList = targets as any[];
      const finalRecipientCount = targetList?.length || 0;

      if (finalRecipientCount === 0) {
        toast.error("Nenhum destinatário encontrado para este segmento");
        return;
      }

      const { error: logError } = await supabase
        .from("push_notifications_log")
        .insert({
          title: notification.title,
          body: notification.body,
          url: notification.url,
          recipient_count: finalRecipientCount,
          created_by: user?.id,
        });

      if (logError) throw logError;

      try {
        if (targetUserId) {
          await supabase.from("notificacoes").insert({
            titulo: notification.title,
            mensagem: notification.body,
            tipo: "aviso",
            usuario_id: targetUserId,
            dados: { segment, action_url: notification.url },
          });
        } else if (segment === "all") {
          await supabase.from("notificacoes").insert({
            titulo: notification.title,
            mensagem: notification.body,
            tipo: "aviso",
            usuario_id: null,
            dados: { segment, action_url: notification.url },
          });
        } else {
          const uniqueUserIds = Array.from(
            new Set(targetList.map((t: any) => t.user_id).filter(Boolean)),
          ) as string[];
          if (uniqueUserIds.length > 0) {
            const inAppRows = uniqueUserIds.map((uId) => ({
              titulo: notification.title,
              mensagem: notification.body,
              tipo: "aviso",
              usuario_id: uId,
              dados: { segment, action_url: notification.url },
            }));
            const chunkSize = 100;
            for (let i = 0; i < inAppRows.length; i += chunkSize) {
              const chunk = inAppRows.slice(i, i + chunkSize);
              await supabase.from("notificacoes").insert(chunk);
            }
          }
        }
      } catch (inAppErr) {
        console.error("Error saving in-app notification:", inAppErr);
      }

      const { error: pushError } = await supabase.functions.invoke(
        "send-push",
        {
          body: {
            title: notification.title,
            body: notification.body,
            url: notification.url,
            tokens: targetList.map((t: any) => ({
              endpoint: t.endpoint,
              keys: { p256dh: t.p256dh, auth: t.auth },
            })),
          },
        },
      );

      if (pushError) {
        console.warn(
          "Real push delivery failed, but log was created:",
          pushError,
        );
        toast.warning("Log criado, mas houve erro no disparo real");
      } else {
        toast.success(
          `Notificação enviada para ${finalRecipientCount} dispositivos!`,
        );
        recordAction(
          "PUSH_DISPATCH",
          {
            title: notification.title,
            recipient_count: finalRecipientCount,
            segment,
          },
          { status: "success", timestamp: new Date().toISOString() },
        );
      }

      setNotification({ title: "", body: "", url: "/" });
      fetchHistory();
    } catch (error) {
      console.error("Error sending push:", error);
      toast.error("Falha ao registrar notificação no banco");
    } finally {
      setLoading(false);
    }
  };

  const effectiveReach = segment === "all" ? subCount : predictedReach;

  return (
    <div className="min-h-screen bg-[#09090b] pb-admin lg:pb-12 text-white duration-200 animate-in fade-in selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Header Limpo e Direto */}
      <div className="sticky top-0 z-20 border-b border-white/10 bg-[#09090b]/90 backdrop-blur-xl px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.2)]">
              <Send className="size-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-black tracking-tight text-white leading-none">
                  Enviar Notificações
                </h1>
                <button
                  type="button"
                  onClick={() => setShowHelpModal(true)}
                  className="flex size-5 shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-900 text-zinc-400 transition-all hover:border-white/20 hover:text-white active:scale-95"
                  title="Ajuda e explicação desta tela"
                >
                  <HelpCircle className="size-3" />
                </button>
              </div>
              <p className="text-[9px] font-extrabold uppercase tracking-widest text-zinc-500 mt-0.5">
                Envie mensagens e avisos direto no celular dos clientes
              </p>
            </div>
          </div>

          {/* Indicadores no Topbar */}
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 rounded-lg border border-white/5 bg-zinc-900/80 px-2.5 py-1 text-[10px] font-semibold text-zinc-300">
              <Smartphone className="size-3.5 text-emerald-400" />
              <span>
                <strong className="text-white font-bold">{subCount}</strong>{" "}
                Celulares Cadastrados
              </span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-zinc-900/80 px-2.5 py-1 text-[10px] font-semibold">
              <span
                className={`size-2 rounded-full ${config.realTimeSalesAlerts ? "bg-emerald-500 animate-pulse" : "bg-zinc-600"}`}
              />
              <span className="text-zinc-400 uppercase tracking-wider text-[9px]">
                {config.realTimeSalesAlerts
                  ? "Avisos de Vendas Ativos"
                  : "Avisos Desativados"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Conteúdo Principal */}
      <div className="mx-auto max-w-6xl px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
          {/* COLUNA PRINCIPAL: Mensagens Prontas e Envio (lg:col-span-7) */}
          <div className="space-y-3.5 lg:col-span-7">
            {/* Mensagens Prontas */}
            <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3.5 shadow-lg backdrop-blur-xl">
              <div className="mb-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-3.5 text-emerald-400" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-white">
                    Exemplos de Mensagens Prontas
                  </h3>
                </div>
                <span className="text-[9px] font-semibold uppercase tracking-widest text-zinc-500">
                  Clique para usar
                </span>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {[
                  {
                    id: "fomo",
                    title: "Desconto Relâmpago",
                    tag: "Oferta ⚡",
                    desc: "Preenche oferta de 10% OFF",
                    icon: Zap,
                    border: "hover:border-amber-500/40 hover:bg-amber-500/5",
                  },
                  {
                    id: "auth",
                    title: "Lembrete de Carrinho",
                    tag: "Vendas 🛒",
                    desc: "Lembrar de finalizar compra",
                    icon: Info,
                    border: "hover:border-sky-500/40 hover:bg-sky-500/5",
                  },
                  {
                    id: "value",
                    title: "Cupom de R$20",
                    tag: "Presente 🎁",
                    desc: "Cupom de desconto especial",
                    icon: Target,
                    border:
                      "hover:border-emerald-500/40 hover:bg-emerald-500/5",
                  },
                ].map((arch) => (
                  <button
                    key={arch.id}
                    className={`group/arch flex flex-col justify-between rounded-lg border border-white/5 bg-white/[0.03] p-2.5 text-left transition-all duration-200 active:scale-[0.98] ${arch.border}`}
                    onClick={() => {
                      if (arch.id === "fomo") {
                        setNotification({
                          title:
                            "Cupom Relâmpago: 10% OFF ativo por 1 hora! ⚡",
                          body: "Aproveite o desconto exclusivo nos produtos da loja. Garanta o seu antes que acabe!",
                          url: "/search",
                        });
                      } else if (arch.id === "auth") {
                        setNotification({
                          title:
                            "Seu carrinho de compras está te esperando! 🛒",
                          body: "Finalize seu pedido agora e garanta seus produtos com rapidez. Não perca!",
                          url: "/cart",
                        });
                      } else {
                        setNotification({
                          title: "Presente para você: Cupom de R$20! 🎁",
                          body: "Use o cupom BEMVINDO e garanta um desconto especial na sua próxima compra na loja.",
                          url: "/profile",
                        });
                      }

                      recordAction(
                        "CAMPAIGN_TEMPLATE_LOAD",
                        { template: arch.id, title: arch.title },
                        {
                          result: "applied",
                          timestamp: new Date().toISOString(),
                        },
                      );

                      toast.success(
                        `Mensagem pronta "${arch.title}" preenchida!`,
                      );
                    }}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-white">
                        <arch.icon className="size-3 text-emerald-400" />
                        {arch.title}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[9px] font-medium text-zinc-400">
                      <span>{arch.desc}</span>
                      <span className="font-mono text-[8px] text-emerald-400/80 font-bold">
                        {arch.tag}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Formulário de Envio */}
            <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3.5 shadow-lg backdrop-blur-xl">
              <div className="mb-3 flex items-center justify-between border-b border-white/5 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
                    <Send className="size-3.5" />
                  </div>
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-white leading-none">
                      Escrever Nova Notificação
                    </h3>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mt-0.5">
                      Crie e envie mensagens para os clientes
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400">
                  <Radio className="size-3 animate-pulse" />
                  <span>Receberão: {effectiveReach} clientes</span>
                </div>
              </div>

              {isOffline && (
                <div className="mb-3 flex items-center gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-rose-300 animate-in fade-in">
                  <AlertCircle className="size-4 shrink-0" />
                  <div className="text-[10px]">
                    <span className="font-bold uppercase">
                      Você está offline:
                    </span>{" "}
                    Conecte-se à internet para poder enviar notificações aos
                    clientes.
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {/* Quem vai receber */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">
                      Quem vai receber esta mensagem?
                    </span>
                  </div>

                  {targetUserId ? (
                    <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="size-4 text-emerald-400" />
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-widest text-emerald-400 leading-none">
                            Mensagem para Cliente Específico
                          </p>
                          <p className="text-xs font-bold text-white mt-0.5">
                            Cliente: {targetUserName || "Carregando..."}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => onNavigate("admin-push")}
                        disabled={isOffline}
                        className="rounded-md border border-white/10 bg-zinc-900 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-zinc-300 hover:bg-zinc-800 hover:text-white"
                      >
                        Mudar para todos os clientes
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                      {[
                        {
                          id: "all",
                          label: "Todos os Clientes",
                          count: segment === "all" ? effectiveReach : subCount,
                        },
                        {
                          id: "vip",
                          label: "Clientes Frequentes",
                          count:
                            segment === "vip"
                              ? effectiveReach
                              : Math.ceil(subCount * 0.3),
                        },
                        {
                          id: "inactive",
                          label: "Sem comprar há 30d",
                          count:
                            segment === "inactive"
                              ? effectiveReach
                              : Math.floor(subCount * 0.25),
                        },
                        {
                          id: "new",
                          label: "Novos Clientes",
                          count:
                            segment === "new"
                              ? effectiveReach
                              : Math.floor(subCount * 0.45),
                        },
                      ].map((s) => (
                        <button
                          key={s.id}
                          onClick={() => !isOffline && setSegment(s.id)}
                          disabled={isOffline}
                          className={`flex h-8 items-center justify-between rounded-lg border px-2.5 text-[9px] font-black uppercase tracking-wider transition-all ${
                            segment === s.id
                              ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.15)]"
                              : "border-white/5 bg-white/[0.02] text-zinc-400 hover:bg-white/5 hover:text-white"
                          } disabled:opacity-30`}
                        >
                          <span className="truncate pr-1">{s.label}</span>
                          <span
                            className={`text-[8px] font-mono rounded px-1 shrink-0 ${segment === s.id ? "bg-emerald-500/20 text-emerald-200" : "bg-zinc-800 text-zinc-500"}`}
                          >
                            {s.count}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Título & Mensagem */}
                <div className="space-y-2">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label
                        htmlFor="push-title"
                        className="text-[9px] font-black uppercase tracking-widest text-zinc-400"
                      >
                        Título da mensagem
                      </Label>
                      <span className="text-[8px] font-mono text-zinc-500">
                        {notification.title.length}/60
                      </span>
                    </div>
                    <LocalBufferedInput
                      id="push-title"
                      name="title"
                      autoComplete="off"
                      value={notification.title}
                      onFlush={(val) =>
                        setNotification((prev) => ({ ...prev, title: val }))
                      }
                      disabled={isOffline || loading}
                      placeholder={
                        isOffline
                          ? "Indisponível offline"
                          : "Ex: Oferta especial liberada para você! 🎁"
                      }
                      useShadcn={true}
                      className="h-9 rounded-lg border-white/10 bg-black/50 px-3 text-xs text-white shadow-inner focus:border-emerald-500/50 focus:ring-0 placeholder:text-zinc-600 disabled:opacity-40"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label
                        htmlFor="push-body"
                        className="text-[9px] font-black uppercase tracking-widest text-zinc-400"
                      >
                        Texto da mensagem
                      </Label>
                      <span className="text-[8px] font-mono text-zinc-500">
                        {notification.body.length}/140
                      </span>
                    </div>
                    <LocalBufferedTextarea
                      id="push-body"
                      name="body"
                      autoComplete="off"
                      value={notification.body}
                      onFlush={(val) =>
                        setNotification((prev) => ({ ...prev, body: val }))
                      }
                      disabled={isOffline || loading}
                      placeholder={
                        isOffline
                          ? "Indisponível offline"
                          : "Escreva aqui a mensagem curta que o cliente vai ver no celular..."
                      }
                      rows={2}
                      useShadcn={true}
                      className="resize-none rounded-lg border-white/10 bg-black/50 p-2.5 text-xs font-medium text-white shadow-inner focus:border-emerald-500/50 focus:ring-0 placeholder:text-zinc-600 disabled:opacity-40"
                    />
                  </div>
                </div>

                {/* Destino Selector & Dynamic Inputs */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label
                      htmlFor="push-destination"
                      className="text-[9px] font-black uppercase tracking-widest text-zinc-400"
                    >
                      Para onde o cliente vai ao clicar?
                    </Label>
                    <Select
                      name="destType"
                      value={destType}
                      onValueChange={handleDestTypeChange}
                      disabled={isOffline || loading}
                    >
                      <SelectTrigger
                        id="push-destination"
                        className="h-9 w-full rounded-lg border border-white/10 bg-black/50 px-2.5 text-xs text-white shadow-inner focus:border-emerald-500/50 focus:ring-0 [&>svg]:opacity-50"
                      >
                        <SelectValue placeholder="Selecione a tela..." />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border border-white/10 bg-zinc-950 text-white shadow-2xl">
                        <SelectItem value="home">
                          Página Inicial da Loja
                        </SelectItem>
                        <SelectItem value="search">
                          Página de Busca de Produtos
                        </SelectItem>
                        <SelectItem value="cart">
                          Carrinho de Compras
                        </SelectItem>
                        <SelectItem value="favorites">
                          Lista de Favoritos
                        </SelectItem>
                        <SelectItem value="orders">Meus Pedidos</SelectItem>
                        <SelectItem value="profile">
                          Perfil do Cliente
                        </SelectItem>
                        <SelectItem value="product">
                          Abrir um Produto Específico
                        </SelectItem>
                        <SelectItem value="custom">
                          Outra Página (Link manual)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {destType === "product" && (
                    <div className="space-y-1 duration-200 animate-in fade-in">
                      <Label
                        htmlFor="push-product-select"
                        className="text-[9px] font-black uppercase tracking-widest text-zinc-400"
                      >
                        Selecione o produto
                      </Label>
                      <Select
                        name="productId"
                        value={selectedProductId}
                        onValueChange={handleProductChange}
                        disabled={isOffline || loading || loadingProducts}
                      >
                        <SelectTrigger
                          id="push-product-select"
                          className="h-9 w-full rounded-lg border border-white/10 bg-black/50 px-2.5 text-xs text-white shadow-inner focus:border-emerald-500/50 focus:ring-0 [&>svg]:opacity-50"
                        >
                          <SelectValue
                            placeholder={
                              loadingProducts
                                ? "Carregando..."
                                : "Escolha o produto..."
                            }
                          />
                        </SelectTrigger>
                        <SelectContent className="max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-zinc-950 text-white shadow-2xl">
                          {products.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {destType === "custom" && (
                    <div className="space-y-1 duration-200 animate-in fade-in">
                      <Label
                        htmlFor="push-custom-path"
                        className="text-[9px] font-black uppercase tracking-widest text-zinc-400"
                      >
                        Digite o caminho da página
                      </Label>
                      <LocalBufferedInput
                        id="push-custom-path"
                        name="customPath"
                        autoComplete="off"
                        value={customPath}
                        onFlush={handleCustomPathChange}
                        disabled={isOffline || loading}
                        placeholder="/exemplo-pagina"
                        useShadcn={true}
                        className="h-9 rounded-lg border-white/10 bg-black/50 font-mono text-xs text-white shadow-inner focus:border-emerald-500/50 focus:ring-0 placeholder:text-zinc-600"
                      />
                    </div>
                  )}

                  {destType !== "product" && destType !== "custom" && (
                    <div className="flex items-end">
                      <div className="flex h-9 w-full items-center gap-1.5 rounded-lg border border-white/5 bg-black/20 px-3 text-[10px] font-mono text-zinc-400">
                        <ExternalLink className="size-3 text-emerald-400 shrink-0" />
                        <span className="truncate">
                          Ao clicar abrirá: {notification.url}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Botão de Ação */}
                <button
                  className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 text-xs font-black uppercase tracking-[0.15em] text-white shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all hover:bg-emerald-400 hover:shadow-[0_0_25px_rgba(16,185,129,0.4)] active:scale-[0.98] disabled:opacity-30 disabled:grayscale disabled:shadow-none"
                  onClick={handleSend}
                  disabled={loading || effectiveReach === 0 || isOffline}
                >
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <div className="size-4 animate-spin rounded-full border-2 border-white/25 border-t-white" />
                      <span>Enviando Notificação...</span>
                    </div>
                  ) : (
                    <>
                      <Send className="size-4 fill-current" />
                      Enviar Notificação Agora ({effectiveReach} clientes)
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Dica de Vendas Card */}
            <div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 backdrop-blur-md">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                <Clock className="size-3.5 text-emerald-400" />
              </div>
              <p className="text-[10px] font-medium text-zinc-300 leading-tight">
                <span className="font-bold text-emerald-400 uppercase tracking-wider">
                  Dica de Vendas:
                </span>{" "}
                Enviar mensagens entre{" "}
                <strong className="text-white">10h e 12h</strong> costuma atrair{" "}
                <span className="font-black text-emerald-300">
                  mais clientes e aumentar as vendas
                </span>
                .
              </p>
            </div>
          </div>

          {/* COLUNA LATERAL: Avisos de Vendas, Celulares e Histórico (lg:col-span-5) */}
          <div className="space-y-3.5 lg:col-span-5">
            {/* Avisos de Compras Recentes */}
            {configLoaded && (
              <div
                className={`rounded-xl border p-3.5 transition-all duration-300 ${
                  config.realTimeSalesAlerts
                    ? "border-emerald-500/30 bg-emerald-500/5 shadow-[0_0_15px_rgba(16,185,129,0.08)]"
                    : "border-white/10 bg-zinc-900/60"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`flex size-8 shrink-0 items-center justify-center rounded-lg border transition-all duration-300 ${
                        config.realTimeSalesAlerts
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                          : "border-white/5 bg-zinc-950 text-zinc-500"
                      }`}
                    >
                      <Sparkles className="size-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <Label
                          htmlFor="realtime-sales-alerts-switch"
                          className="cursor-pointer text-xs font-bold text-white"
                        >
                          Avisos de Compras Recentes
                        </Label>
                        <span
                          className={`size-1.5 rounded-full ${
                            config.realTimeSalesAlerts
                              ? "bg-emerald-500 animate-pulse"
                              : "bg-zinc-600"
                          }`}
                        />
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-[10px] text-zinc-400 leading-none">
                          Mostra na loja avisos de compras em tempo real.
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            setIsSocialProofExpanded(!isSocialProofExpanded)
                          }
                          className="flex items-center text-[10px] font-bold text-emerald-400 hover:text-emerald-300 leading-none"
                        >
                          {isSocialProofExpanded ? (
                            <ChevronUp className="size-3" />
                          ) : (
                            <ChevronDown className="size-3" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                  <Switch
                    id="realtime-sales-alerts-switch"
                    checked={config.realTimeSalesAlerts}
                    onCheckedChange={handleToggleRealTimeSalesAlerts}
                    className="scale-90 data-[state=checked]:bg-emerald-500"
                    disabled={isOffline || isUpdatingConfig}
                  />
                </div>

                <AnimatePresence initial={false}>
                  {isSocialProofExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2.5 pt-2.5 border-t border-white/5 text-[10px] leading-relaxed text-zinc-400 space-y-1">
                        <p>
                          Esta opção exibe pequenas notificações discretas na
                          loja quando alguém faz um pedido, passando mais
                          segurança e confiança aos novos clientes.
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Metric Card - Celulares Cadastrados */}
            <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3.5 shadow-lg backdrop-blur-xl">
              <div className="flex items-center justify-between mb-2">
                <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-400">
                  <Users className="size-3.5 text-emerald-400" /> Clientes
                  Prontos para Receber
                </p>
                <span className="text-[9px] font-mono text-emerald-400 font-bold uppercase">
                  Ativos
                </span>
              </div>

              <div className="flex items-baseline justify-between border-b border-white/5 pb-2.5">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-3xl font-black tabular-nums tracking-tight text-white">
                    {subCount}
                  </h2>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                    Celulares e Computadores Cadastrados
                  </span>
                </div>

                <div className="flex items-center gap-1.5 text-[9px] font-mono text-zinc-400">
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5">
                    iOS: {Math.floor(subCount * 0.4)}
                  </span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5">
                    Android: {Math.ceil(subCount * 0.6)}
                  </span>
                </div>
              </div>

              {isSupported && !isTestSubscribed && (
                <button
                  onClick={handleTestSubscription}
                  disabled={isOffline}
                  className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-1.5 text-[9px] font-black uppercase tracking-wider text-emerald-400 hover:bg-emerald-500/20 active:scale-95 disabled:opacity-40"
                >
                  <Zap className="size-3 fill-emerald-400" />
                  Testar Recebimento Neste Aparelho
                </button>
              )}
            </div>

            {/* Log de Envios */}
            <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3.5 shadow-lg backdrop-blur-xl">
              <div className="mb-2.5 flex items-center justify-between border-b border-white/5 pb-2">
                <div className="flex items-center gap-1.5">
                  <History className="size-3.5 text-zinc-400" />
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
                    Histórico de Mensagens Enviadas
                  </h3>
                </div>
                <span className="text-[8px] font-mono text-zinc-500">
                  Últimas 20 mensagens
                </span>
              </div>

              <div className="max-h-[350px] overflow-y-auto pr-1 space-y-2 scrollbar-thin scrollbar-thumb-zinc-700">
                {history.length === 0 ? (
                  <div className="py-6 text-center italic text-zinc-600">
                    <p className="text-[9px] font-bold uppercase tracking-widest">
                      Nenhuma mensagem enviada até o momento
                    </p>
                  </div>
                ) : (
                  history.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-white/5 bg-black/30 p-2.5 transition-all hover:border-white/10 hover:bg-black/50"
                    >
                      <div className="flex items-center justify-between text-[8px] font-bold uppercase tracking-widest text-zinc-400 mb-1">
                        <span className="text-emerald-400 font-mono">
                          {new Date(item.sent_at).toLocaleDateString()} às{" "}
                          {new Date(item.sent_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className="flex items-center gap-1 bg-zinc-800/80 px-1.5 py-0.5 rounded text-zinc-300">
                          <Users className="size-2.5 text-emerald-400" />{" "}
                          {item.recipient_count} clientes
                        </span>
                      </div>
                      <h4 className="text-[10px] font-bold text-white line-clamp-1">
                        {item.title}
                      </h4>
                      <p className="text-[9px] text-zinc-400 line-clamp-1 mt-0.5 font-medium">
                        {item.body}
                      </p>
                      <div className="mt-1.5 flex items-center justify-between border-t border-white/5 pt-1 text-[8px]">
                        <span className="font-mono text-zinc-500 truncate max-w-[150px]">
                          Ao clicar: {item.url}
                        </span>
                        <span className="text-emerald-400 font-bold uppercase">
                          Enviada
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Ajuda Limpo */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Ajuda - Notificações para Clientes"
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-zinc-400">
            Nesta tela você pode criar e enviar mensagens curtas direto para os
            celulares dos clientes que aceitaram receber avisos da sua loja.
          </p>

          <div className="space-y-3">
            <h4 className="border-l-2 border-emerald-500 pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              O que você pode fazer aqui
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-xl border border-white/5 bg-zinc-900/40 p-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Send className="size-3.5 text-emerald-500" />
                  Enviar Notificação
                </div>
                <p className="text-xs text-zinc-400">
                  Escreva o título, a mensagem e escolha qual tela abre quando o
                  cliente clica.
                </p>
              </div>

              <div className="space-y-1 rounded-xl border border-white/5 bg-zinc-900/40 p-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Sparkles className="size-3.5 text-emerald-400" />
                  Mensagens Prontas
                </div>
                <p className="text-xs text-zinc-400">
                  Escolha exemplos prontos para preencher o texto rapidamente
                  com apenas 1 clique.
                </p>
              </div>

              <div className="space-y-1 rounded-xl border border-white/5 bg-zinc-900/40 p-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Users className="size-3.5 text-sky-500" />
                  Quem Vai Receber
                </div>
                <p className="text-xs text-zinc-400">
                  Escolha enviar para todos os clientes ou para grupos (ex:
                  clientes novos ou sem comprar há 30 dias).
                </p>
              </div>

              <div className="space-y-1 rounded-xl border border-white/5 bg-zinc-900/40 p-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <History className="size-3.5 text-purple-500" />
                  Histórico de Envios
                </div>
                <p className="text-xs text-zinc-400">
                  Veja a lista das últimas mensagens que você enviou e quantas
                  pessoas receberam.
                </p>
              </div>
            </div>
          </div>
        </div>
      </AdminHelpModal>
    </div>
  );
});
