// O RASCUNHO DO CHECKOUT — a meia hora de digitação não evapora mais
// (laudo ofensiva+mobile 31/08, achado N7).
//
// O DEFEITO PROVADO: cupom aplicado e formulário do convidado morriam com o
// desmonte do CheckoutView. Voltar ao carrinho para conferir qualquer coisa —
// no celular é o gesto mais comum do funil — custava redigitar nome,
// WhatsApp e endereço inteiros e PERDER o cupom que tinha aplicado, sem
// aviso nenhum. Medido em 31/08: CUPOM10 aplicado (−R$ 8,99), voltar, voltar
// → desconto sumido e formulário em branco (só o CEP sobrevivia, por morar
// em localStorage como "último CEP de frete").
//
// POR QUE sessionStorage (e não localStorage): rascunho de COMPRA em
// andamento é coisa da SESSÃO — fechar a aba é abandonar a compra, e o
// rascunho tem de morrer junto (nada de dado de endereço de visita antiga
// espreitando o próximo cliente no mesmo navegador). Sobrevive exatamente ao
// que dói: o vai-e-volta carrinho ⇄ checkout e o recarregar da página.
//
// O CUPOM vai no rascunho só o CÓDIGO: o desconto é revalidado no restore
// pelo MESMO caminho do botão Aplicar (validateCoupon contra o subtotal
// atual) — cupom que deixou de valer (mínimo, limite, validade) não volta
// mentindo; simplesmente não é restaurado.
//
// Insira o armazenamento (ArmazenamentoSimples, o mesmo contrato de
// chave-do-pedido.ts): os testes passam um Map, o CheckoutView passa o
// globalThis.sessionStorage.

import type { ArmazenamentoSimples } from "./chave-do-pedido";

const CHAVE_DE_ARMAZENAMENTO = "ikcous-rascunho-do-checkout-v1";

export interface RascunhoDoCheckout {
  nome: string;
  whatsapp: string;
  cep: string;
  numero: string;
  rua: string;
  bairro: string;
  cidade: string;
  estado: string;
  complemento: string;
  notas: string;
  /** Código do cupom aplicado — o desconto é revalidado no restore. */
  cupom: string | null;
}

export function rascunhoVazio(): RascunhoDoCheckout {
  return {
    nome: "",
    whatsapp: "",
    cep: "",
    numero: "",
    rua: "",
    bairro: "",
    cidade: "",
    estado: "",
    complemento: "",
    notas: "",
    cupom: null,
  };
}

type Desconhecido = Record<string, unknown>;

function eString(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

/** Rascunho que o CheckoutView consegue consumir sem surpresa: todo campo string, cupom string|null. */
function higienizar(cru: unknown): RascunhoDoCheckout | null {
  if (typeof cru !== "object" || cru === null) return null;
  const d = cru as Desconhecido;
  const cupom = d.cupom;
  return {
    nome: eString(d.nome),
    whatsapp: eString(d.whatsapp),
    cep: eString(d.cep),
    numero: eString(d.numero),
    rua: eString(d.rua),
    bairro: eString(d.bairro),
    cidade: eString(d.cidade),
    estado: eString(d.estado),
    complemento: eString(d.complemento),
    notas: eString(d.notas),
    cupom: typeof cupom === "string" && cupom !== "" ? cupom : null,
  };
}

export function salvarRascunhoDoCheckout(
  armazenamento: ArmazenamentoSimples,
  rascunho: RascunhoDoCheckout,
): void {
  try {
    armazenamento.setItem(CHAVE_DE_ARMAZENAMENTO, JSON.stringify(rascunho));
  } catch {
    // sessionStorage cheio/indisponível: rascunho é best-effort — a compra
    // nunca depende dele.
  }
}

export function lerRascunhoDoCheckout(
  armazenamento: ArmazenamentoSimples,
): RascunhoDoCheckout | null {
  try {
    const cru = armazenamento.getItem(CHAVE_DE_ARMAZENAMENTO);
    if (!cru) return null;
    return higienizar(JSON.parse(cru));
  } catch {
    return null;
  }
}

/** Chamado NO SUCESSO do pedido (e só lá): compra fechada não tem rascunho. */
export function limparRascunhoDoCheckout(
  armazenamento: ArmazenamentoSimples,
): void {
  try {
    armazenamento.removeItem(CHAVE_DE_ARMAZENAMENTO);
  } catch {
    // idem acima
  }
}

/** Verdade de teste da casa: o rascunho tem ALGUM conteúdo que valha restaurar? */
export function rascunhoTemConteudo(r: RascunhoDoCheckout): boolean {
  return (
    r.nome !== "" ||
    r.whatsapp !== "" ||
    r.cep !== "" ||
    r.numero !== "" ||
    r.rua !== "" ||
    r.bairro !== "" ||
    r.cidade !== "" ||
    r.estado !== "" ||
    r.complemento !== "" ||
    r.notas !== "" ||
    r.cupom !== null
  );
}
