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
 * Cor da BARRA de proporção da forma. Pix teal, crédito roxo, o resto azul.
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
  // Só o Pix leva cor (teal do tema, remapeada no tema claro); as demais são
  // neutras, no mesmo cinza dos textos secundários do módulo.
  const cor = forma === "pix" ? "text-teal-300" : "text-zinc-400";
  const props = {
    "aria-hidden": true,
    className: `${CLASSE} ${cor} ${className}`.trim(),
  } as const;
  switch (forma) {
    case "pix":
      return <IconePix className={props.className} />;
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
