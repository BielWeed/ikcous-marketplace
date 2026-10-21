// Regras do número de WhatsApp da loja (Minha loja › Contato), extraídas da
// antiga tela "Atendimento" (painel simples, D9) sem mudar o comportamento:
// o campo é OPCIONAL (decisão de 30/08 — vazio grava NULL e o botão de
// WhatsApp some da loja); preenchido, vale DDD + número (10 ou 11 dígitos) e o
// +55 do Brasil entra sozinho na hora de gravar.

import { limparTelefoneBrasileiro } from "@/lib/telefone-br";
import type { Order } from "@/types";

/** Só os dígitos do que foi digitado ou salvo. */
export function soDigitos(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\D/g, "");
}

/**
 * O número como o campo mostra: sem o +55 (ele é desenhado ao lado do campo).
 * Só tira o 55 de número COM país (12 ou 13 dígitos) — um DDD 55 (interior do
 * RS) sem país não pode perder os dois primeiros dígitos.
 */
export function numeroParaOCampo(valor: string | null | undefined): string {
  return limparTelefoneBrasileiro(valor);
}

/** A forma gravada: 10 ou 11 dígitos ganham o 55; o resto fica como está. */
export function numeroComPais(valor: string | null | undefined): string {
  const digitos = soDigitos(valor);
  return digitos.length === 10 || digitos.length === 11
    ? `55${digitos}`
    : digitos;
}

// Diferente da máscara de digitação, esta validação nunca trunca o dado salvo.
// DDD brasileiro válido + fixo de 8 dígitos ou celular de 9; país só Brasil.
const DDD_BR =
  /^(?:1[1-9]|2[12478]|3[1-578]|4[1-9]|5[13-5]|6[1-9]|7[134579]|8[1-9]|9[1-9])$/;
export function normalizarNumeroMototaxi(
  valor: string | null | undefined,
): string | null {
  if (!valor || !/^[+\d\s().-]+$/.test(valor)) return null;
  let numero = valor.replace(/\D/g, "");
  if (
    (numero.length === 12 || numero.length === 13) &&
    numero.startsWith("55")
  ) {
    numero = numero.slice(2);
  }
  if (
    !DDD_BR.test(numero.slice(0, 2)) ||
    !/^(?:[2-5]\d{7}|9\d{8})$/.test(numero.slice(2))
  )
    return null;
  return `55${numero}`;
}

/** Mensagem mínima: só os campos que o painel já mostra para entregar. */
export function mensagemMototaxi(order: Order, loja: string): string {
  const c = order.customer;
  const pago =
    ["pago", "pago_apos_expirar", "recebido_na_entrega"].includes(
      order.paymentStatus ?? "",
    ) || !!order.pagamentoRecebidoEm;
  const formas = new Map([
    ["pix", "Pix"],
    ["card", "Cartão"],
    ["cash", "Dinheiro"],
  ]);
  const forma = formas.get(order.paymentMethod);
  const valor = order.total.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const pagamento =
    order.paymentStatus === "estornado"
      ? "Pagamento estornado — conferir antes de enviar"
      : order.total === 0
        ? "Sem valor a cobrar"
        : pago
          ? "Já pago — não cobrar"
          : forma
            ? `Cobrar na entrega: R$ ${valor} (${forma})`
            : "Pagamento pelo app pendente — não cobrar na entrega";
  return [
    `Entrega — Pedido #${order.id.slice(0, 6).toUpperCase()}`,
    `Cliente: ${c.name}`,
    `Telefone: ${c.whatsapp}`,
    `Endereço: ${[c.address, c.number, c.complement].filter(Boolean).join(", ")}`,
    [
      c.neighborhood,
      [c.city, c.state].filter(Boolean).join("/"),
      c.cep ? `CEP ${c.cep}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    c.reference ? `Referência: ${c.reference}` : "",
    `Itens: ${order.items.map((i) => `${i.quantity}× ${i.name}`).join("; ")}`,
    pagamento,
    `Loja: ${loja}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export type WhatsappParaGravar =
  | { readonly valido: true; readonly valor: string | null }
  | { readonly valido: false };

/** O que digitaram → o que vai ao banco (`null` = vazio, ausência honesta). */
export function whatsappParaGravar(
  digitado: string | null | undefined,
): WhatsappParaGravar {
  // Mesma limpeza do campo (zero na frente, +55): o que se grava é o que a
  // máscara mostra, mesmo se o valor chegar cru (preenchimento automático).
  const digitos = limparTelefoneBrasileiro(digitado);
  if (digitos.length > 0 && digitos.length < 10) return { valido: false };
  return { valido: true, valor: numeroComPais(digitos) || null };
}
