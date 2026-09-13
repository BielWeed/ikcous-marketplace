import { gravaMotivoDeRecarga } from "@/lib/motivo-de-recarga";
/**
 * PWA Sentinel — The Guardian
 * Camada 3 da v23.0 OMNIPOTENCE.
 * Este script roda fora do ciclo de vida principal do React para monitorar a saúde do SW.
 * Se o SW travar ou falhar em responder corações (heartbeats), o Sentinel intervém.
 *
 * Issue #92: o sentinela NÃO é mais uma porta paralela de recarga. Ele pede
 * recarga pela MESMA chave única de @/lib/recuperacao-chunk (uma recuperação
 * por vez) e, antes de desregistrar qualquer coisa, tenta o caminho gentil:
 * um SW waiting pronto assume (SKIP_WAITING → controllerchange → reload) —
 * desregistrar numa transição de SW atiraria no próprio motor da
 * recuperação. O desregistro sobra como último recurso, sem waiting pronto.
 */
import {
  assumirServiceWorkerNovoERecarregar,
  pedirRecargaSubordinada,
} from "@/lib/recuperacao-chunk";

/** Prazo para o waiting pronto assumir antes de recorrer ao desregistro.
 * Mesmo prazo do ciclo do SW no módulo único. */
const PRAZO_ASSUMIR_SW_MS = 2500;

/** A recuperação do pulso perdido, extraída para ser testável sem relógio:
 * subordinada à chave única, waiting primeiro, desregistro por último. */
export async function recuperarPulsoPerdido(
  registros: readonly ServiceWorkerRegistration[],
): Promise<void> {
  if (!pedirRecargaSubordinada()) {
    console.warn(
      "[PWA Sentinel] Recuperação recente já engajada pela chave única; sentinel não intervém agora.",
    );
    return;
  }

  const assumiu = await assumirServiceWorkerNovoERecarregar({
    motivo: "recuperacao-sentinela",
    prazoMs: PRAZO_ASSUMIR_SW_MS,
  });
  if (assumiu) return;

  for (const registro of registros) {
    try {
      await registro.unregister();
    } catch (e) {
      console.warn("[PWA Sentinel] Falha ao desregistrar:", e);
    }
  }
  console.warn(
    "[PWA Sentinel] 🔌 Service Worker Unregistered. Forcing reload.",
  );
  // Laudo #2 (P-1): motivo nominal — o boot não anuncia "Sistema
  // Atualizado" para uma recuperação de pulso.
  gravaMotivoDeRecarga("recuperacao-sentinela");
  window.location.reload();
}

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
        void recuperarPulsoPerdido(registrations);
      });
    } else {
      // Quiet heart-ping
      navigator.serviceWorker.controller?.postMessage("HEARTBEAT_PING");
    }
  }, 30000);
};
