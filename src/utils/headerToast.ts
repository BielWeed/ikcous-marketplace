import { toast } from "sonner";

export interface HeaderToastData {
  id: string;
  message: string;
  type: "success" | "error" | "warning" | "info";
  duration?: number;
}

export function triggerHeaderToast(
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
