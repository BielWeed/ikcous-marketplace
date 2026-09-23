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
// ============================================================================
// @ts-nocheck
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { ehRetiradaNaLoja } from "../_shared/retirada-na-loja.ts"
import { cpfDoDestinatario, cpfValido, sanitizarCpfDoTexto } from "./cpf.ts"

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
        const { action, orderId, serviceId: serviceIdEscolhidoNoCard, cpf: cpfDoCorpo } = body

        if (!orderId || typeof orderId !== 'string') {
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
            console.error('[melhor-envio-etiqueta] cart sem id:', JSON.stringify(cartData).slice(0, 500))
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
