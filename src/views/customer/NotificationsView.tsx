import { Button } from "@/components/ui/button";
import { useNotificationCenter } from "@/contexts/NotificationContextCore";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  Check,
  CheckCheck,
  ChevronRight,
  Percent,
  Sparkles,
  Truck,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

interface NotificationsViewProps {
  readonly onNavigate?: (view: any, id?: string) => void;
}

type TabType = "todas" | "avisos";

export function NotificationsView({ onNavigate }: NotificationsViewProps) {
  const { notifications, markAllAsRead, deleteNotification, markAsRead } =
    useNotificationCenter();

  const [activeTab, setActiveTab] = useState<TabType>("todas");

  // Format date/time to be user friendly
  const formatNotificationTime = useCallback((dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffTime = Math.abs(now.getTime() - date.getTime());
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        return `Hoje às ${date.toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        })}`;
      }
      if (diffDays === 1) {
        return `Ontem às ${date.toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        })}`;
      }
      return date.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }, []);

  // Parse action_url or order_id and navigate
  const handleNotificationClick = useCallback(
    async (notif: any) => {
      if (!notif.read) {
        await markAsRead(notif.id);
      }

      if (notif.order_id) {
        onNavigate?.("order-details", notif.order_id);
        return;
      }

      if (notif.action_url) {
        const url = notif.action_url;
        try {
          const parsedUrl = new URL(url, window.location.origin);
          const pathname = parsedUrl.pathname;
          const searchParams = parsedUrl.searchParams;
          const cleanPath = pathname.replace(/^\/+|\/+$/g, "");

          if (cleanPath === "product-detail" || cleanPath === "product") {
            const id = searchParams.get("id");
            if (id) {
              onNavigate?.("product-detail", id);
              return;
            }
          }

          if (cleanPath === "order-details" || cleanPath === "order") {
            const id = searchParams.get("id");
            if (id) {
              onNavigate?.("order-details", id);
              return;
            }
          }

          const knownViews = [
            "home",
            "cart",
            "product-detail",
            "checkout",
            "profile",
            "user-profile",
            "search",
            "auth",
            "login",
            "favorites",
            "notifications",
            "order-success",
            "orders",
            "order-details",
            "account-settings",
          ];

          if (knownViews.includes(cleanPath)) {
            onNavigate?.(cleanPath as any, searchParams.get("id") || undefined);
          } else {
            onNavigate?.("home");
          }
        } catch {
          if (url.includes("cart")) onNavigate?.("cart");
          else if (url.includes("favorites")) onNavigate?.("favorites");
          else if (url.includes("profile")) onNavigate?.("profile");
          else if (url.includes("checkout")) onNavigate?.("checkout");
          else onNavigate?.("home");
        }
      }
    },
    [markAsRead, onNavigate],
  );

  // Grouping counts for each tab (unread count)
  const counts = useMemo(() => {
    const unread = notifications.filter((n) => !n.read);
    return {
      todas: unread.length,
      avisos: unread.filter(
        (n) =>
          n.type === "system" || n.type === "aviso" || n.type === "sucesso",
      ).length,
    };
  }, [notifications]);

  // Filtered notifications based on active tab
  const filteredNotifications = useMemo(() => {
    switch (activeTab) {
      case "avisos":
        return notifications.filter(
          (n) =>
            n.type === "system" || n.type === "aviso" || n.type === "sucesso",
        );
      default:
        return notifications;
    }
  }, [notifications, activeTab]);

  // Type styling details
  const getTypeConfig = useCallback((type: string) => {
    switch (type) {
      case "order":
      case "delivery":
        return {
          icon: Truck,
          bgClass:
            "bg-gradient-to-br from-blue-500 to-indigo-600 shadow-blue-100 dark:shadow-none text-white",
          borderClass: "border-blue-100 dark:border-blue-950/40",
          cardBg: "bg-blue-50/10 dark:bg-blue-950/5",
          dotColor: "bg-blue-500",
          accentColor: "text-indigo-600 dark:text-indigo-400",
          actionText: "Acompanhar Pedido",
        };
      case "promotion":
        return {
          icon: Percent,
          bgClass:
            "bg-gradient-to-br from-amber-400 to-orange-500 shadow-amber-100 dark:shadow-none text-white",
          borderClass: "border-amber-100 dark:border-amber-950/40",
          cardBg: "bg-amber-50/10 dark:bg-amber-950/5",
          dotColor: "bg-amber-500",
          accentColor: "text-amber-600 dark:text-amber-400",
          actionText: "Aproveitar Cupom",
        };
      case "sucesso":
        return {
          icon: Sparkles,
          bgClass:
            "bg-gradient-to-br from-emerald-400 to-teal-500 shadow-emerald-100 dark:shadow-none text-white",
          borderClass: "border-emerald-100 dark:border-emerald-950/40",
          cardBg: "bg-emerald-50/10 dark:bg-emerald-950/5",
          dotColor: "bg-emerald-500",
          accentColor: "text-emerald-600 dark:text-emerald-400",
          actionText: "Ver Detalhes",
        };
      default:
        return {
          icon: Bell,
          bgClass: "bg-gradient-to-br from-zinc-400 to-zinc-600 text-white",
          borderClass: "border-zinc-100 dark:border-zinc-800/40",
          cardBg: "bg-zinc-50/50 dark:bg-zinc-900/10",
          dotColor: "bg-zinc-500",
          accentColor: "text-zinc-600 dark:text-zinc-400",
          actionText: "Ver Detalhes",
        };
    }
  }, []);

  const emptyStateConfig = useMemo(() => {
    switch (activeTab) {
      case "avisos":
        return {
          title: "Sem avisos ou comunicados",
          desc: "Qualquer informativo importante da plataforma ou alertas de segurança serão listados aqui.",
        };
      default:
        return {
          title: "Sua caixa está limpa!",
          // A frase antiga prometia "promoções, cupons e atualizações dos seus
          // pedidos" -- as MESMAS três coisas que as abas removidas prometiam e
          // que o banco proíbe: o CHECK de `notificacoes` não aceita esses tipos,
          // e o único escritor do produto grava sempre "aviso". Este é o estado
          // vazio da aba PADRÃO, então era a primeira frase que toda cliente nova
          // lia -- mais visível que as abas que saíram.
          desc: "Tudo em ordem. Quando a loja enviar um aviso ou comunicado, ele aparece aqui.",
        };
    }
  }, [activeTab]);

  const hasUnreadNotifications = useMemo(
    () => notifications.some((n) => !n.read),
    [notifications],
  );

  return (
    <div className="pb-customer flex min-h-full flex-col bg-zinc-50/40 dark:bg-zinc-950/40">
      {/* Sticky Header & Filters */}
      <div className="sticky top-[-2px] z-50 border-b border-zinc-100 bg-white/80 px-4 py-3 backdrop-blur-xl dark:border-zinc-900/60 dark:bg-zinc-950/80">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <h1 className="text-lg font-black leading-tight text-zinc-900 dark:text-zinc-100">
              Notificações
            </h1>
            {counts.todas > 0 && (
              <p className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500">
                Você tem {counts.todas} não{" "}
                {counts.todas === 1 ? "lida" : "lidas"}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1">
            {hasUnreadNotifications && (
              <Button
                variant="ghost"
                size="sm"
                onClick={markAllAsRead}
                className="flex h-8 items-center gap-1 rounded-xl px-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                title="Marcar todas como lidas"
              >
                <CheckCheck className="size-4" />
                <span className="hidden xs:inline">Lidas</span>
              </Button>
            )}
          </div>
        </div>

        {/* Categories Bar */}
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto pb-1">
          {(
            [
              { id: "todas", label: "Todas" },
              { id: "avisos", label: "Avisos" },
            ] as const
          ).map((tab) => {
            const isActive = activeTab === tab.id;
            const tabUnread = counts[tab.id];

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex shrink-0 items-center rounded-full px-3.5 py-1.5 text-xs font-bold transition-all ${
                  isActive
                    ? "bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {tab.label}
                {tabUnread > 0 && (
                  <span
                    className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-black leading-none ${
                      isActive
                        ? "bg-amber-500 text-white dark:bg-amber-500"
                        : "bg-amber-500 text-white"
                    }`}
                  >
                    {tabUnread}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main List */}
      <div className="flex flex-1 flex-col px-4 pt-4">
        {filteredNotifications.length > 0 ? (
          <motion.div layout className="space-y-3">
            <AnimatePresence mode="popLayout">
              {filteredNotifications.map((notif: any) => {
                const config = getTypeConfig(notif.type);
                const Icon = config.icon;
                const showAction = notif.action_url || notif.order_id;

                return (
                  <motion.div
                    key={notif.id}
                    layout
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    onClick={() => handleNotificationClick(notif)}
                    className={`group relative cursor-pointer rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-zinc-200 hover:shadow-md dark:border-zinc-900/60 dark:bg-zinc-900/50 dark:hover:border-zinc-800 ${
                      !notif.read ? `${config.cardBg} border-l-2` : ""
                    }`}
                    style={{
                      borderLeftColor: !notif.read
                        ? "var(--admin-gold, #f59e0b)"
                        : undefined,
                    }}
                  >
                    {/* Pulsing indicator for unread */}
                    {!notif.read && (
                      <div className="absolute right-4 top-4 flex items-center gap-1.5">
                        <span className="relative flex size-2">
                          <span
                            className={`absolute inline-flex size-full animate-ping rounded-full opacity-75 ${config.dotColor}`}
                          />
                          <span
                            className={`relative inline-flex size-2 rounded-full ${config.dotColor}`}
                          />
                        </span>
                      </div>
                    )}

                    <div className="flex gap-4">
                      {/* Left Gradient Icon */}
                      <div
                        className={`flex size-11 shrink-0 items-center justify-center rounded-2xl shadow-sm ${config.bgClass}`}
                      >
                        <Icon className="size-5" />
                      </div>

                      {/* Content Area */}
                      <div className="flex-1 space-y-1 pr-4">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold leading-tight text-zinc-900 dark:text-zinc-100">
                            {notif.title}
                          </h4>
                        </div>
                        <p className="text-xs font-medium leading-relaxed text-zinc-500 dark:text-zinc-400">
                          {notif.message}
                        </p>
                        <div className="flex items-center gap-2 pt-1">
                          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-300 dark:text-zinc-600">
                            {formatNotificationTime(notif.created_at)}
                          </span>
                        </div>

                        {/* Interactive Link CTA */}
                        {showAction && (
                          <div className="flex justify-start pt-2">
                            <span
                              className={`inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider ${config.accentColor} group-hover:underline`}
                            >
                              {config.actionText}
                              <ChevronRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Dismiss Action */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteNotification(notif.id);
                        }}
                        className="absolute bottom-3 right-3 rounded-lg p-1.5 text-zinc-400 opacity-0 transition-all hover:bg-zinc-100 hover:text-zinc-600 group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 xs:relative xs:bottom-0 xs:right-0 xs:self-start"
                        title="Excluir notificação"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        ) : (
          /* Premium Empty State */
          <div className="flex h-full flex-col items-center justify-center px-6 py-20 text-center">
            <div className="relative mb-6 flex size-20 items-center justify-center rounded-3xl bg-zinc-100 shadow-inner dark:bg-zinc-900">
              <motion.div
                animate={{
                  rotate: [0, -8, 8, -6, 6, 0],
                }}
                transition={{
                  repeat: Number.POSITIVE_INFINITY,
                  duration: 2.2,
                  repeatDelay: 1.5,
                  ease: "easeInOut",
                }}
              >
                <Bell className="size-9 text-zinc-400 dark:text-zinc-500" />
              </motion.div>
              <div className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full bg-emerald-500 text-white shadow-md">
                <Check className="size-3.5 stroke-[3]" />
              </div>
            </div>
            <h2 className="mb-2 text-base font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-200">
              {emptyStateConfig.title}
            </h2>
            <p className="mb-8 max-w-xs text-xs font-semibold leading-relaxed text-zinc-400 dark:text-zinc-500">
              {emptyStateConfig.desc}
            </p>

            <Button
              onClick={() => onNavigate?.("home")}
              className="rounded-2xl bg-zinc-900 px-6 py-4 text-xs font-bold text-white shadow-md transition-all hover:bg-zinc-800 hover:shadow-lg dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Explorar Ofertas
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
