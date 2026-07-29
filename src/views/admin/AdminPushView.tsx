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
import { useAuth } from "@/hooks/useAuth";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useVOR } from "@/hooks/useVOR";
import { supabase } from "@/lib/supabase";
import type { View } from "@/types";
import {
  AlertCircle,
  HelpCircle,
  History,
  Info,
  Send,
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
          .from("produtos")
          .select("id, nome")
          .eq("ativo", true)
          .order("nome", { ascending: true });
        if (!error && data) {
          setProducts(data);
          if (data.length > 0) {
            setSelectedProductId(data[0].id);
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
    } else if (url.startsWith("/product-detail?id=")) {
      if (destType !== "product") setDestType("product");
      const id = url.split("?id=")[1] || "";
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
      // ZENITH v21.7: Rely on AuthContext's verified user
      if (!user) throw new Error("Administrador não autenticado");

      // 1. Fetch real targets based on segment
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

      // 2. Save to logs
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

      // 2.5. Save in-app notifications
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

      // 3. Call Edge Function to send real push notifications
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

  return (
    <div className="h-auto bg-[#09090b] pb-8 text-white duration-200 animate-in fade-in selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Header Executivo */}
      <div className="p-4 border-b border-white/5">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-lg font-black tracking-tight text-white">
                <span>Push Center</span>
                <button
                  type="button"
                  onClick={() => setShowHelpModal(true)}
                  className="flex size-6 shrink-0 items-center justify-center rounded-full border border-white/5 bg-zinc-900/60 text-zinc-500 transition-all duration-300 hover:border-white/10 hover:text-white active:scale-95"
                  title="Guia do Push Center e Ajuda"
                >
                  <HelpCircle className="size-3" />
                </button>
                <Target className="size-3.5 animate-pulse text-emerald-500" />
              </h1>
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                Centro de Comando de Engajamento
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl p-4">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-5">
          {/* Coluna Principal: Modelos e Formulário (3 Colunas no md) */}
          <div className="space-y-5 md:col-span-3">
            {/* Modelos de Campanha Card */}
            <div className="admin-glass rounded-2xl border border-white/5 bg-zinc-900/40 p-5 shadow-xl backdrop-blur-2xl">
              <div className="mb-4 flex items-center gap-2">
                <Sparkles className="size-4 text-emerald-400" />
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-white">
                    Modelos de Campanha
                  </h3>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                    Selecione um modelo para preencher a cópia
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                {[
                  {
                    id: "fomo",
                    title: "Promoção Relâmpago",
                    desc: "Gera urgência com tempo limitado.",
                    icon: Zap,
                  },
                  {
                    id: "auth",
                    title: "Carrinho Abandonado",
                    desc: "Recupera clientes inativos.",
                    icon: Info,
                  },
                  {
                    id: "value",
                    title: "Cupom de Desconto",
                    desc: "Oferece vantagens exclusivas.",
                    icon: Target,
                  },
                ].map((arch) => (
                  <button
                    key={arch.id}
                    className="group/arch flex flex-col justify-between rounded-xl border border-white/5 bg-white/5 p-3.5 text-left transition-all hover:bg-white/10 active:scale-95"
                    onClick={() => {
                      if (arch.id === "fomo") {
                        setNotification({
                          title: "Cupom Relâmpago: 10% OFF ativo por 1h! ⚡",
                          body: "Aproveite o desconto exclusivo nos produtos da sua lista de desejos. Garanta o seu antes que acabe!",
                          url: "/search",
                        });
                      } else if (arch.id === "auth") {
                        setNotification({
                          title: "Seu carrinho está te esperando! 🛒",
                          body: "Finalize sua compra agora e garanta frete grátis para Monte Carmelo. Não perca!",
                          url: "/cart",
                        });
                      } else {
                        setNotification({
                          title: "Presente para você: Cupom de R$20! 🎁",
                          body: "Use o cupom BEMVINDO e garanta um desconto especial na sua próxima compra no marketplace.",
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

                      toast.success(`Modelo "${arch.title}" Carregado!`);
                    }}
                  >
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <arch.icon className="size-3.5 text-emerald-400" />
                      <h4 className="text-[10px] font-black uppercase tracking-wider text-white">
                        {arch.title}
                      </h4>
                    </div>
                    <p className="text-[9px] font-medium leading-tight text-zinc-500">
                      {arch.desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Formulário de Envio */}
            <div className="admin-glass rounded-2xl border border-white/5 bg-zinc-900/40 p-5 shadow-xl backdrop-blur-2xl">
              <div className="mb-4 flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-xl border border-white/5 bg-zinc-950 text-white">
                  <Send className="size-4 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-white">
                    Redigir Campanha
                  </h3>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                    Disparo imediato segmentado
                  </p>
                </div>
              </div>

              {isOffline && (
                <div className="mb-4 flex items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-rose-400 animate-in fade-in slide-in-from-top-2">
                  <AlertCircle className="size-4 shrink-0" />
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-wider">
                      Modo Offline Ativo
                    </p>
                    <p className="mt-0.5 text-[9px] font-medium text-zinc-500">
                      Disparos de notificação desativados temporariamente.
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <div className="space-y-2">
                  <span className="ml-1 text-[9px] font-black uppercase tracking-widest text-zinc-400">
                    Segmentação do Público
                  </span>
                  {targetUserId ? (
                    <div className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                      <div>
                        <p className="text-[9px] font-black uppercase leading-none tracking-widest text-emerald-400">
                          Envio Direcionado
                        </p>
                        <p className="mt-1 text-xs font-bold leading-none text-white">
                          Cliente: {targetUserName || "Carregando..."}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          onNavigate("admin-push");
                        }}
                        disabled={isOffline}
                        className="rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-white shadow-sm transition-all hover:bg-zinc-800 active:scale-95 disabled:opacity-40"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { id: "all", label: "Todos" },
                        { id: "vip", label: "Clientes VIP" },
                        { id: "inactive", label: "Inativos (30d)" },
                        { id: "new", label: "Novos" },
                      ].map((s) => (
                        <button
                          key={s.id}
                          onClick={() => !isOffline && setSegment(s.id)}
                          disabled={isOffline}
                          className={`h-9 rounded-lg border text-[9px] font-black uppercase tracking-widest transition-all ${
                            segment === s.id
                              ? "border-white bg-white text-black shadow-md shadow-white/10"
                              : "border-white/5 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
                          } disabled:pointer-events-none disabled:opacity-30`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="ml-1 text-[9px] font-bold uppercase tracking-widest text-emerald-400">
                    Alcance Estimado:{" "}
                    {segment === "all" ? subCount : predictedReach} dispositivos
                  </p>
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="push-title"
                    className="ml-1 text-[9px] font-black uppercase tracking-widest text-zinc-400"
                  >
                    Título da Notificação
                  </Label>
                  <LocalBufferedInput
                    id="push-title"
                    name="title"
                    value={notification.title}
                    onFlush={(val) =>
                      setNotification((prev) => ({ ...prev, title: val }))
                    }
                    disabled={isOffline || loading}
                    placeholder={
                      isOffline
                        ? "Indisponível offline"
                        : "Ex: Oferta Especial Ativada! 🎁"
                    }
                    useShadcn={true}
                    className="h-11 rounded-xl border-white/10 bg-black/40 text-sm text-white shadow-inner transition-all placeholder:text-zinc-700 focus:border-admin-gold/50 focus:bg-black/60 focus:ring-0 focus:ring-offset-0 disabled:opacity-40"
                  />
                  <Label
                    htmlFor="push-body"
                    className="ml-1 text-[9px] font-black uppercase tracking-widest text-zinc-400"
                  >
                    Mensagem da Notificação
                  </Label>
                  <LocalBufferedTextarea
                    id="push-body"
                    name="body"
                    value={notification.body}
                    onFlush={(val) =>
                      setNotification((prev) => ({ ...prev, body: val }))
                    }
                    disabled={isOffline || loading}
                    placeholder={
                      isOffline
                        ? "Indisponível offline"
                        : "Digite o texto da notificação..."
                    }
                    rows={3}
                    useShadcn={true}
                    className="resize-none rounded-xl border-white/10 bg-black/40 p-3.5 text-xs font-medium text-white shadow-inner transition-all placeholder:text-zinc-700 focus:border-admin-gold/50 focus:bg-black/60 focus:ring-0 focus:ring-offset-0 disabled:opacity-40"
                  />
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="push-destination"
                    className="ml-1 text-[9px] font-black uppercase tracking-widest text-zinc-400"
                  >
                    Tela de Destino (Redirecionamento)
                  </Label>
                  <Select
                    value={destType}
                    onValueChange={handleDestTypeChange}
                    disabled={isOffline || loading}
                  >
                    <SelectTrigger
                      id="push-destination"
                      className="h-11 w-full rounded-xl border border-white/10 bg-black/40 px-3.5 text-xs text-white shadow-inner transition-all focus:border-admin-gold/50 focus:bg-black/60 focus:ring-0 focus:ring-offset-0 disabled:opacity-40 [&>svg]:opacity-50"
                    >
                      <SelectValue placeholder="Selecione a tela de destino" />
                    </SelectTrigger>
                    <SelectContent className="border border-white/10 bg-zinc-950 text-white rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.8)]">
                      <SelectItem value="home">
                        Página Inicial (Home)
                      </SelectItem>
                      <SelectItem value="search">Tela de Busca</SelectItem>
                      <SelectItem value="cart">Carrinho de Compras</SelectItem>
                      <SelectItem value="favorites">
                        Lista de Desejos (Favoritos)
                      </SelectItem>
                      <SelectItem value="orders">Meus Pedidos</SelectItem>
                      <SelectItem value="profile">Perfil do Usuário</SelectItem>
                      <SelectItem value="product">
                        Produto Específico
                      </SelectItem>
                      <SelectItem value="custom">
                        Caminho Manual (Avançado)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {destType === "product" && (
                  <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                    <Label
                      htmlFor="push-product-select"
                      className="ml-1 text-[9px] font-black uppercase tracking-widest text-zinc-400"
                    >
                      Selecionar Produto para Divulgar
                    </Label>
                    <Select
                      value={selectedProductId}
                      onValueChange={handleProductChange}
                      disabled={isOffline || loading || loadingProducts}
                    >
                      <SelectTrigger
                        id="push-product-select"
                        className="h-11 w-full rounded-xl border border-white/10 bg-black/40 px-3.5 text-xs text-white shadow-inner transition-all focus:border-admin-gold/50 focus:bg-black/60 focus:ring-0 focus:ring-offset-0 disabled:opacity-40 [&>svg]:opacity-50"
                      >
                        <SelectValue
                          placeholder={
                            loadingProducts
                              ? "Carregando produtos..."
                              : "Selecione um produto"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent className="max-h-60 border border-white/10 bg-zinc-950 text-white rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.8)] overflow-y-auto">
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.nome}
                          </SelectItem>
                        ))}
                        {products.length === 0 && !loadingProducts && (
                          <div className="p-2 text-center text-xs text-zinc-500">
                            Nenhum produto ativo encontrado
                          </div>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {destType === "custom" && (
                  <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                    <Label
                      htmlFor="push-custom-path"
                      className="ml-1 text-[9px] font-black uppercase tracking-widest text-zinc-400"
                    >
                      Caminho Manual (Ex: /search?q=promo)
                    </Label>
                    <LocalBufferedInput
                      id="push-custom-path"
                      name="customPath"
                      value={customPath}
                      onFlush={handleCustomPathChange}
                      disabled={isOffline || loading}
                      placeholder="/caminho-da-pagina"
                      useShadcn={true}
                      className="h-11 rounded-xl border-white/10 bg-black/40 font-mono text-xs text-white shadow-inner transition-all placeholder:text-zinc-700 focus:border-admin-gold/50 focus:bg-black/60 focus:ring-0 focus:ring-offset-0 disabled:opacity-40"
                    />
                  </div>
                )}

                <button
                  className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-xs font-black uppercase tracking-[0.2em] text-white shadow-md transition-all hover:bg-emerald-400 active:scale-95 disabled:opacity-30 disabled:grayscale disabled:active:scale-100"
                  onClick={handleSend}
                  disabled={loading || subCount === 0 || isOffline}
                >
                  {loading ? (
                    <div className="size-4 animate-spin rounded-full border-2 border-white/25 border-t-white" />
                  ) : (
                    <>
                      <Zap className="size-4 fill-current" />
                      Lançar Notificação
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Conversão Tip Card */}
            <div className="flex gap-3 rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-4 backdrop-blur-md">
              <div className="flex size-9 flex-shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10">
                <Info className="size-5 text-emerald-400" />
              </div>
              <div className="space-y-0.5">
                <h4 className="text-[9px] font-black uppercase tracking-wider text-emerald-400">
                  Diretriz de Conversão
                </h4>
                <p className="text-[10px] font-bold uppercase italic leading-relaxed tracking-tight text-zinc-400">
                  Notificações entre 10h e 12h têm{" "}
                  <span className="font-black text-white">
                    40% mais cliques
                  </span>
                  .
                </p>
              </div>
            </div>
          </div>

          {/* Coluna Lateral: Alcance e Histórico (2 Colunas no md) */}
          <div className="space-y-5 md:col-span-2">
            {/* Alcance Card (Stats) */}
            <div className="admin-glass rounded-2xl border border-white/5 bg-zinc-900/40 p-5 shadow-xl backdrop-blur-2xl">
              <p className="mb-1.5 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-500">
                <Users className="size-3.5 text-emerald-400" /> Alcance
                Instantâneo
              </p>
              <div className="flex items-baseline gap-2">
                <h2 className="text-4xl font-black tabular-nums tracking-tight text-white">
                  {subCount}
                </h2>
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                  Dispositivos
                </span>
              </div>

              <div className="mt-4 flex gap-2 border-t border-white/5 pt-3.5">
                <div className="flex-1 rounded-lg border border-white/5 bg-zinc-950/60 px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider text-zinc-400 text-center">
                  iOS: {Math.floor(subCount * 0.4)}
                </div>
                <div className="flex-1 rounded-lg border border-white/5 bg-zinc-950/60 px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider text-zinc-400 text-center">
                  Android: {Math.ceil(subCount * 0.6)}
                </div>
              </div>

              {isSupported && !isTestSubscribed && (
                <button
                  onClick={handleTestSubscription}
                  disabled={isOffline}
                  className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 py-2.5 text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                >
                  <Zap className="size-3 fill-emerald-400" />
                  Monitorar este Dispositivo
                </button>
              )}
            </div>

            {/* Histórico/Log Card */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 px-2">
                <History className="size-4 text-zinc-500" />
                <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                  Log de Campanhas
                </h3>
              </div>

              <div className="relative space-y-3 before:absolute before:bottom-0 before:left-3 before:top-2 before:w-px before:bg-white/5">
                {history.length === 0 ? (
                  <div className="py-8 text-center italic opacity-30">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                      Sem histórico
                    </p>
                  </div>
                ) : (
                  history.map((item) => (
                    <div key={item.id} className="group relative pl-8">
                      <div className="absolute left-1 top-3.5 z-10 size-2.5 rounded-full border-2 border-zinc-800 bg-zinc-950 shadow-md transition-transform group-hover:scale-125" />
                      <div className="cursor-default rounded-xl border border-white/5 bg-zinc-900/40 p-4 backdrop-blur-md transition-all hover:border-white/10 hover:bg-white/[0.05] hover:shadow-lg">
                        <div className="mb-2 flex items-start justify-between">
                          <span className="text-[8px] font-black uppercase tracking-widest text-emerald-400/70">
                            {new Date(item.sent_at).toLocaleDateString()} •{" "}
                            {new Date(item.sent_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <h4 className="mb-2 line-clamp-2 text-[10px] font-black uppercase tracking-wider text-white">
                          {item.title}
                        </h4>
                        <div className="flex items-center justify-between text-[8px] font-bold uppercase tracking-widest text-zinc-500 border-t border-white/5 pt-2">
                          <span className="flex items-center gap-1 text-zinc-400">
                            <Users className="size-3" /> {item.recipient_count}
                          </span>
                          <span className="text-zinc-700">|</span>
                          <span className="max-w-[120px] truncate text-zinc-400 font-mono">
                            {item.url}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Ajuda */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Push Center & Engajamento"
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-zinc-400">
            O Push Center é o centro de comando de engajamento do marketplace.
            Aqui você pode disparar notificações em massa para todos os usuários
            inscritos no sistema de notificações Web Push.
          </p>

          <div className="space-y-3">
            <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Seções Principais
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Target className="size-3.5 text-emerald-500" />
                  Disparo de Campanhas
                </div>
                <p className="text-xs text-zinc-400">
                  Configure o título da notificação, a mensagem (corpo) e uma
                  URL interna ou externa. Os usuários que clicarem na
                  notificação serão direcionados para esse link.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Sparkles className="size-3.5 text-emerald-400" />
                  Modelos de Campanha
                </div>
                <p className="text-xs text-zinc-400">
                  Modelos pré-definidos para preencher as copys promocionais de
                  forma rápida e com gatilhos de vendas comprovados.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Users className="size-3.5 text-sky-500" />
                  Usuários Inscritos
                </div>
                <p className="text-xs text-zinc-400">
                  Exibe a quantidade total de dispositivos aptos a receber as
                  notificações disparadas.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <History className="size-3.5 text-purple-500" />
                  Log de Campanhas
                </div>
                <p className="text-xs text-zinc-400">
                  O histórico completo das notificações enviadas no passado,
                  incluindo data, quantidade de destinatários e link de
                  redirecionamento.
                </p>
              </div>
            </div>
          </div>
        </div>
      </AdminHelpModal>
    </div>
  );
});
