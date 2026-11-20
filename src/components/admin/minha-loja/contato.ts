// Regras do número de WhatsApp da loja (Minha loja › Contato), extraídas da
// antiga tela "Atendimento" (painel simples, D9) sem mudar o comportamento:
// o campo é OPCIONAL (decisão de 30/08 — vazio grava NULL e o botão de
// WhatsApp some da loja); preenchido, vale DDD + número (10 ou 11 dígitos) e o
// +55 do Brasil entra sozinho na hora de gravar.

import { cortarTexto } from "@/lib/cortar-texto";
import { numeroDoPedido } from "@/lib/numero-do-pedido";
import { observacaoDaClienteNoRecibo } from "@/lib/observacao-da-cliente-no-recibo";
import { quemVaiReceberSeForOutro } from "@/lib/quem-vai-receber";
import { situacaoDoPagamentoNaEntrega } from "@/lib/situacao-do-pagamento-na-entrega";
import { limparTelefoneBrasileiro } from "@/lib/telefone-br";
import { textoSemControlesDeDirecao } from "@/lib/texto-sem-controles-de-direcao";
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

/** Os dois primeiros dígitos são um DDD que existe no Brasil. */
export function dddBrasileiroValido(ddd: string): boolean {
  return DDD_BR.test(ddd);
}

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

// Prefixo do link do WhatsApp com o maior número brasileiro (ver mensagemMototaxi).
const TAMANHO_DO_PREFIXO_DO_LINK = 33;

/** Mensagem mínima: só os campos que o painel já mostra para entregar. */
export function mensagemMototaxi(order: Order, loja: string): string {
  const c = order.customer;
  const limpar = (campo: string | null | undefined) =>
    textoSemControlesDeDirecao(campo ?? "");
  const endereco = [c.address, c.number, c.complement]
    .map(limpar)
    .filter(Boolean)
    .join(", ");
  const referencia = limpar(c.reference);
  const cep = limpar(c.cep);
  const quemRecebe = quemVaiReceberSeForOutro(c.name, c.recipientName);
  // "Deixar na portaria", "campainha estragada": o que a cliente escreveu no
  // checkout. `order.notes` e o mesmo campo que a ficha mostra como
  // "Observacoes do pedido": o checkout cola ali a observacao, as escolhas de
  // variacao e a linha automatica "Frete Escolhido:" (a ficha e o recibo ja
  // tratam assim). A linha automatica de frete sai; o resto vai em UMA linha
  // so (nao quebra o formato da mensagem), com teto contado em CARACTERES
  // inteiros: cortar no meio de um emoji deixaria meio caractere solto e o
  // encodeURIComponent do link do WhatsApp lancaria erro na ficha inteira.
  const notaLimpa = observacaoDaClienteNoRecibo(order.notes)
    .split(/\r?\n/)
    .map((linha) => linha.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" · ");
  const caracteres = Array.from(notaLimpa);
  const observacao =
    caracteres.length > 300
      ? `${caracteres.slice(0, 299).join("").trimEnd()}…`
      : notaLimpa;
  const { situacao, forma, valor } = situacaoDoPagamentoNaEntrega(order);
  const pagamento =
    situacao === "estornado"
      ? "Pagamento estornado — conferir antes de enviar"
      : situacao === "sem_valor"
        ? "Sem valor a cobrar"
        : situacao === "pago"
          ? "Já pago — não cobrar"
          : situacao === "cobrar"
            ? `Cobrar na entrega: R$ ${valor} (${forma})`
            : "Pagamento pelo app pendente — não cobrar na entrega";
  const dadosDaEntrega = [
    `Entrega — Pedido #${numeroDoPedido(order.id)}`,
    `Cliente: ${c.name}`,
    // Compra para presente/portaria: quem recebe na porta e outra pessoa, e o
    // mototaxi precisa do nome dela (a ficha do painel ja mostra "Recebe: X").
    quemRecebe ? `Quem recebe: ${quemRecebe}` : "",
    `Telefone: ${c.whatsapp}`,
    `Endereço: ${endereco}`,
    [
      limpar(c.neighborhood),
      [c.city, c.state].map(limpar).filter(Boolean).join("/"),
      cep ? `CEP ${cep}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    referencia ? `Referência: ${referencia}` : "",
  ].filter(Boolean);
  const linhaDaNota = (nota: string) =>
    nota ? `Observações do pedido: ${nota}` : "";
  const itens = order.items.map((i) => `${i.quantity}× ${i.name}`);
  const linhaDaLoja = `Loja: ${loja}`;
  const juntar = (...linhas: string[]) => linhas.filter(Boolean).join("\n");
  // Reserve o prefixo inteiro do link e o maior número brasileiro com DDI:
  // 33 caracteres (esquema, endereço do WhatsApp, 55 + DDD + 9 dígitos e "?text=").
  const cabeNoLink = (texto: string) =>
    TAMANHO_DO_PREFIXO_DO_LINK + encodeURIComponent(texto).length <= 1800;
  const completa = juntar(
    ...dadosDaEntrega,
    linhaDaNota(observacao),
    `Itens: ${itens.join("; ")}`,
    pagamento,
    linhaDaLoja,
  );
  if (cabeNoLink(completa)) return completa;

  const resumo = (omitidos: number) =>
    `+ ${omitidos} ${omitidos === 1 ? "item" : "itens"} (veja o pedido no painel)`;
  const essenciais = juntar(...dadosDaEntrega, pagamento, linhaDaLoja);
  const montar = (nota: string, lista: string, omitidos: number) =>
    juntar(
      essenciais,
      linhaDaNota(nota),
      lista ? `Itens: ${lista}` : "",
      omitidos > 0 ? resumo(omitidos) : "",
    );

  let nota = observacao;
  // Observações multibyte podem consumir o orçamento mesmo sem a lista.
  // Preserve os dados de entrega e encurte a nota com o helper de texto.
  if (!cabeNoLink(montar(nota, "", itens.length))) {
    nota = cortarTexto(nota, 80);
    if (!cabeNoLink(montar(nota, "", itens.length))) {
      nota = "Veja a observação no painel.";
    }
  }
  let lista = "";
  let mensagem = montar(nota, lista, itens.length);
  for (const [indice, item] of itens.entries()) {
    // Só entra um item inteiro: nunca corte uma palavra ou emoji do nome.
    const candidata = lista ? `${lista}; ${item}` : item;
    const proxima = montar(nota, candidata, itens.length - indice - 1);
    if (!cabeNoLink(proxima)) break;
    lista = candidata;
    mensagem = proxima;
  }
  return mensagem;
}

/** Valida o número nacional tanto no campo quanto antes de gravar. */
export function validarWhatsappDaLoja(digitado: string): string | null {
  const digitos = soDigitos(digitado);
  if (!digitos) return null;
  if (digitos.length === 10 && /[7-9]/.test(digitos.charAt(2))) {
    return "Celulares têm 9 dígitos depois do DDD: coloque o 9 na frente.";
  }
  if (digitos.length < 10 || digitos.length > 11) {
    return "Informe DDD + número (10 ou 11 dígitos)";
  }
  if (!dddBrasileiroValido(digitos.slice(0, 2))) {
    return "Confira o DDD: esse DDD não existe.";
  }
  if (digitos.length === 11 && digitos[2] !== "9") {
    return "Confira o WhatsApp: celular precisa começar com 9 depois do DDD.";
  }
  return null;
}

export type WhatsappParaGravar =
  | { readonly valido: true; readonly valor: string | null }
  | { readonly valido: false };

/** O que digitaram → o que vai ao banco (`null` = vazio, ausência honesta). */
export function whatsappParaGravar(
  digitado: string | null | undefined,
  /** O campo já removeu país e operadora; não normalizar o país duas vezes. */
  jaNacional = false,
): WhatsappParaGravar {
  // Mesma limpeza do campo (zero na frente, +55): o que se grava é o que a
  // máscara mostra, mesmo se o valor chegar cru (preenchimento automático).
  // Quando já veio do campo, só +55 explícito identifica país: reinterpretar
  // 55 sem "+" esconderia o excesso digitado tecla a tecla. A carga legada
  // continua aceitando o país sem "+" antes de entregar o número ao campo.
  const digitos = limparTelefoneBrasileiro(digitado, { colagem: !jaNacional });
  if (validarWhatsappDaLoja(digitos)) return { valido: false };
  return { valido: true, valor: numeroComPais(digitos) || null };
}
