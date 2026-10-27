import { useSyncExternalStore } from "react";
import { toast } from "sonner";

import { haptic } from "@/utils/haptic";

export interface HeaderToastData {
  id: string;
  message: string;
  type: "success" | "error" | "warning" | "info";
  description?: string;
  duration?: number;
  /** `id` que o chamador deu ao toast do Sonner (para `toast.dismiss(id)`). */
  toastId?: string | number;
}

/**
 * Tempo na tela proporcional ao que há para ler: 60 ms por letra (mensagem +
 * descrição), nunca menos que os 2600 ms de sempre e nunca mais que 9 s. Quem
 * chama o toast com `duration` explícito não passa por aqui (só no celular).
 */
export function duracaoDoAviso(message: string, description = ""): number {
  const letras = message.length + description.length;
  return Math.min(9000, Math.max(2600, letras * 60));
}

// Mesmo corte do CSS que esconde o Sonner (index.css): até 640 px a cápsula é o
// ÚNICO aviso. Sem matchMedia (jsdom) vale como celular.
function ehCelular(): boolean {
  return (
    typeof window.matchMedia !== "function" ||
    window.matchMedia("(max-width: 640px)").matches
  );
}

function triggerHeaderToast(
  message: string,
  type: "success" | "error" | "warning" | "info",
  data?: { description?: unknown; duration?: unknown; id?: unknown },
) {
  if (typeof window !== "undefined") {
    const description =
      typeof data?.description === "string" ? data.description : undefined;
    // Tempo proporcional / `duration` explícito / Infinity só no celular; acima
    // de 640 px a cápsula fica os 2600 ms fixos de sempre (o Sonner mostra o
    // aviso completo pelo tempo dele).
    let duration = 2600;
    if (ehCelular()) {
      duration =
        typeof data?.duration === "number"
          ? data.duration
          : duracaoDoAviso(message, description);
    }
    const idDoSonner = data?.id;
    window.dispatchEvent(
      new CustomEvent<HeaderToastData>("header-toast-event", {
        detail: {
          id: Math.random().toString(36).substring(2, 9),
          message,
          type,
          description,
          duration,
          toastId:
            typeof idDoSonner === "string" || typeof idDoSonner === "number"
              ? idDoSonner
              : undefined,
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
  const origDismiss =
    typeof toast.dismiss === "function" ? toast.dismiss.bind(toast) : null;

  toast.success = ((message: any, data?: any) => {
    if (typeof message === "string") {
      triggerHeaderToast(message, "success", data);
    }
    return origSuccess(message, data);
  }) as typeof origSuccess;

  toast.error = ((message: any, data?: any) => {
    if (typeof message === "string") {
      triggerHeaderToast(message, "error", data);
    }
    return origError(message, data);
  }) as typeof origError;

  toast.warning = ((message: any, data?: any) => {
    if (typeof message === "string") {
      triggerHeaderToast(message, "warning", data);
    }
    return origWarning(message, data);
  }) as typeof origWarning;

  toast.info = ((message: any, data?: any) => {
    if (typeof message === "string") {
      triggerHeaderToast(message, "info", data);
    }
    return origInfo(message, data);
  }) as typeof origInfo;

  // Quem fecha o aviso pelo código (`toast.dismiss(id)`, ou sem id = todos)
  // também fecha a cápsula; sem isto um aviso fixo (`duration: Infinity`)
  // ficaria preso no cabeçalho até o toque.
  if (origDismiss) {
    toast.dismiss = ((id?: string | number) => {
      dispensarToastPorId(id);
      return origDismiss(id);
    }) as typeof origDismiss;
  }
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
    timerDoToast = null;
    // `duration: Infinity` (aviso fixo) fica até o toque: o setTimeout trata
    // Infinity como 0 e o aviso sumiria na hora.
    const ms = customEvent.detail.duration || 2600;
    if (ms !== Number.POSITIVE_INFINITY) {
      timerDoToast = setTimeout(() => {
        toastDoHeader = null;
        avisarOuvintes();
      }, ms);
    }
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

/** Fecha a cápsula se `id` for o do aviso atual, ou se vier sem id (fecha todos). */
function dispensarToastPorId(id?: string | number) {
  if (!toastDoHeader) return;
  if (id === undefined || id === toastDoHeader.toastId)
    dispensarToastDoHeader();
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
 * (`duration || 2600`, `Infinity` sem timer, timer único reiniciado a cada aviso novo); `ativo` é
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
