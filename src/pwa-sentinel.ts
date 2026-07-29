/**
 * PWA Sentinel — The Guardian
 * Camada 3 da v23.0 OMNIPOTENCE.
 * Este script roda fora do ciclo de vida principal do React para monitorar a saúde do SW.
 * Se o SW travar ou falhar em responder corações (heartbeats), o Sentinel intervém.
 */
export const initSentinel = () => {
  if (!navigator.serviceWorker) return;

  console.log(
    "[PWA-Sentinel] Guardian active. Monitoring Service Worker health...",
  );

  let lastHeartbeat = Date.now();
  const channel = new BroadcastChannel("sw-heartbeat");

  const handleHeartbeatAck = (data: any) => {
    if (data === "HEARTBEAT_ACK") {
      lastHeartbeat = Date.now();
    }
  };

  channel.onmessage = (event) => {
    handleHeartbeatAck(event.data);
  };

  // Standard Direct Service Worker message communication listener
  navigator.serviceWorker.addEventListener("message", (event) => {
    handleHeartbeatAck(event.data);
  });

  let lastCheck = Date.now();

  // Verificação de pulso a cada 30 segundos
  setInterval(() => {
    const now = Date.now();
    const timeSinceLastCheck = now - lastCheck;
    lastCheck = now;

    // Se a aba estiver oculta, pausamos as verificações de pulso para evitar pings desnecessários
    if (document.visibilityState === "hidden") {
      lastHeartbeat = now;
      return;
    }

    // Se o tempo desde o último check for maior que 45 segundos (quando deveria ser ~30 segundos),
    // significa que a aba foi suspensa/minimizada no celular ou computador.
    // Nesse caso, o Service Worker e o timer estavam pausados, então não consideramos perda de pulso.
    if (timeSinceLastCheck > 45000) {
      console.log(
        `[PWA Sentinel] ⏸️ Tab suspension detected (timer delayed by ${timeSinceLastCheck}ms). Resetting heartbeat window.`,
      );
      lastHeartbeat = now;
      return;
    }

    if (!navigator.serviceWorker.controller) {
      lastHeartbeat = now;
      return;
    }

    const timeSinceLastPulse = now - lastHeartbeat;

    if (timeSinceLastPulse > 300000) {
      // 5 minutos sem sinal = falha crítica
      console.error(
        `[PWA Sentinel] ⚠️ CRITICAL: Service Worker pulse lost (${timeSinceLastPulse}ms). Triggering Emergency Recovery...`,
      );

      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister();
        }
        console.warn(
          "[PWA Sentinel] 🔌 Service Worker Unregistered. Forcing reload.",
        );
        localStorage.setItem(
          "pwa_reload_reason",
          `Sentinel Recovery: Pulse loss (${timeSinceLastPulse}ms)`,
        );
        window.location.reload();
      });
    } else {
      // Quiet heart-ping
      navigator.serviceWorker.controller?.postMessage("HEARTBEAT_PING");
    }
  }, 30000);
};
