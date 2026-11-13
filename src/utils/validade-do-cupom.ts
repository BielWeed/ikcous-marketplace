/**
 * Conversão da validade do cupom entre o input de data (`yyyy-mm-dd`) e o
 * `valid_until` (timestamptz) que a RPC do pedido confere contra `NOW()`.
 *
 * Dois defeitos que isto fecha:
 *
 * 1. Auditoria 22/08, achado 26: o formulário gravava a data escolhida como
 *    00:00 UTC, e em Brasília o "vale até 25/08" morria às 21:00 de 24/08.
 * 2. 12/11: a correção do (1) construía o fim do dia no fuso do APARELHO. Num
 *    celular em UTC ou noutro fuso, "até 12/11" terminava às 20:59 de Brasília
 *    (3 h antes do fim do dia), e num fuso adiantado terminava depois da
 *    meia-noite — diferente do que o checkout considera
 *    (`cupons-do-checkout.ts`, calendário `America/Sao_Paulo`).
 *
 * A regra daqui: a data escolhida vale até o ÚLTIMO MILISSEGUNDO daquele dia
 * no calendário da LOJA (Brasília), e a ida e volta pelo banco devolve sempre
 * a mesma data no input — independente do fuso da máquina.
 *
 * Aritmética fixa em UTC-03:00, de propósito (mesma escolha de
 * `filtro-da-lista-de-pedidos.ts`): Brasília não tem horário de verão desde
 * 2019, então o deslocamento é constante e as duas conversões são inversas
 * exatas uma da outra, sem depender de `Intl` nem do fuso do aparelho. Se o
 * Brasil voltar a ter horário de verão, é aqui e lá que isto muda.
 * Cupom já gravado não é reescrito: só a leitura passa a ser em Brasília.
 */

const DESLOCAMENTO_DA_LOJA_EM_MS = 3 * 60 * 60 * 1000; // UTC-03:00

/**
 * Converte a data escolhida no input no instante final daquele dia, em
 * Brasília (23:59:59.999 BRT). Retorna `undefined` para entrada
 * vazia/inválida (sem validade).
 */
export function dataEscolhidaParaValidade(
  valorDoInput: string,
): string | undefined {
  const apenasDigitos = /^\d{4}-\d{2}-\d{2}$/.test(valorDoInput);
  if (!apenasDigitos) return undefined;
  const [ano, mes, dia] = valorDoInput.split("-").map(Number);
  // 23:59:59.999 de Brasília = 02:59:59.999 UTC do dia seguinte.
  const fimDoDia = new Date(
    Date.UTC(ano, mes - 1, dia, 23, 59, 59, 999) + DESLOCAMENTO_DA_LOJA_EM_MS,
  );
  if (Number.isNaN(fimDoDia.getTime())) return undefined;
  // `Date.UTC` "rola" componente fora de faixa em vez de virar NaN (mês 13
  // vira janeiro do ano seguinte, 30/02 vira março): conferir que o dia
  // construído é exatamente o pedido, ou "2030-13-99" viraria uma validade
  // válida.
  const conferido = new Date(fimDoDia.getTime() - DESLOCAMENTO_DA_LOJA_EM_MS);
  if (
    conferido.getUTCFullYear() !== ano ||
    conferido.getUTCMonth() !== mes - 1 ||
    conferido.getUTCDate() !== dia
  ) {
    return undefined;
  }
  return fimDoDia.toISOString();
}

/**
 * Converte o `valid_until` gravado na data que o input de date exibe
 * (`yyyy-mm-dd`), no calendário de Brasília — o mesmo que o checkout e o card
 * da listagem mostram. Vazio ou inválido devolve "".
 */
export function validadeParaDataDoInput(validade?: string | null): string {
  if (!validade) return "";
  const d = new Date(validade);
  if (Number.isNaN(d.getTime())) return "";
  const naLoja = new Date(d.getTime() - DESLOCAMENTO_DA_LOJA_EM_MS);
  const ano = String(naLoja.getUTCFullYear()).padStart(4, "0");
  const mes = String(naLoja.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(naLoja.getUTCDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}
