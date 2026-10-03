import type { StoreConfig } from "@/types";
import { Flame, Layers, type LucideIcon, Sparkles, Zap } from "lucide-react";

/** Uma vitrine da Home, no MESMO formato que a loja grava e lê (`home_sections`). */
export type SecaoDaHome = NonNullable<StoreConfig["homeSections"]>[number];

/** Quantos produtos a vitrine mostra quando a lojista nunca mexeu no limite. */
export const QUANTIDADE_PADRAO = 6;

/**
 * O "tipo" que o cartão mostra. Sai do `id` (como a tela sempre fez): as três
 * de fábrica têm ids fixos e qualquer outra é personalizada.
 */
export function tipoDaVitrine(secao: SecaoDaHome): {
  rotulo: string;
  Icone: LucideIcon;
} {
  if (secao.id === "new_arrivals")
    return { rotulo: "Lançamentos", Icone: Sparkles };
  if (secao.id === "offers") return { rotulo: "Ofertas", Icone: Flame };
  if (secao.id === "bestsellers") return { rotulo: "Destaques", Icone: Zap };
  return { rotulo: "Personalizada", Icone: Layers };
}

/** Título para exibir/rotular — vitrine com título vazio não some do leitor de tela. */
export function tituloExibido(secao: SecaoDaHome): string {
  return secao.title.trim() || "Sem nome";
}
