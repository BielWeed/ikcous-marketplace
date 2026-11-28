/**
 * Trocar o VALOR de uma opção já gravada ("M" -> "GG") não renomeia a linha:
 * no salvar ela vira uma opção NOVA (decisão de produto, 27/11/2026). Renomear
 * a mesma linha fazia a cliente com "M" no carrinho ver "GG" sem aviso e o
 * estoque devolvido de um pedido de "M" cair no "GG".
 *
 * O que vai para `salvar_produto_com_grade` (o banco não muda):
 *  - a antiga entra em `p_apagar` E, na grade, desligada e sem SKU nem código de
 *    barras. O banco apaga primeiro; a que já tem venda é recusada (fica em
 *    `recusadas`) e então recebe o UPDATE: desligada, guardada para os pedidos
 *    antigos, sem estoque para venda e com os códigos liberados para a nova;
 *  - a nova vai sem id, com os códigos, o estoque e o preço da linha da tela.
 * As antigas vão na FRENTE da lista: o UPDATE que solta o código roda antes de
 * qualquer linha que o pegue.
 *
 * Só corrigir a grafia (mesma palavra, ignorando maiúscula, acento e espaços nas
 * pontas ou repetidos) segue editando a mesma linha.
 */
import type { ProductVariant } from "@/types";

/** "  Médio " e "medio" são a mesma opção; "M" e "GG", não. */
export function normalizarValorDaOpcao(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

export interface TrocaDeValor {
  idAntigo: string;
  valorAntigo: string;
  valorNovo: string;
}

type VariacaoDoEnvio = Pick<ProductVariant, "id" | "name" | "value"> &
  Partial<Omit<ProductVariant, "id" | "name" | "value">>;

/**
 * @param aMandar as variações que o salvar ia mandar (já com o SKU limpo; a que
 *   não teve o estoque mexido chega sem `stockIncrement`)
 * @param naTela  a grade inteira da tela (de onde a nova herda o estoque)
 * @param gravadas a grade como a tela a abriu (o valor antigo de cada id)
 */
export function trocasDeValorComoOpcaoNova<V extends VariacaoDoEnvio>(
  aMandar: readonly V[],
  naTela: readonly Pick<ProductVariant, "id" | "stockIncrement">[],
  gravadas: readonly ProductVariant[],
): {
  variantes: Array<V | VariacaoDoEnvio>;
  apagar: string[];
  trocas: TrocaDeValor[];
} {
  const deAbertura = new Map(gravadas.map((v) => [v.id, v]));
  const antigas: VariacaoDoEnvio[] = [];
  const resto: Array<V | VariacaoDoEnvio> = [];
  const apagar: string[] = [];
  const trocas: TrocaDeValor[] = [];

  for (const v of aMandar) {
    const gravada = v.id.startsWith("temp-") ? undefined : deAbertura.get(v.id);
    if (
      !gravada ||
      normalizarValorDaOpcao(gravada.value) === normalizarValorDaOpcao(v.value)
    ) {
      resto.push(v);
      continue;
    }
    // A antiga guarda valor, preço e foto para o histórico. O saldo vai só
    // para a nova, para não duplicar as peças se a antiga for religada.
    antigas.push({
      id: gravada.id,
      productId: gravada.productId,
      name: v.name,
      value: gravada.value,
      sku: undefined,
      codigoBarras: undefined,
      priceOverride: gravada.priceOverride,
      stockIncrement: 0,
      active: false,
      imageUrl: gravada.imageUrl,
    });
    const estoqueDaLinha =
      naTela.find((t) => t.id === v.id)?.stockIncrement ??
      v.stockIncrement ??
      gravada.stockIncrement;
    resto.push({
      ...v,
      id: `temp-troca-${gravada.id}`,
      stockIncrement: estoqueDaLinha,
    });
    apagar.push(gravada.id);
    trocas.push({
      idAntigo: gravada.id,
      valorAntigo: gravada.value,
      valorNovo: v.value,
    });
  }

  return { variantes: [...antigas, ...resto], apagar, trocas };
}

type VariacaoDaConferencia = Pick<
  ProductVariant,
  "id" | "name" | "value" | "active"
>;

/**
 * Liga cada troca pendente à opção de mesmo tipo e valor criada no banco.
 * A antiga está desligada com o valor de abertura ou já foi apagada. Isso
 * identifica a opção, não prova que o preço digitado também foi salvo.
 */
export function opcoesNovasCorrespondentes<V extends VariacaoDaConferencia>(
  tela: readonly VariacaoDaConferencia[],
  abertura: readonly VariacaoDaConferencia[],
  banco: readonly V[],
  soAntigasGuardadas = false,
): Map<string, V> {
  const aberturaPorId = new Map(abertura.map((v) => [v.id, v]));
  const bancoPorId = new Map(banco.map((v) => [v.id, v]));
  const conhecidas = new Set([...tela, ...abertura].map((v) => v.id));
  const novasDoBanco = banco.filter((v) => !conhecidas.has(v.id));
  const usadas = new Set<string>();
  const mesmaOpcao = (a: VariacaoDaConferencia, b: VariacaoDaConferencia) =>
    normalizarValorDaOpcao(a.name) === normalizarValorDaOpcao(b.name) &&
    normalizarValorDaOpcao(a.value) === normalizarValorDaOpcao(b.value);

  const novasPorIdAntigo = new Map<string, V>();
  for (const v of tela) {
    if (v.id.startsWith("temp-")) continue;
    const antes = aberturaPorId.get(v.id);
    const hoje = bancoPorId.get(v.id);
    if (!antes || hoje?.active || (soAntigasGuardadas && !hoje)) continue;
    const valorDeAbertura = normalizarValorDaOpcao(antes.value);
    if (
      normalizarValorDaOpcao(v.value) === valorDeAbertura ||
      (hoje && normalizarValorDaOpcao(hoje.value) !== valorDeAbertura)
    ) {
      continue;
    }
    const nova = novasDoBanco.find(
      (n) => !usadas.has(n.id) && mesmaOpcao(n, v),
    );
    if (!nova) continue;
    usadas.add(nova.id);
    novasPorIdAntigo.set(v.id, nova);
  }
  return novasPorIdAntigo;
}

/** Trocas reconhecidas em que o banco guardou a antiga para os pedidos. */
export function trocasJaGravadasNoBanco(
  tela: readonly VariacaoDaConferencia[],
  abertura: readonly VariacaoDaConferencia[],
  banco: readonly VariacaoDaConferencia[],
): TrocaDeValor[] {
  const bancoPorId = new Map(banco.map((v) => [v.id, v]));
  return Array.from(
    opcoesNovasCorrespondentes(tela, abertura, banco, true),
  ).flatMap(([idAntigo, nova]) => {
    const antiga = bancoPorId.get(idAntigo);
    return antiga
      ? [{ idAntigo, valorAntigo: antiga.value, valorNovo: nova.value }]
      : [];
  });
}

/** O aviso quando o banco guardou a antiga (ela já tinha venda). */
export function fraseDaTrocaGuardada(troca: TrocaDeValor): string {
  return `O "${troca.valorAntigo}" já foi vendido, então guardamos ele desligado para os pedidos antigos e criamos o "${troca.valorNovo}" como opção nova. Confira o estoque das duas linhas.`;
}
