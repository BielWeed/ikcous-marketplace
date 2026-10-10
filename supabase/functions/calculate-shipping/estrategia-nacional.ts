// @ts-nocheck
/**
 * ESTRATÉGIA DO FRETE NACIONAL (23/09/2026): regra pura, calculada UMA vez na
 * edge sobre as opções nacionais depois que os provedores respondem.
 * Contrato: `docs/superpowers/plans/2026-09-23-estrategias-de-frete-local-e-nacional.md`
 * (seção "CONTRATO FIXO ENTRE AS PEÇAS" — nenhum executor muda isto sozinho).
 *
 * Tudo aqui é função pura: nada lê banco (isso é do `configuracao.ts`/`index.ts`).
 */
import { aoCentavo, valorUnitarioDoBanco } from './regua.ts'

const ESTRATEGIAS_NACIONAIS = ['desligado', 'acima_de_valor', 'sempre', 'por_produto', 'desconto_na_mais_barata'] as const
const TIPOS_DE_DESCONTO = ['percentual', 'fixo'] as const
const ALCANCES = ['mais_barata', 'todas'] as const

export type EstrategiaNacionalTipo = (typeof ESTRATEGIAS_NACIONAIS)[number]
export type TipoDeDescontoNacional = (typeof TIPOS_DE_DESCONTO)[number]
export type AlcanceNacional = (typeof ALCANCES)[number]

/** As 5 colunas de `store_config` (lidas no instante da cotação — é o carimbo). */
export type EstrategiaNacional = {
    estrategia: EstrategiaNacionalTipo
    minimo: number
    tipoDesconto: TipoDeDescontoNacional | null
    valorDesconto: number
    alcance: AlcanceNacional
}

function numero(valor: unknown): number | null {
    const n = typeof valor === 'number'
        ? valor
        : typeof valor === 'string' && valor.trim().length > 0 ? Number(valor) : Number.NaN
    return Number.isFinite(n) ? n : null
}

/**
 * A linha crua das 5 colunas (do banco, ou de um teste) → `EstrategiaNacional`
 * válida, ou `null` se a forma não bate com o que o CHECK da migration exige
 * (enum errado, número negativo, tipo de desconto desconhecido). Quem chama
 * trata `null` como leitura que falhou (espelho legado).
 */
export function estrategiaNacionalDaLinha(linha: any): EstrategiaNacional | null {
    const estrategia = linha?.national_shipping_strategy
    if (!ESTRATEGIAS_NACIONAIS.includes(estrategia)) return null
    const minimo = numero(linha?.national_shipping_min)
    if (minimo === null || minimo < 0) return null
    const tipoBruto = linha?.national_discount_type
    let tipoDesconto: TipoDeDescontoNacional | null
    if (tipoBruto === null || tipoBruto === undefined) {
        tipoDesconto = null
    } else if (TIPOS_DE_DESCONTO.includes(tipoBruto)) {
        tipoDesconto = tipoBruto
    } else {
        return null
    }
    const valorDesconto = numero(linha?.national_discount_value)
    if (valorDesconto === null || valorDesconto < 0) return null
    const alcance = linha?.national_benefit_scope
    if (!ALCANCES.includes(alcance)) return null
    return { estrategia, minimo, tipoDesconto, valorDesconto, alcance }
}

/**
 * O espelho legado da regra de hoje (`store_config.free_shipping_min`), como
 * a migration copiaria SE rodasse agora — usado só como QUEDA quando a
 * leitura tolerante das 5 colunas falha (banco sem elas). Tabela do
 * contrato: `0`/NULL → desligado; `0.01` → sempre; `< 0` → por_produto;
 * `> 0` → acima_de_valor (min = o mesmo). Alcance `todas` nos três — é o que
 * preserva o comportamento de hoje: cada loja continua cobrando amanhã
 * exatamente o que cobra hoje. `desligado` é a EXCEÇÃO (EMENDA revisão T1):
 * alcance `mais_barata`, o mesmo default da coluna — sem efeito prático (não
 * há benefício nenhum quando a estratégia está desligada), só para bater com
 * o que a migration gravaria.
 */
export function espelhoLegado(freeShippingMin: unknown): EstrategiaNacional {
    const min = numero(freeShippingMin) ?? 0
    const semDesconto = { tipoDesconto: null as null, valorDesconto: 0 }
    if (min === 0.01) return { ...semDesconto, estrategia: 'sempre', minimo: 0, alcance: 'todas' }
    if (min < 0) return { ...semDesconto, estrategia: 'por_produto', minimo: 0, alcance: 'todas' }
    if (min > 0) return { ...semDesconto, estrategia: 'acima_de_valor', minimo: min, alcance: 'todas' }
    // EMENDA (revisão T1, 23/09): `desligado` nasce com alcance `mais_barata`
    // — o mesmo default da coluna `national_benefit_scope` no banco (não
    // `todas`, que era o valor de antes desta emenda).
    return { ...semDesconto, estrategia: 'desligado', minimo: 0, alcance: 'mais_barata' }
}

/**
 * Subtotal do carrinho pelo BANCO: `Σ (price_override da variação se não
 * nulo, senão preco_venda) × quantidade` (quantidade ausente = 1) — a MESMA
 * conta da RPC do pedido (`create_marketplace_order_v23/_v24`, "3. Validation
 * Loop": `COALESCE(v.price_override, p.preco_venda) * quantity`).
 *
 * Item cujo produto não está no mapa (a leitura de `produtos` falhou, ou o
 * item referencia um produto apagado) NÃO entra na soma — mas isso não é a
 * defesa real: quem chama (`cotarUmaVez`) já decide ANTES de chegar aqui não
 * aplicar a estratégia nenhuma quando `insumos.produtosSemCadastro > 0` (o
 * caminho seguro é "preço cheio, sem carimbo", o mesmo da leitura tolerante
 * que falhou — nunca um subtotal silenciosamente incompleto). Esta função só
 * decide SE a estratégia bate; não é a fonte da verdade do pedido.
 */
export function subtotalDoCarrinho(
    itens: any[],
    dbProductsMap: Map<unknown, any>,
    variantesMap: Map<unknown, any>,
): number {
    let total = 0
    for (const item of Array.isArray(itens) ? itens : []) {
        const produtoId = item?.product?.id ?? item?.productId ?? null
        const varianteId = item?.variantId ?? null
        const qtd = Number(item?.quantity ?? 1) || 1
        const produto = dbProductsMap.get(produtoId)
        if (!produto) continue
        const variante = varianteId ? variantesMap.get(varianteId) : null
        const valor = valorUnitarioDoBanco(produto, variante, !!varianteId)
        if (valor === null) continue
        total += valor * qtd
    }
    return aoCentavo(total)
}

function centavosDoPreco(preco: unknown): number {
    const n = Number(preco)
    return Number.isFinite(n) ? Math.round(n * 100) : 0
}

/**
 * Aplica a estratégia nacional às opções (TODAS nacionais — local e retirada
 * nunca chegam aqui). Devolve as opções com `price` FINAL, `precoCheio`
 * (preço da transportadora antes da estratégia), `estrategiaNacional`
 * (carimbo = as 5 colunas recebidas) e `subtotalCotacao` (EMENDA pós-revisão
 * T1, 23/09 — o subtotal com que a regra foi aplicada; a RPC compara com o
 * subtotal da hora do pedido e recusa se divergir).
 *
 * O ALCANCE só vale para o GRÁTIS (`sempre`/`acima_de_valor`): todas as
 * opções, ou só as de MENOR `precoCheio` (empate: todas as empatadas). O
 * DESCONTO (`desconto_na_mais_barata`) é SEMPRE só na(s) de menor `precoCheio`
 * — o alcance da coluna é ignorado nesse caso (EMENDA revisão T1: o servidor
 * não confia que o admin só grava `mais_barata` para desconto). Conta em
 * CENTAVOS inteiros — o mesmo número que vai para a tela e para o cache que
 * a RPC lê:
 * - `percentual`: `cheioC − Math.round(cheioC × pct / 100)`.
 * - `fixo`: `cheioC − min(valorC, cheioC)`.
 * Nunca negativo. `acima_de_valor` exige `minimo > 0` (o CHECK da migration
 * já garante isso na linha real; a guarda aqui é só defensiva). Desconto com
 * `minimo` 0 vale sempre (subtotal ≥ 0 é sempre verdade).
 */
export function aplicarEstrategiaNacional(
    opcoes: any[],
    estrategia: EstrategiaNacional,
    subtotal: number,
): any[] {
    if (!Array.isArray(opcoes) || opcoes.length === 0) return opcoes
    const carimbo: EstrategiaNacional = { ...estrategia }
    const subtotalCotacao = aoCentavo(Number(subtotal) || 0)
    const cheios = opcoes.map((opcao) => ({ opcao, cheioC: centavosDoPreco(opcao?.price) }))
    const menorC = Math.min(...cheios.map(({ cheioC }) => cheioC))
    const subtotalC = Math.round(subtotalCotacao * 100)
    const minimoC = Math.round(estrategia.minimo * 100)

    const bate = estrategia.estrategia === 'sempre'
        || (estrategia.estrategia === 'acima_de_valor' && estrategia.minimo > 0 && subtotalC >= minimoC)
        || (estrategia.estrategia === 'desconto_na_mais_barata' && subtotalC >= minimoC)

    return cheios.map(({ opcao, cheioC }) => {
        const precoCheio = cheioC / 100
        const beneficiada = bate && (
            estrategia.estrategia === 'desconto_na_mais_barata'
                ? cheioC === menorC
                : (estrategia.alcance === 'todas' || cheioC === menorC)
        )
        if (!beneficiada) {
            return { ...opcao, precoCheio, price: precoCheio, estrategiaNacional: carimbo, subtotalCotacao }
        }
        let finalC = cheioC
        if (estrategia.estrategia === 'sempre' || estrategia.estrategia === 'acima_de_valor') {
            finalC = 0
        } else if (estrategia.estrategia === 'desconto_na_mais_barata') {
            const valorC = Math.round(estrategia.valorDesconto * 100)
            finalC = estrategia.tipoDesconto === 'percentual'
                ? cheioC - Math.round((cheioC * estrategia.valorDesconto) / 100)
                : cheioC - Math.min(valorC, cheioC)
            if (finalC < 0) finalC = 0
        }
        return { ...opcao, precoCheio, price: finalC / 100, estrategiaNacional: carimbo, subtotalCotacao }
    })
}
