import { useAuth } from "@/hooks/useAuth";
import { useLeaderElection } from "@/hooks/useLeaderElection";
import { supabase } from "@/lib/supabase";
import type { Notification } from "@/types";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { NotificationContext } from "./NotificationContextCore";

// Notificação de campanha ("Todos os Clientes", AdminPushView) grava UMA
// linha só, com usuario_id NULO — vista por toda cliente. As policies de
// UPDATE/DELETE de `notificacoes` exigem `auth.uid() = usuario_id`
// (supabase/migrations/20260806000000_baseline_do_schema_vivo.sql), então
// essa linha nunca pode ser marcada como lida nem apagada no banco por uma
// cliente comum — o Postgrest simplesmente ignora a linha, sem erro. "Lida"
// e "dispensada" para esse tipo de aviso só podem valer NESTE aparelho,
// guardadas localmente por usuário.
function chaveEstadoLocalDaCampanha(userId: string): string {
  return `notificacoes-campanha-estado:${userId}`;
}

interface EstadoLocalDaCampanha {
  lidas: Set<string>;
  ocultas: Set<string>;
}

function lerEstadoLocalDaCampanha(userId: string): EstadoLocalDaCampanha {
  try {
    const bruto = localStorage.getItem(chaveEstadoLocalDaCampanha(userId));
    const dados = bruto ? JSON.parse(bruto) : null;
    return {
      lidas: new Set(Array.isArray(dados?.lidas) ? dados.lidas : []),
      ocultas: new Set(Array.isArray(dados?.ocultas) ? dados.ocultas : []),
    };
  } catch {
    // localStorage indisponível (modo privado, quota etc.) — sem estado
    // local, a marcação de leitura/dispensa fica só nesta sessão em memória.
    return { lidas: new Set(), ocultas: new Set() };
  }
}

function persistirEstadoLocalDaCampanha(
  userId: string,
  estado: EstadoLocalDaCampanha,
): void {
  try {
    localStorage.setItem(
      chaveEstadoLocalDaCampanha(userId),
      JSON.stringify({
        lidas: Array.from(estado.lidas),
        ocultas: Array.from(estado.ocultas),
      }),
    );
  } catch {
    // Mesma ressalva de lerEstadoLocalDaCampanha: falha em silêncio, a tela
    // continua funcionando só sem persistir entre sessões.
  }
}

export function NotificationProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { user } = useAuth();
  const { isLeader } = useLeaderElection();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  // Falha de fetch ≠ caixa vazia: sem este estado, a tela anunciava
  // "Tudo em ordem" para uma cliente com avisos não lidos que a consulta
  // não conseguiu trazer.
  const [erro, setErro] = useState<string | null>(null);
  const lastFetchRef = useRef<number>(0);
  // ids da última busca cujo usuario_id era nulo (aviso de campanha) — é o
  // que diferencia, em markAsRead/markAllAsRead/deleteNotification, uma
  // linha que o UPDATE/DELETE do banco alcança de uma que a policy ignora.
  const campanhaIdsRef = useRef<Set<string>>(new Set());

  const fetchNotifications = useCallback(
    async (force = false) => {
      if (!user) {
        setNotifications([]);
        campanhaIdsRef.current = new Set();
        setLoading(false);
        // Este ramo NÃO é o caminho do logout (o efeito lá embaixo é, e a
        // limpeza que resolve o defeito mora lá). Ele é alcançado pelo
        // `refresh()` — o botão "Tentar de novo" da tela, tocado por quem não
        // tem sessão. Sem sessão não há o que buscar, mas também não há erro
        // a exibir: limpar aqui é o que faz esse botão deixar de ser um
        // clique que não produz nada.
        setErro(null);
        return;
      }

      const now = Date.now();
      if (!force && now - lastFetchRef.current < 10000) return; // cache 10s
      lastFetchRef.current = now;

      try {
        setLoading(true);
        // Laudo 0109 (A9): a consulta única misturava avisos próprios com
        // campanha (`usuario_id` nulo) num único `.limit(50)` por created_at
        // — cliente frequente com 50+ avisos de status nunca via a campanha
        // que o lojista mandou "para todos", nem no contador de não lidas.
        // As duas pontas andam em paralelo, cada uma com o seu limite;
        // campanha é rara (uma linha por envio), 20 já sobra.
        const [dosProprios, deCampanha] = await Promise.all([
          supabase
            .from("notificacoes")
            .select("*")
            .eq("usuario_id", user.id)
            .order("created_at", { ascending: false })
            .limit(50),
          supabase
            .from("notificacoes")
            .select("*")
            .is("usuario_id", null)
            .order("created_at", { ascending: false })
            .limit(20),
        ]);

        if (dosProprios.error) throw dosProprios.error;
        if (deCampanha.error) throw deCampanha.error;

        const data = [...(dosProprios.data || []), ...(deCampanha.data || [])]
          .sort(
            (a, b) =>
              new Date(b.created_at).getTime() -
              new Date(a.created_at).getTime(),
          );

        const estadoLocal = lerEstadoLocalDaCampanha(user.id);
        const campanhaIds = new Set<string>();

        const mappedData: Notification[] = (data || [])
          .filter((item) => !estadoLocal.ocultas.has(item.id))
          .map((item) => {
            const isCampanha = item.usuario_id === null;
            if (isCampanha) campanhaIds.add(item.id);
            return {
              id: item.id,
              title: item.titulo,
              message: item.mensagem || "",
              type: (item.tipo as any) || "system",
              read:
                !!item.lida || (isCampanha && estadoLocal.lidas.has(item.id)),
              created_at: item.created_at,
              action_url:
                (item.acao as any)?.url || (item.dados as any)?.action_url,
              order_id: (item.dados as any)?.order_id,
            };
          });

        campanhaIdsRef.current = campanhaIds;
        setNotifications(mappedData);
        setErro(null);
      } catch (err) {
        console.error("[Notifications] Fetch error:", err);
        setErro("Não conseguimos carregar suas notificações.");
      } finally {
        setLoading(false);
      }
    },
    [user],
  );

  const markAsRead = useCallback(
    async (id: string) => {
      if (user && campanhaIdsRef.current.has(id)) {
        // Aviso de campanha: o UPDATE do banco não alcança essa linha (RLS
        // exige auth.uid() = usuario_id). "Lida" só pode valer aqui.
        const estadoLocal = lerEstadoLocalDaCampanha(user.id);
        estadoLocal.lidas.add(id);
        persistirEstadoLocalDaCampanha(user.id, estadoLocal);
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
        );
        return;
      }

      try {
        const { error } = await supabase
          .from("notificacoes")
          .update({ lida: true })
          .eq("id", id);

        if (error) throw error;
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
        );
      } catch (err) {
        // Achado 4 da auditoria rodada 2: sem este aviso a cliente toca em
        // "marcar como lida", nada acontece, e nada explica o porquê — ela
        // toca de novo, e de novo. O estado da tela continua honesto (o
        // `setNotifications` acima só roda no caminho de sucesso); o que
        // faltava era a tela CONTAR que não deu.
        console.error("[Notifications] Mark as read error:", err);
        toast.error("Não conseguimos marcar como lida. Tente de novo.");
      }
    },
    [user],
  );

  const markAllAsRead = useCallback(async () => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from("notificacoes")
        .update({ lida: true })
        .eq("usuario_id", user.id)
        .eq("lida", false);

      if (error) throw error;

      // O UPDATE acima só alcança as linhas da própria cliente. Os avisos de
      // campanha (usuario_id nulo) que ainda estavam não lidos ficam de fora
      // da policy — a leitura deles é registrada localmente, para o contador
      // e a lista concordarem com o que a tela acabou de afirmar.
      const idsDeCampanhaNaoLidos = notifications
        .filter((n) => !n.read && campanhaIdsRef.current.has(n.id))
        .map((n) => n.id);

      if (idsDeCampanhaNaoLidos.length > 0) {
        const estadoLocal = lerEstadoLocalDaCampanha(user.id);
        for (const id of idsDeCampanhaNaoLidos) estadoLocal.lidas.add(id);
        persistirEstadoLocalDaCampanha(user.id, estadoLocal);
      }

      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (err) {
      // Achado 4 da auditoria rodada 2 — mesmo motivo do markAsRead.
      console.error("[Notifications] Mark all as read error:", err);
      toast.error(
        "Não conseguimos marcar os avisos como lidos. Tente de novo.",
      );
    }
  }, [user, notifications]);

  const deleteNotification = useCallback(
    async (id: string) => {
      if (user && campanhaIdsRef.current.has(id)) {
        // O DELETE do banco também exige auth.uid() = usuario_id — dispensar
        // um aviso de campanha só pode significar "sumir dele neste
        // aparelho", nunca apagar a linha (que é de todas as clientes).
        const estadoLocal = lerEstadoLocalDaCampanha(user.id);
        estadoLocal.ocultas.add(id);
        estadoLocal.lidas.delete(id);
        persistirEstadoLocalDaCampanha(user.id, estadoLocal);
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        return;
      }

      try {
        const { error } = await supabase
          .from("notificacoes")
          .delete()
          .eq("id", id);

        if (error) throw error;
        setNotifications((prev) => prev.filter((n) => n.id !== id));
      } catch (err) {
        // Achado 4 da auditoria rodada 2 — mesmo motivo do markAsRead. Este é
        // o pior dos três para quem usa: apagar é o gesto de que a pessoa mais
        // espera retorno imediato.
        console.error("[Notifications] Delete error:", err);
        toast.error("Não conseguimos apagar este aviso. Tente de novo.");
      }
    },
    [user],
  );

  useEffect(() => {
    const bc =
      typeof window !== "undefined"
        ? new BroadcastChannel("ikcous_notifications")
        : null;

    if (user) {
      fetchNotifications(true);

      let channel: any = null;

      if (isLeader) {
        console.log(
          "[Notifications] Leader tab subscribing to realtime notifications...",
        );
        channel = supabase
          .channel(`notificacoes:${user.id}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "notificacoes",
            },
            () => {
              fetchNotifications(true);
              bc?.postMessage({ type: "notification_update" });
            },
          )
          .subscribe();
      } else {
        console.log(
          "[Notifications] Secondary tab listening to notifications via BroadcastChannel...",
        );
        if (bc) {
          bc.onmessage = (event) => {
            if (event.data?.type === "notification_update") {
              console.log(
                "[Notifications-Secondary] Received notification ping from Leader tab, fetching...",
              );
              fetchNotifications(true);
            }
          };
        }
      }

      return () => {
        if (channel) {
          supabase.removeChannel(channel);
        }
        bc?.close();
      };
    }
    setNotifications([]);
    setLoading(false);
    // ESTE é o caminho do logout — o efeito não chama `fetchNotifications`
    // quando `user` some, então limpar `erro` lá dentro não alcança aqui.
    // `erro` descreve a falha de UMA consulta logada e não pode sobreviver à
    // sessão que o criou: o sino do topo abre para qualquer pessoa, e sem
    // esta linha a falha de quem deslogou virava "Não conseguimos carregar"
    // permanente para o visitante seguinte no mesmo aparelho, com o "Tentar
    // de novo" incapaz de limpá-la. Regressão introduzida por mim em 9142182,
    // apontada pela revisão cruzada do parceiro (laudo da rodada 2, #5).
    setErro(null);
    bc?.close();
  }, [user, fetchNotifications, isLeader]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const contextValue = useMemo(
    () => ({
      notifications,
      unreadCount,
      loading,
      erro,
      markAsRead,
      markAllAsRead,
      deleteNotification,
      refresh: () => fetchNotifications(true),
    }),
    [
      notifications,
      unreadCount,
      loading,
      erro,
      markAsRead,
      markAllAsRead,
      deleteNotification,
      fetchNotifications,
    ],
  );

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
    </NotificationContext.Provider>
  );
}
