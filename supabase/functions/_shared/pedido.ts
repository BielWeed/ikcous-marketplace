// @ts-nocheck
/**
 * O vocabulario comum para falar de PEDIDO com um humano.
 *
 * POR QUE ESTE ARQUIVO NASCEU AGORA, E POR QUE ELE NAO CONSERTA AS DUAS COPIAS
 *   `numeroDoPedido` e `formatarBRL` ja existiam DUAS vezes quando este arquivo
 *   foi escrito: em `notify-new-order/index.ts` e em
 *   `webhook-mercadopago/index.ts`. A terceira copia seria o ponto em que a
 *   duplicacao para de ser detalhe.
 *
 *   Mesmo assim as duas ficam como estao, de proposito. Trocar o import delas
 *   obriga a republicar duas edge functions que estao no ar e funcionando — e
 *   uma delas e' o webhook de pagamento, o caminho por onde entra dinheiro.
 *   Mexer nele de carona numa entrega de e-mail e exatamente o padrao que ja
 *   custou caro neste projeto: a correcao que cria o defeito seguinte.
 *
 *   Entao a casa existe, quem nasce agora mora nela, e unificar as duas antigas
 *   e tarefa propria — com revisao propria, porque toca o caminho do dinheiro.
 */

/**
 * O numero que o humano ve: os 6 ultimos caracteres do UUID, em maiuscula.
 * Mesma convencao do painel e do push, para o cliente e a lojista falarem do
 * mesmo pedido pelo mesmo nome.
 */
export const numeroDoPedido = (id: string): string =>
  `#${String(id).slice(-6).toUpperCase()}`;

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/**
 * R$ 1.234,50 — quem compra le valor em pt-BR, nao em ponto decimal.
 *
 * Via `Intl` e nao com a regex classica de separador de milhar: aquela tem
 * quantificador aninhado e o eslint a marca como `security/detect-unsafe-regex`,
 * o que subiria a catraca.
 *
 * O `replace` troca o espaco nao separavel que o `Intl` poe entre o simbolo e o
 * numero por um espaco comum — sem isso o texto PARECE igual na tela mas nao
 * casa em comparacao de string, e o teste passa a mentir.
 *
 * O NBSP na expressao vai ESCAPADO (`u00a0` precedido de barra), e nunca como
 * o caractere em si: NBSP cru no fonte dispara `no-irregular-whitespace`, que e
 * ERRO de eslint, e o teto de erro do projeto e zero. Escrever este arquivo
 * custou tres tentativas exatamente aqui — as ferramentas de edicao reinserem o
 * caractere literal quando ele aparece no texto da substituicao.
 */
export function formatarBRL(valor: unknown): string {
  const numero = Number(valor ?? 0);
  if (!Number.isFinite(numero)) return "R$ 0,00";
  return BRL.format(numero).replace(/\u00a0/g, " ");
}

/**
 * Escapa texto que vai para dentro do HTML do e-mail.
 *
 * POR QUE PRECISA
 *   Nome do cliente, nome de produto e observacao do pedido sao texto que
 *   ALGUEM digitou — a pessoa que comprou, ou a lojista no painel. Colar isso
 *   cru no corpo do e-mail deixa um `<` fechar a tabela e desmontar o layout no
 *   caso inocente, e injetar marcacao no caso nao inocente.
 *
 *   O alvo aqui e' o cliente de e-mail de quem recebe, que nao executa script —
 *   entao isto e menos "impedir XSS" e mais "impedir que um apostrofo no nome
 *   do produto quebre o comprovante". As duas razoes pedem a mesma linha.
 */
export function escaparHtml(texto: unknown): string {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Como cada forma de pagamento se chama para quem comprou.
 *
 * O rotulo `online` diz "PIX" e nao "cartao ou PIX": a `criar-pagamento`
 * devolve 400 para qualquer coisa que nao seja PIX, e o Brick so' oferece
 * `bankTransfer`. Prometer cartao aqui seria a tela dizendo o que o sistema
 * nao faz — o defeito que a release 1.4.0 inteira existiu para acabar.
 */
/**
 * `Map`, e nao objeto literal: indexar objeto por chave que veio de fora e o
 * que o eslint marca como `security/detect-object-injection`, e o teto de
 * divida deste projeto reprova advertencia nova. O motivo da regra e real —
 * chave vinda de dado alcanca `__proto__` e `constructor` num objeto comum,
 * e `Map` simplesmente nao tem esse chao.
 */
const ROTULO_PAGAMENTO = new Map<string, string>([
  ["online", "PIX pelo site"],
  ["pix", "PIX na entrega"],
  ["card", "Cartao na entrega"],
  ["cash", "Dinheiro na entrega"],
]);

export function rotuloDoPagamento(metodo: unknown): string {
  const chave = String(metodo ?? "").toLowerCase();
  // Metodo desconhecido nao vira palpite: some a linha inteira, e quem
  // chama decide. Inventar "Outro" seria informar o que ninguem sabe.
  return ROTULO_PAGAMENTO.get(chave) ?? "";
}

/**
 * Monta o endereco de entrega a partir do que EXISTE, sem completar buraco.
 *
 * Esta funcao e' filha direta do PR #231 ("o app para de inventar o endereco da
 * loja"): o app tinha cidade e estado cravados no codigo e os colava em pedido
 * que nao os tinha. Aqui a regra e a mesma, do outro lado — campo ausente
 * simplesmente nao aparece. Um comprovante com a cidade errada e pior que um
 * comprovante sem cidade.
 *
 * Aceita as duas formas em que o endereco existe neste projeto: o `customer_data`
 * do pedido de convidado (address/number/neighborhood/destination_cep) e a
 * linha de `user_addresses` de quem tem conta (street/number/neighborhood/
 * city/state/cep/complement).
 */
export function montarEndereco(
  fonte: Record<string, unknown> | null | undefined,
): string {
  if (!fonte) return "";
  // Pelo mesmo motivo do ROTULO_PAGAMENTO acima: as chaves procuradas sao
  // fixas, mas indexar objeto por variavel dispara `detect-object-injection`.
  // Converter uma vez para `Map` resolve, e ainda ignora o que veio pelo
  // prototipo — que num `customer_data` vindo de JSON nunca deveria contar.
  const campos = new Map(Object.entries(fonte));
  const pegar = (...chaves: string[]): string => {
    for (const chave of chaves) {
      const valor = String(campos.get(chave) ?? "").trim();
      if (valor) return valor;
    }
    return "";
  };

  const rua = pegar("street", "address");
  const numero = pegar("number");
  const complemento = pegar("complement");
  const bairro = pegar("neighborhood");
  const cidade = pegar("city");
  const estado = pegar("state");
  const cep = pegar("cep", "destination_cep");

  const linha1 = [rua, numero].filter(Boolean).join(", ");
  const cidadeEstado = [cidade, estado].filter(Boolean).join(" - ");
  return [linha1, complemento, bairro, cidadeEstado, cep]
    .filter(Boolean)
    .join(" · ");
}
