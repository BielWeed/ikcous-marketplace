// ============================================================================
// Edge function melhor-envio-etiqueta — Onda 3: rastreio automático.
//
// Gera a etiqueta de envio de um pedido na API do Melhor Envio e consulta o
// rastreio de uma etiqueta já gerada. Substitui o fluxo manual de hoje
// (comprar etiqueta no site do ME, copiar o código, colar no pedido).
//
// CREDENCIAIS (fonte única — o padrão da casa, igual ao `calculate-shipping`):
//   O token do Melhor Envio NÃO mora em env var nem no código: mora na tabela
//   `store_shipping_credentials`, linha provider='melhor_envio', coluna
//   `credentials` (JSON: { token, sandbox }). É o mesmo token que o lojista
//   cadastra e testa na tela Logística & Frete do painel. Sem a linha, a
//   function falha fechado com mensagem de configuração — NUNCA inventa
//   credencial e NUNCA chama a API sem token.
//
// SEGURANÇA: as duas actions exigem admin (mesmo verifyIsAdmin do
// `calculate-shipping` — anon/customer recebem 403 antes de qualquer leitura
// de pedido). Toda leitura/escrita no banco usa service role.
//
// DINHEIRO: o checkout da etiqueta usa o SALDO da conta do Melhor Envio do
// lojista. Proteções embutidas:
//   * pedido só etiqueta com pagamento CONFIRMADO (`payment_status` `pago`,
//     `pago_apos_expirar` ou `recebido_na_entrega` — os três valores de
//     "dinheiro que entrou" do CHECK) — falha fechado (recomendação do
//     revisor, aplicada pelo supervisor 03/09/2026; reversível pelo dono);
//   * o pedido é REIVINDICADO com update condicional ENTRE o carrinho e o
//     checkout (`shipping_label_id` NULL -> labelId, uma linha só vence) —
//     re-clique/aba paralela não compra duas etiquetas; quem perde a corrida
//     tem o item REMOVIDO do carrinho do ME e recebe "já existe uma geração
//     em andamento";
//   * pedido que JÁ TEM `shipping_label_id` não gera etiqueta de novo — a
//     segunda chamada devolve a etiqueta existente (`already: true`), então
//     falha suave de generate/print/tracking não vira segunda compra;
//   * falha no CHECKOUT com resposta DEFINIDA do ME (HTTP 4xx, ou 200 com
//     status != paid) remove o item do carrinho do ME (nada fica lá para o
//     lojista comprar sem querer) e LIBERA a reivindicação — o ME RESPONDEU
//     que a compra não fechou, não há ambiguidade de dinheiro; o pedido volta
//     a poder etiquetar quando o lojista tentar de novo (revisor, bloqueante
//     A da 2ª rodada, PR #423);
//   * 5xx do checkout (um gateway pode ter DEBITADO com a resposta perdida —
//     o ME não disse "não pagou") e exceção/timeout DEPOIS da reivindicação
//     são INDETERMINADOS (`finalizarIndeterminado`): evento
//     `checkout_indeterminado`, reivindicação MANTIDA, carrinho intacto e
//     502 mandando conferir a conta do ME antes de qualquer retry — liberar
//     aqui reabriria o caminho de compra dupla (revisor, B e A′ da 2ª rodada);
//   * modo Sandbox da credencial manda tudo para o sandbox do ME (sem custo).
//
// ENDPOINTS v2 do Melhor Envio (doc oficial docs.melhorenvio.com.br):
//   GET  /api/v2/me                   — dados do remetente (empresa/endereço)
//   POST /api/v2/me/cart              — cria a etiqueta no carrinho (201,
//                                       não consome saldo)
//   DELETE /api/v2/me/cart/{id}       — remove etiqueta não paga do carrinho
//   POST /api/v2/me/shipment/checkout — paga com o saldo ({ orders: [id] })
//   POST /api/v2/me/shipment/generate — gera a etiqueta ({ orders: [id] })
//   POST /api/v2/me/shipment/print    — link de impressão ({ url })
//   POST /api/v2/me/shipment/tracking — código de rastreio ({ tracking })
//
// DEVOLUÇÃO (action `gerar_devolucao_reversa`, plano 2026-09-26 tarefa 7):
//   POST /api/v2/me/cart/reverse      — logística reversa dos Correios no
//                                       carrinho (doc "Inserir Logística
//                                       Reversa no carrinho"), depois o MESMO
//                                       checkout/generate da ida
//   GET  /api/v2/me/imprimir/dace/pdf/{id} — link da DC-e (DACE) que o
//                                       cliente imprime e leva junto
//   Ver o bloco "LOGÍSTICA REVERSA" mais abaixo.
// ============================================================================
// @ts-nocheck
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { ehRetiradaNaLoja } from "../_shared/retirada-na-loja.ts"
import { cpfDoDestinatario, cpfValido, sanitizarCpfDoTexto, sanitizarDadosPessoaisDoTexto } from "./cpf.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Recuo LEGADO do User-Agent (contrato 1.5.7, R3-7): só usado quando a
// credencial melhor_envio NÃO tem `contact_email` salvo — mantém as lojas de
// hoje (SAVY, IKCOUS) no ar até a lojista preencher o campo no painel.
const USER_AGENT = 'IKCOUS-Marketplace-Integration (contato@ikcous.com.br)'

/**
 * O projeto está migrando das chaves legadas (anon/service_role, formato JWT)
 * para as novas (publishable/secret). MESMA cópia do `calculate-shipping`: lê
 * a nova e cai pra legada, para funcionar antes E depois da migração.
 */
function readKey(newVar: string, legacyVar: string): string {
    try {
        const parsed = JSON.parse(Deno.env.get(newVar) ?? '{}')
        if (parsed?.default) return parsed.default
    } catch {
        // variável ausente ou JSON inválido — segue pro fallback
    }
    return Deno.env.get(legacyVar) ?? ''
}

/**
 * MESMA costura do `calculate-shipping`: fetch com tempo de espera. A API do
 * Melhor Envio já pendurou de verdade; uma geração de etiqueta faz ATÉ SEIS
 * chamadas encadeadas — sem o corte, um travamento segurava o lojista
 * indefinidamente no meio do fluxo.
 */
export async function buscarComTempo(
    buscar: typeof fetch,
    url: string,
    init: RequestInit = {},
    tempoMs = 20000,
): Promise<Response> {
    const controle = new AbortController()
    const despertar = setTimeout(() => controle.abort(), tempoMs)
    try {
        return await buscar(url, { ...init, signal: controle.signal })
    } finally {
        clearTimeout(despertar)
    }
}

/**
 * Verifica se quem chamou é admin. MESMA cópia do `calculate-shipping`:
 * valida o JWT com o anon key, sobe o papel de `profiles` com service role.
 */
async function verifyIsAdmin(
    authHeader: string | null,
    supabaseUrl: string,
    serviceRoleKey: string,
): Promise<boolean> {
    if (!authHeader) return false
    try {
        const anonKey = readKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
        const userClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } },
        })
        const { data: { user }, error: userError } = await userClient.auth.getUser()
        if (userError || !user) return false
        const systemClient = createClient(supabaseUrl, serviceRoleKey)
        const { data: profile, error: profileError } = await systemClient
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()
        if (profileError || !profile) return false
        return profile.role === 'admin'
    } catch (err) {
        console.error('[melhor-envio-etiqueta] Falha no check de admin:', err)
        return false
    }
}

/**
 * Regra ÚNICA de extração do id do Melhor Envio embutido na opção de frete —
 * captura completa `^melhor-envio-(\d+)(-ss)?$` (contrato 1.5.7, R1-6): nunca
 * `parseInt` parcial nem `startsWith` para tirar o número. O sufixo `-ss`
 * (contrato A6) marca a opção cotada SEM seguro; id sem sufixo mantém o
 * comportamento de hoje (seguro = subtotal dos itens).
 */
const REGEX_OPCAO_MELHOR_ENVIO = /^melhor-envio-(\d+)(-ss)?$/

/**
 * Analisa o id completo da opção do Melhor Envio (do checkout ou do seletor
 * manual): devolve o id numérico do serviço e se ela foi cotada SEM seguro
 * (sufixo `-ss`). `null` para qualquer formato que não seja da própria casa
 * (flat-fee-*, local-delivery, superfrete-*, frenet-*, null).
 */
export function analisarOpcaoMelhorEnvio(optionId: unknown): { id: string; semSeguro: boolean } | null {
    if (typeof optionId !== 'string') return null
    const casou = optionId.match(REGEX_OPCAO_MELHOR_ENVIO)
    if (!casou) return null
    return { id: casou[1], semSeguro: casou[2] === '-ss' }
}

/**
 * O id do serviço do Melhor Envio escondido no id da opção de frete que o
 * pedido guardou no checkout (`customer_data.shipping_option_id` — a RPC
 * `create_marketplace_order_v2*` grava o id cru da opção, e a cotação do
 * `calculate-shipping` monta ids `melhor-envio-{service.id}` ou
 * `melhor-envio-{service.id}-ss`).
 *
 * Só casa o formato da própria casa (com ou sem `-ss`). Qualquer outra coisa
 * (flat-fee-*, local-delivery, superfrete-*, frenet-*, null) devolve null —
 * e o chamador RECUSA o pedido: cotar de novo aqui escolheria `opcoes[0]` SEM
 * o filtro de métodos que a loja habilitou (contratar serviço que o lojista
 * nem oferece), e entrega fixa/local é feita pelo próprio lojista, não por
 * etiqueta.
 */
export function extrairServiceIdDaOpcao(optionId: unknown): string | null {
    return analisarOpcaoMelhorEnvio(optionId)?.id ?? null
}

/**
 * O endereço de entrega do pedido, com a MESMA prioridade do mapper do painel
 * (`mapOrderFromDB`): snapshot `addressData`, depois `address` objeto, depois
 * a raiz de `customer_data`. O snapshot vence — o endereço atual do perfil
 * nunca reescreve o passado (mesma regra do mapper).
 *
 * Recusa (devolve null) quando falta o essencial para o transportador:
 * CEP e cidade. Rua sem número vai com aviso? NÃO — recusa também: a
 * transportadora não entrega pacote sem número; melhor parar antes de gastar
 * saldo do lojista numa etiqueta que os Correios devolveriam.
 */
export function extrairEnderecoDoPedido(
    customerData: Record<string, any> | null | undefined,
): { cep: string; street: string; number: string; complement: string; district: string; city: string; state: string } | null {
    const cd = customerData || {}
    const fonte = cd.addressData || (typeof cd.address === 'object' && cd.address !== null ? cd.address : null) || cd || {}
    const cep = String(fonte.cep || cd.cep || '').replace(/\D/g, '')
    const street = String(fonte.street || fonte.address_text || (typeof cd.address === 'string' ? cd.address : '') || '')
    const number = String(fonte.number || cd.number || '')
    const city = String(fonte.city || cd.city || '')
    if (cep.length !== 8 || !city || !street || !number) return null
    return {
        cep,
        street,
        number,
        complement: String(fonte.complement || cd.complement || ''),
        district: String(fonte.neighborhood || cd.neighborhood || ''),
        city,
        state: String(fonte.state || cd.state || ''),
    }
}

/**
 * Portão de status do pedido antes de gastar saldo: pedido cancelado,
 * entregue ou sem endereço utilizável não gera etiqueta. `returns` não está
 * no CHECK do status vivo, mas entra na mesma lista por segurança — é estado
 * de pedido morto para envio.
 */
export function erroDePedidoParaEtiqueta(pedido: { status?: string | null }): string | null {
    const status = String(pedido?.status || '').toLowerCase()
    if (['cancelled', 'delivered', 'returned'].includes(status)) {
        return `Pedido com status "${status}" não gera etiqueta de envio.`
    }
    return null
}

/**
 * Portão de PAGAMENTO (falha FECHADO): a etiqueta usa o saldo REAL da conta
 * do Melhor Envio do lojista — só pedido com pagamento CONFIRMADO etiqueta.
 * Passam os TRÊS valores de "dinheiro que entrou" do CHECK
 * `marketplace_orders_payment_status_check`: `pago`, `pago_apos_expirar` e
 * `recebido_na_entrega` (lojista registrou o pagamento na mão — RPC
 * `registrar_pagamento_recebido`; migrations 20261021000000:122,
 * 20261062000000:116 e 20261073000000:41). NULL (pedido antigo, anterior à
 * coluna), 'aguardando', 'recusado', 'expirado' e 'estornado' todos recusados
 * (mesmo critério de filtragem da lista do card — uma regra, dois lugares
 * lendo da MESMA lista de valores do CHECK).
 *
 * Recomendação do revisor (@claude, PR #423) aplicada pelo supervisor em
 * 03/09/2026 — reversível pelo dono.
 */
export const PAGAMENTOS_QUE_ETIQUETAM = [
    'pago',
    'pago_apos_expirar',
    'recebido_na_entrega',
] as const

export function erroDePagamentoParaEtiqueta(paymentStatus: unknown): string | null {
    const status = String(paymentStatus || '').toLowerCase()
    if ((PAGAMENTOS_QUE_ETIQUETAM as readonly string[]).includes(status)) return null
    return 'Só pedido com pagamento confirmado gera etiqueta — ela é comprada com o saldo real da sua conta no Melhor Envio. Confirme o pagamento do pedido e tente de novo.'
}

/**
 * Mensagem de recusa para quando o pedido NÃO tem serviço do Melhor Envio
 * para etiquetar (`extrairServiceIdDaOpcao` devolveu null) — achado
 * index-691. ANTES este caminho tinha UMA frase fixa, "foi frete fixo ou
 * entrega local", para qualquer opção ausente. Mas a taxa fixa MORREU na
 * migração do frete v2 (a RPC recusa `flat-fee-%`, calculate-shipping
 * index.ts:278) e o caso mais comum de opção ausente hoje é OUTRO: um preset
 * de frete grátis esconde a calculadora do carrinho inteira
 * (CartView.tsx:495), então o pedido nasce sem NENHUMA opção — não com uma
 * opção fixa/local que alguém escolheu. Dizer "foi frete fixo ou entrega
 * local" nesse caso manda o lojista atrás do motivo errado.
 *
 * `podeEscolherServico` é o sinal para o CARD (contrato com a tarefa irmã
 * EtiquetasEnvioCard): true quando a causa é FALTA de opção — grátis, pedido
 * antigo sem opção salva, ou a taxa fixa morta — porque nesses casos o
 * lojista pode escolher o serviço agora e reenviar com `serviceId` (ver
 * `normalizarServicoEscolhidoPeloLojista`); false quando o pedido de fato foi
 * por ENTREGA LOCAL — aí quem despacha é a própria loja, não existe serviço
 * de transportadora para escolher.
 *
 * RETIRADA NA LOJA (release 1.5.3): false também — a cliente busca o pedido
 * no balcão, não existe envio. Sem este ramo, `store-pickup` (frete 0) caía
 * em "saiu com frete grátis… escolha o serviço" e o lojista conseguia
 * comprar etiqueta com o saldo do Melhor Envio para um pedido que ninguém
 * vai despachar.
 */
export function erroDeServicoParaEtiqueta(
    shippingOptionId: unknown,
    shippingFee: unknown,
): { mensagem: string; podeEscolherServico: boolean } {
    if (ehRetiradaNaLoja(shippingOptionId)) {
        return {
            mensagem: 'Este pedido é de retirada na loja — a cliente busca no seu endereço. Não existe etiqueta de envio para este caso.',
            podeEscolherServico: false,
        }
    }
    if (shippingOptionId === 'local-delivery') {
        return {
            mensagem: 'Este pedido foi por entrega local — quem despacha é a própria loja. Não existe etiqueta pela API do Melhor Envio para este caso.',
            podeEscolherServico: false,
        }
    }
    // SUPERFRETE (release 1.5.4): frete cotado e cobrado em OUTRA
    // transportadora. No ramo genérico lá embaixo (`podeEscolherServico:
    // true`) o `serviceId` do corpo era aceito e a etiqueta saía COMPRADA no
    // Melhor Envio, com o saldo da lojista. A etiqueta é feita no site da
    // SuperFrete.
    if (typeof shippingOptionId === 'string' && shippingOptionId.startsWith('superfrete-')) {
        return {
            mensagem: 'Este pedido foi cotado e cobrado pela SuperFrete — a etiqueta é feita no site da SuperFrete, não pelo Melhor Envio.',
            podeEscolherServico: false,
        }
    }
    // FRENET (release 1.5.7): mesma ideia do ramo SuperFrete acima — frete
    // cotado e cobrado em outra transportadora. Sem este ramo, `frenet-*`
    // caía no genérico (`podeEscolherServico: true`) e um `serviceId` do
    // corpo comprava a etiqueta no Melhor Envio com o saldo da lojista para
    // um frete de outro provedor (contrato 1.5.7, §5/R1-6).
    if (typeof shippingOptionId === 'string' && shippingOptionId.startsWith('frenet-')) {
        return {
            mensagem: 'Este pedido foi cotado e cobrado pela Frenet — a etiqueta é feita no site da Frenet, não pelo Melhor Envio.',
            podeEscolherServico: false,
        }
    }
    if (typeof shippingOptionId === 'string' && shippingOptionId.startsWith('flat-fee-')) {
        return {
            mensagem: 'Este pedido usou uma taxa de frete fixa (recurso desativado) e não tem serviço do Melhor Envio associado. Escolha o serviço abaixo para gerar a etiqueta.',
            podeEscolherServico: true,
        }
    }
    if (!(Number(shippingFee) > 0)) {
        return {
            mensagem: 'O pedido saiu com frete grátis e sem serviço do Melhor Envio escolhido no checkout (a calculadora do carrinho fica oculta quando o frete é grátis). Escolha o serviço abaixo para gerar a etiqueta.',
            podeEscolherServico: true,
        }
    }
    return {
        mensagem: 'Este pedido não registrou um serviço do Melhor Envio no checkout. Escolha o serviço abaixo para gerar a etiqueta.',
        podeEscolherServico: true,
    }
}

/**
 * Ids de serviço do Melhor Envio que só saem com AGÊNCIA de coleta: LATAM
 * Cargo (12), Azul (15 e 16) e Buslog (22). O `POST /api/v2/me/cart` do app
 * não manda agência nenhuma — bloquear aqui é melhor que cobrar diferente
 * escondido (plano 1.5.7, A7). Vale tanto para o serviço que veio do
 * CHECKOUT quanto para o que o lojista escolhe agora no card (contrato
 * 1.5.7, R1-6 item 6: a mesma recusa vale para o seletor manual).
 */
const IDS_QUE_EXIGEM_AGENCIA_DE_COLETA = new Set(['12', '15', '16', '22'])

export function erroDeAgenciaObrigatoria(serviceId: string): string | null {
    if (!IDS_QUE_EXIGEM_AGENCIA_DE_COLETA.has(serviceId)) return null
    return 'Esta transportadora exige agência de coleta — gere esta etiqueta no site do Melhor Envio.'
}

/**
 * Serviço que o LOJISTA escolhe na hora de etiquetar um pedido sem opção
 * (índice-691) — só entra em jogo quando `extrairServiceIdDaOpcao` não achou
 * nada no checkout. Mesmo formato de dígitos que ela devolve (sem o prefixo
 * `melhor-envio-`): quem manda aqui é o seletor do card, não a opção salva no
 * pedido.
 */
export function normalizarServicoEscolhidoPeloLojista(valor: unknown): string | null {
    if (typeof valor !== 'string') return null
    const limpo = valor.trim()
    return /^\d+$/.test(limpo) ? limpo : null
}

/**
 * Produtos e volumes do corpo do carrinho do ME, a partir dos itens do pedido
 * (JOIN `marketplace_order_items` × `produtos`) — mesmo padrão de leitura do
 * `calculate-shipping`: peso/dimensões vêm do BANCO, com fallbacks iguais aos
 * da cotação (0.3 kg / 15 cm) quando o produto não tem medição.
 *
 * Volumes: UM volume por LINHA de item, com o peso total da linha
 * (peso unitário × quantidade). Não é medição física da caixa real — é o
 * mesmo grau de aproximação que a cotação do carrinho já usa; o lojista
 * confere a etiqueta no ME antes de postar.
 */
export function montarProdutosEVolumes(
    itens: Array<Record<string, any>>,
    produtosDb: Array<Record<string, any>>,
): { products: Array<Record<string, unknown>>; volumes: Array<Record<string, unknown>> } {
    const mapa = new Map(produtosDb.map((p) => [p.id, p]))
    const products: Array<Record<string, unknown>> = []
    const volumes: Array<Record<string, unknown>> = []

    for (const item of itens || []) {
        const prodId = item.product_id
        const db = mapa.get(prodId)
        const quantidade = Number(item.quantity || 1)
        const peso = Number(db?.peso_kg ?? 0.3)
        const largura = Number(db?.largura_cm ?? 15)
        const altura = Number(db?.altura_cm ?? 15)
        const comprimento = Number(db?.comprimento_cm ?? 15)
        // Correção pós-revisão Opus (root autorizou): a declaração fiscal é o
        // valor VENDIDO no pedido — o `price` gravado pela RPC
        // (COALESCE(price_override, preco_venda) no momento da compra) —,
        // não o preco_venda ATUAL do catálogo (que pode ter mudado desde a
        // venda). Medidas e nome continuam vindo do banco (db).
        const precoVendido = Number(item.price)
        const preco = item.price != null && Number.isFinite(precoVendido) ? precoVendido : Number(db?.preco_venda ?? 0)
        const nome = String(db?.nome || 'Produto')

        products.push({
            name: nome,
            quantity: quantidade,
            unitary_value: preco,
        })
        volumes.push({
            weight: Number((peso * quantidade).toFixed(3)),
            width: largura,
            height: altura,
            length: comprimento,
        })
    }
    return { products, volumes }
}

/**
 * O remetente (corpo `from` do carrinho) a partir do GET /api/v2/me do
 * Melhor Envio — os dados de quem DESPACHA moram na conta do ME do lojista
 * (documento, endereço completo), não na store_config, que só tem o CEP.
 *
 * Tolerante ao shape: prefere a empresa (CNPJ) e o endereço padrão; aceita
 * os dois formatos de documento da doc. Devolve null quando falta o que a
 * API exige de verdade — e a mensagem do chamador manda completar o cadastro
 * no ME, não "tente de novo".
 */
export function montarRemetente(meData: Record<string, any> | null | undefined): Record<string, unknown> | null {
    if (!meData) return null
    const company = Array.isArray(meData.companies) ? meData.companies.find((c: any) => c?.company_document) || meData.companies[0] : null
    const addresses = Array.isArray(meData.addresses) ? meData.addresses : []
    const address = addresses.find((a: any) => a?.is_default) || addresses[0] || null

    const document = company?.company_document || company?.document || meData.document || null
    const postalCode = String(address?.postal_code || '').replace(/\D/g, '')
    const city = address?.city?.city || address?.city_name || address?.city || null
    const state = address?.city?.state_abbr || address?.state_abbr || address?.state || null

    if (!document || !postalCode || postalCode.length !== 8 || !city || !state) return null

    return {
        name: company?.name || meData.name || address?.address || 'Loja',
        company_document: typeof company?.company_document === 'string' ? company.company_document : undefined,
        document: company?.company_document ? undefined : document,
        phone: String(company?.phone || meData.phone || address?.phone || '0000000000'),
        address: String(address?.address || ''),
        complement: address?.complement || null,
        number: String(address?.number || 'S/N'),
        district: String(address?.district || ''),
        city,
        state_abbr: state,
        country_id: 'BR',
        postal_code: postalCode,
        email: meData.email || null,
    }
}

/**
 * Normaliza a resposta do checkout: devolve o estado da compra e a mensagem
 * de falha amigável quando o saldo não foi aceito. O ME responde 200 até
 * quando a compra NÃO fechou (status pending/blocked com `token` de
 * redirecionamento de pagamento) — por isso o status é lido de verdade em vez
 * de confiar no código HTTP.
 */
export function normalizarCheckout(data: Record<string, any>): { pago: boolean; purchaseId?: string; erro?: string } {
    const purchase = data?.purchase || null
    const status = String(purchase?.status || '').toLowerCase()
    if (purchase?.id && status === 'paid') return { pago: true, purchaseId: purchase.id }
    return {
        pago: false,
        erro:
            status && status !== 'paid'
                ? `O Melhor Envio não fechou a compra da etiqueta (status "${status}"). Confira o saldo da sua conta no Melhor Envio.`
                : 'O Melhor Envio não confirmou a compra da etiqueta. Confira o saldo da sua conta no Melhor Envio.',
    }
}

/**
 * Lê o código de rastreio da resposta do POST /tracking (objeto chaveado pelo
 * id da etiqueta). O rastreio só nasce DEPOIS que a transportadora aceita o
 * objeto — uma etiqueta gerada há 2 segundos pode voltar vazia, e vazio NÃO é
 * erro: o painel deixa o lojista consultar de novo depois.
 */
export function normalizarTracking(data: Record<string, any>, labelId: string): { tracking: string | null; status: string | null } {
    // Map (não indexação por variável): `data[labelId]` dispara
    // `security/detect-object-injection` do eslint e a catraca reprova
    // warning novo — `.get()` devolve a mesma entrada do objeto chaveado
    // pelo id da etiqueta.
    const entrada = new Map(Object.entries(data ?? {})).get(labelId) ?? null
    const tracking = entrada?.tracking || entrada?.melhorenvio_tracking || null
    return { tracking: tracking ? String(tracking) : null, status: entrada?.status ? String(entrada.status) : null }
}

/**
 * Mensagem do erro HTTP do Melhor Envio para o lojista — o texto cru da API
 * (inglês/JSON de validação) não é frase de painel; o detalhe fica no console
 * dos logs da function.
 */
function mensagemDoErroHttp(status: number, etapa: string): string {
    if (status === 401) return 'O Melhor Envio recusou o token (não autenticado). Gere um novo token na sua conta e atualize em Logística & Frete.'
    if (status === 422) return `O Melhor Envio recusou os dados da etiqueta (${etapa}). Confira o cadastro do remetente e o endereço do pedido.`
    if (status === 429) return 'O Melhor Envio está limitando as chamadas (muitas em pouco tempo). Tente novamente em instantes.'
    return `O Melhor Envio respondeu erro ${status} em ${etapa}. Tente novamente; se persistir, confira o status da sua conta no Melhor Envio.`
}

/**
 * Grava um evento no histórico de envio. Falha de log NUNCA derruba a
 * resposta — mas também não passa calada (console dos logs da function).
 */
async function gravarEvento(
    client: any,
    valores: Record<string, unknown>,
): Promise<void> {
    try {
        const { error } = await client.from('order_shipping_events').insert(valores)
        if (error) console.error('[melhor-envio-etiqueta] Falha ao gravar evento:', error)
    } catch (err) {
        console.error('[melhor-envio-etiqueta] Exceção ao gravar evento:', err)
    }
}

/**
 * Remove a etiqueta NÃO PAGA do carrinho do Melhor Envio
 * (DELETE /api/v2/me/cart/{id}). Usada quando esta geração NÃO vai
 * acontecer: o item não pode ficar no carrinho — se o lojista "comprar o
 * carrinho" no site do ME, pagaria por ele sem querer (revisor, item 4).
 * Falha suave: se o DELETE não sair, a etiqueta não-paga expira sozinha no
 * carrinho do ME; o erro original importa mais.
 */
async function removerDoCarrinho(
    buscar: typeof fetch,
    baseUrl: string,
    headersME: Record<string, string>,
    labelId: string,
): Promise<void> {
    try {
        await buscarComTempo(buscar, `${baseUrl}/api/v2/me/cart/${labelId}`, {
            method: 'DELETE',
            headers: headersME,
        })
    } catch (err) {
        console.error('[melhor-envio-etiqueta] Falha ao remover item do carrinho do ME (suave):', err)
    }
}

// ============================================================================
// LOGÍSTICA REVERSA — action `gerar_devolucao_reversa` (devolução nacional
// quando a IDA saiu por etiqueta do Melhor Envio; spec
// docs/superpowers/specs/2026-09-26-devolucoes-design.md).
//
// O QUE A DOC OFICIAL DIZ (docs.melhorenvio.com.br, lida em 26/09/2026):
//   * rota própria `POST /api/v2/me/cart/reverse` — não é a flag
//     `options.reverse` do carrinho comum;
//   * só Correios: `service` 1 (PAC) ou 2 (SEDEX); UM volume (`package`);
//   * envio original feito pelo ME: basta `order_id` (id do envio de ida),
//     `new_sender_mail`, `new_sender_phone`, `insurance_value` e `package`
//     (sem from/to/products — o ME já tem os dados; nenhum CPF sai daqui);
//   * DC-e: "informe a chave … ou deixe em branco para que a API comunique a
//     DCe à SEFAZ" — deixamos em branco (a loja não emite DC-e própria);
//   * depois, o MESMO checkout e o MESMO generate da ida: "será necessário
//     solicitar a geração da etiqueta para obter o código, mesmo que não haja
//     posterior impressão";
//   * o Sandbox NÃO gera o código de devolução (só insere e paga).
// Da central de ajuda do ME: o código de postagem "também é o seu código de
// rastreio" (coluna Rastreio) e vale 7 DIAS a partir da geração; a DC-e é
// obrigatória, impressa, junto do pacote.
//
// DINHEIRO (mesmas travas da ida, adaptadas):
//   * RESERVA antes de qualquer chamada: `me_reverse_id` NULL → 'reservando:
//     <epoch_ms>:<uuid>' com update condicional (id + status aprovada +
//     método etiqueta_reversa). Uma chamada só passa; re-clique/aba paralela
//     recebe 409 ou o resultado já pronto;
//   * a reserva vira o id do envio reverso no ME (update condicional à
//     PRÓPRIA reserva E a status aprovada + método etiqueta_reversa) ANTES do
//     checkout — o checkout só roda com o vínculo gravado. Se o cliente
//     cancelou/informou o envio no meio (0 linhas), o item sai do carrinho,
//     a reserva é solta e a resposta diz o status novo (R1). Erro no update
//     relê a linha antes de tirar o item: vínculo gravado segue (R3);
//   * falha DEFINIDA (carrinho recusado/sem id/estourado, checkout 4xx ou
//     2xx com status CONHECIDO de não pago — pending/blocked/canceled):
//     libera a reserva (e tira o item do carrinho quando ele existe) — nada
//     foi pago, o lojista tenta de novo;
//   * checkout 5xx, 2xx sem confirmação legível (vazio, `{message}`, corpo
//     não-JSON, formato desconhecido — R2) ou exceção pós-vínculo:
//     INDETERMINADO (mesma regra da ida, revisor A′/B do PR #423) — vínculo
//     MANTIDO, carrinho intacto, resposta manda conferir a conta do ME.
//     Liberar aqui abriria a compra dupla;
//   * devolução VINCULADA sem código salvo: nova chamada só GERA (generate
//     não cobra; envio não pago volta 4xx) e CONSULTA o código, nunca compra
//     de novo — e a resposta separa "pago, código ainda não saiu" de "pode
//     estar pendente de pagamento no carrinho do ME" (R4);
//   * reserva sem vínculo há mais de 10 min (a função morreu entre a reserva
//     e o vínculo — nesse trecho nada foi pago) pode ser retomada, com update
//     condicional à reserva antiga.
// Nunca `ok: true` mudo: sem a DC-e volta `dce_pendente` + `aviso` (R6); a
// validade do código (7 dias) conta do evento que registrou a geração, e
// vencida volta `expirado` + `aviso` para reemitir no ME (R8).
// Nada de CPF, e-mail, telefone ou token em log: texto do ME passa por
// `sanitizarDadosPessoaisDoTexto` antes de log e de resposta.
// ============================================================================

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function ehUuid(valor: unknown): valor is string {
    return typeof valor === 'string' && REGEX_UUID.test(valor)
}

const PREFIXO_RESERVA_REVERSA = 'reservando:'
const RESERVA_REVERSA_VENCE_EM_MS = 10 * 60 * 1000
const VALIDADE_DO_CODIGO_DE_POSTAGEM_MS = 7 * 24 * 60 * 60 * 1000
const NOTA_CODIGO_DE_POSTAGEM_GERADO = 'Código de postagem dos Correios gerado (válido por 7 dias)'

/**
 * Serviço dos Correios da devolução: o MESMO da ida quando a ida foi PAC (1)
 * ou SEDEX (2) — com ou sem `-ss`, captura completa (nunca prefixo: '12' não
 * é '1'); qualquer outra coisa (outra transportadora na ida, opção ausente)
 * cai no PAC, porque a reversa só existe nos Correios.
 */
export function servicoDaDevolucaoReversa(shippingOptionId: unknown): 1 | 2 {
    return analisarOpcaoMelhorEnvio(shippingOptionId)?.id === '2' ? 2 : 1
}

/**
 * O pacote ÚNICO da devolução (a reversa dos Correios é de um volume só), a
 * partir dos itens DEVOLVIDOS e das medições do banco — pelo MESMO helper da
 * ida (`montarProdutosEVolumes`: fallbacks 0.3 kg / 15 cm, peso da linha =
 * unitário × quantidade). Agrega no mesmo grau de aproximação da ida (que
 * declara a medida de UMA unidade por linha): peso somado e a MAIOR largura,
 * altura e comprimento. Não é medição da caixa real — declarar a mais
 * travaria a reversa no limite dos Correios (100 cm por lado) sem ganho; a
 * diferença de conferência métrica o ME cobra depois, como na ida.
 */
export function montarPacoteDaDevolucao(
    itens: Array<Record<string, any>>,
    produtosDb: Array<Record<string, any>>,
): { weight: number; width: number; height: number; length: number } | null {
    const linhas = (itens || []).map((item) => ({
        product_id: item.product_id,
        quantity: item.quantidade,
        price: item.valor_unitario,
    }))
    const { volumes } = montarProdutosEVolumes(linhas, produtosDb || [])
    if (volumes.length === 0) return null
    let peso = 0
    let largura = 0
    let altura = 0
    let comprimento = 0
    for (const volume of volumes) {
        peso += Number(volume.weight)
        largura = Math.max(largura, Number(volume.width))
        altura = Math.max(altura, Number(volume.height))
        comprimento = Math.max(comprimento, Number(volume.length))
    }
    return { weight: Number(peso.toFixed(3)), width: largura, height: altura, length: comprimento }
}

export type VinculoReverso =
    | { tipo: 'livre' }
    | { tipo: 'reservado'; vencido: boolean }
    | { tipo: 'vinculado'; meId: string }

/**
 * Lê `devolucoes.me_reverse_id`: vazio (livre), reserva desta função
 * (`reservando:<epoch_ms>:<uuid>`, vencida depois de 10 min) ou o id do
 * envio reverso no ME. Reserva sem carimbo legível NUNCA vence — na dúvida,
 * não se toma a reserva de outra chamada.
 */
export function classificarVinculoReverso(valor: unknown, agoraMs: number): VinculoReverso {
    if (valor === null || valor === undefined || valor === '') return { tipo: 'livre' }
    const texto = String(valor)
    if (!texto.startsWith(PREFIXO_RESERVA_REVERSA)) return { tipo: 'vinculado', meId: texto }
    const marcadaEm = Number(texto.slice(PREFIXO_RESERVA_REVERSA.length).split(':')[0])
    const vencido = Number.isFinite(marcadaEm) && marcadaEm > 0 && agoraMs - marcadaEm > RESERVA_REVERSA_VENCE_EM_MS
    return { tipo: 'reservado', vencido }
}

/**
 * O código de postagem na resposta do POST /shipment/tracking (objeto
 * chaveado pelo id do envio). SÓ o campo `tracking` — é o que o painel do ME
 * mostra na coluna Rastreio, que a central de ajuda chama de código de
 * postagem da reversa. O `melhorenvio_tracking` (código interno do ME) NÃO
 * serve no balcão dos Correios e nunca é usado aqui.
 */
export function normalizarCodigoDePostagem(data: unknown, meId: string): string | null {
    const objeto = data && typeof data === 'object' ? data : {}
    const entrada: any = new Map(Object.entries(objeto)).get(meId)
    const codigo = entrada && typeof entrada === 'object' ? entrada.tracking : null
    return typeof codigo === 'string' && codigo.trim() ? codigo.trim() : null
}

/**
 * Status de compra do ME que são "NÃO pago" com certeza (a doc do checkout:
 * saldo insuficiente volta `pending`/`blocked` com token de pagamento;
 * `canceled` é compra desfeita). Só estes soltam o vínculo num 200.
 */
const STATUS_DE_COMPRA_NAO_PAGA = new Set(['pending', 'blocked', 'canceled'])

export type DesfechoDoCheckoutReverso =
    | { tipo: 'pago' }
    | { tipo: 'recusado'; status: string }
    | { tipo: 'indeterminado' }

/**
 * Lê o corpo de um checkout 2xx da REVERSA (R2 da revisão de risco). A ida
 * usa `normalizarCheckout`, que trata QUALQUER 200 sem `paid` como recusa —
 * aqui isso soltaria o vínculo de um envio que pode ter sido pago (corpo
 * vazio, `{message}`, formato novo da API, página de gateway com 200).
 * Regra: `pago` só com `purchase.status === 'paid'` E `purchase.id`;
 * `recusado` só com um status CONHECIDO de não pago; todo o resto é
 * `indeterminado` — o vínculo fica e o lojista confere a conta do ME.
 */
export function classificarCheckoutDaReversa(dados: unknown): DesfechoDoCheckoutReverso {
    const raiz: any = dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : null
    const purchase = raiz?.purchase
    if (!purchase || typeof purchase !== 'object') return { tipo: 'indeterminado' }
    const status = typeof purchase.status === 'string' ? purchase.status.trim().toLowerCase() : ''
    if (status === 'paid') return purchase.id ? { tipo: 'pago' } : { tipo: 'indeterminado' }
    if (STATUS_DE_COMPRA_NAO_PAGA.has(status)) return { tipo: 'recusado', status }
    return { tipo: 'indeterminado' }
}

/**
 * Validade do código de postagem (R8): 7 dias a partir da GERAÇÃO — e a
 * geração é o `created_at` do evento `NOTA_CODIGO_DE_POSTAGEM_GERADO` da
 * devolução. Data ausente ou ilegível devolve null: sem data, a validade
 * não é inventada.
 */
export function validadeDoCodigoDePostagem(
    geradoEm: unknown,
    agoraMs: number,
): { validade_ate: string; expirado: boolean } | null {
    if (typeof geradoEm !== 'string') return null
    const inicio = Date.parse(geradoEm)
    if (!Number.isFinite(inicio)) return null
    const fim = inicio + VALIDADE_DO_CODIGO_DE_POSTAGEM_MS
    return { validade_ate: new Date(fim).toISOString(), expirado: agoraMs > fim }
}

function respostaJson(corpo: Record<string, unknown>, status = 200): Response {
    return new Response(JSON.stringify(corpo), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
}

/**
 * O motivo que o ME deu, legível para o painel: as mensagens de
 * `errors`/`error`/`message` do JSON (validação do Laravel), sem CPF, e-mail
 * nem telefone — sanitiza ANTES do corte final de 300 (lição do `cart sem
 * id`). O teto de 2000 antes da sanitização só limita o custo das regex: um
 * dado pessoal partido ali fica muito além dos 300 que sobrevivem. Página
 * HTML de gateway não vira mensagem.
 */
function motivoDoProvedor(texto: string): string {
    const mensagens: string[] = []
    const coletar = (valor: unknown, profundidade: number): void => {
        if (profundidade > 4 || mensagens.length >= 6) return
        if (typeof valor === 'string') {
            if (valor.trim()) mensagens.push(valor.trim())
            return
        }
        if (Array.isArray(valor)) {
            for (const item of valor) coletar(item, profundidade + 1)
            return
        }
        if (valor && typeof valor === 'object') {
            for (const item of Object.values(valor)) coletar(item, profundidade + 1)
        }
    }
    let bruto = ''
    try {
        const dados = JSON.parse(texto)
        coletar(dados?.errors ?? dados?.error ?? dados?.message ?? null, 0)
        bruto = mensagens.join(' ')
    } catch {
        bruto = String(texto || '').trim().startsWith('<') ? '' : String(texto || '')
    }
    return sanitizarDadosPessoaisDoTexto(bruto.replace(/\s+/g, ' ').slice(0, 2000)).trim().slice(0, 300)
}

/**
 * Etapa da reversa nas duas regências que as frases pedem: "recusou A
 * criação" e "erro 502 NA criação" (antes saía "erro 502 em a criação").
 */
type EtapaDaReversa = { objeto: string; local: string }
const ETAPA_CRIACAO_DA_REVERSA: EtapaDaReversa = { objeto: 'a criação do envio reverso', local: 'na criação do envio reverso' }
const ETAPA_PAGAMENTO_DA_REVERSA: EtapaDaReversa = { objeto: 'o pagamento do envio reverso', local: 'no pagamento do envio reverso' }

function mensagemDoErroDaReversa(status: number, etapa: EtapaDaReversa, motivo: string): string {
    if (status === 401 || status === 429) return mensagemDoErroHttp(status, etapa.objeto)
    if (status >= 500) {
        return `O Melhor Envio respondeu erro ${status} ${etapa.local}. Tente novamente; se persistir, confira o status da sua conta no Melhor Envio.`
    }
    const base = `O Melhor Envio recusou ${etapa.objeto} (erro ${status}).`
    return motivo ? `${base} Motivo informado: ${motivo}` : base
}

type ContextoReversa = {
    supabase: any
    buscar: typeof fetch
    baseUrl: string
    headersME: Record<string, string>
    isSandbox: boolean
    devolucaoId: string
}

const AVISO_SANDBOX_REVERSA = ' Atenção: no Sandbox do Melhor Envio a logística reversa não gera o código de postagem — só em produção.'

async function lerDevolucaoParaReversa(ctx: ContextoReversa): Promise<{ data: any; error: any }> {
    return await ctx.supabase
        .from('devolucoes')
        .select('id, order_id, status, metodo_retorno, valor_itens, me_reverse_id, codigo_postagem, etiqueta_url')
        .eq('id', ctx.devolucaoId)
        .maybeSingle()
}

const AVISO_DCE_PENDENTE = 'O código de postagem saiu, mas a DC-e (a declaração que o cliente imprime e leva junto com o pacote) não veio do Melhor Envio agora. Tente de novo aqui em instantes para buscá-la, ou baixe-a em Meus envios, na sua conta do Melhor Envio.'

function avisoDeCodigoVencido(validadeAte: string): string {
    const dia = new Date(validadeAte).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    return `O código de postagem venceu em ${dia} (vale 7 dias a partir da geração). Reemita o código em Meus envios, na sua conta do Melhor Envio, e passe o código novo ao cliente.`
}

/**
 * Corpo de sucesso com o código de postagem. Nunca é um `ok: true` mudo:
 *   * sem o link da DC-e → `dce_pendente: true` + `aviso` (R6);
 *   * validade conhecida → `validade_ate` + `expirado`; vencido → `aviso` (R8).
 */
function corpoComCodigoDePostagem(dados: {
    already: boolean
    codigo: string
    etiquetaUrl: string | null
    meId: string
    validade: { validade_ate: string; expirado: boolean } | null
}): Record<string, unknown> {
    const avisos: string[] = []
    if (!dados.etiquetaUrl) avisos.push(AVISO_DCE_PENDENTE)
    if (dados.validade?.expirado) avisos.push(avisoDeCodigoVencido(dados.validade.validade_ate))
    return {
        ok: true,
        already: dados.already,
        codigo_postagem: dados.codigo,
        etiqueta_url: dados.etiquetaUrl,
        me_reverse_id: dados.meId,
        ...(dados.validade ? { validade_ate: dados.validade.validade_ate, expirado: dados.validade.expirado } : {}),
        ...(dados.etiquetaUrl ? {} : { dce_pendente: true }),
        ...(avisos.length > 0 ? { aviso: avisos.join(' ') } : {}),
    }
}

/**
 * Momento da geração do código (R8): o `created_at` do evento que a
 * gravação do código registrou (`NOTA_CODIGO_DE_POSTAGEM_GERADO`). Falha
 * suave: null (sem data, sem validade — nunca uma validade inventada).
 */
async function lerMomentoDaGeracaoDoCodigo(ctx: ContextoReversa): Promise<string | null> {
    try {
        const { data, error } = await ctx.supabase
            .from('devolucao_eventos')
            .select('created_at')
            .eq('devolucao_id', ctx.devolucaoId)
            .eq('nota', NOTA_CODIGO_DE_POSTAGEM_GERADO)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        if (error) {
            console.error('[melhor-envio-etiqueta] reversa: falha ao ler o evento da geração do código:', error?.code ?? error?.message ?? 'erro')
            return null
        }
        return typeof data?.created_at === 'string' ? data.created_at : null
    } catch (err) {
        console.error('[melhor-envio-etiqueta] reversa: exceção ao ler o evento da geração do código:', sanitizarDadosPessoaisDoTexto(String(err)))
        return null
    }
}

/**
 * Grava o link da DC-e buscado DEPOIS do código (R6) — condicional ao
 * vínculo e a `etiqueta_url IS NULL`: nunca pisa num link que outra chamada
 * gravou. Falha suave (o link volta na resposta do mesmo jeito).
 */
async function gravarLinkDaDeclaracao(ctx: ContextoReversa, meId: string, link: string): Promise<void> {
    try {
        const { error } = await ctx.supabase
            .from('devolucoes')
            .update({ etiqueta_url: link })
            .eq('id', ctx.devolucaoId)
            .eq('me_reverse_id', meId)
            .is('etiqueta_url', null)
        if (error) console.error('[melhor-envio-etiqueta] reversa: falha ao gravar o link da DC-e:', error?.code ?? error?.message ?? 'erro')
    } catch (err) {
        console.error('[melhor-envio-etiqueta] reversa: exceção ao gravar o link da DC-e:', sanitizarDadosPessoaisDoTexto(String(err)))
    }
}

/**
 * Devolução que JÁ tem código salvo (idempotência): devolve o que está no
 * banco, sem compra nem geração nova. Sem o link da DC-e, tenta de novo
 * (só leitura no ME) e grava o que vier (R6); a validade sai do evento da
 * geração (R8).
 */
async function responderReversoExistente(ctx: ContextoReversa, devolucao: Record<string, any>): Promise<Response> {
    const meId = String(devolucao.me_reverse_id)
    let etiquetaUrl = linkHttps(devolucao.etiqueta_url)
    if (!etiquetaUrl) {
        etiquetaUrl = await buscarLinkDaDeclaracao(ctx, meId)
        if (etiquetaUrl) await gravarLinkDaDeclaracao(ctx, meId, etiquetaUrl)
    }
    const validade = validadeDoCodigoDePostagem(await lerMomentoDaGeracaoDoCodigo(ctx), Date.now())
    return respostaJson(corpoComCodigoDePostagem({ already: true, codigo: devolucao.codigo_postagem, etiquetaUrl, meId, validade }))
}

function respostaReversaEmAndamento(): Response {
    return respostaJson(
        { error: 'Já existe uma geração do código de postagem em andamento para esta devolução. Aguarde alguns instantes e recarregue.' },
        409,
    )
}

/** Solta a reserva/vínculo — condicional ao valor que ESTA chamada gravou. */
async function liberarVinculoReverso(ctx: ContextoReversa, valorAtual: string): Promise<void> {
    try {
        const { error } = await ctx.supabase
            .from('devolucoes')
            .update({ me_reverse_id: null })
            .eq('id', ctx.devolucaoId)
            .eq('me_reverse_id', valorAtual)
        if (error) console.error('[melhor-envio-etiqueta] reversa: falha ao liberar a reserva:', error?.code ?? error?.message ?? 'erro')
    } catch (err) {
        console.error('[melhor-envio-etiqueta] reversa: exceção ao liberar a reserva:', sanitizarDadosPessoaisDoTexto(String(err)))
    }
}

/** Código de postagem do envio reverso (falha suave: null). */
async function lerCodigoDePostagem(ctx: ContextoReversa, meId: string): Promise<string | null> {
    try {
        const resposta = await buscarComTempo(ctx.buscar, `${ctx.baseUrl}/api/v2/me/shipment/tracking`, {
            method: 'POST',
            headers: ctx.headersME,
            body: JSON.stringify({ orders: [meId] }),
        })
        if (!resposta.ok) {
            console.error('[melhor-envio-etiqueta] reversa tracking HTTP', resposta.status, motivoDoProvedor(await resposta.text()))
            return null
        }
        return normalizarCodigoDePostagem(await resposta.json(), meId)
    } catch (err) {
        console.error('[melhor-envio-etiqueta] reversa: consulta do código falhou (suave):', sanitizarDadosPessoaisDoTexto(String(err)))
        return null
    }
}

function linkHttps(valor: unknown): string | null {
    return typeof valor === 'string' && /^https:\/\//i.test(valor) ? valor : null
}

/**
 * Link da DC-e que o cliente imprime (falha suave: null). Primeiro a DACE em
 * PDF (doc "Impressão de DACE"); se não vier, o link PÚBLICO de impressão do
 * envio (`mode: public` — quem devolve não tem login no ME do lojista).
 */
async function buscarLinkDaDeclaracao(ctx: ContextoReversa, meId: string): Promise<string | null> {
    const idNaUrl = encodeURIComponent(meId)
    try {
        const resposta = await buscarComTempo(ctx.buscar, `${ctx.baseUrl}/api/v2/me/imprimir/dace/pdf/${idNaUrl}`, {
            method: 'GET',
            headers: ctx.headersME,
        })
        if (resposta.ok) {
            const dados = await resposta.json()
            const link = linkHttps(dados?.pdf) ?? linkHttps(dados?.url)
            if (link) return link
        } else {
            console.error('[melhor-envio-etiqueta] reversa DACE HTTP', resposta.status, motivoDoProvedor(await resposta.text()))
        }
    } catch (err) {
        console.error('[melhor-envio-etiqueta] reversa: DACE falhou (suave):', sanitizarDadosPessoaisDoTexto(String(err)))
    }
    try {
        const resposta = await buscarComTempo(ctx.buscar, `${ctx.baseUrl}/api/v2/me/shipment/print`, {
            method: 'POST',
            headers: ctx.headersME,
            body: JSON.stringify({ orders: [meId], mode: 'public' }),
        })
        if (resposta.ok) return linkHttps((await resposta.json())?.url)
        console.error('[melhor-envio-etiqueta] reversa print HTTP', resposta.status, motivoDoProvedor(await resposta.text()))
    } catch (err) {
        console.error('[melhor-envio-etiqueta] reversa: print falhou (suave):', sanitizarDadosPessoaisDoTexto(String(err)))
    }
    return null
}

/**
 * Por que o envio reverso vinculado ainda não tem código (vai na resposta
 * como `situacao`, e cada uma tem a sua frase):
 *   * `geracao_falhou` — checkout PAGO agora, generate falhou;
 *   * `pago_sem_codigo` — pago e gerado (checkout pago agora, ou o generate
 *     aceitou: o ME só gera envio pago), o código ainda não apareceu;
 *   * `pagamento_pendente_no_me` — o generate RECUSOU (4xx): o envio pode
 *     estar no carrinho do ME esperando pagamento (R4);
 *   * `sem_confirmacao` — o generate não respondeu (5xx/timeout): não dá
 *     para dizer qual dos dois.
 */
type SituacaoSemCodigo = 'geracao_falhou' | 'pago_sem_codigo' | 'pagamento_pendente_no_me' | 'sem_confirmacao'

/**
 * Envio reverso vinculado sem código de postagem ainda. Nova chamada é
 * SEGURA: só gera (não cobra) e consulta o código, nunca compra de novo.
 */
function respostaCodigoPendente(ctx: ContextoReversa, meId: string, situacao: SituacaoSemCodigo, motivo = ''): Response {
    const sandbox = ctx.isSandbox ? AVISO_SANDBOX_REVERSA : ''
    const semCompraNova = 'tentar de novo aqui só gera e consulta o código, sem compra nova'
    let mensagem: string
    if (situacao === 'geracao_falhou') {
        mensagem = `O envio reverso foi PAGO no Melhor Envio (id ${meId}), mas a geração do código de postagem falhou. Gere o código em Meus envios, na sua conta do Melhor Envio; depois, ${semCompraNova}.${sandbox}`
    } else if (situacao === 'pago_sem_codigo') {
        mensagem = `O envio reverso (id ${meId}) está pago e gerado no Melhor Envio, mas o código de postagem dos Correios ainda não apareceu. Confira em Meus envios > Envios postados, coluna Rastreio; ${semCompraNova}.${sandbox}`
    } else if (situacao === 'pagamento_pendente_no_me') {
        const porque = motivo ? ` Motivo informado: ${motivo}` : ''
        mensagem = `O Melhor Envio não gerou o envio reverso (id ${meId}): ele pode estar PENDENTE DE PAGAMENTO no carrinho da sua conta do Melhor Envio — a compra não foi confirmada aqui.${porque} Confira o carrinho de lá: se o envio estiver lá, pague por lá e depois ${semCompraNova}.${sandbox}`
    } else {
        mensagem = `O envio reverso já existe no Melhor Envio (id ${meId}), mas não consegui gerar nem ler o código de postagem agora. Confira em Meus envios, na sua conta do Melhor Envio; ${semCompraNova}.${sandbox}`
    }
    return respostaJson({ error: mensagem, resgate: true, pendente: true, situacao, me_reverse_id: meId }, 502)
}

/**
 * `POST /shipment/generate` de um envio reverso JÁ vinculado (R4). Gerar
 * NÃO cobra: envio pago gera (ou já estava gerado); envio NÃO pago volta
 * 4xx — ou 2xx com a entrada do envio em `status: false`. 401/408/429,
 * 5xx e exceção não dizem nada sobre o pagamento (`sem_resposta`).
 */
async function gerarEnvioReversoVinculado(
    ctx: ContextoReversa,
    meId: string,
): Promise<{ desfecho: 'gerado' | 'recusado' | 'sem_resposta'; motivo: string }> {
    try {
        const resposta = await buscarComTempo(ctx.buscar, `${ctx.baseUrl}/api/v2/me/shipment/generate`, {
            method: 'POST',
            headers: ctx.headersME,
            body: JSON.stringify({ orders: [meId] }),
        })
        const texto = await resposta.text().catch(() => '')
        if (resposta.ok) {
            let dados: unknown = null
            try {
                dados = JSON.parse(texto)
            } catch {
                dados = null
            }
            const entrada: any = new Map(Object.entries(dados && typeof dados === 'object' ? dados : {})).get(meId)
            if (entrada && typeof entrada === 'object' && entrada.status === false) {
                const motivo = motivoDoProvedor(JSON.stringify({ message: entrada.message ?? '' }))
                console.error('[melhor-envio-etiqueta] reversa generate recusado na entrada do envio:', motivo)
                return { desfecho: 'recusado', motivo }
            }
            return { desfecho: 'gerado', motivo: '' }
        }
        const motivo = motivoDoProvedor(texto)
        console.error('[melhor-envio-etiqueta] reversa generate HTTP', resposta.status, motivo)
        const recusa = resposta.status >= 400 && resposta.status < 500 && ![401, 408, 429].includes(resposta.status)
        return recusa ? { desfecho: 'recusado', motivo } : { desfecho: 'sem_resposta', motivo: '' }
    } catch (err) {
        console.error('[melhor-envio-etiqueta] reversa: generate do envio vinculado falhou (suave):', sanitizarDadosPessoaisDoTexto(String(err)))
        return { desfecho: 'sem_resposta', motivo: '' }
    }
}

/**
 * Checkout 5xx ou exceção depois do vínculo: o ME pode ter cobrado com a
 * resposta perdida. Vínculo e carrinho ficam como estão (revisor A′/B, PR
 * #423) — se não foi pago, o item continua no carrinho do ME e o lojista
 * pode pagar e gerar por lá; a próxima chamada aqui só busca o código.
 */
function respostaReversaIndeterminada(meId: string, pagoConfirmado: boolean): Response {
    const mensagem = pagoConfirmado
        ? `O pagamento do envio reverso (id ${meId}) FOI CONFIRMADO no Melhor Envio, mas a finalização falhou. Confira em Meus envios na sua conta do Melhor Envio e gere o código por lá se preciso; tentar de novo aqui só busca o código, sem compra nova.`
        : `O pagamento do envio reverso (id ${meId}) ficou em estado INDETERMINADO no Melhor Envio — pode ter sido pago ou não. Confira a sua conta do Melhor Envio antes de qualquer coisa: se não foi pago, o envio continua no carrinho de lá. A devolução segue vinculada a este envio e nenhuma compra nova sai daqui.`
    return respostaJson({ error: mensagem, resgate: true, me_reverse_id: meId }, 502)
}

/** Evento da devolução (falha de log NUNCA derruba a resposta). */
async function gravarEventoDaDevolucao(ctx: ContextoReversa, status: string): Promise<void> {
    try {
        const { error } = await ctx.supabase.from('devolucao_eventos').insert({
            devolucao_id: ctx.devolucaoId,
            de_status: status,
            para_status: status,
            ator: 'sistema',
            nota: NOTA_CODIGO_DE_POSTAGEM_GERADO,
        })
        if (error) console.error('[melhor-envio-etiqueta] reversa: falha ao gravar evento da devolução:', error?.code ?? error?.message ?? 'erro')
    } catch (err) {
        console.error('[melhor-envio-etiqueta] reversa: exceção ao gravar evento da devolução:', sanitizarDadosPessoaisDoTexto(String(err)))
    }
}

/**
 * Grava código + link na devolução (update condicional ao vínculo e a
 * código ainda vazio — duas chamadas simultâneas não duplicam o evento) e
 * registra o evento na primeira gravação. A validade (R8) conta do evento:
 * gravado agora, conta de agora; senão, do evento que já está no banco.
 */
async function concluirComCodigoDePostagem(
    ctx: ContextoReversa,
    devolucao: Record<string, any>,
    meId: string,
    codigo: string,
    etiquetaUrl: string | null,
    extras: { already: boolean },
): Promise<Response> {
    const { data: gravadas, error } = await ctx.supabase
        .from('devolucoes')
        .update({ codigo_postagem: codigo, etiqueta_url: etiquetaUrl })
        .eq('id', ctx.devolucaoId)
        .eq('me_reverse_id', meId)
        .is('codigo_postagem', null)
        .select('id')
    if (error) {
        console.error('[melhor-envio-etiqueta] reversa: falha ao gravar o código na devolução:', error?.code ?? error?.message ?? 'erro')
        return respostaJson(
            {
                error: `O código de postagem dos Correios saiu (${codigo}), mas não consegui salvá-lo na devolução. Anote o código; tentar de novo aqui busca e salva o mesmo código, sem compra nova.`,
                resgate: true,
                me_reverse_id: meId,
                codigo_postagem: codigo,
            },
            500,
        )
    }
    const gravouAgora = Array.isArray(gravadas) && gravadas.length === 1
    if (gravouAgora) await gravarEventoDaDevolucao(ctx, String(devolucao.status))
    const geradoEm = gravouAgora ? new Date().toISOString() : await lerMomentoDaGeracaoDoCodigo(ctx)
    const validade = validadeDoCodigoDePostagem(geradoEm, Date.now())
    return respostaJson(corpoComCodigoDePostagem({ already: extras.already, codigo, etiquetaUrl, meId, validade }))
}

/**
 * O vínculo (reserva → id do ME) NÃO voltou confirmado: 0 linhas (a
 * devolução mudou entre a reserva e aqui — R1) ou erro do banco, que PODE ter
 * gravado mesmo assim (R3). Relê a linha ANTES de mexer no carrinho:
 *   * `me_reverse_id` já é o id do ME → o vínculo entrou: devolve null e o
 *     chamador segue para o checkout (tirar o item do carrinho aqui deixaria
 *     a devolução presa a um envio apagado);
 *   * qualquer outra coisa → o checkout NUNCA roda: tira o item do carrinho
 *     do ME e solta a reserva. Se nem a releitura respondeu, solta TAMBÉM o
 *     id do ME (cada liberação condicional ao próprio valor) — o item já
 *     saiu do carrinho e nenhum checkout rodou para ele: nada foi pago.
 */
async function tratarVinculoNaoConfirmado(
    ctx: ContextoReversa,
    reserva: string,
    meId: string,
    vinculoError: any,
): Promise<Response | null> {
    if (vinculoError) console.error('[melhor-envio-etiqueta] reversa: falha ao vincular o envio:', vinculoError?.code ?? vinculoError?.message ?? 'erro')
    let relida: any = null
    let releituraFalhou = false
    try {
        const { data, error } = await lerDevolucaoParaReversa(ctx)
        if (error) {
            releituraFalhou = true
            console.error('[melhor-envio-etiqueta] reversa: falha ao reler a devolução depois do vínculo:', error?.code ?? error?.message ?? 'erro')
        }
        relida = data ?? null
    } catch (err) {
        releituraFalhou = true
        console.error('[melhor-envio-etiqueta] reversa: exceção ao reler a devolução depois do vínculo:', sanitizarDadosPessoaisDoTexto(String(err)))
    }
    if (!releituraFalhou && relida?.me_reverse_id === meId) {
        console.error('[melhor-envio-etiqueta] reversa: o vínculo respondeu erro mas foi gravado — segue para o checkout')
        return null
    }

    await removerDoCarrinho(ctx.buscar, ctx.baseUrl, ctx.headersME, meId)
    await liberarVinculoReverso(ctx, reserva)
    if (releituraFalhou) await liberarVinculoReverso(ctx, meId)

    if (!releituraFalhou && relida && relida.status !== 'aprovada') {
        return respostaJson(
            { error: `A devolução mudou de status enquanto o código de postagem era gerado (status atual: "${String(relida.status)}" — por exemplo, o cliente cancelou ou informou o envio). O envio reverso foi retirado do carrinho do Melhor Envio e nada foi pago.` },
            409,
        )
    }
    if (!releituraFalhou && relida && relida.metodo_retorno !== 'etiqueta_reversa') {
        return respostaJson(
            { error: `O método de devolução mudou enquanto o código de postagem era gerado (agora: "${String(relida.metodo_retorno)}"). O envio reverso foi retirado do carrinho do Melhor Envio e nada foi pago.` },
            409,
        )
    }
    return respostaJson(
        { error: 'Não consegui registrar o envio reverso na devolução — ele foi retirado do carrinho do Melhor Envio e nada foi pago. Tente novamente.' },
        500,
    )
}

async function gerarDevolucaoReversa(ctx: ContextoReversa): Promise<Response> {
    const { supabase, buscar, baseUrl, headersME, devolucaoId } = ctx

    // 1. A devolução.
    const { data: devolucao, error: devolucaoError } = await lerDevolucaoParaReversa(ctx)
    if (devolucaoError) {
        console.error('[melhor-envio-etiqueta] reversa: falha ao ler a devolução:', devolucaoError?.code ?? devolucaoError?.message ?? 'erro')
        return respostaJson({ error: 'Não consegui ler a devolução agora. Tente novamente em instantes.' }, 500)
    }
    if (!devolucao) return respostaJson({ error: 'Devolução não encontrada.' }, 404)

    if (devolucao.metodo_retorno !== 'etiqueta_reversa') {
        return respostaJson(
            { error: 'Esta devolução não foi combinada por etiqueta reversa — não há código de postagem para gerar.' },
            400,
        )
    }

    // 2. IDEMPOTÊNCIA: código pronto volta como está (R6: sem a DC-e, busca
    //    de novo; R8: com a validade do evento); vínculo sem código só GERA
    //    (não cobra) e consulta; reserva de outra chamada (recente) espera.
    const vinculo = classificarVinculoReverso(devolucao.me_reverse_id, Date.now())
    if (vinculo.tipo === 'vinculado') {
        if (devolucao.codigo_postagem) return await responderReversoExistente(ctx, devolucao)
        // R4: generate ANTES do tracking — pago e ainda não gerado, o código
        // só nasce assim; e a resposta dele separa "pago, código ainda não
        // saiu" de "pode estar pendente de pagamento no carrinho do ME".
        const geracao = await gerarEnvioReversoVinculado(ctx, vinculo.meId)
        const codigo = await lerCodigoDePostagem(ctx, vinculo.meId)
        if (!codigo) {
            const situacao: SituacaoSemCodigo = geracao.desfecho === 'gerado'
                ? 'pago_sem_codigo'
                : geracao.desfecho === 'recusado' ? 'pagamento_pendente_no_me' : 'sem_confirmacao'
            return respostaCodigoPendente(ctx, vinculo.meId, situacao, geracao.motivo)
        }
        const etiquetaUrl = linkHttps(devolucao.etiqueta_url) ?? await buscarLinkDaDeclaracao(ctx, vinculo.meId)
        return await concluirComCodigoDePostagem(ctx, devolucao, vinculo.meId, codigo, etiquetaUrl, { already: true })
    }
    if (vinculo.tipo === 'reservado' && !vinculo.vencido) return respostaReversaEmAndamento()

    if (devolucao.status !== 'aprovada') {
        return respostaJson(
            { error: `Só devolução aprovada gera o código de postagem (status atual: "${String(devolucao.status)}").` },
            409,
        )
    }

    // 3. O pedido: a reversa do ME exige o envio de IDA feito por ele.
    const { data: pedido, error: pedidoError } = await supabase
        .from('marketplace_orders')
        .select('id, shipping_label_id, customer_data')
        .eq('id', devolucao.order_id)
        .maybeSingle()
    if (pedidoError || !pedido) {
        if (pedidoError) console.error('[melhor-envio-etiqueta] reversa: falha ao ler o pedido:', pedidoError?.code ?? pedidoError?.message ?? 'erro')
        return respostaJson({ error: 'Pedido da devolução não encontrado.' }, 404)
    }
    if (!ehUuid(pedido.shipping_label_id)) {
        return respostaJson({ error: 'Este pedido não saiu por etiqueta do Melhor Envio; use envio pelo cliente.' }, 409)
    }

    // 4. Contato de quem devolve — o ME exige os dois (os Correios mandam o
    //    código por e-mail). Nunca vão para log.
    const customerData = pedido.customer_data || {}
    const emailCliente = typeof customerData.email === 'string' ? customerData.email.trim() : ''
    let celularCliente = String(customerData.whatsapp || customerData.phone || '').replace(/\D/g, '')
    if ((celularCliente.length === 12 || celularCliente.length === 13) && celularCliente.startsWith('55')) {
        celularCliente = celularCliente.slice(2)
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailCliente)) {
        return respostaJson(
            { error: 'O pedido não tem um e-mail válido do cliente — o Melhor Envio exige o e-mail de quem devolve (é por ele que os Correios mandam o código). Use envio pelo cliente.' },
            400,
        )
    }
    if (celularCliente.length !== 10 && celularCliente.length !== 11) {
        return respostaJson(
            { error: 'O pedido não tem um celular válido do cliente — o Melhor Envio exige o celular de quem devolve. Use envio pelo cliente.' },
            400,
        )
    }

    // 5. Itens devolvidos + medições do banco → o pacote único.
    const { data: itens, error: itensError } = await supabase
        .from('devolucao_itens')
        .select('product_id, quantidade, valor_unitario')
        .eq('devolucao_id', devolucaoId)
    if (itensError) {
        console.error('[melhor-envio-etiqueta] reversa: falha ao ler os itens:', itensError?.code ?? itensError?.message ?? 'erro')
        return respostaJson({ error: 'Não consegui ler os itens da devolução agora. Tente novamente em instantes.' }, 500)
    }
    const itensDevolvidos = Array.isArray(itens) ? itens : []
    const productIds = [...new Set(itensDevolvidos.map((item: any) => item.product_id).filter(Boolean))]
    let produtosDb: Array<Record<string, any>> = []
    if (productIds.length > 0) {
        const { data: produtos, error: produtosError } = await supabase
            .from('produtos')
            .select('id, nome, preco_venda, peso_kg, largura_cm, altura_cm, comprimento_cm')
            .in('id', productIds)
        // R5: falha de LEITURA não é produto sem medição — seguir com os
        // fallbacks (0.3 kg / 15 cm) compraria o envio com medida inventada.
        // Para ANTES da reserva; nada foi chamado no ME.
        if (produtosError) {
            console.error('[melhor-envio-etiqueta] reversa: falha ao ler as medidas dos produtos:', produtosError?.code ?? produtosError?.message ?? 'erro')
            return respostaJson({ error: 'Não consegui ler as medidas dos produtos da devolução agora (nada foi reservado nem pago). Tente de novo em instantes.' }, 500)
        }
        produtosDb = produtos || []
    }
    const pacote = montarPacoteDaDevolucao(itensDevolvidos, produtosDb)
    if (!pacote) {
        return respostaJson({ error: 'A devolução não tem itens registrados — não há o que devolver.' }, 400)
    }

    // 6. RESERVA (antes de qualquer chamada ao ME).
    const reserva = `${PREFIXO_RESERVA_REVERSA}${Date.now()}:${crypto.randomUUID()}`
    let reivindicacao = supabase
        .from('devolucoes')
        .update({ me_reverse_id: reserva })
        .eq('id', devolucaoId)
        .eq('status', 'aprovada')
        .eq('metodo_retorno', 'etiqueta_reversa')
    reivindicacao = vinculo.tipo === 'reservado'
        ? reivindicacao.eq('me_reverse_id', devolucao.me_reverse_id)
        : reivindicacao.is('me_reverse_id', null)
    const { data: reservadas, error: reservaError } = await reivindicacao.select('id')
    if (reservaError) {
        console.error('[melhor-envio-etiqueta] reversa: falha ao reservar a devolução:', reservaError?.code ?? reservaError?.message ?? 'erro')
        return respostaJson({ error: 'Não consegui reservar a devolução agora. Tente novamente em instantes.' }, 500)
    }
    if (!Array.isArray(reservadas) || reservadas.length !== 1) {
        // Perdeu a corrida (ou a devolução mudou): relê e responde o estado real.
        const { data: relida } = await lerDevolucaoParaReversa(ctx)
        if (relida?.codigo_postagem && classificarVinculoReverso(relida.me_reverse_id, Date.now()).tipo === 'vinculado') {
            return await responderReversoExistente(ctx, relida)
        }
        if (relida && relida.status !== 'aprovada') {
            return respostaJson(
                { error: `Só devolução aprovada gera o código de postagem (status atual: "${String(relida.status)}").` },
                409,
            )
        }
        return respostaReversaEmAndamento()
    }

    // 7. Logística reversa no carrinho (NÃO consome saldo).
    const corpoReverso = {
        service: servicoDaDevolucaoReversa(customerData.shipping_option_id),
        order_id: pedido.shipping_label_id,
        new_sender_mail: emailCliente,
        new_sender_phone: celularCliente,
        insurance_value: Number(Number(devolucao.valor_itens || 0).toFixed(2)),
        package: pacote,
        options: { own_hand: false, receipt: false },
    }
    let carrinho: Response
    try {
        carrinho = await buscarComTempo(buscar, `${baseUrl}/api/v2/me/cart/reverse`, {
            method: 'POST',
            headers: headersME,
            body: JSON.stringify(corpoReverso),
        })
    } catch (err) {
        console.error('[melhor-envio-etiqueta] reversa: carrinho reverso falhou (nada pago):', sanitizarDadosPessoaisDoTexto(String(err)))
        await liberarVinculoReverso(ctx, reserva)
        return respostaJson(
            { error: 'Não consegui falar com o Melhor Envio para criar o envio reverso (nada foi pago). Tente novamente em instantes.' },
            502,
        )
    }
    if (!carrinho.ok) {
        // R7: o corpo pode quebrar na leitura — o motivo vira '' e a reserva
        // é solta do mesmo jeito (uma exceção aqui subia com a reserva presa).
        const motivo = motivoDoProvedor(await carrinho.text().catch(() => ''))
        console.error('[melhor-envio-etiqueta] reversa cart HTTP', carrinho.status, motivo)
        await liberarVinculoReverso(ctx, reserva)
        return respostaJson({ error: mensagemDoErroDaReversa(carrinho.status, ETAPA_CRIACAO_DA_REVERSA, motivo) }, 502)
    }
    let dadosDoCarrinho: any = null
    try {
        dadosDoCarrinho = await carrinho.json()
    } catch {
        dadosDoCarrinho = null
    }
    const meId = dadosDoCarrinho?.id
    if (!ehUuid(meId)) {
        console.error('[melhor-envio-etiqueta] reversa: carrinho sem id:', motivoDoProvedor(JSON.stringify(dadosDoCarrinho ?? {})))
        await liberarVinculoReverso(ctx, reserva)
        return respostaJson({ error: 'O Melhor Envio não devolveu o id do envio reverso (nada foi pago). Tente novamente.' }, 502)
    }

    // 8. VÍNCULO: a reserva vira o id do envio reverso — ANTES do checkout.
    //    Condicional à PRÓPRIA reserva E ao estado da devolução (R1): entre a
    //    reserva e aqui o cliente pode cancelar (→ cancelada) ou informar o
    //    envio (→ em_transito); aí nada é vinculado e o checkout nunca roda.
    const { data: vinculadas, error: vinculoError } = await supabase
        .from('devolucoes')
        .update({ me_reverse_id: meId })
        .eq('id', devolucaoId)
        .eq('me_reverse_id', reserva)
        .eq('status', 'aprovada')
        .eq('metodo_retorno', 'etiqueta_reversa')
        .select('id')
    if (vinculoError || !Array.isArray(vinculadas) || vinculadas.length !== 1) {
        const recusa = await tratarVinculoNaoConfirmado(ctx, reserva, meId, vinculoError)
        if (recusa) return recusa
        // null: a releitura mostrou o vínculo GRAVADO apesar do erro (R3) —
        // segue para o checkout com o vínculo no banco, como no caminho normal.
    }

    // 9–12 sob guarda própria: daqui em diante a ambiguidade de dinheiro é real.
    let pagoConfirmado = false
    try {
        // 9. Checkout — AQUI consome o saldo do lojista.
        const checkoutResponse = await buscarComTempo(buscar, `${baseUrl}/api/v2/me/shipment/checkout`, {
            method: 'POST',
            headers: headersME,
            body: JSON.stringify({ orders: [meId] }),
        })
        if (!checkoutResponse.ok) {
            const motivo = motivoDoProvedor(await checkoutResponse.text().catch(() => ''))
            console.error('[melhor-envio-etiqueta] reversa checkout HTTP', checkoutResponse.status, motivo)
            // R2: só 4xx é recusa DEFINIDA. 5xx (o gateway pode ter debitado
            // com a resposta perdida) e qualquer outro código fora de 2xx são
            // indeterminados — o vínculo fica.
            if (checkoutResponse.status < 400 || checkoutResponse.status >= 500) return respostaReversaIndeterminada(meId, false)
            await removerDoCarrinho(buscar, baseUrl, headersME, meId)
            await liberarVinculoReverso(ctx, meId)
            return respostaJson({ error: mensagemDoErroDaReversa(checkoutResponse.status, ETAPA_PAGAMENTO_DA_REVERSA, motivo) }, 502)
        }
        // R2: 2xx só solta o vínculo com um status CONHECIDO de não pago; corpo
        // ilegível, vazio, `{message}` ou formato desconhecido é INDETERMINADO.
        const textoDoCheckout = await checkoutResponse.text()
        let dadosDoCheckout: unknown = null
        try {
            dadosDoCheckout = JSON.parse(textoDoCheckout)
        } catch {
            dadosDoCheckout = null
        }
        const checkout = classificarCheckoutDaReversa(dadosDoCheckout)
        if (checkout.tipo === 'indeterminado') {
            console.error('[melhor-envio-etiqueta] reversa checkout 2xx sem confirmação legível:', checkoutResponse.status, motivoDoProvedor(textoDoCheckout) || '(sem mensagem)')
            return respostaReversaIndeterminada(meId, false)
        }
        if (checkout.tipo === 'recusado') {
            await removerDoCarrinho(buscar, baseUrl, headersME, meId)
            await liberarVinculoReverso(ctx, meId)
            return respostaJson(
                { error: `O Melhor Envio não fechou a compra do envio reverso (status "${checkout.status}") — nada foi pago, o envio saiu do carrinho e o código de postagem não foi gerado. Confira o saldo da sua conta no Melhor Envio e tente de novo.` },
                502,
            )
        }
        pagoConfirmado = true

        // 10. Geração — obrigatória para o código existir.
        const gerarResponse = await buscarComTempo(buscar, `${baseUrl}/api/v2/me/shipment/generate`, {
            method: 'POST',
            headers: headersME,
            body: JSON.stringify({ orders: [meId] }),
        })
        if (!gerarResponse.ok) {
            console.error('[melhor-envio-etiqueta] reversa generate HTTP', gerarResponse.status, motivoDoProvedor(await gerarResponse.text().catch(() => '')))
            return respostaCodigoPendente(ctx, meId, 'geracao_falhou')
        }

        // 11. Código de postagem + DC-e.
        const codigo = await lerCodigoDePostagem(ctx, meId)
        if (!codigo) return respostaCodigoPendente(ctx, meId, 'pago_sem_codigo')
        const etiquetaUrl = await buscarLinkDaDeclaracao(ctx, meId)

        // 12. Grava e registra (a validade sai do evento gravado agora — R8).
        return await concluirComCodigoDePostagem(ctx, devolucao, meId, codigo, etiquetaUrl, { already: false })
    } catch (err) {
        console.error('[melhor-envio-etiqueta] reversa: falha indeterminada após o vínculo:', sanitizarDadosPessoaisDoTexto(String(err)))
        return respostaReversaIndeterminada(meId, pagoConfirmado)
    }
}

/**
 * Costura de teste (mesmo padrão de `criar-pagamento`/`calculate-shipping`):
 * o handler é exportado e o cliente do Supabase e o fetch podem ser
 * substituídos por dublês. Em produção nada muda.
 */
export type EtiquetaDeps = {
    supabase?: any
    buscar?: typeof fetch
}

export async function handler(req: Request, deps: EtiquetaDeps = {}): Promise<Response> {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const buscar = deps.buscar ?? fetch

    try {
        const body = await req.json()
        // `serviceId` (índice-691): o serviço que o LOJISTA escolhe no card
        // quando o pedido não tem opção do Melhor Envio salva no checkout —
        // ver `erroDeServicoParaEtiqueta` / `normalizarServicoEscolhidoPeloLojista`.
        // `cpf` (só usado pela action `definir_cpf_destinatario` abaixo): o
        // `gerar_etiqueta` NUNCA lê este campo — o CPF daquele fluxo vem
        // SOMENTE do banco (`customerData.cpf`, mais abaixo).
        // `devolucao_id` (só `gerar_devolucao_reversa`): a devolução é a
        // chave daquela action — ela não recebe `orderId` (o pedido vem da
        // própria devolução, no banco).
        const { action, orderId, devolucao_id: devolucaoIdDoCorpo, serviceId: serviceIdEscolhidoNoCard, cpf: cpfDoCorpo } = body

        if (action === 'gerar_devolucao_reversa') {
            if (!ehUuid(devolucaoIdDoCorpo)) {
                return new Response(
                    JSON.stringify({ error: 'Id da devolução inválido.' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                )
            }
        } else if (!orderId || typeof orderId !== 'string') {
            return new Response(
                JSON.stringify({ error: 'Id do pedido é obrigatório.' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
        const supabaseServiceRole = readKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')

        // Porta de admin ANTES de qualquer leitura de pedido — as duas actions.
        // Também ANTES da criação do client principal: sem Authorization nem
        // há por que construir cliente nenhum (o supabase-js lança na cara
        // quando falta SUPABASE_URL — em produção nunca falta, mas a ordem
        // certa é recusar primeiro e construir depois).
        const authHeader = req.headers.get('Authorization')
        const isAdmin = await verifyIsAdmin(authHeader, supabaseUrl, supabaseServiceRole)
        if (!isAdmin) {
            return new Response(
                JSON.stringify({ error: 'Não autorizado: apenas administradores geram etiquetas e consultam rastreio.' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        }

        const supabaseClient = deps.supabase ?? createClient(supabaseUrl, supabaseServiceRole)

        // ── ACTION: definir_cpf_destinatario ────────────────────────────────
        // Caminho seguro para pedido ANTIGO (nasceu antes do checkout gravar
        // CPF) completar o dado direto na ficha, sem depender de migration.
        // Fica ANTES da leitura de credencial/token do Melhor Envio de
        // propósito: esta action nunca fala com o ME, então não deve falhar
        // por causa de um token que ainda nem foi configurado — só passa
        // pelo MESMO portão de admin que as outras (já checado acima).
        if (action === 'definir_cpf_destinatario') {
            const cpfLimpo = typeof cpfDoCorpo === 'string' || typeof cpfDoCorpo === 'number'
                ? String(cpfDoCorpo).replace(/\D/g, '')
                : ''
            if (!cpfValido(cpfLimpo)) {
                return new Response(
                    JSON.stringify({ error: 'CPF inválido — confira os números e tente de novo.' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                )
            }

            const { data: pedidoAtual, error: pedidoAtualError } = await supabaseClient
                .from('marketplace_orders')
                .select('id, status, shipping_label_id, customer_data')
                .eq('id', orderId)
                .maybeSingle()

            if (pedidoAtualError || !pedidoAtual) {
                return new Response(
                    JSON.stringify({ error: 'Pedido não encontrado.' }),
                    { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                )
            }

            // Etiqueta já emitida: o CPF que foi para o Melhor Envio na compra
            // não muda mais retroativamente — não faz sentido reescrever o
            // banco depois do fato.
            if (pedidoAtual.shipping_label_id) {
                return new Response(
                    JSON.stringify({ error: 'Este pedido já tem etiqueta emitida — o CPF não pode mais ser alterado.' }),
                    { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                )
            }

            const statusAtual = String(pedidoAtual.status || '').toLowerCase()
            if (['cancelled', 'delivered', 'returned'].includes(statusAtual)) {
                return new Response(
                    JSON.stringify({ error: `Pedido com status "${statusAtual}" não recebe alteração de CPF.` }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                )
            }

            const customerDataAtual = pedidoAtual.customer_data || {}
            const cpfAnterior = typeof customerDataAtual.cpf === 'string' ? customerDataAtual.cpf : null

            // UPDATE CONDICIONAL contra corrida: só grava se o pedido AINDA
            // não tem etiqueta E o CPF anterior é exatamente o que este
            // pedido de escrita leu — outra aba/clique que gravou no meio
            // tempo faz esta linha não bater e devolve 0 linhas (o front
            // manda recarregar). O front NUNCA reescreve `customer_data`
            // inteiro por conta própria (PII + corrida); só esta action, no
            // servidor, com validação e filtro condicional.
            let atualizacao = supabaseClient
                .from('marketplace_orders')
                .update({ customer_data: { ...customerDataAtual, cpf: cpfLimpo } })
                .eq('id', orderId)
                .is('shipping_label_id', null)
            atualizacao = cpfAnterior === null
                ? atualizacao.is('customer_data->>cpf', null)
                : atualizacao.eq('customer_data->>cpf', cpfAnterior)

            const { data: linhasAtualizadas, error: updateError } = await atualizacao.select('id')

            if (updateError) {
                console.error('[melhor-envio-etiqueta] Falha ao gravar CPF do destinatário:', updateError)
                return new Response(
                    JSON.stringify({ error: 'Não foi possível salvar o CPF agora. Tente novamente em instantes.' }),
                    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                )
            }

            if (!Array.isArray(linhasAtualizadas) || linhasAtualizadas.length !== 1) {
                return new Response(
                    JSON.stringify({ error: 'O pedido mudou enquanto você salvava — recarregue e tente de novo.' }),
                    { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                )
            }

            // NUNCA devolve o CPF inteiro — só os 2 últimos dígitos, para a
            // tela confirmar sem reexibir o número completo depois de salvo.
            return new Response(
                JSON.stringify({ success: true, cpf_final: cpfLimpo.slice(-2) }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        }

        // ── Credencial do provedor (padrão da casa: nada de env var) ──
        const { data: credRow, error: credError } = await supabaseClient
            .from('store_shipping_credentials')
            .select('credentials')
            .eq('provider', 'melhor_envio')
            .maybeSingle()

        if (credError) {
            // Sem a credencial lida NENHUMA action anda — falhar aqui com
            // mensagem clara, não com "Bearer undefined" disfarçado de 401
            // do Melhor Envio.
            console.error('[melhor-envio-etiqueta] Falha ao ler credencial:', credError)
            return new Response(
                JSON.stringify({
                    error: 'Não consegui ler a credencial do Melhor Envio agora. Tente novamente em instantes; se persistir, confira o cadastro do token em Logística & Frete.',
                }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        }

        const credentials = credRow?.credentials || {}
        const token = credentials.token
        const isSandbox = credentials.sandbox === true
        const baseUrl = isSandbox ? 'https://sandbox.melhorenvio.com.br' : 'https://melhorenvio.com.br'

        // R3-7 (contrato 1.5.7, root 23/09 — "Se precisa de email deve ter no
        // app para eu colocar e não você colocar"): o User-Agent do ME é
        // montado com o `contact_email` da PRÓPRIA credencial melhor_envio —
        // a leitura acima já é escopada a `provider = 'melhor_envio'`
        // (linha ~593), então este e-mail NUNCA pode ser o da SuperFrete
        // (linha diferente, nunca lida aqui). Sem `contact_email` salvo, cai
        // no User-Agent LEGADO (`USER_AGENT`) e o log marca a queda — sem
        // imprimir e-mail (não há nenhum neste ramo) nem token.
        const contactEmail = typeof credentials.contact_email === 'string' ? credentials.contact_email.trim() : ''
        if (!contactEmail) {
            console.log('[melhor-envio-etiqueta] ua_contato:legado')
        }
        const userAgentME = contactEmail ? `IKCOUS-Marketplace-Integration (${contactEmail})` : USER_AGENT

        // MESMO User-Agent em TODAS as chamadas ao ME desta requisição (/me,
        // /cart, /checkout, /generate, /print, tracking) — `headersME` é
        // construído uma vez e reutilizado por elas.
        const headersME = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'User-Agent': userAgentME,
        }

        // Sem token não existe fluxo NENHUM (nem consultar rastreio, que hoje
        // sairia com "Bearer undefined" e voltaria 401 do ME disfarçado de
        // "recusou o token"): falha ANTES de gastar qualquer chamada na API
        // externa, nas DUAS actions. É a pendência do dono configurar o token
        // na tela de frete (mesmo campo de hoje).
        if (!token) {
            return new Response(
                JSON.stringify({
                    error: 'Token do Melhor Envio não configurado. Cadastre o token em Logística & Frete (Método de Cálculo Nacional > Melhor Envio) e salve antes de usar etiquetas e rastreio.',
                }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        }

        // ── ACTION: gerar_devolucao_reversa ─────────────────────────────────
        // Código de postagem dos Correios (logística reversa do ME) para uma
        // devolução aprovada — ver o bloco "LOGÍSTICA REVERSA" acima.
        if (action === 'gerar_devolucao_reversa') {
            return await gerarDevolucaoReversa({
                supabase: supabaseClient,
                buscar,
                baseUrl,
                headersME,
                isSandbox,
                devolucaoId: devolucaoIdDoCorpo,
            })
        }

        // ── ACTION: consultar_rastreio ──────────────────────────────────────
        if (action === 'consultar_rastreio') {
            const { data: pedido, error: pedidoError } = await supabaseClient
                .from('marketplace_orders')
                .select('id, status, tracking_code, shipping_label_id')
                .eq('id', orderId)
                .maybeSingle()

            if (pedidoError || !pedido) {
                return new Response(
                    JSON.stringify({ error: 'Pedido não encontrado.' }),
                    { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                )
            }

            const labelId = pedido.shipping_label_id
            if (!labelId) {
                return new Response(
                    JSON.stringify({ error: 'Este pedido ainda não tem etiqueta gerada pela API.' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                )
            }

            const response = await buscarComTempo(buscar, `${baseUrl}/api/v2/me/shipment/tracking`, {
                method: 'POST',
                headers: headersME,
                body: JSON.stringify({ orders: [labelId] }),
            })

            if (!response.ok) {
                const detalhe = await response.text()
                console.error('[melhor-envio-etiqueta] tracking HTTP', response.status, sanitizarCpfDoTexto(detalhe))
                await gravarEvento(supabaseClient, {
                    order_id: orderId,
                    event_type: 'erro',
                    error_message: `tracking HTTP ${response.status}`,
                    payload: { etapa: 'tracking' },
                })
                return new Response(
                    JSON.stringify({ error: mensagemDoErroHttp(response.status, 'consulta de rastreio') }),
                    { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                )
            }

            const data = await response.json()
            const { tracking, status } = normalizarTracking(data, labelId)

            // Rastreio novo sobrescreve o código do pedido — é a sincronização
            // que substitui a digitação manual. Rastreio vazio não apaga o que
            // já existe (vazio é "ainda não saiu", não "não tem").
            if (tracking && tracking !== pedido.tracking_code) {
                await supabaseClient
                    .from('marketplace_orders')
                    .update({ tracking_code: tracking })
                    .eq('id', orderId)
            }
            await gravarEvento(supabaseClient, {
                order_id: orderId,
                event_type: 'rastreio_consultado',
                tracking_code: tracking,
                payload: { status_etiqueta: status },
            })

            return new Response(
                JSON.stringify({ success: true, tracking_code: tracking, status_etiqueta: status }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        }

        // ── ACTION: gerar_etiqueta (default e única action restante) ────────
        if (action !== 'gerar_etiqueta') {
            return new Response(
                JSON.stringify({ error: `Ação desconhecida: ${String(action)}. Use 'gerar_etiqueta' ou 'consultar_rastreio'.` }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        }

        // 1. O pedido, com o que a etiqueta precisa (inclui o estado de
        //    pagamento para o portão e a URL da etiqueta para o `already`).
        const { data: pedido, error: pedidoError } = await supabaseClient
            .from('marketplace_orders')
            .select('id, status, payment_status, tracking_code, shipping_label_id, shipping_label_url, customer_name, customer_data, shipping, shipping_cost')
            .eq('id', orderId)
            .maybeSingle()

        if (pedidoError || !pedido) {
            return new Response(
                JSON.stringify({ error: 'Pedido não encontrado.' }),
                { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        }

        const erroDeStatus = erroDePedidoParaEtiqueta(pedido)
        if (erroDeStatus) {
            return new Response(JSON.stringify({ error: erroDeStatus }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        }

        // 1.5 Portão de PAGAMENTO (falha fechado — ver erroDePagamentoParaEtiqueta).
        const erroDePagamento = erroDePagamentoParaEtiqueta(pedido.payment_status)
        if (erroDePagamento) {
            return new Response(JSON.stringify({ error: erroDePagamento }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        }

        // 2. IDEMPOTÊNCIA DE DINHEIRO: pedido com etiqueta não compra outra.
        if (pedido.shipping_label_id) {
            return new Response(
                JSON.stringify({
                    success: true,
                    already: true,
                    tracking_code: pedido.tracking_code,
                    label_url: pedido.shipping_label_url,
                    label_id: pedido.shipping_label_id,
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        }

        const customerData = pedido.customer_data || {}

        // 3. O SERVIÇO de transporte — determinado ANTES de qualquer leitura
        //    de endereço/itens e de qualquer chamada ao Melhor Envio,
        //    INCLUSIVE o GET /api/v2/me (contrato 1.5.7, §5 e R1-6): pedido
        //    cotado por outro provedor (SuperFrete/Frenet) ou por
        //    transportadora que exige agência de coleta nunca pode gastar
        //    uma chamada de rede no ME antes de recusar. O que o cliente
        //    ESCOLHEU no checkout sempre vence; sem opção salva, o LOJISTA
        //    escolhe agora (`serviceId` do corpo — índice-691), com o mesmo
        //    veredito das recusas abaixo.
        //    O frete efetivo: pedido antigo (RPC anterior à v23) gravava o
        //    frete em shipping_cost e deixava shipping no DEFAULT 0 — sem
        //    olhar as duas colunas, a recusa afirmaria "saiu com frete
        //    grátis" para um pedido que cobrou frete.
        const freteEfetivo = Number(pedido.shipping) > 0 ? pedido.shipping : pedido.shipping_cost
        const opcaoDoCheckout = analisarOpcaoMelhorEnvio(customerData.shipping_option_id)
        const serviceIdDoCheckout = opcaoDoCheckout?.id ?? null
        // O veredito é calculado ANTES de aceitar a escolha do lojista: o
        // `serviceId` do corpo só vale quando a recusa autoriza
        // (`podeEscolherServico`). Entrega local, por exemplo, NUNCA vira
        // etiqueta — quem despacha é a própria loja.
        const recusa = serviceIdDoCheckout ? null : erroDeServicoParaEtiqueta(customerData.shipping_option_id, freteEfetivo)
        const serviceIdEscolhidoAgora = recusa?.podeEscolherServico
            ? normalizarServicoEscolhidoPeloLojista(serviceIdEscolhidoNoCard)
            : null
        const serviceId = serviceIdDoCheckout ?? serviceIdEscolhidoAgora
        if (!serviceId) {
            const { mensagem, podeEscolherServico } = recusa ?? erroDeServicoParaEtiqueta(customerData.shipping_option_id, freteEfetivo)
            return new Response(
                JSON.stringify({ error: mensagem, precisa_escolher_servico: podeEscolherServico }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        }
        // Transportadora que exige agência de coleta (LATAM Cargo id 12,
        // Azul ids 15/16, Buslog id 22): vale tanto para o serviço do
        // CHECKOUT (o cliente já pagou por ele; sem escolha nova aqui) quanto
        // para o escolhido AGORA pelo lojista (aí ele pode tentar outro
        // serviço — por isso `precisa_escolher_servico` acompanha a origem
        // do id, contrato R1-6 item 6).
        const erroAgencia = erroDeAgenciaObrigatoria(serviceId)
        if (erroAgencia) {
            return new Response(
                JSON.stringify({ error: erroAgencia, precisa_escolher_servico: !serviceIdDoCheckout }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        }
        const service = serviceId
        // Seguro (contrato A6/R1-6): a opção cotada SEM seguro leva o
        // sufixo `-ss` no id — só existe numa opção real do CHECKOUT (o
        // seletor manual do lojista nunca tem sufixo, então segue com o
        // subtotal, como sempre foi).
        const semSeguro = opcaoDoCheckout?.semSeguro === true

        const endereco = extrairEnderecoDoPedido(customerData)
        if (!endereco) {
            return new Response(
                JSON.stringify({
                    error: 'O pedido não tem endereço completo (CEP, rua, número e cidade). Sem isso a transportadora não entrega — nenhum dado do endereço é enviado incompleto.',
                }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        }

        // 3.7 CPF do destinatário pessoa física (doc oficial do Melhor Envio,
        //     "Documentos from/to": inserir-fretes-no-carrinho) — ANTES de
        //     ler itens/produtos e de qualquer chamada ao ME (INCLUSIVE o
        //     GET /me): sem CPF válido não vale gastar rede nem ler o
        //     catálogo. O CPF vem SOMENTE do banco (`customerData.cpf`,
        //     contrato com a frente de checkout) — `cpfDoCorpo` do body
        //     NUNCA é lido aqui, mesmo que venha preenchido.
        const cpfBrutoDoPedido = customerData.cpf
        const cpfAusenteNoPedido =
            cpfBrutoDoPedido === undefined || cpfBrutoDoPedido === null || String(cpfBrutoDoPedido).trim() === ''
        const cpfDestinatario = cpfDoDestinatario(customerData)
        if (!cpfDestinatario) {
            return new Response(
                JSON.stringify({
                    error: cpfAusenteNoPedido
                        ? 'Este pedido não tem o CPF do destinatário. O Melhor Envio exige o CPF para emitir a etiqueta — complete o CPF na ficha do pedido e tente de novo.'
                        : 'O CPF do destinatário salvo neste pedido é inválido — corrija na ficha do pedido.',
                    precisa_cpf: true,
                }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        }

        // 4. Itens do pedido + medições do banco (mesma leitura da cotação).
        //    A coluna de preço no schema vivo é `price` (baseline
        //    20260806000000 / src/types/supabase.ts) — `unit_price` não existe.
        const { data: itens, error: itensError } = await supabaseClient
            .from('marketplace_order_items')
            .select('product_id, quantity, price')
            .eq('order_id', orderId)

        if (itensError) {
            console.error('[melhor-envio-etiqueta] Erro ao ler itens:', itensError)
        }
        const itensPedido = itens || []
        if (itensPedido.length === 0) {
            return new Response(
                JSON.stringify({ error: 'O pedido não tem itens registrados — não há o que etiquetar.' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        }

        const productIds = [...new Set(itensPedido.map((i: any) => i.product_id).filter(Boolean))]
        const { data: produtosDb } = await supabaseClient
            .from('produtos')
            .select('id, nome, preco_venda, peso_kg, largura_cm, altura_cm, comprimento_cm')
            .in('id', productIds)

        const { products, volumes } = montarProdutosEVolumes(itensPedido, produtosDb || [])

        // Valor declarado do seguro: SUBTOTAL dos itens (preço × quantidade),
        // não o `total` do pedido — o total inclui frete e desconto, e o ME
        // cobra o seguro em cima do valor declarado (revisor, item 8).
        const subtotalItens = itensPedido.reduce(
            (soma: number, item: Record<string, any>) => soma + Number(item.price || 0) * Number(item.quantity || 1),
            0,
        )

        // 5. Remetente: a conta do lojista no Melhor Envio é a fonte.
        const meResponse = await buscarComTempo(buscar, `${baseUrl}/api/v2/me`, {
            method: 'GET',
            headers: headersME,
        })
        if (!meResponse.ok) {
            const detalhe = await meResponse.text()
            console.error('[melhor-envio-etiqueta] /me HTTP', meResponse.status, sanitizarCpfDoTexto(detalhe))
            return new Response(
                JSON.stringify({ error: mensagemDoErroHttp(meResponse.status, 'leitura do remetente') }),
                { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        }
        const meData = await meResponse.json()
        const from = montarRemetente(meData)
        if (!from) {
            return new Response(
                JSON.stringify({
                    error: 'A conta do Melhor Envio não tem cadastro completo de remetente (documento e endereço). Complete o cadastro no site do Melhor Envio e tente de novo.',
                }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        }

        const to = {
            name: pedido.customer_name || 'Cliente',
            phone: String(customerData.whatsapp || customerData.phone || '0000000000').replace(/\D/g, '') || '0000000000',
            email: customerData.email || null,
            document: cpfDestinatario,
            address: endereco.street,
            complement: endereco.complement || null,
            number: endereco.number,
            district: endereco.district,
            city: endereco.city,
            state_abbr: endereco.state,
            country_id: 'BR',
            postal_code: endereco.cep,
        }

        // 6. Carrinho do ME — cria a etiqueta (ainda SEM consumir saldo).
        const cartResponse = await buscarComTempo(buscar, `${baseUrl}/api/v2/me/cart`, {
            method: 'POST',
            headers: headersME,
            body: JSON.stringify({
                service,
                from,
                to,
                products,
                volumes,
                options: {
                    insurance_value: semSeguro ? 0 : subtotalItens,
                    receipt: false,
                    own_hand: false,
                    reverse: false,
                    non_commercial: true,
                },
            }),
        })
        if (!cartResponse.ok) {
            const detalhe = await cartResponse.text()
            console.error('[melhor-envio-etiqueta] cart HTTP', cartResponse.status, sanitizarCpfDoTexto(detalhe))
            return new Response(
                JSON.stringify({ error: mensagemDoErroHttp(cartResponse.status, 'criação da etiqueta') }),
                { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        }
        const cartData = await cartResponse.json()
        const labelId = cartData?.id
        if (!labelId) {
            // Sanitiza ANTES de cortar em 500 caracteres — cortar primeiro
            // podia partir um CPF ao meio na fronteira do corte, deixando um
            // pedaço de dígitos que a regex de 11 não reconhece mais (achado
            // da 2ª rodada da revisão Opus sobre o commit aadbf4c).
            console.error('[melhor-envio-etiqueta] cart sem id:', sanitizarCpfDoTexto(JSON.stringify(cartData)).slice(0, 500))
            return new Response(
                JSON.stringify({ error: 'O Melhor Envio não devolveu o id da etiqueta. Tente novamente.' }),
                { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        }

        // 6.5 IDEMPOTÊNCIA DE DINHEIRO — a trava anti-duplo-pagamento (revisor,
        //     item 3): reivindicar o pedido ENTRE o carrinho e o checkout com
        //     update CONDICIONAL. Só a chamada que converter
        //     `shipping_label_id` NULL -> labelId (uma linha de volta) segue
        //     para o checkout. Quem perde a corrida (re-clique, aba paralela,
        //     página recarregada no meio da geração) remove o PRÓPRIO item do
        //     carrinho e responde "já existe geração" — nada de duas etiquetas
        //     pagas para o mesmo pedido. A partir daqui falha de
        //     generate/print/tracking é suave: a etiqueta (id) já está no
        //     pedido, e o `already: true` + "Atualizar rastreio" cobrem o resto.
        const { data: reivindicado, error: reivindicarError } = await supabaseClient
            .from('marketplace_orders')
            .update({ shipping_label_id: labelId })
            .eq('id', orderId)
            .is('shipping_label_id', null)
            .select()

        if (reivindicarError || !Array.isArray(reivindicado) || reivindicado.length !== 1) {
            if (reivindicarError) {
                console.error('[melhor-envio-etiqueta] Falha ao reivindicar o pedido:', reivindicarError)
            }
            await removerDoCarrinho(buscar, baseUrl, headersME, labelId)
            await gravarEvento(supabaseClient, {
                order_id: orderId,
                event_type: 'erro',
                error_message: 'Geração concorrida: o pedido já tem etiqueta em andamento (item do carrinho removido).',
                protocol: cartData?.protocol || null,
                payload: { etapa: 'reivindicacao', label_id: labelId, sandbox: isSandbox },
            })
            return new Response(
                JSON.stringify({
                    error: 'Já existe uma geração de etiqueta em andamento para este pedido. Aguarde ou recarregue para ver a etiqueta existente.',
                    label_id: labelId,
                    resgate: true,
                }),
                { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        }

        const finalizarComErro = async (mensagem: string, etapa: string): Promise<Response> => {
            if (etapa === 'checkout') {
                // O ME RESPONDEU que a compra não fechou (HTTP 4xx, ou 200 com
                // status != paid — 5xx NUNCA chega aqui: vai para
                // finalizarIndeterminado, revisor A′ da 2ª rodada): aqui NÃO há
                // ambiguidade de dinheiro. Remover o item do carrinho (revisor,
                // item 4 — nada fica lá para o lojista "comprar o carrinho" sem
                // querer) e LIBERAR a reivindicação (revisor, bloqueante A da
                // 2ª rodada, PR #423): mantê-la deixava o pedido preso para
                // sempre — o portão `already: true` devolvia uma etiqueta que
                // não existe mais, e só UPDATE na mão do dono destravava.
                // Update CONDICIONAL: só solta se o vínculo ainda é o desta
                // corrida.
                await removerDoCarrinho(buscar, baseUrl, headersME, labelId)
                const { error: erroLiberacao } = await supabaseClient
                    .from('marketplace_orders')
                    .update({ shipping_label_id: null })
                    .eq('id', orderId)
                    .eq('shipping_label_id', labelId)
                if (erroLiberacao) {
                    console.error('[melhor-envio-etiqueta] Falha ao liberar a reivindicação do pedido:', erroLiberacao)
                }
                await gravarEvento(supabaseClient, {
                    order_id: orderId,
                    event_type: 'erro',
                    error_message: mensagem,
                    protocol: cartData?.protocol || null,
                    payload: { etapa, label_id: labelId, service, sandbox: isSandbox },
                })
                return new Response(JSON.stringify({ error: mensagem }), {
                    status: 502,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                })
            }
            // Etapa PÓS-checkout (generate): a etiqueta JÁ FOI PAGA — o vínculo
            // no pedido FICA (é ela que o `already: true` devolve e o que
            // amarra o pedido à etiqueta paga na conta do ME). Item pago não
            // está mais no carrinho: NADA a remover. E a resposta NÃO diz
            // "tente novamente" — o retry cairia no `already` sem link de
            // impressão: nomeia o id e manda gerar/imprimir no site do ME.
            // `resgate: true` é CONTRATO para o card (não regex sobre a prosa):
            // volta para a lista, não reapresenta o botão de gasto (E′).
            await gravarEvento(supabaseClient, {
                order_id: orderId,
                event_type: 'erro',
                error_message: mensagem,
                protocol: cartData?.protocol || null,
                payload: { etapa, label_id: labelId, service, sandbox: isSandbox },
            })
            return new Response(
                JSON.stringify({
                    error: `A etiqueta foi PAGA no Melhor Envio (id ${labelId}), mas a geração do arquivo falhou. Ela já está na sua conta do Melhor Envio — gere e imprima a etiqueta de id ${labelId} direto por lá; não tente de novo aqui.`,
                    label_id: labelId,
                    resgate: true,
                }),
                { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        }

        /**
         * Estado INDETERMINADO de dinheiro (revisor, B e A′ da 2ª rodada, PR
         * #423): 5xx do checkout OU exceção pós-reivindicação — o ME pode ter
         * processado a compra com a resposta perdida. AQUI não se libera a
         * reivindicação e não se mexe no carrinho: o vínculo
         * `shipping_label_id` fica (é o que impede a compra dupla — o próximo
         * clique cai no `already: true`), o evento registra o estado e a
         * resposta 502 nomeia o id e manda conferir a conta do ME antes de
         * qualquer retry. `resgate: true` é contrato para o card (E′).
         * `pagoConfirmado` deixa a mensagem honesta quando a compra FECHOU
         * (exceção em generate/print/json depois de um checkout `paid`).
         */
        const finalizarIndeterminado = async (detalheEvento: string, pagoConfirmado: boolean): Promise<Response> => {
            await gravarEvento(supabaseClient, {
                order_id: orderId,
                event_type: 'erro',
                error_message: pagoConfirmado
                    ? `Compra CONFIRMADA no Melhor Envio, falha na finalização: ${detalheEvento}`
                    : `Falha indeterminada no checkout/geração da etiqueta: ${detalheEvento}`,
                protocol: cartData?.protocol || null,
                payload: { etapa: 'checkout_indeterminado', label_id: labelId, service, sandbox: isSandbox },
            })
            const mensagem = pagoConfirmado
                ? `A compra da etiqueta (id ${labelId}) FOI CONFIRMADA no Melhor Envio, mas a geração do arquivo falhou. Gere e imprima a etiqueta de id ${labelId} direto na sua conta do Melhor Envio; o pedido segue vinculado a esta etiqueta.`
                : `A compra da etiqueta (id ${labelId}) ficou em estado INDETERMINADO no Melhor Envio — pode ter sido paga ou não. Confira a compra na sua conta do Melhor Envio antes de tentar de novo; o pedido segue vinculado a esta etiqueta.`
            return new Response(
                JSON.stringify({ error: mensagem, label_id: labelId, resgate: true }),
                { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        }

        // ── Passos 7–11 sob guarda PRÓPRIA (revisor, B da 2ª rodada, PR #423) ──
        // O checkout é a chamada mais lenta do ME (`buscarComTempo` corta em
        // 20 s) e uma exceção aqui saltava direto para o catch de TOPO:
        // resposta genérica, nenhum evento gravado, item no carrinho e
        // reivindicação mantidos em silêncio. AQUI a ambiguidade de dinheiro
        // é REAL — o ME pode ter processado a compra com a resposta perdida.
        // Por isso o catch NÃO libera a reivindicação e NÃO mexe no carrinho:
        // registra o estado indeterminado (finalizarIndeterminado) e manda o
        // lojista conferir a conta do ME antes de qualquer retry. O 5xx do
        // checkout entra no MESMO caminho (A′ da 2ª rodada): gateway que
        // responde 500/502/504 pode ter DEBITADO com a resposta perdida —
        // tratá-lo como "não pagou" reabre a compra dupla. A flag
        // `pagoConfirmado` nasce FORA do try porque o catch precisa ler: só
        // vira true depois de um checkout com `purchase.status === 'paid'`,
        // para a mensagem do indeterminado ser honesta quando a compra FECHOU
        // (nit H2 da 3ª rodada).
        let pagoConfirmado = false
        try {
            // 7. Checkout — AQUI consome o saldo. A confirmação explícita é na
            //    tela; a function não re-confirma (a UI é a única porta).
            const checkoutResponse = await buscarComTempo(buscar, `${baseUrl}/api/v2/me/shipment/checkout`, {
                method: 'POST',
                headers: headersME,
                body: JSON.stringify({ orders: [labelId] }),
            })
            if (!checkoutResponse.ok) {
                const detalhe = await checkoutResponse.text()
                console.error('[melhor-envio-etiqueta] checkout HTTP', checkoutResponse.status, sanitizarCpfDoTexto(detalhe))
                if (checkoutResponse.status >= 500) {
                    // 5xx de gateway: a compra PODE ter fechado com a resposta
                    // perdida — indeterminado, NÃO "não pagou" (A′).
                    return await finalizarIndeterminado(
                        `checkout respondeu HTTP ${checkoutResponse.status} — compra em estado indeterminado`,
                        false,
                    )
                }
                return await finalizarComErro(mensagemDoErroHttp(checkoutResponse.status, 'pagamento da etiqueta'), 'checkout')
            }
            const checkoutData = await checkoutResponse.json()
            const checkout = normalizarCheckout(checkoutData)
            if (!checkout.pago) {
                return await finalizarComErro(checkout.erro || 'Compra da etiqueta não confirmada.', 'checkout')
            }
            // A compra FECHOU de verdade (`purchase.status === 'paid'`) — daqui
            // em diante exceção não é mais "pode ter sido paga ou não" (flag
            // para a mensagem honesta do indeterminado, nit H2 da 3ª rodada).
            pagoConfirmado = true

            // 8. Gera a etiqueta (obrigatório antes de imprimir).
            const generateResponse = await buscarComTempo(buscar, `${baseUrl}/api/v2/me/shipment/generate`, {
                method: 'POST',
                headers: headersME,
                body: JSON.stringify({ orders: [labelId] }),
            })
            if (!generateResponse.ok) {
                const detalhe = await generateResponse.text()
                console.error('[melhor-envio-etiqueta] generate HTTP', generateResponse.status, sanitizarCpfDoTexto(detalhe))
                return await finalizarComErro(mensagemDoErroHttp(generateResponse.status, 'geração da etiqueta'), 'generate')
            }

            // 9. Link de impressão (fallo suave: sem link, a etiqueta existe e o
            //    lojista reimprime pelo ME — não é motivo para falhar tudo).
            let labelUrl: string | null = null
            try {
                const printResponse = await buscarComTempo(buscar, `${baseUrl}/api/v2/me/shipment/print`, {
                    method: 'POST',
                    headers: headersME,
                    body: JSON.stringify({ orders: [labelId], mode: 'private' }),
                })
                if (printResponse.ok) {
                    const printData = await printResponse.json()
                    labelUrl = printData?.url || null
                } else {
                    console.error('[melhor-envio-etiqueta] print HTTP', printResponse.status, sanitizarCpfDoTexto(await printResponse.text()))
                }
            } catch (printErr) {
                console.error('[melhor-envio-etiqueta] print falhou (suave):', printErr)
            }

            // 10. Rastreio inicial (fallo suave igual: pode não ter nascido ainda).
            let trackingCode: string | null = null
            try {
                const trackingResponse = await buscarComTempo(buscar, `${baseUrl}/api/v2/me/shipment/tracking`, {
                    method: 'POST',
                    headers: headersME,
                    body: JSON.stringify({ orders: [labelId] }),
                })
                if (trackingResponse.ok) {
                    const trackingData = await trackingResponse.json()
                    trackingCode = normalizarTracking(trackingData, labelId).tracking
                }
            } catch (trackingErr) {
                console.error('[melhor-envio-etiqueta] tracking falhou (suave):', trackingErr)
            }

            // 11. Completa o resultado no pedido e grava o histórico. O
            //     `shipping_label_id` JÁ foi gravado na reivindicação (6.5) — este
            //     update acrescenta url de impressão e rastreio.
            const { error: updateError } = await supabaseClient
                .from('marketplace_orders')
                .update({
                    shipping_label_id: labelId,
                    shipping_label_url: labelUrl,
                    tracking_code: trackingCode ?? pedido.tracking_code ?? null,
                })
                .eq('id', orderId)

            if (updateError) {
                // Etiqueta PAGA e VINCULADA (6.5), mas url/rastreio não subiram:
                // erro honesto com o id — o lojista não perde a etiqueta (ela está
                // na conta dele e no pedido); reimpressão pelo site do ME.
                console.error('[melhor-envio-etiqueta] Falha ao completar o pedido:', updateError)
                await gravarEvento(supabaseClient, {
                    order_id: orderId,
                    event_type: 'erro',
                    error_message: 'Etiqueta paga e vinculada, mas falhou ao gravar url de impressão/rastreio.',
                    tracking_code: trackingCode,
                    label_url: labelUrl,
                    protocol: cartData?.protocol || null,
                    payload: { label_id: labelId, etapa: 'gravacao' },
                })
                return new Response(
                    JSON.stringify({
                        error: `A etiqueta foi paga no Melhor Envio (id ${labelId}) e está vinculada ao pedido, mas o link de impressão não foi salvo. Reimprima pela sua conta do Melhor Envio; o rastreio pode ser atualizado aqui depois.`,
                        label_id: labelId,
                        resgate: true,
                    }),
                    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                )
            }

            await gravarEvento(supabaseClient, {
                order_id: orderId,
                event_type: 'etiqueta_gerada',
                tracking_code: trackingCode,
                label_url: labelUrl,
                protocol: cartData?.protocol || null,
                payload: {
                    label_id: labelId,
                    purchase_id: checkout.purchaseId || null,
                    service,
                    sandbox: isSandbox,
                    valor_declarado: subtotalItens,
                },
            })

            return new Response(
                JSON.stringify({
                    success: true,
                    already: false,
                    tracking_code: trackingCode,
                    label_url: labelUrl,
                    label_id: labelId,
                    protocol: cartData?.protocol || null,
                    sandbox: isSandbox,
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            )
        } catch (errFinalizacao) {
            console.error('[melhor-envio-etiqueta] Falha indeterminada após a reivindicação:', errFinalizacao)
            // Mesmo caminho do 5xx do checkout (finalizarIndeterminado): NÃO
            // libera, NÃO mexe no carrinho, registra e manda conferir a conta
            // do ME. Se a compra já tinha FECHADO (`paid`), a mensagem é
            // honesta sobre isso (pagoConfirmado).
            return await finalizarIndeterminado(String(errFinalizacao), pagoConfirmado)
        }
    } catch (err) {
        console.error('[melhor-envio-etiqueta] Erro de topo:', err)
        return new Response(
            JSON.stringify({ error: 'Não foi possível gerar a etiqueta agora. Tente novamente em instantes.' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
    }
}

// `(req) => handler(req)`, e não `serve(handler)` direto: o `serve` do std
// passa um segundo argumento (ConnInfo) que cairia em `deps`.
const isTesting = Deno.mainModule.endsWith('_test.ts') || Deno.mainModule.endsWith('_test.js') || Deno.mainModule.includes('index_test')
if (!isTesting) serve((req: Request) => handler(req))
