import { branding } from "@/config/branding";

export function nomeDaLoja(
  config?: { storeName?: string | null } | null,
): string {
  return config?.storeName?.trim() || branding.appName;
}
