// Conta do troco na tela Vender (balcão), quando o pagamento é em dinheiro.
// É só conta na tela: nada daqui é gravado nem enviado ao servidor.
//
// Tudo em CENTAVOS inteiros. Em reais com ponto flutuante, 0,10 + 0,20 dá
// 0,30000000000000004 e 20.05 * 100 dá 2004.9999…; um troco errado em um
// centavo é exatamente o tipo de erro que a lojista não vê e o caixa sente.

/** Notas e valores redondos que a cliente costuma entregar, em reais. */
const NOTAS_EM_REAIS = [5, 10, 20, 50, 100, 200] as const;

const MAXIMO_DE_SUGESTOES = 3;

export type ResultadoDoTroco =
  | { readonly tipo: "troco"; readonly centavos: number }
  | { readonly tipo: "faltam"; readonly centavos: number };

/**
 * `recebidoCentavos` nulo = campo vazio: não há o que mostrar. Pagou o
 * suficiente (inclusive exato) é `troco`, com zero quando bate certinho;
 * pagou menos é `faltam`. Só aviso: quem decide registrar a venda é a lojista.
 */
export function calcularTroco(
  totalCentavos: number,
  recebidoCentavos: number | null,
): ResultadoDoTroco | null {
  if (recebidoCentavos === null) return null;
  const diferenca = recebidoCentavos - totalCentavos;
  return diferenca >= 0
    ? { tipo: "troco", centavos: diferenca }
    : { tipo: "faltam", centavos: -diferenca };
}

/**
 * Até 3 valores redondos ESTRITAMENTE acima do total: para cada nota (5, 10,
 * 20, 50, 100, 200) o próximo múltiplo dela depois do total; sem repetir, do
 * menor para o maior. Total redondo (R$ 100,00) não sugere ele mesmo — daria
 * troco zero. Total zero ou inválido não tem o que cobrar: devolve vazio.
 */
export function sugerirNotas(totalCentavos: number): readonly number[] {
  if (!Number.isSafeInteger(totalCentavos) || totalCentavos <= 0) return [];
  const proximos = new Set<number>();
  for (const nota of NOTAS_EM_REAIS) {
    const notaCentavos = nota * 100;
    proximos.add((Math.floor(totalCentavos / notaCentavos) + 1) * notaCentavos);
  }
  return [...proximos].sort((a, b) => a - b).slice(0, MAXIMO_DE_SUGESTOES);
}

/**
 * Lê o texto que o campo de dinheiro entrega ao sair ("50.00", "0.05", "137",
 * ou "" quando vazio) e devolve centavos, SEM passar por ponto flutuante.
 * Vazio, negativo, com mais de 2 casas ou grande demais para ser exato
 * (acima do inteiro seguro) devolve `null`: nunca um troco inventado.
 */
export function centavosDoTextoEmReais(texto: string): number | null {
  const partes = texto.trim().split(".");
  if (partes.length > 2) return null;
  const [inteira, decimal] = partes;
  if (!/^\d+$/.test(inteira)) return null;
  if (decimal !== undefined && !/^\d{1,2}$/.test(decimal)) return null;
  const reais = Number(inteira);
  const centavos = Number((decimal ?? "").padEnd(2, "0"));
  const total = reais * 100 + centavos;
  return Number.isSafeInteger(total) ? total : null;
}
