/**
 * O que a tela de pedidos MANDA ao banco quando a lojista filtra por data ou
 * busca pelo número do pedido.
 *
 * Dois defeitos medidos, os dois na ponta da tela (o banco está certo):
 *
 * 1. **Dia errado.** `get_admin_orders_paged` compara `created_at` com o
 *    texto como `TIMESTAMPTZ` e a sessão do banco roda em UTC. A tela mandava
 *    a data crua ("2026-10-14"), que vira 00:00 UTC = 21:00 de 13/10 em
 *    Brasília: "14/10 a 14/10" devolvia lista vazia, e "01/08 a 31/08"
 *    perdia o dia 31 inteiro e trazia a noite de 31/07 — fechamento do mês com
 *    número errado e sem aviso. Agora a tela manda o INSTANTE de início e de
 *    fim do dia da loja.
 * 2. **"#" na busca.** O app mostra o número do pedido como "#3884BE" em toda
 *    parte; quem busca copiando isso mandava o "#" junto, e os dígitos "3884"
 *    caíam na regra de busca por telefone, mostrando o pedido de OUTRA pessoa.
 *
 * O fuso é o da casa: Brasília, UTC-03:00 o ano todo (sem horário de verão
 * desde 2019) — o mesmo calendário `America/Sao_Paulo` do restante do painel
 * (`financeiro.ts`, `crm.ts`). Fixo de propósito: o texto vai direto para o
 * banco, que lê o deslocamento embutido nele.
 */

const DESLOCAMENTO_DA_LOJA = "-03:00";

/**
 * `AAAA-MM-DD` que existe no calendário (descarta "2026-02-30", "2026-13-01",
 * texto solto guardado no navegador). `new Date` "rola" componente fora de
 * faixa, então confere o dia construído contra o pedido — mesmo cuidado de
 * `dataEscolhidaParaValidade`.
 */
function diaValido(dia: string | undefined): dia is string {
  if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
  const [ano, mes, data] = dia.split("-").map(Number);
  const conferido = new Date(Date.UTC(ano, mes - 1, data));
  return (
    conferido.getUTCFullYear() === ano &&
    conferido.getUTCMonth() === mes - 1 &&
    conferido.getUTCDate() === data
  );
}

/** Meia-noite de Brasília do dia escolhido. Sem dia válido: sem limite. */
export function inicioDoDiaDaLoja(dia: string | undefined): string | undefined {
  return diaValido(dia) ? `${dia}T00:00:00${DESLOCAMENTO_DA_LOJA}` : undefined;
}

/** Último milissegundo do dia escolhido em Brasília. Sem dia válido: sem limite. */
export function fimDoDiaDaLoja(dia: string | undefined): string | undefined {
  return diaValido(dia)
    ? `${dia}T23:59:59.999${DESLOCAMENTO_DA_LOJA}`
    : undefined;
}

/**
 * O termo da busca como o banco precisa: sem espaço nas pontas e sem o "#"
 * que o app mostra antes do número do pedido (só UM, só no começo).
 */
export function termoDeBuscaDoPedido(termo: string | undefined): string {
  return (termo ?? "").trim().replace(/^#\s*/, "");
}

function emMilissegundos(valor: string | undefined): number | undefined {
  if (!valor) return undefined;
  const ms = new Date(valor).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * O pedido (`criadoEm`) cai dentro do período que a tela mandou ao banco?
 * Compara INSTANTES, nunca texto: "2026-10-15T02:30:00.000Z" é maior que
 * "2026-10-14T23:59:59.999-03:00" como texto, mas é 23h30 do dia 14 em
 * Brasília — dentro do período. Limite que não é data legível é ignorado
 * (como se não houvesse), para não esconder todo pedido novo por causa dele.
 */
export function instanteDentroDoPeriodo(
  criadoEm: string,
  inicio: string | undefined,
  fim: string | undefined,
): boolean {
  const limiteInicial = emMilissegundos(inicio);
  const limiteFinal = emMilissegundos(fim);
  if (limiteInicial === undefined && limiteFinal === undefined) return true;
  const quando = emMilissegundos(criadoEm);
  if (quando === undefined) return false;
  return (
    (limiteInicial === undefined || quando >= limiteInicial) &&
    (limiteFinal === undefined || quando <= limiteFinal)
  );
}

/**
 * O recorte que a tela manda ao banco, num ponto só: a LISTA e a planilha
 * (CSV) passam por aqui, então não dá para a lista mostrar um período e o
 * arquivo exportar outro.
 */
export function recorteDaListaDePedidos(filtro: {
  searchQuery: string | undefined;
  dateRange: { start?: string; end?: string };
}): { searchQuery: string; startDate?: string; endDate?: string } {
  return {
    searchQuery: termoDeBuscaDoPedido(filtro.searchQuery),
    startDate: inicioDoDiaDaLoja(filtro.dateRange.start),
    endDate: fimDoDiaDaLoja(filtro.dateRange.end),
  };
}
