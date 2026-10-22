import {
  ArrowLeftRight,
  Banknote,
  Barcode,
  CreditCard,
  Globe,
  Wallet,
} from "lucide-react";

import { IconePix } from "@/components/admin/primitivos/IconePix";

/**
 * Cor da forma de pagamento — UMA só, usada pela barra e pelo ícone para
 * nunca divergirem. Pix teal, crédito roxo, o resto azul.
 */
export function corDaForma(forma: string | null | undefined): string {
  if (forma === "pix") return "#2DD4BF";
  if (forma === "credito") return "#BA9AFF";
  return "#7AA2FF";
}

const CLASSE = "inline-block size-4 shrink-0 align-text-bottom";

/**
 * Ícone decorativo da forma (o rótulo ao lado já a nomeia). Crédito, débito
 * e cartão genérico usam o mesmo cartão: quem distingue é o rótulo.
 */
export function IconeDaForma({
  forma,
  className = "",
}: {
  readonly forma: string | null | undefined;
  readonly className?: string;
}) {
  const props = {
    "aria-hidden": true,
    className: `${CLASSE} ${className}`.trim(),
    style: { color: corDaForma(forma) },
  } as const;
  switch (forma) {
    case "pix":
      return (
        <span aria-hidden="true" style={props.style} className="contents">
          <IconePix className={props.className} />
        </span>
      );
    case "credito":
    case "cartao_credito":
    case "debito":
    case "cartao_debito":
    case "cartao":
    case "card":
      return <CreditCard {...props} />;
    case "dinheiro":
    case "cash":
      return <Banknote {...props} />;
    case "transferencia":
      return <ArrowLeftRight {...props} />;
    case "boleto":
      return <Barcode {...props} />;
    case "online":
    case "online_desconhecido":
      return <Globe {...props} />;
    default:
      return <Wallet {...props} />;
  }
}
