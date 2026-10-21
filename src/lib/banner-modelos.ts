import { PREFIXO_DO_MODELO } from "@/lib/prefixo-do-banner";
export { PREFIXO_DO_MODELO } from "@/lib/prefixo-do-banner";

export const MODELOS_DE_BANNER = [
  "destaque",
  "claro",
  "vitrine",
  "promocao",
  "lancamento",
  "foto",
] as const;

export type ModeloDeBanner = (typeof MODELOS_DE_BANNER)[number];

export function modeloDoBanner(
  templateType?: string | null,
): ModeloDeBanner | null {
  return (
    MODELOS_DE_BANNER.find(
      (modelo) => templateType === PREFIXO_DO_MODELO + modelo,
    ) ?? null
  );
}

// Mantém os exports do contrato; o painel importa o catálogo diretamente.
export {
  CORES_DO_MODELO,
  INFO_DOS_MODELOS,
  templateTypeDoModelo,
  type CorDoModelo,
} from "@/lib/catalogo-de-banners";

export function tintaSobre(hex: string): "claro" | "escuro" {
  const cor = /^#([\da-f]{3}|[\da-f]{6})$/i.test(hex) ? hex.slice(1) : "2A2A31";
  const completa = cor.length === 3 ? cor.replace(/./g, "$&$&") : cor;
  const [r, g, b] = [0, 2, 4].map((inicio) => {
    const canal = Number.parseInt(completa.slice(inicio, inicio + 2), 16) / 255;
    return canal <= 0.04045 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4;
  });
  // Limiar entre preto e branco (WCAG): escolhe o maior contraste, sempre ≥ 4,5:1.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "escuro" : "claro";
}

export function dividirTitulo(titulo: string): [string, string] {
  const palavras = titulo.trim().split(/\s+/);
  const meio = Math.ceil(palavras.length / 2);
  return [palavras.slice(0, meio).join(" "), palavras.slice(meio).join(" ")];
}
