import { Button } from "@/components/ui/button";
import { useNotificationCenter } from "@/contexts/NotificationContextCore";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  BellOff,
  CheckCheck,
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

// Os tipos que o banco grava de fato: a campanha do painel grava "aviso";
// as respostas da loja e os avisos de pedido (trigger do status) gravam
// "info" (em preparo, a caminho), "success" (entregue) e "warning"
// (cancelado); o trigger do pagamento grava "pagamento" (confirmado).
// Todos eles são "avisos" da aba Avisos.
const TIPOS_DA_ABA_AVISOS = new Set([
  "system",
  "aviso",
  "sucesso",
  "info",
  "success",
  "warning",
  "pagamento",
]);

/**
 * Laudo 02/09 #9 (onda 2): a decisão de destino a partir de `action_url` é
 * pura e virou função própria — o clique precisa navegar ANTES de qualquer
 * espera (o `await markAsRead` antigo congelava o toque sob rede lenta).
 */
export function navegarPorUrl(
  url: string,
  onNavigate?: (view: any, id?: string) => void,
) {
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

    // Formato antigo de link de produto, ainda aceito pelo painel
    // (`destinoDaUrl`): o id vem no CAMINHO, `/product/<id>`. Sem id
    // (`/product/`) o caminho vira "product" e segue o fluxo normal.
    if (cleanPath.startsWith("product/")) {
      const idNoCaminho = cleanPath.slice("product/".length).split("/")[0];
      if (idNoCaminho) {
        onNavigate?.("product-detail", idNoCaminho);
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

export function NotificationsView({ onNavigate }: NotificationsViewProps) {
  const {
    notifications,
    loading,
    erro,
    refresh,
    markAllAsRead,
    deleteNotification,
    markAsRead,
    semConta,
  } = useNotificationCenter();

  const [activeTab, setActiveTab] = useState<TabType>("todas");
  // Visitante sem conta nunca receberá aviso de pedido: a caixa vazia dele
  // não pode dizer "tudo em ordem".
  const visitante = semConta === true;

  // Format date/time to be user friendly
  const formatNotificationTime = useCallback((dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      // "Hoje" e "Ontem" são dias de CALENDÁRIO, não janelas de 24h: aviso
      // criado às 23:50 de ontem e lido às 00:10 de hoje é de ONTEM, mas a
      // diferença em milissegundos dá 0 dia e o floor dizia "Hoje às 23:50".
      // Comparar início do dia resolve; e sem o Math.abs, created_at no
      // futuro (clock skew) cai no formato completo em vez de "Hoje".
      const inicioDoDia = (d: Date) =>
        new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const diffDays = Math.round(
        (inicioDoDia(now) - inicioDoDia(date)) / (1000 * 60 * 60 * 24),
      );

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
    (notif: any) => {
      // Laudo 02/09 #9 (onda 2): navegar NA HORA. O `await markAsRead` que
      // vinha antes segurava a navegação até o "lida" salvar — rede lenta,
      // toque sem resposta. Prendado por
      // tests/front/aviso-toque-responde-na-hora.test.tsx.
      if (notif.order_id) {
        onNavigate?.("order-details", notif.order_id);
      } else if (notif.action_url) {
        navegarPorUrl(notif.action_url, onNavigate);
      }

      // Marcar como lida roda em segundo plano: falha não impede a navegação
      // nem derruba a tela (o contexto já avisa a cliente — ver
      // notificacoes-acao-que-falha-avisa-a-cliente.test.tsx).
      if (!notif.read) {
        markAsRead(notif.id).catch(() => {
          // silêncio de propósito: a navegação já aconteceu.
        });
      }
    },
    [markAsRead, onNavigate],
  );

  // Grouping counts for each tab (unread count)
  const counts = useMemo(() => {
    const unread = notifications.filter((n) => !n.read);
    return {
      todas: unread.length,
      avisos: unread.filter((n) => TIPOS_DA_ABA_AVISOS.has(n.type)).length,
    };
  }, [notifications]);

  // Filtered notifications based on active tab
  const filteredNotifications = useMemo(() => {
    switch (activeTab) {
      case "avisos":
        return notifications.filter((n) => TIPOS_DA_ABA_AVISOS.has(n.type));
      default:
        return notifications;
    }
  }, [notifications, activeTab]);

  // Type styling details: cor só no glifo (significado), nunca bloco pintado
  const getTypeConfig = useCallback((type: string, temPedido: boolean) => {
    // "info" do trigger de pedido (em preparo, a caminho) é o caminhão;
    // "success" (entregue) é o "sucesso"; "warning" (cancelado) fica no sino
    // neutro.
    switch (type === "info" && temPedido ? "order" : type) {
      case "order":
      case "delivery":
        return {
          icon: Truck,
          glyphClass: "text-blue-600 dark:text-blue-400",
          actionText: "Acompanhar Pedido",
        };
      case "promotion":
        return {
          icon: Percent,
          glyphClass: "text-amber-700 dark:text-amber-400",
          actionText: "Aproveitar Cupom",
        };
      case "success":
      case "sucesso":
      case "pagamento":
        return {
          icon: Sparkles,
          glyphClass: "text-emerald-700 dark:text-emerald-400",
          actionText: "Ver Detalhes",
        };
      default:
        return {
          icon: Bell,
          glyphClass: "text-muted-foreground",
          actionText: "Ver Detalhes",
        };
    }
  }, []);

  const emptyStateConfig = useMemo(() => {
    if (visitante) {
      return {
        title: "Avisos dos seus pedidos",
        desc: "Entre na sua conta para receber os avisos dos seus pedidos.",
      };
    }
    switch (activeTab) {
      case "avisos":
        return {
          title: "Sem avisos ou comunicados",
          desc: "Quando a loja enviar um comunicado ou atualizar um pedido seu, ele aparece aqui.",
        };
      default:
        return {
          title: "Sua caixa está limpa!",
          // Estado vazio da aba PADRÃO: a primeira frase que toda cliente nova
          // lê. Promete só o que chega de fato: comunicado da loja (tipo
          // "aviso") e andamento do pedido (tipos "info", "success" e
          // "warning", gravados pelo trigger de status do pedido). Nunca
          // promoção/cupom como tipo próprio, que o banco não aceita.
          desc: "Tudo em ordem. Quando a loja enviar um aviso ou comunicado, ele aparece aqui.",
        };
    }
  }, [activeTab, visitante]);

  const hasUnreadNotifications = useMemo(
    () => notifications.some((n) => !n.read),
    [notifications],
  );

  return (
    <div className="pb-customer flex min-h-full flex-col bg-background">
      {/* Cabeçalho fixo: título, "marcar como lidas" e abas (Tinta) */}
      <div className="sticky top-[-2px] z-50 border-b border-border bg-background/90 px-4 pb-3 pt-4 backdrop-blur-xl">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            {counts.todas > 0 && (
              <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {counts.todas} não {counts.todas === 1 ? "lida" : "lidas"}
              </p>
            )}
            <h1 className="text-[28px] font-bold leading-8 tracking-tight text-foreground">
              Notificações
            </h1>
          </div>

          {hasUnreadNotifications && (
            <Button
              variant="ghost"
              size="sm"
              onClick={markAllAsRead}
              className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-solid border-border bg-background px-3 text-[13px] font-semibold text-foreground hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
              title="Marcar todas como lidas"
            >
              <CheckCheck className="size-4" />
              <span className="hidden xs:inline">Marcar como lidas</span>
              <span className="xs:hidden">Lidas</span>
            </Button>
          )}
        </div>

        {/* Abas */}
        <div className="scrollbar-none -mx-1 mt-3 flex gap-2 overflow-x-auto p-1">
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
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-pressed={isActive}
                className={`flex h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive
                    ? "bg-foreground text-background"
                    : "border border-solid border-border bg-background text-foreground hover:bg-muted/40"
                }`}
              >
                {tab.label}
                {tabUnread > 0 && (
                  <span
                    className={`font-mono text-[13px] font-medium tabular-nums ${
                      isActive
                        ? "text-background/70"
                        : "text-amber-700 dark:text-amber-400"
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

      {/* Lista */}
      <div className="flex flex-1 flex-col px-4 pt-2">
        {filteredNotifications.length > 0 ? (
          <motion.div layout role="list">
            <AnimatePresence mode="popLayout">
              {filteredNotifications.map((notif: any) => {
                const config = getTypeConfig(notif.type, !!notif.order_id);
                const Icon = config.icon;
                const showAction = notif.action_url || notif.order_id;

                return (
                  <motion.div
                    key={notif.id}
                    role="listitem"
                    layout
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    className="group relative border-b border-border"
                  >
                    {/* A linha inteira é o "ver detalhes": mesmo destino de antes */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleNotificationClick(notif)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleNotificationClick(notif);
                        }
                      }}
                      className="flex min-h-[72px] cursor-pointer gap-3 rounded-[18px] py-4 pr-12 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-muted/40">
                        <Icon
                          data-testid="notif-glifo"
                          className={`size-5 ${config.glyphClass}`}
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <h4
                          className={`break-words text-[16px] leading-6 text-foreground ${
                            notif.read ? "font-medium" : "font-semibold"
                          }`}
                        >
                          {notif.title}
                        </h4>
                        <p className="break-words text-[14px] leading-5 text-muted-foreground">
                          {notif.message}
                        </p>
                        <span className="mt-1 block font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                          {formatNotificationTime(notif.created_at)}
                        </span>
                        {showAction && (
                          <span className="sr-only">{config.actionText}</span>
                        )}
                      </div>
                    </div>

                    {/* Ponto de não lida (tinta): mesma regra do contador */}
                    {!notif.read && (
                      <span
                        data-testid="notif-ponto-nao-lida"
                        role="img"
                        aria-label="Não lida"
                        className="pointer-events-none absolute right-3 top-5 size-2 rounded-full bg-foreground"
                      />
                    )}

                    {/* Dispensar. Laudo NotificationsView-421: opaco por padrão e
                     * só some até o hover sob `@media (hover: hover)` (variante
                     * `hover-hover`), senão em touch ficava invisível mas tocável.
                     * size-11 = alvo de 44px. */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNotification(notif.id);
                      }}
                      className="absolute bottom-2 right-0 flex size-11 items-center justify-center rounded-xl text-muted-foreground opacity-100 transition-all after:absolute after:-inset-2 after:content-[''] hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover-hover:opacity-0 hover-hover:focus-visible:opacity-100 hover-hover:group-hover:opacity-100"
                      title="Excluir notificação"
                    >
                      <X className="size-4" />
                    </button>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        ) : loading && notifications.length === 0 ? (
          /* Laudo 02/09 #8 (onda 2): o PRIMEIRO carregamento não é caixa
           * limpa — "Tudo em ordem" fica reservado para o vazio DE VERDADE.
           * Prendado por tests/front/sino-carregando-nao-mente.test.tsx. */
          <div
            data-testid="sino-carregando"
            role="status"
            aria-label="Carregando notificações"
          >
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex animate-pulse gap-3 border-b border-border py-4"
              >
                <div className="size-11 shrink-0 rounded-[14px] bg-muted" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-3.5 w-2/3 rounded bg-muted" />
                  <div className="h-3 w-full rounded bg-muted/60" />
                  <div className="h-3 w-1/4 rounded bg-muted/60" />
                </div>
              </div>
            ))}
          </div>
        ) : erro && filteredNotifications.length === 0 ? (
          /* Estado de ERRO — falha de consulta não é caixa limpa. */
          <div className="flex h-full flex-col items-center justify-center px-6 py-20 text-center">
            <div className="mb-6 flex size-16 items-center justify-center rounded-[18px] border border-border bg-muted/30">
              <BellOff className="size-7 text-red-600 dark:text-red-400" />
            </div>
            <h2 className="mb-2 text-[20px] font-bold leading-7 tracking-tight text-foreground">
              Não conseguimos carregar
            </h2>
            <p className="mb-8 max-w-xs break-words text-[14px] leading-5 text-muted-foreground">
              {erro} Verifique sua conexão e tente de novo.
            </p>
            <Button
              onClick={() => void refresh()}
              className="h-[52px] rounded-2xl bg-foreground px-6 text-[15px] font-semibold text-background hover:bg-foreground/90"
            >
              Tentar de novo
            </Button>
          </div>
        ) : (
          /* Estado vazio */
          <div className="flex h-full flex-col items-center justify-center px-6 py-20 text-center">
            <div className="mb-6 flex size-16 items-center justify-center rounded-[18px] border border-border bg-muted/30">
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
                <Bell className="size-7 text-muted-foreground" />
              </motion.div>
            </div>
            <h2 className="mb-2 text-[20px] font-bold leading-7 tracking-tight text-foreground">
              {emptyStateConfig.title}
            </h2>
            <p className="mb-8 max-w-xs break-words text-[14px] leading-5 text-muted-foreground">
              {emptyStateConfig.desc}
            </p>

            <Button
              onClick={() => onNavigate?.(visitante ? "auth" : "home")}
              className="h-[52px] rounded-2xl bg-foreground px-6 text-[15px] font-semibold text-background hover:bg-foreground/90"
            >
              {visitante ? "Entrar" : "Explorar Ofertas"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
