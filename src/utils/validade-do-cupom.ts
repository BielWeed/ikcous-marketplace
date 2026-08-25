/**
 * Conversão da validade do cupom entre o input de data (`yyyy-mm-dd`) e o
 * `valid_until` (timestamptz) que a RPC do pedido confere contra `NOW()`.
 *
 * Defeito que isto fecha (auditoria 22/08, achado 26): o formulário gravava a
 * data escolhida como 00:00 UTC, e em Brasília o "vale até 25/08" morria às
 * 21:00 de 24/08 — o cupom expirava ~21h antes do fim do dia prometido, e o
 * card da listagem (fuso local) mostrava um dia a menos que o formulário.
 *
 * A regra daqui: a data escolhida vale até o ÚLTIMO MILISSEGUNDO daquele dia
 * no fuso de quem opera a loja, e a ida e volta pelo banco devolve sempre a
 * mesma data no input — independente do fuso da máquina.
 */

/**
 * Converte a data escolhida no input no instante final daquele dia, no fuso
 * local. Retorna `undefined` para entrada vazia/inválida (sem validade).
 */
export function dataEscolhidaParaValidade(
  valorDoInput: string,
): string | undefined {
  const apenasDigitos = /^\d{4}-\d{2}-\d{2}$/.test(valorDoInput);
  if (!apenasDigitos) return undefined;
  const [ano, mes, dia] = valorDoInput.split("-").map(Number);
  const fimDoDia = new Date(ano, mes - 1, dia, 23, 59, 59, 999);
  if (Number.isNaN(fimDoDia.getTime())) return undefined;
  // `new Date` "rola" componente fora de faixa em vez de virar NaN
  // (mês 13 vira janeiro do ano seguinte): conferir que o dia construído
  // é exatamente o pedido, ou "2030-13-99" viraria uma validade válida.
  if (
    fimDoDia.getFullYear() !== ano ||
    fimDoDia.getMonth() !== mes - 1 ||
    fimDoDia.getDate() !== dia
  ) {
    return undefined;
  }
  return fimDoDia.toISOString();
}

/**
 * Converte o `valid_until` gravado na data que o input de date exibe
 * (`yyyy-mm-dd`), no fuso local — o mesmo calendário que o card da listagem
 * mostra com `toLocaleDateString("pt-BR")`. Vazio ou inválido devolve "".
 */
export function validadeParaDataDoInput(validade?: string | null): string {
  if (!validade) return "";
  const d = new Date(validade);
  if (Number.isNaN(d.getTime())) return "";
  const ano = String(d.getFullYear()).padStart(4, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}
