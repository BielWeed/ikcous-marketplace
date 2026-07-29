import { useLeaderElection } from "@/hooks/useLeaderElection";
import { supabase } from "@/lib/supabase";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * useRealtimeUpdate
 * Camada 1 da v21.0 ZENITH.
 * Assina um canal de Broadcast do Supabase para receber notificações de deploy em tempo real.
 * Otimizado via useLeaderElection para abrir conexão com Supabase apenas na aba líder.
 * Abas secundárias recebem os pings via BroadcastChannel local.
 */
export function useRealtimeUpdate(
  onUpdateDetected: (version?: string) => void,
  userId?: string,
) {
  const callbackRef = useRef(onUpdateDetected);
  const { isLeader } = useLeaderElection();

  useEffect(() => {
    callbackRef.current = onUpdateDetected;
  }, [onUpdateDetected]);

  useEffect(() => {
    let activeChannel: ReturnType<typeof supabase.channel> | null = null;
    let isUnmounting = false;
    let setupTimeoutId: ReturnType<typeof setTimeout> | null = null;

    // Shared BroadcastChannel for cross-tab realtime synchronization
    const bc = new BroadcastChannel("ikcous_realtime_updates");

    if (isLeader) {
      console.log(
        "[RealtimeUpdate] Current tab is LEADER. Deferring Supabase Realtime subscription...",
      );

      const setupRealtime = () => {
        if (isUnmounting) return;

        // Cleanup previous channel before creating a new one
        if (activeChannel) {
          console.log("[RealtimeUpdate] Removing previous channel instance...");
          supabase.removeChannel(activeChannel).catch(() => {});
          activeChannel = null;
        }

        console.log(
          `[RealtimeUpdate] Initializing pwa-system-signals channel${userId ? ` for user ${userId.slice(0, 8)}` : " (public)"}...`,
        );
        const channel = supabase.channel("pwa-system-signals");
        activeChannel = channel;

        channel
          .on("broadcast", { event: "deploy-ping" }, (payload) => {
            if (isUnmounting) return;

            let data = payload.payload;
            if (data instanceof ArrayBuffer) {
              data = { version: "binary-v24" };
            }
            console.log(
              "[RealtimeUpdate-Leader] Deploy signal received from Supabase:",
              data,
            );

            const newVersion = data?.version;
            toast.info("Nova atualização disponível (Realtime)", {
              description: `Versão ${newVersion || "detectada"} está pronta.`,
            });

            // Trigger callback for self
            callbackRef.current(newVersion);

            // Propagate update event to secondary tabs
            try {
              bc.postMessage({ type: "deploy-ping", payload: data });
              console.log(
                "[RealtimeUpdate-Leader] Propagated deploy signal to other tabs via BroadcastChannel.",
              );
            } catch (e) {
              console.warn(
                "[RealtimeUpdate-Leader] Broadcast channel propagation failed:",
                e,
              );
            }
          })
          .subscribe((status, err) => {
            if (isUnmounting || activeChannel !== channel) return;

            if (status === "SUBSCRIBED") {
              console.log(
                "[RealtimeUpdate] Active and Subscribed: pwa-system-signals",
              );
            } else if (status === "CHANNEL_ERROR") {
              const errMessage =
                (err as any)?.message ||
                (typeof (err as any) === "string" ? (err as any) : "");
              const isNormalClose =
                errMessage.includes("1000") || errMessage.includes("normal");
              const isAbnormalClose =
                errMessage.includes("1006") || errMessage.includes("abnormal");
              if (isNormalClose) {
                console.log(
                  "[RealtimeUpdate] Channel closed normally (socket closed: 1000)",
                );
              } else if (isAbnormalClose) {
                console.warn(
                  "[RealtimeUpdate] Channel closed abnormally (socket closed: 1006). SDK will auto-reconnect.",
                );
              } else if (import.meta.env.DEV) {
                console.warn(
                  "[RealtimeUpdate] Channel unavailable (Silent in Dev):",
                  errMessage || "Connection failed",
                );
              } else {
                console.error(
                  "[RealtimeUpdate] Channel error:",
                  errMessage || "Connection failed",
                );
              }
            } else if (status === "TIMED_OUT") {
              console.warn(
                "[RealtimeUpdate] Channel timed out. SDK will auto-reconnect.",
              );
            } else if (status === "CLOSED") {
              console.log(
                "[RealtimeUpdate] Channel closed. SDK will auto-reconnect.",
              );
            }
          });
      };

      setupTimeoutId = setTimeout(setupRealtime, 400);
    } else {
      console.log(
        "[RealtimeUpdate] Current tab is SECONDARY. Relying on Leader Tab via BroadcastChannel...",
      );

      bc.onmessage = (event) => {
        if (isUnmounting) return;

        if (event.data?.type === "deploy-ping") {
          const data = event.data.payload;
          console.log(
            "[RealtimeUpdate-Follower] Received update ping from Leader Tab via BroadcastChannel:",
            data,
          );

          const newVersion = data?.version;
          toast.info(
            "Nova atualização disponível (Realtime - Aba secundária)",
            {
              description: `Versão ${newVersion || "detectada"} está pronta.`,
            },
          );

          // Trigger callback for self
          callbackRef.current(newVersion);
        }
      };
    }

    return () => {
      console.log(
        "[RealtimeUpdate] Context cleaning up (isLeader:",
        isLeader,
        ")...",
      );
      isUnmounting = true;
      if (setupTimeoutId) {
        clearTimeout(setupTimeoutId);
      }
      bc.close();
      if (activeChannel) {
        const channelToCleanup = activeChannel;
        activeChannel = null;
        supabase.removeChannel(channelToCleanup).catch(() => {});
      }
    };
  }, [isLeader, userId]);
}
