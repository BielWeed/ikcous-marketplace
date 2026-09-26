import {
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
  Wallet,
} from "lucide-react";

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
      return <Store aria-hidden="true" className={className} />;
    case "banco":
      return <Landmark aria-hidden="true" className={className} />;
    case "mercado_pago":
      return <Wallet aria-hidden="true" className={className} />;
    default:
      return <PiggyBank aria-hidden="true" className={className} />;
  }
}
