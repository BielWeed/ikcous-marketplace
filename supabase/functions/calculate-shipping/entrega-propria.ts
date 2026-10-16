// @ts-nocheck
/**
 * ENTREGA PRÓPRIA DA LOJA (16/10/2026): "Entrego" / "Entrego e retiro" / "Só
 * retiro" e o prazo da entrega local. Desenho: `equipe/bastoes/
 * desenho-entrega-so-retiro-e-prazo-20261016.md`, peça B (edge).
 *
 * Duas colunas de `store_config` (migration da peça A, que pode ainda não
 * existir no banco desta loja):
 * - `local_delivery_enabled boolean` — a entrega própria (a "Entrega Local")
 *   está ligada? `false` = "Só retiro";
 * - `local_delivery_days integer` (0..30) — o prazo que a cliente lê.
 *
 * Tudo aqui é função pura: quem LÊ o banco é `configuracao.ts`
 * (`lerEntregaPropriaDaLoja`, leitura SEPARADA e tolerante — a coluna nova
 * nunca entra em `COLUNAS_DA_LOJA`).
 *
 * Regra-mãe: "Só retiro" desliga a Entrega Local e a retirada vale para
 * QUALQUER CEP. Nos outros dois modos a retirada continua só na cidade.
 */

export type EntregaPropria = {
    /** `false` = "Só retiro": a Entrega Local não é oferecida. */
    ativa: boolean
    /** Prazo da Entrega Local, em dias (0 = no mesmo dia). */
    dias: number
}

/**
 * O padrão da coluna (`DEFAULT true` / `DEFAULT 1`) — e o comportamento de
 * HOJE, usado quando a leitura falha ou as colunas ainda não existem.
 */
export const ENTREGA_PROPRIA_PADRAO: EntregaPropria = { ativa: true, dias: 1 }

/** O teto do CHECK da migration (`local_delivery_days BETWEEN 0 AND 30`). */
export const MAXIMO_DE_DIAS_DA_ENTREGA = 30

/**
 * O primeiro `contratoCliente` que entende `deliveryDays: 0` na Entrega Local
 * (a tela troca o 0 por "no mesmo dia"). Antes dele o app escreveria "até 0
 * dia útil" — por isso o 0 sai como 1 para quem não prova o contrato.
 */
export const CONTRATO_QUE_ENTENDE_ENTREGA_NO_MESMO_DIA = 3

/**
 * A linha crua das duas colunas → `EntregaPropria` válida, ou `null` quando a
 * forma não bate com o que o CHECK da migration garante (boolean de verdade,
 * inteiro de 0 a 30). As DUAS precisam valer: linha pela metade é leitura que
 * falhou (quem chama cai no padrão), nunca "metade da regra".
 */
export function entregaPropriaDaLinha(linha: any): EntregaPropria | null {
    const ativa = linha?.local_delivery_enabled
    if (typeof ativa !== 'boolean') return null
    const dias = linha?.local_delivery_days
    if (typeof dias !== 'number' || !Number.isInteger(dias)) return null
    if (dias < 0 || dias > MAXIMO_DE_DIAS_DA_ENTREGA) return null
    return { ativa, dias }
}

/** A loja está fora do padrão (só retiro, ou prazo diferente de 1 dia)? */
export function entregaPropriaDifereDoPadrao(entrega: EntregaPropria): boolean {
    return entrega.ativa !== ENTREGA_PROPRIA_PADRAO.ativa || entrega.dias !== ENTREGA_PROPRIA_PADRAO.dias
}

/**
 * O que entra no hash da `revisaoConfig` (spread dentro de `loja`): NADA
 * quando a leitura falhou (`null`) ou a loja está no padrão — o hash de hoje,
 * byte a byte — e o bloco `entrega_propria` quando a lojista mudou o modo ou
 * o prazo (a cliente com carrinho aberto recota).
 */
export function blocoDaEntregaPropriaNaRevisao(entrega: EntregaPropria | null): Record<string, unknown> {
    if (!entrega || !entregaPropriaDifereDoPadrao(entrega)) return {}
    return { entrega_propria: { ativa: entrega.ativa, dias: entrega.dias } }
}

/**
 * O prazo que vai para a cliente. Só o 0 é reescrito (para 1) e só quando o
 * app não prova o contrato 3+ — o número exato, nunca texto ("3"): é o mesmo
 * rigor do `aceitaRetirada === true`.
 */
export function prazoDaEntregaParaOApp(dias: number, contratoCliente: unknown): number {
    if (dias !== 0) return dias
    const entende = typeof contratoCliente === 'number' && contratoCliente >= CONTRATO_QUE_ENTENDE_ENTREGA_NO_MESMO_DIA
    return entende ? 0 : 1
}

/**
 * A opção "Entrega Local" — id, nome e provedor INTOCADOS (e-mail, etiqueta,
 * antifraude, ficha da lojista e app antigo seguem entendendo); só o prazo
 * vem da lojista.
 */
export function opcaoDeEntregaLocal(preco: number, entrega: EntregaPropria, contratoCliente: unknown) {
    return {
        id: 'local-delivery',
        name: 'Entrega Local',
        price: preco,
        deliveryDays: prazoDaEntregaParaOApp(entrega.dias, contratoCliente),
        provider: 'local',
    }
}

/**
 * A retirada ANEXADA depois: vai no fim da lista (a de transportadoras ou a
 * local) e NUNCA entra em `shipping_quotes_cache` — a RPC do pedido resolve
 * `store-pickup` pelo id, sem procurar no cache. `retirada` nula = nada a
 * anexar (a lista volta como veio, mesma referência).
 */
export function comRetiradaAnexada<T>(opcoes: T[], retirada: T | null): T[] {
    return retirada ? [...opcoes, retirada] : opcoes
}
