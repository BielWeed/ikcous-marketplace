import { cpfValido } from "@/lib/cpf-do-destinatario";
import { ehRetiradaNaLoja } from "@/lib/guarda-de-frete";

// ============================================================================
// Elegibilidade da etiqueta de envio — extraído de `EtiquetasEnvioCard.tsx`
// (que morava na tela Admin > Frete) quando a emissão migrou para dentro da
// ficha do pedido (`EtiquetaDoPedidoCard.tsx`, orders/). Módulo PURO, sem
// React: a régua de decisão vira função testável sem montar componente.
//
// A ORDEM é a própria regra de negócio, não um detalhe de implementação:
//   1. já etiquetado          → emitida, SEMPRE (mesmo se cancelado depois —
//                                a etiqueta paga continua visível)
//   2. status morto p/ envio  → indisponível
//   3. pagamento não confirmado → indisponível (a etiqueta usa saldo REAL)
//   4. retirada na loja       → indisponível
//   5. entrega local          → indisponível
//   6. cotado pela SuperFrete → indisponível
//   7. cotado pela Frenet     → indisponível
//   8. sem serviço do ME      → indisponível
//   9. exige agência de coleta → indisponível
//  10. sem CPF válido do destinatário → precisa_cpf (só chega aqui quando a
//      etiqueta pelo app SERIA possível — indisponível continua vencendo
//      CPF, ver comentário no bloco 9.5)
//  11. nenhum dos anteriores  → disponível
//
// MESMA fonte de verdade que a edge `melhor-envio-etiqueta`
// (supabase/functions/melhor-envio-etiqueta/index.ts): regex do id do ME,
// lista de pagamento que etiqueta e ids que exigem agência são cópias
// DELIBERADAS (o padrão que já valia no card antigo) — o servidor é quem
// recusa de verdade; esta tela só evita o clique que ia ouvir "não".
// ============================================================================

export interface PedidoParaEtiqueta {
  id: string;
  status: string | null;
  payment_status: string | null;
  shipping: number | string | null;
  shipping_cost?: number | string | null;
  tracking_code: string | null;
  shipping_label_id: string | null;
  shipping_label_url: string | null;
  notes: string | null;
  shipping_option_id: string | null;
  /**
   * CPF do destinatário (`customer_data.cpf`, contrato com o checkout) —
   * `null` em pedido antigo, sem a chave. O Melhor Envio exige o CPF em
   * `to.document` para inserir o frete no carrinho.
   */
  cpf: string | null;
}

export type ElegibilidadeDaEtiqueta =
  | { estado: "emitida" }
  | { estado: "indisponivel"; motivo: string }
  | { estado: "precisa_cpf"; servico: string; cpfInvalido: boolean }
  | { estado: "disponivel"; servico: string };

function indisponivel(motivo: string): ElegibilidadeDaEtiqueta {
  return { estado: "indisponivel", motivo };
}

/**
 * Frete efetivo para exibição: pedido antigo (RPC anterior à v23) gravava o
 * frete em `shipping_cost` e deixava `shipping` no DEFAULT 0 — sem olhar as
 * duas colunas, a tela diria "frete grátis" para um pedido que cobrou frete.
 * MESMA leitura da edge (`freteEfetivo`, index.ts linha ~793).
 */
export function freteEfetivoDoPedido(
  p: Pick<PedidoParaEtiqueta, "shipping" | "shipping_cost">,
): number {
  const shipping = Number(p.shipping);
  if (Number.isFinite(shipping) && shipping > 0) return shipping;
  const custo = Number(p.shipping_cost);
  return Number.isFinite(custo) ? custo : 0;
}

// ── Regra ÚNICA de extração do id do Melhor Envio (MESMA regex da edge) ────
const REGEX_OPCAO_MELHOR_ENVIO = /^melhor-envio-(\d+)(-ss)?$/;
function idNumericoDoMelhorEnvio(opcao: unknown): string | null {
  if (typeof opcao !== "string") return null;
  const casou = opcao.match(REGEX_OPCAO_MELHOR_ENVIO);
  return casou ? casou[1] : null;
}

// Ids do Melhor Envio que só saem com AGÊNCIA de coleta — LATAM Cargo (12),
// Azul (15 e 16) e Buslog (22). MESMA lista e MESMO texto da edge
// (`IDS_QUE_EXIGEM_AGENCIA_DE_COLETA`, melhor-envio-etiqueta/index.ts).
const IDS_QUE_EXIGEM_AGENCIA_DE_COLETA: ReadonlySet<string> = new Set([
  "12",
  "15",
  "16",
  "22",
]);
const AVISO_EXIGE_AGENCIA =
  "Esta transportadora exige agência de coleta — gere esta etiqueta no site do Melhor Envio.";

/**
 * A nota do pedido (coluna `notes`, gravada pelo checkout — CheckoutView.tsx
 * ~1999-2003) traz "Frete Escolhido: <nome> (Prazo: ...)". Lê a ÚLTIMA
 * ocorrência, nunca a primeira — o checkout ACRESCENTA esta linha no FIM de
 * `notes`, e texto livre que a cliente escreve ANTES dela (observação do
 * pedido) pode conter a MESMA frase e enganar um `.match()` que para no
 * primeiro achado.
 */
function nomeDoFreteNaNota(notes: unknown): string | null {
  if (typeof notes !== "string") return null;
  const casamentos = [...notes.matchAll(/Frete Escolhido:\s*(.+?)\s*\(Prazo/g)];
  const nome = casamentos.at(-1)?.[1]?.trim();
  return nome ? nome : null;
}

// SUPERFRETE e FRENET: provedores SÓ de cotação — a etiqueta do pedido
// cotado por eles é feita no site DELES, nunca pelo Melhor Envio.
// `boolean` simples, NUNCA `opcao is string`: o predicado teria que valer
// "opcao É string ⟺ retornou true", mas a função só cobre um PREFIXO — TS
// negaria a checagem seguinte (Frenet) achando que sobrou só `null` do tipo
// `string | null`, e `.replace` em cima disso vira erro de compilação em
// `never` (achado do executor anterior, TS2339 linha ~194).
const COTADO_PELA_SUPERFRETE = /^superfrete-/;
function ehCotacaoDaSuperFrete(opcao: unknown): boolean {
  return typeof opcao === "string" && COTADO_PELA_SUPERFRETE.test(opcao);
}
const COTADO_PELA_FRENET = /^frenet-/;
function ehCotacaoDaFrenet(opcao: unknown): boolean {
  return typeof opcao === "string" && COTADO_PELA_FRENET.test(opcao);
}

// A "Entrega econômica" da SuperFrete é o PAC OU o Mini Envios (o mais
// barato), e a cliente só vê "Entrega econômica". Mapa de FALLBACK para
// pedido antigo, sem a nota nova — quando a nota tem o nome, ela vence.
const SERVICO_DA_SUPERFRETE: ReadonlyMap<string, string> = new Map([
  ["superfrete-1", "PAC"],
  ["superfrete-2", "SEDEX"],
  ["superfrete-3", "Jadlog"],
  ["superfrete-17", "Mini Envios"],
]);

function nomeDoServicoDaSuperFrete(
  opcao: string,
  notes: unknown,
): string | null {
  // O id VALIDADO pela RPC vence — texto livre da cliente (campo de
  // observação do pedido) não pode trocar o serviço mostrado. Só cai para a
  // nota quando o id não está no mapa (serviço novo/sem nome fixo ainda).
  return SERVICO_DA_SUPERFRETE.get(opcao) ?? nomeDoFreteNaNota(notes);
}

/**
 * Regra de decisão principal. Ordem descrita no comentário de topo do
 * arquivo — cada `if` é um ramo TERMINAL, nunca cai no de baixo.
 */
export function elegibilidadeDaEtiqueta(
  p: PedidoParaEtiqueta,
): ElegibilidadeDaEtiqueta {
  // 1. já etiquetado vence QUALQUER outro motivo — a etiqueta PAGA continua
  //    visível mesmo se o pedido foi cancelado depois.
  if (p.shipping_label_id) return { estado: "emitida" };

  // 2. status morto para envio.
  const status = String(p.status || "").toLowerCase();
  if (status === "cancelled") {
    return indisponivel("Pedido cancelado — não gera etiqueta.");
  }
  if (status === "delivered") {
    return indisponivel("Pedido já entregue — não gera etiqueta.");
  }
  if (status === "returned") {
    return indisponivel("Pedido devolvido — não gera etiqueta.");
  }

  // 3. pagamento não confirmado (falha FECHADO — a etiqueta usa o saldo REAL
  //    da conta do lojista no Melhor Envio). Passam os TRÊS valores de
  //    "dinheiro que entrou" do CHECK `marketplace_orders_payment_status_check`
  //    — mesma lista que a edge usa (PAGAMENTOS_QUE_ETIQUETAM).
  const paymentStatus = String(p.payment_status || "").toLowerCase();
  const pagamentosQueEtiquetam = [
    "pago",
    "pago_apos_expirar",
    "recebido_na_entrega",
  ];
  if (!pagamentosQueEtiquetam.includes(paymentStatus)) {
    return indisponivel(
      "Só pedido com pagamento confirmado gera etiqueta — ela é comprada com o saldo real da sua conta no Melhor Envio. Confirme o pagamento do pedido antes.",
    );
  }

  // 4. retirada na loja: a cliente busca, não existe envio.
  if (ehRetiradaNaLoja(p.shipping_option_id)) {
    return indisponivel(
      "Este pedido é de retirada na loja — a cliente busca no seu endereço. Não existe etiqueta de envio para este caso.",
    );
  }

  // 5. entrega local: quem despacha é a própria loja.
  if (p.shipping_option_id === "local-delivery") {
    return indisponivel(
      "Este pedido foi por entrega local — quem despacha é a própria loja. Não existe etiqueta pela API do Melhor Envio para este caso.",
    );
  }

  // 6. SuperFrete: só cotação, etiqueta fora do app.
  if (ehCotacaoDaSuperFrete(p.shipping_option_id)) {
    // A guarda acima já provou, EM RUNTIME, que é string com o prefixo
    // "superfrete-" — `String(...)` só satisfaz o compilador sem mudar o
    // valor (o guard não é mais um type predicate; ver comentário acima).
    const opcao = String(p.shipping_option_id);
    const nome = nomeDoServicoDaSuperFrete(opcao, p.notes);
    return indisponivel(
      nome
        ? `Frete cotado e cobrado pela SuperFrete (${nome}) — gere a etiqueta no site da SuperFrete.`
        : "Frete cotado e cobrado pela SuperFrete — gere a etiqueta no site da SuperFrete.",
    );
  }

  // 7. Frenet: mesma ideia — sempre tem um nome (nota, ou o código cru).
  if (ehCotacaoDaFrenet(p.shipping_option_id)) {
    const codigo = String(p.shipping_option_id).replace(/^frenet-/, "");
    const nome = nomeDoFreteNaNota(p.notes) ?? codigo;
    return indisponivel(
      `Frete cotado e cobrado pela Frenet (${nome}) — gere a etiqueta no site da Frenet.`,
    );
  }

  // 8. sem serviço do Melhor Envio salvo (nulo, flat-fee-*, ou qualquer
  //    outro formato desconhecido) — o lojista compra no site do ME.
  const idME = idNumericoDoMelhorEnvio(p.shipping_option_id);
  if (!idME) {
    return indisponivel(
      "Este pedido não registrou um serviço do Melhor Envio no checkout — gere a etiqueta no site do Melhor Envio.",
    );
  }

  // 9. transportadora que exige agência de coleta — a compra pela API é
  //    recusada (o app não manda agência nenhuma).
  if (IDS_QUE_EXIGEM_AGENCIA_DE_COLETA.has(idME)) {
    return indisponivel(AVISO_EXIGE_AGENCIA);
  }

  // Nome legível do serviço (usado pelos dois desfechos daqui pra baixo): a
  // nota do checkout ("Frete Escolhido") vence; sem nota, o fallback nomeia
  // o id do serviço.
  const servico =
    nomeDoFreteNaNota(p.notes) ?? `Melhor Envio (serviço ${idME})`;

  // 10. CPF do destinatário — SÓ chega aqui quando nenhum motivo de
  //     indisponibilidade valeu (a etiqueta pelo app SERIA possível). Sem
  //     isso, um pedido de SuperFrete/Frenet/entrega local sem CPF pediria
  //     CPF à toa para um caso que já é indisponível por outro motivo —
  //     "emitida vence tudo" e "indisponível vence CPF" são as duas regras
  //     da ordem descrita no topo do arquivo.
  const cpfPresente =
    p.cpf !== null && p.cpf !== undefined && String(p.cpf).trim() !== "";
  if (!cpfPresente || !cpfValido(p.cpf)) {
    return { estado: "precisa_cpf", servico, cpfInvalido: cpfPresente };
  }

  // 11. disponível.
  return { estado: "disponivel", servico };
}
