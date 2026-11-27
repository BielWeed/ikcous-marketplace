import {
  Archive,
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  ArrowUpRight,
  Landmark,
  PiggyBank,
  RotateCcw,
  Scale,
  Smartphone,
  Store,
  Truck,
  Undo2,
} from "lucide-react";
import type { LucideIcon, LucideProps } from "lucide-react";
import { forwardRef } from "react";

import { IconeMercadoPago } from "@/components/icons/IconeMercadoPago";

// Componentes (e não funções que devolvem o ícone): escolher o componente
// durante o render faria o React recriá-lo a cada pintura
// (react-hooks/static-components).

/** Ícone do lançamento pela ORIGEM (de onde o dinheiro veio). */
export function IconeDaOrigem({
  origem,
  tipo,
  className,
}: {
  readonly origem: string;
  readonly tipo: string;
  readonly className?: string;
}) {
  switch (origem) {
    case "venda_online":
      return <Smartphone aria-hidden="true" className={className} />;
    case "venda_balcao":
      return <Store aria-hidden="true" className={className} />;
    case "venda_entrega":
      return <Truck aria-hidden="true" className={className} />;
    case "estorno":
    case "estorno_externo":
      return <RotateCcw aria-hidden="true" className={className} />;
    case "devolucao":
      return <Undo2 aria-hidden="true" className={className} />;
    case "sangria":
      return <ArrowUpFromLine aria-hidden="true" className={className} />;
    case "suprimento":
      return <ArrowDownToLine aria-hidden="true" className={className} />;
    case "ajuste_caixa":
      return <Scale aria-hidden="true" className={className} />;
    default:
      if (tipo === "transferencia") {
        return <ArrowLeftRight aria-hidden="true" className={className} />;
      }
      return tipo === "saida" ? (
        <ArrowUpRight aria-hidden="true" className={className} />
      ) : (
        <ArrowDownLeft aria-hidden="true" className={className} />
      );
  }
}

export function IconeDoTipoDeConta({
  tipo,
  className,
}: {
  readonly tipo: string;
  readonly className?: string;
}) {
  switch (tipo) {
    case "caixa":
      return <Archive aria-hidden="true" className={className} />;
    case "banco":
      return <Landmark aria-hidden="true" className={className} />;
    case "mercado_pago":
      return <IconeMercadoPago className={className} />;
    default:
      return <PiggyBank aria-hidden="true" className={className} />;
  }
}

/**
 * O glifo do Mercado Pago no formato que a lista de escolha do painel aceita
 * (`OpcaoDaLista.icone` é um `LucideIcon`). O `ref` não tem onde cair: o
 * glifo é decoração (`aria-hidden`) e ninguém mede o `<svg>`.
 */
const IconeMercadoPagoDaLista = forwardRef<SVGSVGElement, LucideProps>(
  function IconeMercadoPagoDaLista({ className }, _ref) {
    return <IconeMercadoPago className={className} />;
  },
);

/**
 * O MESMO ícone de `IconeDoTipoDeConta`, como componente solto, para a lista
 * de escolha do painel (chip "Todas as contas ›" do Extrato).
 */
export function iconeDaListaDoTipoDeConta(tipo: string): LucideIcon {
  switch (tipo) {
    case "caixa":
      return Archive;
    case "banco":
      return Landmark;
    case "mercado_pago":
      return IconeMercadoPagoDaLista;
    default:
      return PiggyBank;
  }
}

export function matizDoTipoDeConta(tipo: string): string {
  if (tipo === "caixa") return "#2DD4BF";
  if (tipo === "banco") return "#7AA2FF";
  if (tipo === "mercado_pago") return "#BA9AFF";
  return "#FF8BB2";
}
