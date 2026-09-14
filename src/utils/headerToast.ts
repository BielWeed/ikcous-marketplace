import { useSyncExternalStore } from "react";
import { toast } from "sonner";

import { haptic } from "@/utils/haptic";

export interface HeaderToastData {
  id: string;
  message: string;
  type: "success" | "error" | "warning" | "info";
  duration?: number;
}

function triggerHeaderToast(
  message: string,
  type: "success" | "error" | "warning" | "info" = "success",
  duration = 2600,
) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<HeaderToastData>("header-toast-event", {
        detail: {
          id: Math.random().toString(36).substring(2, 9),
          message,
          type,
          duration,
        },
      }),
    );
  }
}

let isPatched = false;

/**
 * Initializes global interceptor so all `toast.success`, `toast.error`, etc.
 * automatically trigger the Dynamic Island header toast animation.
 */
export function initHeaderToastInterceptor() {
  if (isPatched || typeof window === "undefined") return;
  isPatched = true;

  const origSuccess = toast.success.bind(toast);
  const origError = toast.error.bind(toast);
  const origWarning = toast.warning.bind(toast);
  const origInfo = toast.info.bind(toast);

  toast.success = ((message: any, data?: any) => {
    if (typeof message === "string") {
      triggerHeaderToast(message, "success");
    }
    return origSuccess(message, data);
  }) as typeof origSuccess;

  toast.error = ((message: any, data?: any) => {
    if (typeof message === "string") {
      triggerHeaderToast(message, "error");
    }
    return origError(message, data);
  }) as typeof origError;

  toast.warning = ((message: any, data?: any) => {
    if (typeof message === "string") {
      triggerHeaderToast(message, "warning");
    }
    return origWarning(message, data);
  }) as typeof origWarning;

  toast.info = ((message: any, data?: any) => {
    if (typeof message === "string") {
      triggerHeaderToast(message, "info");
    }
    return origInfo(message, data);
  }) as typeof origInfo;
}

// ── O lado LEITOR do canal: estado ÚNICO do toast do header ──────────────
// Dois consumidores precisam do MESMO estado em render trees diferentes: o
// wrapper BarraSuperiorCliente (App.tsx), que é o stacking context que
// compete na raiz contra o sheet portalado no body e por isso carrega o
// degrau z-[100]/z-[140], e a cápsula do próprio Header. Estados por
// consumidor divergiriam — dispensar a cápsula com um clique deixaria o
// wrapper em 140 sem aviso nenhum por ~2,6 s. Por isso o estado mora no
// módulo (um só timer, um só ouvinte do canal) e cada consumidor assina via
// useSyncExternalStore — o mesmo desenho de store externa do React 19.
let toastDoHeader: HeaderToastData | null = null;
const ouvintesDoToast = new Set<() => void>();
let timerDoToast: ReturnType<typeof setTimeout> | null = null;
let canalSobEscuta = false;

function avisarOuvintes() {
  ouvintesDoToast.forEach((avisar) => avisar());
}

// O canal em si: UM listener de "header-toast-event" para a vida do app
// (mesma disciplina do initHeaderToastInterceptor acima — registrado sob
// demanda, sem duplicar). É ele quem move o haptic: um toque por aviso,
// não um por consumidor montado.
function garantirCanalSobEscuta() {
  if (canalSobEscuta || typeof window === "undefined") return;
  canalSobEscuta = true;
  window.addEventListener("header-toast-event", (e: Event) => {
    const customEvent = e as CustomEvent<HeaderToastData>;
    if (!customEvent.detail?.message) return;
    haptic.light();
    toastDoHeader = customEvent.detail;
    if (timerDoToast) clearTimeout(timerDoToast);
    timerDoToast = setTimeout(() => {
      toastDoHeader = null;
      avisarOuvintes();
    }, customEvent.detail.duration || 2600);
    avisarOuvintes();
  });
}

// O clique na cápsula (e o Esc nela) dispensam o aviso — o degrau do
// wrapper desce JUNTO, porque o estado é um só.
export function dispensarToastDoHeader() {
  if (!toastDoHeader) return;
  if (timerDoToast) {
    clearTimeout(timerDoToast);
    timerDoToast = null;
  }
  toastDoHeader = null;
  avisarOuvintes();
}

function assinarToastDoHeader(avisar: () => void) {
  garantirCanalSobEscuta();
  ouvintesDoToast.add(avisar);
  return () => {
    ouvintesDoToast.delete(avisar);
  };
}

function obterToastDoHeader(): HeaderToastData | null {
  return toastDoHeader;
}

/**
 * Estado atual do canal de toast do header: `{ ativo, detalhe, dispensar }`.
 * `detalhe` carrega a mensagem/tipo enquanto a cápsula está de pé
 * (`duration || 2600`, timer único reiniciado a cada aviso novo); `ativo` é
 * o que o wrapper usa para o degrau z-[140].
 */
export function useToastDoHeader() {
  const detalhe = useSyncExternalStore(
    assinarToastDoHeader,
    obterToastDoHeader,
  );
  return {
    ativo: detalhe !== null,
    detalhe,
    dispensar: dispensarToastDoHeader,
  };
}
