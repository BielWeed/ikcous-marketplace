// @ts-nocheck
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { ID_RETIRADA_NA_LOJA } from "../_shared/retirada-na-loja.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function erroDeTransportadoraEhCepInvalido(mensagem: string | null | undefined): boolean {
    // Exige status 422 no prefixo e indicação explícita do CEP de destino.
    return !!mensagem && mensagem.includes('retornou 422:') && mensagem.includes('cep_destino')
}

// Helper to calculate smart fallback price based on Brazilian CEP regions
export function calculateSmartFallback(origin: string, dest: string, baseFee: number): number {
    const cleanOrigin = origin.replace(/\D/g, '')
    const cleanDest = dest.replace(/\D/g, '')
    if (cleanOrigin.length === 0 || cleanDest.length === 0) return baseFee

    const oReg = cleanOrigin.charAt(0)
    const dReg = cleanDest.charAt(0)
    
    // Same region (e.g. both start with 3 - Minas Gerais)
    if (oReg === dReg) {
        return Math.max(15, baseFee); // Local/Regional: standard flat fee
    }
    
    // Close region groups
    const groups = [
        ['0', '1'], // SP
        ['8', '9'], // South (PR, SC, RS)
        ['2', '3']  // Southeast (RJ, ES, MG)
    ];
    
    let neighboring = false;
    for (const g of groups) {
        if (g.includes(oReg) && g.includes(dReg)) {
            neighboring = true;
            break;
        }
    }
    
    if (neighboring) {
        return Math.max(22, baseFee + 7); // Neighboring state/region
    }
    
    // Remote states
    return Math.max(38, baseFee + 20); // Remote regions
}

/**
 * Preço da contingência de ÚLTIMO recurso — a do `catch` de topo, quando a
 * função inteira estourou.
 *
 * POR QUE ELA EXISTE SEPARADA DE `calculateSmartFallback`
 *
 * A contingência de topo roda num ponto em que talvez nada tenha sido lido: o
 * erro pode ter vindo antes do `req.json()`, antes do `store_config`, antes de
 * qualquer coisa. Então ela precisa decidir com o que houver — e precisa poder
 * dizer "não sei", que é o caso em que `null` é devolvido.
 *
 * O QUE ELA CONSERTA
 *
 * Até 18/08/2026 esse `catch` devolvia `price: 15` cravado, para qualquer
 * destino do Brasil. A escada por região (15 / 22 / 38) já existia logo acima e
 * não era usada aqui. O efeito: toda cotação que estourasse mandava uma peça de
 * Monte Carmelo para Manaus por R$ 15, e a diferença saía do bolso da lojista,
 * sem aparecer em tela nenhuma. Cotação falha é justamente quando ninguém está
 * olhando.
 *
 * POR QUE `null` EM VEZ DE UM NÚMERO ALTO QUANDO FALTA CEP
 *
 * Sem os dois CEPs não há distância, e sem distância todo número é chute. Chute
 * barato custa o dinheiro dela; chute caro afasta a compradora. Devolver `null`
 * faz a função responder erro, e aí o carrinho aplica a taxa que a própria
 * lojista configurou no painel — número dela, escolhido por ela.
 *
 * @returns o preço em reais, ou `null` quando não há como cotar honestamente.
 *
 * ⚠️ DESLIGADA DO `catch` DE TOPO EM 25/08/2026: a escada por região que ela
 * devolve não bate com o que a RPC do checkout cobra para um id `flat-fee-%`
 * (`store_config.shipping_fee`, sempre — ver `precoResolvidoSemCache`
 * abaixo). O `catch` de topo passou então a mostrar `taxaDaLoja` direto
 * quando `taxaDaLojaConfigurada` era `true`, e falhava fechado quando não
 * era — nunca mais a estimativa por distância. FRETE V2 (03/09/2026): essa
 * contingência de taxa fixa saiu INTEIRA com o caminho de flat_fee — o
 * `catch` de topo hoje falha fechado sempre, sem preço nenhum. Esta função
 * continua exportada e testada porque descreve, isolada, um comportamento
 * que já existiu em produção; nenhum caminho do `handler` a chama mais.
 */
export function precoDeContingenciaDoTopo(
    originCep?: string,
    destCep?: string,
    flatFee?: number,
): number | null {
    const origem = (originCep ?? '').replace(/\D/g, '')
    const destino = (destCep ?? '').replace(/\D/g, '')
    if (origem.length === 0 || destino.length === 0) return null

    // `flatFee` é o piso configurado pela loja. Quando o erro impediu de lê-lo,
    // 0 deixa a escada decidir sozinha — os pisos dela (15/22/38) já protegem.
    const base = Number.isFinite(flatFee) ? (flatFee as number) : 0
    return calculateSmartFallback(origem, destino, base)
}

/**
 * Resolve se dá para cotar a partir do que a loja configurou — falhando
 * fechado quando falta CEP de origem.
 *
 * MESMO DEFEITO QUE A 1.4.0 CORRIGIU NA CONTINGÊNCIA DE TOPO, um andar acima
 * (ver `precoDeContingenciaDoTopo`): até 18/08/2026 o cálculo direto usava
 * `storeConfig.origin_cep || '38500-000'` e
 * `Number(storeConfig.shipping_fee || 15)` — loja que nunca disse de onde
 * despacha, ou quanto cobra, tinha o frete calculado a partir de Monte
 * Carmelo e de R$ 15, calada. `Number(null)` é `0` e `null || 15` é `15`:
 * os dois caminhos estavam errados. Cotação sem origem não é cotação — é
 * chute com aparência de preço.
 *
 * FRETE V2 (03/09/2026): a exigência de taxa fixa que vivia aqui (quando
 * `provider` era `'flat_fee'`) saiu JUNTO com o caminho de taxa fixa — a
 * cotação de fora da cidade agora é SÓ a de transportadora real
 * (melhor_envio/frenet), e quem decide o preço é a API dela. O que resta é a
 * origem: sem ela não há distância, e sem distância todo preço é chute.
 *
 * @returns a mensagem de erro quando falta configuração, ou `null` quando
 * pode seguir com a cotação.
 */
export function validarOrigemEFrete(originCep: string | null | undefined): string | null {
    if (!originCep) {
        return 'A loja ainda não configurou o CEP de origem do frete.'
    }
    return null
}

// FRETE V2 (03/09/2026): `flatFeeConfigurada` e `getFlatFeeResponse` — a
// checagem e a montagem da opção de taxa fixa ("Entrega Padrão" com o valor
// de `store_config.shipping_fee`) — foram REMOVIDAS junto com o caminho que
// as usava. Ordem do dono: "entrega fixa não faz sentido existir, parece
// opção duplicada". Fora da cidade o preço vem SÓ de transportadora real;
// sem ela, a resposta é a lista vazia e honesta (ver
// `respostaSemCotacaoDeFora` abaixo). `store_config.shipping_fee` fica
// órfão no banco de propósito (sem migration nesta frente).

/**
 * Dispara uma query sem bloquear a resposta, sem quebrar a função.
 *
 * O PostgrestBuilder do supabase-js implementa apenas `PromiseLike` — tem `then`,
 * mas NÃO tem `catch`. O código anterior fazia `.insert({...}).catch(...)`, o que
 * lançava `TypeError: .catch is not a function`. Esse erro subia até o try/catch
 * de topo e a função descartava as cotações reais da transportadora para devolver
 * o fallback fixo de R$ 15 — ou seja, o frete calculado nunca chegava ao cliente.
 *
 * Envolver em `Promise.resolve()` converte o thenable em Promise de verdade (o que
 * também dispara a execução da query, já que o builder é lazy) e permite tratar
 * tanto a rejeição quanto o `{ error }` que o PostgREST devolve sem rejeitar.
 */
function fireAndForget(query: PromiseLike<unknown>, label: string): void {
    Promise.resolve(query).then(
        (result) => {
            const error = (result as { error?: unknown } | null)?.error
            if (error) console.error(label, error)
        },
        (err) => console.error(label, err),
    )
}

/**
 * O oposto do `fireAndForget` acima: espera a gravação terminar e devolve o
 * erro, se houve.
 *
 * Duas formas de falhar precisam sair pelo mesmo lugar — o PostgREST devolve
 * `{ error }` sem rejeitar, e rede/permissão rejeitam a promessa. As duas
 * viram um valor de retorno, e NENHUMA vira exceção: se a exceção subisse, o
 * `catch` de topo desta função a converteria num preço de contingência com
 * status 200 — ou seja, o preço sairia mesmo sem a cotação gravada, que é
 * exatamente o defeito que este caminho existe para fechar.
 *
 * Recebe uma função (e não o builder já criado) porque o builder do
 * supabase-js é lazy: assim a query só é disparada aqui dentro, com o
 * `try/catch` já em volta.
 */
async function gravarCotacao(gravar: () => PromiseLike<unknown>): Promise<unknown | null> {
    try {
        const resultado = await gravar()
        const erro = (resultado as { error?: unknown } | null)?.error
        if (erro) {
            console.error('Failed to cache shipping options:', erro)
            return erro
        }
        return null
    } catch (err) {
        console.error('Failed to cache shipping options:', err)
        return err ?? new Error('Falha desconhecida ao gravar a cotação')
    }
}

/**
 * Gravação da cotação em `shipping_quotes_cache` — `.upsert` de verdade
 * (index-880 fechado pela 20261166000000).
 *
 * A migration `20261166000000_o_cache_de_cotacao_nao_guarda_repeticao.sql`
 * criou a UNIQUE (origin_cep, destination_cep, cart_hash) que este
 * `onConflict` mira: a gravação ficou ATÔMICA — dois misses simultâneos do
 * MESMO carrinho agora disputam a mesma constraint e um dos dois vira
 * UPDATE da linha do outro, nunca mais INSERT duplicado. Este código só
 * pode ser PUBLICADO depois da migration aplicada no banco da loja (o
 * aviso de ordem também mora no cabeçalho da migration).
 *
 * E se rodar antes, num ambiente ainda SEM a UNIQUE: NÃO é insert
 * silencioso nem duplicado. O Postgres recusa um ON CONFLICT sem
 * constraint correspondente com o erro 42P10 ("no unique constraint
 * matching the ON CONFLICT specification"), o PostgREST devolve isso como
 * `{ error }` sem rejeitar a promessa, e `gravarCotacao` captura o erro e
 * o devolve como valor. Daí em diante é o caminho de falha-de-gravação de
 * sempre: o log sai com status 'error' ("Falha ao gravar a cotação: …"),
 * as opções cujo preço o servidor resolve SEM cache seguem na resposta
 * (`precoResolvidoSemCache` — hoje, a entrega local) e, se TODAS as opções
 * dependiam da linha gravada, o edge recusa com 503 para a cliente
 * reapertar "calcular". Quem perde é a gravação no cache (e com ela o
 * frete de transportadora); a cotação que não depende do cache continua
 * chegando ao usuário.
 */
async function salvarCotacaoNoCache(
    supabaseClient: any,
    chave: { originCep: string; destinationCep: string; cartHash: string; options: unknown },
): Promise<unknown | null> {
    // `created_at` VAI no corpo (release 1.5.4): no conflito o upsert vira
    // UPDATE só das colunas enviadas. Sem ele, a linha recotada guardava o
    // `created_at` VELHO — e o gatilho `limpar_cotacoes_fora_da_janela`
    // (AFTER INSERT/UPDATE, apaga > 2 h) apagava a linha que acabara de ser
    // atualizada; a RPC do pedido não achava a cotação ("expirou") depois de
    // a cliente já ter visto o preço.
    return await gravarCotacao(() =>
        supabaseClient.from('shipping_quotes_cache').upsert({
            origin_cep: chave.originCep,
            destination_cep: chave.destinationCep,
            cart_hash: chave.cartHash,
            options: chave.options,
            created_at: new Date().toISOString(),
        }, { onConflict: 'origin_cep,destination_cep,cart_hash' }),
    )
}

/**
 * O cache só serve se a cotação gravada for do PROVEDOR QUE A LOJA USA AGORA
 * (release 1.5.4). A UNIQUE de `shipping_quotes_cache` é
 * (origin_cep, destination_cep, cart_hash) — sem provedor. Loja que troca
 * Melhor Envio -> SuperFrete (ou volta) acharia por até 2 h o preço do
 * provedor anterior, com ids que o provedor atual nem conhece. Linha de
 * outro provedor (ou mista, ou sem `provider`) = FALTA: recota e o upsert
 * sobrescreve a mesma chave. `local`/`free`/`pickup` são da própria loja e
 * valem para qualquer provedor.
 */
export function cotacaoDoCacheServeAoProvedor(options: unknown, provider: string): boolean {
    if (!Array.isArray(options) || options.length === 0) return false
    return options.every((opcao) => {
        const dono = (opcao as { provider?: unknown } | null)?.provider
        return dono === provider || dono === 'local' || dono === 'free' || dono === 'pickup'
    })
}

/**
 * Texto de erro de terceiro pronto para log/resposta (release 1.5.4): troca
 * cada segredo conhecido (o token da transportadora) e qualquer
 * `Bearer <algo>` por `[redacted]`, e corta no `limite`. A API da
 * transportadora pode ECOAR o que recebeu (o próprio token, o cabeçalho
 * Authorization) — e esse texto ia cru para `shipping_calculation_logs`, para
 * o `console.error` dos logs da função e, no teste de conexão, para a tela.
 * Redige ANTES de cortar: o corte nunca deixa meio token para trás de um
 * segredo que já foi trocado.
 */
export function textoSemSegredo(texto: unknown, segredos: unknown[] = [], limite = 300): string {
    let saida = String(texto ?? '')
    for (const segredo of segredos) {
        if (typeof segredo === 'string' && segredo.length > 0) {
            saida = saida.split(segredo).join('[redacted]')
        }
    }
    saida = saida.replace(/(Bearer\s+)[^\s"',;}]+/gi, '$1[redacted]')
    if (saida.length > limite) saida = `${saida.slice(0, limite)}…`
    return saida
}

// ── SUPERFRETE (release 1.5.4) ───────────────────────────────────────────────
// Contrato lido na doc oficial (superfrete.readme.io, 22/09/2026): POST
// {base}/api/v0/calculator; produção https://api.superfrete.com, sandbox
// https://sandbox.superfrete.com (token é POR ambiente); Authorization Bearer;
// User-Agent OBRIGATÓRIO "<App> <versão> (<e-mail de contato técnico>)";
// corpo com from/to OBJETOS {postal_code}, `services` em texto "1,2,17",
// `options` e `products` (peso kg, medidas cm). Resposta 200 = ARRAY por
// serviço, `price` número, `has_error` booleano. Só o 400 é documentado:
// qualquer outro status é falha genérica. Limites de peso/medida NÃO ficam
// aqui (a doc se contradiz) — a API decide e devolve o serviço com erro.

const SUPERFRETE_BASE_PRODUCAO = 'https://api.superfrete.com'
const SUPERFRETE_BASE_SANDBOX = 'https://sandbox.superfrete.com'

/** Chave da tela (`enabled_shipping_methods`) -> id do serviço na SuperFrete. */
export const SUPERFRETE_SERVICO_POR_CHAVE: Readonly<Record<string, number>> = { pac: 1, sedex: 2, jadlog: 3 }

/** "Lista vazia = todas" (mesma regra do ME): os ids que a doc lista (1 PAC, 2 SEDEX, 3 Jadlog, 17 Mini Envios, 31 Loggi, 33 J&T). */
export const SUPERFRETE_TODOS_OS_SERVICOS: readonly number[] = [1, 2, 3, 17, 31, 33]

/**
 * Versão que vai no User-Agent da SuperFrete (release 1.5.5). A doc manda
 * "Nome da sua aplicação e versão (<e-mail>)"; o nome é o do app, a versão é
 * a da release que publicou esta edge.
 */
export const VERSAO_DA_INTEGRACAO_SUPERFRETE = '1.5.5'

/**
 * Motivo de a SuperFrete não ser consultada por falta do e-mail — vai para o
 * histórico de cotações e para o teste de conexão, em linguagem de lojista e
 * apontando o CAMPO da tela (nunca variável de ambiente).
 */
export const MOTIVO_SEM_EMAIL_SUPERFRETE =
    'Falta o e-mail de contato técnico da SuperFrete — preencha em Ajustes > Transportadoras.'

/** O e-mail que a lojista DIGITOU não passa na régua (salvar e testar). */
export const MOTIVO_EMAIL_DE_CONTATO_INVALIDO =
    'Confira o e-mail de contato técnico: use um endereço completo, sem espaços nem acentos (exemplo: voce@sualoja.com.br).'

/**
 * O `services` do pedido, derivado das chaves de TRANSPORTADORA (a de
 * retirada já saiu em `chavesDeTransportadora`). Vazio = todas. Chave sem
 * serviço correspondente não vira serviço inventado: com nenhuma chave
 * válida o texto sai vazio e quem chama não consulta a API.
 */
export function servicosSuperFrete(chaves: string[]): string {
    if (chaves.length === 0) return SUPERFRETE_TODOS_OS_SERVICOS.join(',')
    const ids = new Set<number>()
    for (const chave of chaves) {
        const id = SUPERFRETE_SERVICO_POR_CHAVE[String(chave || '').toLowerCase().trim()]
        if (id) ids.add(id)
    }
    return [...ids].sort((a, b) => a - b).join(',')
}

/** Só `sandbox === true` EXATO vai para o sandbox (mesma regra do ME). */
export function urlDaCotacaoSuperFrete(sandbox: unknown): string {
    return `${sandbox === true ? SUPERFRETE_BASE_SANDBOX : SUPERFRETE_BASE_PRODUCAO}/api/v0/calculator`
}

/**
 * E-mail de contato técnico (release 1.5.5) — a ÚNICA régua, usada ao salvar
 * (`save_credentials`), no teste de conexão e na cotação pública (que
 * REVALIDA o salvo: a RLS deixa o admin gravar a linha direto, sem passar por
 * aqui). Devolve o e-mail APARADO, ou `null` quando não serve.
 *
 * Estrita de propósito, porque o valor vai DENTRO de um header HTTP:
 * - só ASCII: nada de `\S` nem de classe que aceite Unicode — no Deno 2.9.2
 *   "ő@x.com" estoura "not a valid ByteString" no `new Headers` (e a cotação
 *   virava 503 com motivo técnico em inglês) e "joão@x.com" sai como Latin-1;
 * - sem espaço, CR, LF, `<`, `>`, `(`, `)`, vírgula nem `;`: nenhum desses
 *   cabe na classe abaixo, então nenhum quebra o comentário "(e-mail)" do
 *   User-Agent nem injeta outro header;
 * - no máximo 254 caracteres depois do trim (limite prático de endereço).
 *
 * É a regex `^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$`
 * escrita em partes: um `@` só; local em `[A-Za-z0-9._%+-]+`; domínio com
 * 2+ rótulos `[A-Za-z0-9-]+` separados por ponto, o último só letras (2+).
 * Em partes para não ter quantificador aninhado (backtracking).
 */
export function emailDeContatoValido(valor: unknown): string | null {
    if (typeof valor !== 'string') return null
    const email = valor.trim()
    if (email.length === 0 || email.length > 254) return null
    const arroba = email.indexOf('@')
    if (arroba <= 0 || arroba !== email.lastIndexOf('@')) return null
    if (!/^[A-Za-z0-9._%+-]+$/.test(email.slice(0, arroba))) return null
    const rotulos = email.slice(arroba + 1).split('.')
    if (rotulos.length < 2) return null
    if (!/^[A-Za-z]{2,}$/.test(rotulos.at(-1) ?? '')) return null
    return rotulos.every((rotulo) => /^[A-Za-z0-9-]+$/.test(rotulo)) ? email : null
}

/**
 * User-Agent da SuperFrete montado NO SERVIDOR (release 1.5.5):
 * `IKCOUS Marketplace <versão> (<e-mail de contato técnico da loja>)`. O
 * e-mail é o que a LOJA salvou (ou, no teste de conexão, o que a lojista
 * digitou) — até a 1.5.4 o UA inteiro vinha de uma variável de projeto, que
 * saiu SEM fallback. E-mail que não passa na régua = `null`, e quem chama
 * falha FECHADO sem consultar a API.
 */
export function userAgentDaSuperFrete(email: unknown): string | null {
    const valido = emailDeContatoValido(email)
    return valido ? `IKCOUS Marketplace ${VERSAO_DA_INTEGRACAO_SUPERFRETE} (${valido})` : null
}

function cabecalhosDaSuperFrete(token: string, userAgent: string): Record<string, string> {
    return {
        'Authorization': `Bearer ${token}`,
        'User-Agent': userAgent,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    }
}

/**
 * Corpo da cotação: produtos e preço (seguro) SÓ do banco — o navegador não
 * decide peso nem valor declarado. Padrões de peso/medida iguais aos do
 * Melhor Envio para produto sem cadastro; produto que o banco não conhece
 * entra com preço 0 no seguro (nunca o preço que o navegador mandou).
 */
export function pedidoDeCotacaoSuperFrete(entrada: {
    originCep: string
    destinationCep: string
    services: string
    cart: any[]
    dbProductsMap: Map<unknown, any>
}) {
    let valorSegurado = 0
    const products = entrada.cart.map((item: any) => {
        const prodId = item.product?.id || item.productId
        const dbProd = entrada.dbProductsMap.get(prodId)
        const quantity = Number(item.quantity || 1)
        valorSegurado += Number(dbProd?.preco_venda ?? 0) * quantity
        return {
            quantity,
            weight: Number(dbProd?.peso_kg ?? 0.3),
            height: Number(dbProd?.altura_cm ?? 15),
            width: Number(dbProd?.largura_cm ?? 15),
            length: Number(dbProd?.comprimento_cm ?? 15),
        }
    })
    const insuranceValue = Number.isFinite(valorSegurado) ? Math.round(valorSegurado * 100) / 100 : 0
    return {
        from: { postal_code: entrada.originCep },
        to: { postal_code: entrada.destinationCep },
        services: entrada.services,
        options: {
            own_hand: false,
            receipt: false,
            insurance_value: insuranceValue,
            use_insurance_value: insuranceValue > 0,
        },
        products,
    }
}

/** Número vindo da API: número de verdade, ou texto numérico. Booleano, null, objeto = NaN. */
function numeroDaApi(valor: unknown): number {
    if (typeof valor === 'number') return valor
    if (typeof valor === 'string' && valor.trim().length > 0) return Number(valor)
    return Number.NaN
}

/**
 * Resposta da SuperFrete -> opções no formato de sempre
 * `{ id, name, price, deliveryDays, provider }`. Não-lista = falha (lança).
 * Descarta o serviço com `has_error`/`error`, id não inteiro, preço não
 * finito ou <= 0, prazo que não é inteiro >= 1, serviço não pedido pelas
 * chaves e — 2ª guarda, a mesma régua do ME/Frenet — nome que não casa com
 * nenhuma chave. O preço é arredondado ao centavo: o MESMO número vai para a
 * tela e para o cache que a RPC do pedido lê.
 */
export function mapearRespostaSuperFrete(data: unknown, chaves: string[]): any[] {
    if (!Array.isArray(data)) {
        throw new Error('SuperFrete: resposta inesperada (não é uma lista de serviços).')
    }
    const pedidos = chaves.length > 0 ? new Set(servicosSuperFrete(chaves).split(',').filter(Boolean)) : null
    return data.flatMap((servico: any) => {
        if (!servico || typeof servico !== 'object') return []
        if (servico.has_error === true || servico.error) return []
        const id = numeroDaApi(servico.id)
        if (!Number.isInteger(id) || id <= 0) return []
        if (pedidos && !pedidos.has(String(id))) return []
        if (chaves.length > 0 && !chaves.some((chave) => servicoCasaChave(servico.name, chave))) return []
        const preco = numeroDaApi(servico.price)
        if (!Number.isFinite(preco) || preco <= 0) return []
        const prazo = numeroDaApi(servico.delivery_time)
        if (!Number.isInteger(prazo) || prazo < 1) return []
        return [{
            id: `superfrete-${id}`,
            name: nomeAmigavelDoServico(servico),
            price: Math.round(preco * 100) / 100,
            deliveryDays: prazo,
            provider: 'superfrete',
        }]
    })
}

/**
 * Cotação MÍNIMA do teste de conexão: o exemplo oficial da doc (CEPs e o
 * pacote padrão do OpenAPI), PAC e SEDEX. Só cota — nada é comprado.
 */
const PEDIDO_DE_TESTE_SUPERFRETE = {
    from: { postal_code: '01153000' },
    to: { postal_code: '20020050' },
    services: '1,2',
    options: { own_hand: false, receipt: false, insurance_value: 0, use_insurance_value: false },
    package: { height: 2, width: 11, length: 16, weight: 0.3 },
}

/**
 * Texto legível de um erro que pode ser exceção (`Error`) ou objeto do
 * PostgREST (`{ message, code }`) — as duas formas que `gravarCotacao`
 * devolve. Só vai para `shipping_calculation_logs`, que é tabela de admin;
 * nunca para o corpo que a cliente recebe.
 */
function mensagemDoErro(erro: unknown): string {
    const mensagem = (erro as { message?: unknown } | null)?.message
    if (typeof mensagem === 'string' && mensagem.length > 0) return mensagem
    return String(erro)
}

/**
 * A RPC que valida o pedido resolve o preço de ALGUMAS opções direto da
 * `store_config`, sem olhar `shipping_quotes_cache`. Estas são elas.
 *
 * São DUAS RPCs, e o checkout escolhe entre elas em `useOrders.ts:1060`:
 * `create_marketplace_order_v24` no pagamento online e
 * `create_marketplace_order_v23` no resto. Um classificador só serve para as
 * duas porque os ramos de frete delas são hoje IDÊNTICOS — conferido linha a
 * linha na `20261081000000_a_regra_do_frete_gratis_mora_no_servidor.sql`
 * (corpos verbatim da `20261040000000_a_idempotencia_insere_a_chave.sql`
 * com a emenda de 03/09). Se uma `v25` chegar com ramo diferente, nada aqui
 * avisa: é preciso reconferir esta lista à mão.
 *
 * A cópia literal dos ramos — EMENDA FRETE V2 (03/09, ordem do dono "entrega
 * fixa não faz sentido existir"): os resquícios da taxa fixa que ACEITAVAM
 * `flat-fee-%` cobrando `store_config.shipping_fee` e deixavam pedido sem
 * opção cair em `COALESCE(shipping_fee, 0)` viraram FALHA FECHADA no
 * servidor:
 *
 *   ELSIF p_shipping_option_id IS NULL/''          -> RAISE EXCEPTION (sem opção escolhida)
 *   ELSIF p_shipping_option_id LIKE 'flat-fee-%'   -> RAISE EXCEPTION (taxa fixa morta)
 *   ELSIF p_shipping_option_id = 'local-delivery'  -> store_config.local_delivery_fee
 *   ELSIF p_destination_cep IS NOT NULL            -> SELECT em shipping_quotes_cache
 *   ELSE (id não reconhecido, sem CEP p/ reconciliar) -> RAISE EXCEPTION
 *
 * Ou seja: a ÚNICA opção resolvida sem cache é a ENTREGA LOCAL.
 * `melhor-envio-*` e `frenet-*` caem no SELECT do cache e são recusadas sem a
 * linha gravada; `flat-fee-%` e "sem opção" não passam NENHUMA — o servidor
 * recusa com mensagem clara pedindo entrega válida, nunca cobra preço
 * inventado ou zero.
 *
 * ⚠️ A cópia é literal sobre QUAL ramo a RPC toma, não sobre QUANTO ela
 * cobra. Opção cujo preço é CALCULADO não pode entrar neste classificador:
 * a cliente veria um preço que a RPC não honra — e as RPCs comparam o total
 * do carrinho com o que elas mesmas recalculam e RECUSAM a divergência acima
 * de cinco centavos (`ABS(v_calculated_total - p_total_amount) > 0.05` ->
 * `RAISE EXCEPTION`). Venda perdida no último clique, sem nada aparecer
 * deste lado. Errar para MENOS aqui (deixar de listar) só derruba a opção na
 * falha de gravação — o lado seguro.
 *
 * Por isso a falha de gravação não pode derrubar a resposta inteira: ela só
 * pode derrubar o que a validação do pedido realmente recusaria.
 *
 * FRETE V2 (03/09/2026): a edge NÃO PRODUZ mais ids `flat-fee-%` (o caminho
 * de taxa fixa saiu) e, com a emenda, a RPC os RECUSA em vez de cobrar a
 * taxa da loja — mantê-los neste classificador seria deixá-los vivos numa
 * resposta de falha de cache para o pedido morrer no último clique.
 *
 * RETIRADA NA LOJA (20261169000000): a RPC ganhou o ramo
 *   ELSIF p_shipping_option_id = 'store-pickup'   -> frete 0
 * ANTES do SELECT no cache — a retirada também é resolvida sem cache (e só
 * pelo id EXATO: ' store-pickup' é recusado pela RPC).
 */
export function precoResolvidoSemCache(id: unknown): boolean {
    if (typeof id !== 'string') return false
    return id === 'local-delivery' || id === ID_RETIRADA_NA_LOJA
}

/**
 * RETIRADA NA LOJA (release 1.5.3): a opção que a cliente da área local vê
 * ao lado da entrega local. Contrato: id `store-pickup` (o mesmo token da
 * chave que a loja liga em `enabled_shipping_methods`), preço 0, SEM prazo
 * inventado (`deliveryDays: 0` — a tela troca o prazo por "Aguarde a
 * confirmação da loja para retirar") e o endereço físico REAL da loja
 * (`store_address`, aparado). Sem endereço, não existe retirada: `null`,
 * nunca endereço inventado — a RPC recusa o mesmo caso.
 */
export function opcaoDeRetirada(enderecoDaLoja: unknown) {
    if (typeof enderecoDaLoja !== 'string') return null
    const endereco = enderecoDaLoja.trim()
    if (endereco.length === 0) return null
    return {
        id: ID_RETIRADA_NA_LOJA,
        name: 'Retirar na loja',
        price: 0,
        deliveryDays: 0,
        provider: 'pickup',
        pickupAddress: endereco,
    }
}

/**
 * As chaves de `enabled_shipping_methods` que falam de TRANSPORTADORA. A
 * chave da retirada (`store-pickup`) mora no MESMO array mas não é serviço
 * de transportadora: se contasse, uma loja com `['store-pickup']` (lista de
 * transportadoras "vazia = todas" + retirada ligada) desligaria TODAS as
 * transportadoras, e `['sedex','store-pickup']` casaria a chave da retirada
 * contra o nome de cada serviço. Lista vazia continua valendo "todas".
 */
export function chavesDeTransportadora(enabledMethods: unknown): string[] {
    if (!Array.isArray(enabledMethods)) return []
    return enabledMethods.filter((m) => m !== ID_RETIRADA_NA_LOJA)
}

/**
 * O endereço físico da loja, lido numa consulta SEPARADA e TOLERANTE. Não
 * entra no select principal de `store_config` de propósito: a coluna nasce
 * na migration 20261167000000 e loja sem ela receberia erro no select
 * INTEIRO — a cotação de todo mundo cairia por causa de uma opção nova.
 * Aqui, erro do PostgREST ou exceção = "sem endereço" = sem retirada (a
 * entrega local e as transportadoras seguem iguais). Só é chamada quando a
 * loja habilitou a retirada e o destino é local.
 */
async function lerEnderecoDaLoja(supabaseClient: any): Promise<string | null> {
    try {
        const { data, error } = await supabaseClient
            .from('store_config')
            .select('store_address')
            .eq('id', 1)
            .maybeSingle()
        if (error) {
            console.error('[calculate-shipping] Endereço da loja indisponível; retirada não oferecida:', error.message ?? error)
            return null
        }
        return typeof data?.store_address === 'string' ? data.store_address : null
    } catch (erro) {
        console.error('[calculate-shipping] Falha ao ler o endereço da loja; retirada não oferecida:', mensagemDoErro(erro))
        return null
    }
}

/**
 * As opções da cliente LOCAL: a entrega local de sempre e, DEPOIS dela, a
 * retirada na loja quando os três requisitos valem (chave habilitada +
 * endereço físico + destino local — este último garantido por quem chama).
 * A ordem importa pouco para a tela (a escolha da retirada é sempre da
 * cliente, nunca automática), mas a entrega local na frente mantém a
 * resposta de hoje como prefixo exato da nova.
 *
 * `aceitaRetirada` é o SINAL do app que entende a retirada (1.5.3+): o PWA
 * atualiza por "prompt", então o app 1.5.2 segue no ar — e a auto-seleção
 * dele (mais barata; empate, menor prazo) escolheria a retirada R$ 0 sozinha.
 * Sem o sinal, a resposta é exatamente a de antes (e o endereço nem é lido).
 */
async function opcoesDaClienteLocal(
    supabaseClient: any,
    enabledMethods: unknown,
    precoDaEntregaLocal: number,
    aceitaRetirada: boolean,
) {
    const opcoes: any[] = [
        {
            id: 'local-delivery',
            name: 'Entrega Local',
            price: precoDaEntregaLocal,
            deliveryDays: 1,
            provider: 'local'
        }
    ]
    if (aceitaRetirada && Array.isArray(enabledMethods) && enabledMethods.includes(ID_RETIRADA_NA_LOJA)) {
        const retirada = opcaoDeRetirada(await lerEnderecoDaLoja(supabaseClient))
        if (retirada) opcoes.push(retirada)
    }
    return opcoes
}

/**
 * LAUDO 31/08 (D2): fetch com TEMPO DE ESPERA. Até hoje as quatro chamadas
 * a Melhor Envio/Frenet deste arquivo penduravam sem limite — o DNS do ME
 * já caiu de verdade nesta máquina (#356), e uma transportadora lenta
 * segurava a cotação (e o cliente) indefinidamente. O AbortController
 * corta no tempo; quem chama vê AbortError como qualquer falha de rede e
 * cai na contingência que já existe.
 *
 * O `buscar` entra como parâmetro (o fetch de fora, injetável) para o
 * index_test.ts provar o aborto com um fetch falso — em produção nada
 * muda: chama-se com o `fetch` de sempre.
 */
export async function buscarComTempo(
    buscar: typeof fetch,
    url: string,
    init: RequestInit = {},
    tempoMs = 15000,
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
 * A resposta honesta de "não há cotação de fora da cidade": lista VAZIA, sem
 * preço inventado — e, quando há algo para a lojista consertar, a linha no
 * histórico (`shipping_calculation_logs`) dizendo O QUE falta.
 *
 * FRETE V2 (03/09/2026): substitui o que `getFlatFeeResponse` fazia nos
 * ramais sem cotação real. Fora da cidade o preço vem SÓ de transportadora
 * conectada; provedor `flat_fee` remanescente no config de loja antiga é
 * tratado aqui como "sem cotação de fora", sem explodir.
 *
 * O log é AGUARDADO pelo mesmo motivo do ramo 503 mais abaixo: aqui não há
 * preço para entregar, então esperar não atrasa ninguém — e a linha vermelha
 * com o motivo é a ÚNICA janela que a lojista tem para descobrir que precisa
 * conectar/configurar (`HistoricoCotacoesCard` pinta 'error' de vermelho).
 * Promessa não aguardada pode morrer no encerramento da instância
 * (`EarlyDrop`) — ver `gravarCotacao`.
 *
 * `log` nulo = não há nada para a lojista consertar (ex.: carrinho vazio) —
 * responde vazio SEM sujar o histórico com um erro que ninguém causou.
 *
 * A forma do corpo é a MESMA que o carrinho já consumia para "não há
 * opções" (`options: []` com `cotacaoIncompleta: false`): a tela mostra
 * nenhuma opção, nenhum preço falso, nenhum spinner eterno.
 */
async function respostaSemCotacaoDeFora(
    supabaseClient: any,
    log: {
        originCep: string
        destinationCep: string
        provider: string
        cart: unknown
        motivo: string
    } | null,
): Promise<Response> {
    if (log) {
        const logEmVoo = Promise.resolve(
            supabaseClient.from('shipping_calculation_logs').insert({
                origin_cep: log.originCep,
                destination_cep: log.destinationCep,
                provider: log.provider,
                cart_items: log.cart || [],
                response_time_ms: 0,
                status: 'error',
                error_message: log.motivo,
            }),
        )
        fireAndForget(logEmVoo, 'Failed to log missing-carrier quote:')
        await logEmVoo.catch(() => {})
    }
    return new Response(
        JSON.stringify({ options: [], cotacaoIncompleta: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
}

/**
 * Nome de serviço de transportadora em linguagem de gente (pedido do
 * Gabriel, 02/09: ".Package" não explica nada para o cliente).
 *
 * A API do Melhor Envio manda o nome COMERCIAL do serviço ("SEDEX",
 * ".Package", ".Package Centralizado") e a tela mostrava esse nome cru
 * com o sufixo "(Melhor Envio)" — jargão de integrador. A tradução cobre
 * os nomes conhecidos; o que não é conhecido volta LIMPO (sem o sufixo),
 * porque o sufixo dizia com quem a LOJA integrou, assunto do lojista, e
 * o cliente só decide por preço e prazo (que já aparecem no card).
 *
 * A ordem importa: ".Package Centralizado" contém "package" — a checagem
 * de "centralizado" vem antes para distinguir a modalidade; e o PAC dos
 * Correios casa por fronteira de palavra (`\bpac\b`), que NÃO casa no
 * "pac" embutido em ".package".
 */
export function nomeAmigavelDoServico(service: { name?: string }): string {
    const nome = String(service?.name || '').trim()
    const low = nome.toLowerCase()
    if (low.includes('sedex')) return 'Entrega expressa'
    if (low.includes('centralizado')) return 'Entrega econômica (centro de distribuição)'
    if (low.includes('package') || /\bpac\b/.test(low)) return 'Entrega econômica'
    if (low.includes('.com') || low.includes('express')) return 'Entrega expressa'
    return nome
}

/**
 * Casa o nome COMERCIAL que a transportadora devolve com a CHAVE que o
 * lojista liga/desliga em `enabled_shipping_methods` (as três chaves fixas
 * da tela: "sedex", "pac", "jadlog" — TransportadorasCard.tsx:95).
 *
 * O filtro antigo comparava a chave com `includes` cru sobre o nome
 * comercial: `".package".includes("pac")` é TRUE (liga a Jadlog pensando
 * que é o PAC dos Correios) e `".package".includes("jadlog")` é FALSE
 * (desliga a Jadlog mesmo com a chave marcada, e some a única opção) — a
 * MESMA armadilha que `nomeAmigavelDoServico`, alguns parágrafos acima, já
 * evita para o PAC com `\bpac\b`; o filtro só não usava a mesma régua.
 *
 * Cada chave casa por um padrão que identifica o SERVIÇO, não uma
 * substring qualquer do nome comercial. Chave desconhecida (ex.: nova
 * transportadora ainda sem regra própria) cai no `includes` de antes, para
 * não desligar sozinho um método que o lojista pediu por nome.
 */
export function servicoCasaChave(nomeDoServico: string | null | undefined, chave: string): boolean {
    const nome = String(nomeDoServico || '').toLowerCase()
    const chaveNormalizada = String(chave || '').toLowerCase().trim()

    if (chaveNormalizada === 'pac') return /\bpac\b/.test(nome)
    if (chaveNormalizada === 'jadlog') return /jadlog|package|centralizado|\.com/.test(nome)
    if (chaveNormalizada === 'sedex') return nome.includes('sedex')

    return nome.includes(chaveNormalizada)
}

// Helper to check if destination is a local CEP
export function isLocalCep(originCep: string, destCep: string, localCepRange?: string): boolean {
    const cleanOrigin = originCep.replace(/\D/g, '')
    const cleanDest = destCep.replace(/\D/g, '')
    
    if (cleanOrigin.length === 0 || cleanDest.length === 0) return false
    
    if (localCepRange && localCepRange.trim().length > 0) {
        // O hífen faz parte do formato do CEP brasileiro ("38500-000"), então NÃO
        // pode ser tratado como separador de faixa: a versão anterior lia
        // "38500-000, 38500-999" como duas faixas [38500..0] e [38500..999],
        // que nunca casavam com um CEP de 8 dígitos. Resultado: a faixa configurada
        // pelo lojista — exatamente no formato que o placeholder do admin ensina —
        // era sempre ignorada e ninguém recebia a taxa de entrega local.
        const destVal = Number(cleanDest.padEnd(8, '0'))
        const ranges: Array<[number, number]> = []
        const singles: string[] = []

        for (const rawToken of localCepRange.split(',')) {
            const parts = rawToken.split('-').map(p => p.replace(/\D/g, '')).filter(Boolean)
            if (parts.length === 0) continue

            // "38500000-38505000": dois blocos longos = faixa explícita.
            // "38500-000": 5+3 dígitos = um único CEP formatado.
            if (parts.length === 2 && parts[0].length >= 6 && parts[1].length >= 6) {
                const start = Number(parts[0].padEnd(8, '0'))
                const end = Number(parts[1].padEnd(8, '9'))
                ranges.push(start <= end ? [start, end] : [end, start])
            } else {
                singles.push(parts.join(''))
            }
        }

        if (ranges.some(([start, end]) => destVal >= start && destVal <= end)) {
            return true
        }

        // Formato do placeholder do admin ("38500-000, 38500-999"):
        // dois CEPs completos = início e fim de uma faixa.
        if (ranges.length === 0 && singles.length === 2 && singles.every(s => s.length === 8)) {
            const bounds = singles.map(Number).sort((a, b) => a - b)
            return destVal >= bounds[0] && destVal <= bounds[1]
        }

        // Demais casos: CEP completo casa exato; item mais curto vale como prefixo.
        return singles.some(s => (s.length === 8 ? cleanDest === s : cleanDest.startsWith(s)))
    }
    
    // Default fallback: match first 5 digits
    return cleanOrigin.slice(0, 5) === cleanDest.slice(0, 5)
}

// Helper to generate a stable, order-independent cart hash representation
export function getCartHash(cart: any[]): string {
    if (!cart || !Array.isArray(cart)) return 'empty'
    const sorted = [...cart].sort((a, b) => {
        const idA = (a.product?.id || a.productId || '') + (a.variantId || '')
        const idB = (b.product?.id || b.productId || '') + (b.variantId || '')
        return idA.localeCompare(idB)
    })
    
    return sorted.map((item: any) => {
        const prodId = item.product?.id || item.productId
        const variantId = item.variantId || ''
        const quantity = item.quantity || 1
        return `${prodId}:${variantId}:${quantity}`
    }).join(',')
}

/**
 * O projeto está migrando das chaves legadas (anon/service_role, formato JWT) para
 * as novas (publishable/secret). Durante a migração as duas coexistem: lê a nova e
 * cai pra legada. Assim esta função funciona antes E depois de as legadas serem
 * desligadas no painel — o que evita janela de indisponibilidade.
 *
 * Quando as legadas forem removidas de vez, o fallback pode sair.
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

// Helper to verify if the caller has admin permissions
async function verifyIsAdmin(authHeader: string | null, supabaseUrl: string, serviceRoleKey: string): Promise<boolean> {
    if (!authHeader) return false;

    try {
        const anonKey = readKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
        const userClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } }
        });
        
        const { data: { user }, error: userError } = await userClient.auth.getUser();
        if (userError || !user) {
            console.error('[verifyIsAdmin] Auth getUser failed:', userError);
            return false;
        }
        
        const systemClient = createClient(supabaseUrl, serviceRoleKey);
        const { data: profile, error: profileError } = await systemClient
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();
            
        if (profileError || !profile) {
            console.error('[verifyIsAdmin] Query profile role failed:', profileError);
            return false;
        }
        
        return profile.role === 'admin';
    } catch (err) {
        console.error('[verifyIsAdmin] Exception during admin check:', err);
        return false;
    }
}

const isTesting = Deno.mainModule.endsWith("_test.ts") || Deno.mainModule.endsWith("_test.js") || Deno.mainModule.includes("index_test");

/**
 * Costura de teste, a mesma que `criar-pagamento` e `reconciliar-pagamentos`
 * já usam: o handler é uma função exportada e o cliente do Supabase pode ser
 * substituído por um dublê. Sem isso, o corpo do handler ficava dentro de
 * `serve(...)` e NENHUM teste conseguia exercitar a resposta HTTP — só as
 * funções puras do topo do arquivo. Em produção nada muda: `deps` chega vazio
 * e o cliente real é criado como sempre.
 */
export type CalculateShippingDeps = {
    supabase?: any
    /**
     * Costura da checagem de admin do `test_credentials` (release 1.5.4) —
     * em produção é `verifyIsAdmin` de sempre; o teste injeta o veredito
     * sem sair para a rede.
     */
    verificarAdmin?: (authHeader: string | null) => Promise<boolean>
}

/**
 * Ação `save_credentials` (release 1.5.5) — a chave, o modo de testes e o
 * e-mail de contato técnico da SuperFrete são gravados PELO SERVIDOR.
 *
 * Por que pela edge, e só para a SuperFrete: o e-mail entra num header HTTP
 * (User-Agent), então a régua precisa valer no servidor; e "campo vazio =
 * mantém a chave salva" exige ler o token salvo, que o navegador não tem
 * (1.5.4: a chave é só-escrita). Melhor Envio e Frenet continuam salvando
 * pelo caminho de sempre — aqui recebem recusa.
 *
 * Contrato:
 * - não-admin: 403, o mesmo do `test_credentials` (mesma costura
 *   `deps.verificarAdmin`);
 * - recusa de VALIDAÇÃO (provedor errado, e-mail, "cole a chave", modo de
 *   testes sem chave nova): 200 `{ success: false, error }` — com 4xx o
 *   `supabase.functions.invoke` entrega `data: null` e a frase em português
 *   não chegaria à tela;
 * - falha de banco: 5xx `{ success: false, error }`, sem texto cru;
 * - sucesso: `{ success: true, tem_chave: true, sandbox, contact_email }`.
 *   O token NUNCA volta.
 *
 * Grava por LISTA BRANCA, campo a campo: `{ token, sandbox, contact_email }`
 * — nada do corpo nem da linha antiga é copiado inteiro.
 *
 * Concorrência: "token vazio = mantém o salvo" é ler-e-regravar. Dois
 * salvamentos simultâneos (dois aparelhos da mesma lojista) terminam com o
 * último que gravou — o mesmo "último vence" do upsert que o painel já fazia.
 */
async function salvarCredenciaisDaSuperFrete(
    req: Request,
    body: any,
    supabaseClient: any,
    deps: CalculateShippingDeps,
    supabaseUrl: string,
    supabaseServiceRole: string,
): Promise<Response> {
    const responder = (conteudo: Record<string, unknown>, status = 200) =>
        new Response(JSON.stringify(conteudo), {
            status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })

    const authHeader = req.headers.get('Authorization')
    const isAdmin = deps.verificarAdmin
        ? await deps.verificarAdmin(authHeader)
        : await verifyIsAdmin(authHeader, supabaseUrl, supabaseServiceRole)
    if (!isAdmin) {
        return responder({ error: 'Não autorizado: Apenas administradores podem salvar credenciais.' }, 403)
    }

    if (body?.provider !== 'superfrete') {
        return responder({
            success: false,
            error: 'Por aqui só se salva a chave da SuperFrete. As outras transportadoras salvam pela própria tela.',
        })
    }

    const recebidas = body.credentials && typeof body.credentials === 'object' ? body.credentials : {}
    const contactEmail = emailDeContatoValido(recebidas.contact_email)
    if (!contactEmail) {
        return responder({ success: false, error: MOTIVO_EMAIL_DE_CONTATO_INVALIDO })
    }

    const tokenNovo = typeof recebidas.token === 'string' ? recebidas.token.trim() : ''
    let token = tokenNovo
    let sandbox = recebidas.sandbox === true

    try {
        if (!tokenNovo) {
            // Campo da chave vazio = mantém a SALVA, lida aqui com a service
            // role (depois da checagem de admin). O navegador nunca a teve.
            const { data: linhaSalva, error: erroDaLinha } = await supabaseClient
                .from('store_shipping_credentials')
                .select('credentials')
                .eq('provider', 'superfrete')
                .maybeSingle()
            if (erroDaLinha) {
                console.error('[calculate-shipping] save_credentials: leitura da chave salva falhou:', erroDaLinha?.code ?? 'sem código')
                return responder({ success: false, error: 'Não foi possível conferir a chave salva agora. Tente de novo em instantes.' }, 503)
            }
            const salvas = linhaSalva?.credentials
            if (!salvas || typeof salvas.token !== 'string' || salvas.token.length === 0) {
                return responder({ success: false, error: 'Cole a chave de acesso da SuperFrete.' })
            }
            const sandboxSalvo = salvas.sandbox === true
            // A chave é POR AMBIENTE: trocar o modo de testes sem a chave do
            // ambiente novo deixaria a chave velha apontada para o errado
            // (mesma regra que a tela já aplica).
            if (recebidas.sandbox !== undefined && (recebidas.sandbox === true) !== sandboxSalvo) {
                return responder({
                    success: false,
                    error: 'Para trocar o modo de testes (Sandbox), cole a chave de acesso do ambiente escolhido — Sandbox e produção usam chaves diferentes.',
                })
            }
            token = salvas.token
            sandbox = sandboxSalvo
        }

        const { error: erroAoGravar } = await supabaseClient
            .from('store_shipping_credentials')
            .upsert(
                {
                    provider: 'superfrete',
                    credentials: { token, sandbox, contact_email: contactEmail },
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'provider' },
            )
        if (erroAoGravar) {
            console.error(
                '[calculate-shipping] save_credentials: gravação falhou:',
                textoSemSegredo(erroAoGravar?.message ?? erroAoGravar, [token, tokenNovo]),
            )
            return responder({ success: false, error: 'Não foi possível salvar a chave da SuperFrete. Tente de novo.' }, 500)
        }
    } catch (err) {
        console.error(
            '[calculate-shipping] save_credentials: exceção:',
            textoSemSegredo(err?.message ?? err, [token, tokenNovo]),
        )
        return responder({ success: false, error: 'Não foi possível salvar a chave da SuperFrete. Tente de novo.' }, 500)
    }

    return responder({ success: true, tem_chave: true, sandbox, contact_email: contactEmail })
}

export async function handler(req: Request, deps: CalculateShippingDeps = {}): Promise<Response> {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    // FRETE V2 (03/09/2026): as variáveis `taxaDaLoja`/`taxaDaLojaConfigurada`
    // que viviam aqui alimentavam a contingência do `catch` de topo — que
    // devolvia a taxa fixa com id `flat-fee-fallback`. Ela saiu junto com o
    // caminho de taxa fixa: fora da cidade é SÓ cotação real de
    // transportadora, e exceção inesperada agora é falha fechado (500), sem
    // preço nenhum.

    try {
        const body = await req.json()
        const { cep, cart, action } = body
        // Só o booleano `true` EXATO: "true", 1, objeto… = app que não pediu.
        const aceitaRetirada = body?.aceitaRetirada === true

        // Initialize Supabase clients
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
        const supabaseServiceRole = readKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
        const supabaseClient = deps.supabase ?? createClient(supabaseUrl, supabaseServiceRole)

        // ROUTE: test_credentials
        if (action === 'test_credentials') {
            const authHeader = req.headers.get('Authorization')
            const isAdmin = deps.verificarAdmin
                ? await deps.verificarAdmin(authHeader)
                : await verifyIsAdmin(authHeader, supabaseUrl, supabaseServiceRole)

            if (!isAdmin) {
                return new Response(
                    JSON.stringify({ error: 'Não autorizado: Apenas administradores podem testar credenciais.' }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            const { provider } = body
            let credentials = body.credentials
            // Release 1.5.5: o e-mail de contato técnico DIGITADO na tela
            // (ainda não salvo) viaja em `credentials.contact_email` — é
            // guardado ANTES de `credentials` ser trocado pela linha salva.
            const emailDigitado = body.credentials && typeof body.credentials === 'object'
                ? body.credentials.contact_email
                : undefined
            let linhaSalvaLida = false
            let salvas: any = null

            // Release 1.5.4: o painel NÃO baixa mais o token (só sabe SE ele
            // existe). Para testar a chave JÁ salva, ele pede
            // `usarCredencialSalva: true` e a edge lê a linha do provedor com
            // a service role — depois da checagem de admin acima. O token
            // nunca volta ao navegador.
            if (provider && body.usarCredencialSalva === true) {
                const { data: linhaSalva, error: erroDaLinha } = await supabaseClient
                    .from('store_shipping_credentials')
                    .select('credentials')
                    .eq('provider', provider)
                    .maybeSingle()
                linhaSalvaLida = true
                salvas = erroDaLinha ? null : linhaSalva?.credentials
                if (!salvas || typeof salvas.token !== 'string' || salvas.token.length === 0) {
                    return new Response(
                        JSON.stringify({ error: 'Nenhuma chave de acesso salva para esta transportadora. Cole a chave e salve antes de testar.' }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    )
                }
                credentials = salvas
            }

            if (!provider || !credentials) {
                return new Response(
                    JSON.stringify({ error: 'Provedor e credenciais são obrigatórios' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }
            
            const token = credentials.token
            if (!token) {
                return new Response(
                    JSON.stringify({ error: 'Token de acesso não informado.' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            try {
                if (provider === 'melhor_envio') {
                    const isSandbox = credentials.sandbox === true
                    const baseUrl = isSandbox 
                        ? 'https://sandbox.melhorenvio.com.br' 
                        : 'https://melhorenvio.com.br'
                        
                    const response = await buscarComTempo(fetch, `${baseUrl}/api/v2/me`, {
                        headers: {
                            'Accept': 'application/json',
                            'Authorization': `Bearer ${token}`,
                            'User-Agent': 'IKCOUS-Marketplace-Integration (contato@ikcous.com.br)'
                        }
                    })
                    
                    if (response.ok) {
                        const userData = await response.json()
                        return new Response(
                            JSON.stringify({ success: true, message: `Conectado à conta: ${userData.name || 'Melhor Envio'}` }),
                            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                        )
                    } else {
                        const errText = textoSemSegredo(await response.text(), [token])
                        return new Response(
                            JSON.stringify({ success: false, error: `Melhor Envio (Status ${response.status}): ${errText}` }),
                            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                        )
                    }
                } else if (provider === 'frenet') {
                    const response = await buscarComTempo(fetch, 'https://api.frenet.com.br/shipping/quote', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json',
                            'token': token
                        },
                        body: JSON.stringify({
                            SellerCEP: '38500000',
                            RecipientCEP: '38500000',
                            ShipmentInvoiceValue: 10,
                            ShippingItemArray: [
                                {
                                    Weight: 0.1,
                                    Length: 10,
                                    Height: 10,
                                    Width: 10,
                                    Quantity: 1
                                }
                            ]
                        })
                    })
                    
                    if (response.ok) {
                        const data = await response.json()
                        const services = data.ShippingSevicesArray || []
                        const firstService = services[0]
                        
                        if (firstService?.Error && firstService.Msg === 'Token inválido') {
                            return new Response(
                                JSON.stringify({ success: false, error: 'Frenet retornou: Token inválido' }),
                                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                            )
                        }
                        
                        return new Response(
                            JSON.stringify({ success: true, message: 'Conexão com a Frenet estabelecida com sucesso.' }),
                            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                        )
                    } else {
                        const errText = textoSemSegredo(await response.text(), [token])
                        return new Response(
                            JSON.stringify({ success: false, error: `Frenet (Status ${response.status}): ${errText}` }),
                            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                        )
                    }
                } else if (provider === 'superfrete') {
                    // Release 1.5.5 — de onde vem o e-mail do User-Agent:
                    // - DIGITADO (não vazio): vale ele, validado pela mesma
                    //   régua do salvar; inválido = recusa, sem cair no salvo;
                    // - sem e-mail digitado: o SALVO da loja (lido aqui com a
                    //   service role, se ainda não foi) — cobre o painel 1.5.4
                    //   em cache, que não manda e-mail nenhum.
                    const temEmailDigitado = typeof emailDigitado === 'string' && emailDigitado.trim().length > 0
                    let emailDoTeste: unknown = emailDigitado
                    if (!temEmailDigitado) {
                        if (!linhaSalvaLida) {
                            const { data: linhaDoEmail, error: erroDoEmail } = await supabaseClient
                                .from('store_shipping_credentials')
                                .select('credentials')
                                .eq('provider', 'superfrete')
                                .maybeSingle()
                            salvas = erroDoEmail ? null : linhaDoEmail?.credentials
                        }
                        emailDoTeste = salvas?.contact_email
                    }
                    const userAgent = userAgentDaSuperFrete(emailDoTeste)
                    if (!userAgent) {
                        return new Response(
                            JSON.stringify({
                                success: false,
                                error: temEmailDigitado ? MOTIVO_EMAIL_DE_CONTATO_INVALIDO : MOTIVO_SEM_EMAIL_SUPERFRETE,
                            }),
                            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                        )
                    }
                    const response = await buscarComTempo(fetch, urlDaCotacaoSuperFrete(credentials.sandbox), {
                        method: 'POST',
                        headers: cabecalhosDaSuperFrete(token, userAgent),
                        body: JSON.stringify(PEDIDO_DE_TESTE_SUPERFRETE),
                    })
                    const texto = await response.text()
                    const ambiente = credentials.sandbox === true ? 'Sandbox (testes)' : 'produção'

                    if (response.ok) {
                        let data: unknown = null
                        try {
                            data = JSON.parse(texto)
                        } catch {
                            data = null
                        }
                        // Só "funcionou" com a forma documentada (lista por
                        // serviço) — 200 com qualquer outra coisa não prova
                        // que a cotação do checkout vai funcionar.
                        if (Array.isArray(data)) {
                            return new Response(
                                JSON.stringify({ success: true, message: `SuperFrete respondeu uma cotação de teste com esta chave (ambiente: ${ambiente}).` }),
                                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                            )
                        }
                        return new Response(
                            JSON.stringify({ success: false, error: 'SuperFrete respondeu, mas não com uma cotação válida. Tente de novo em instantes.' }),
                            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                        )
                    }
                    const dica = response.status === 401 || response.status === 403
                        ? ` A chave foi recusada: confira se ela é do ambiente escolhido (${ambiente}) — Sandbox e produção têm chaves diferentes.`
                        : ''
                    return new Response(
                        JSON.stringify({ success: false, error: `SuperFrete (Status ${response.status}): ${textoSemSegredo(texto, [token])}${dica}` }),
                        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    )
                } else {
                    return new Response(
                        JSON.stringify({ error: `Provedor de frete desconhecido: ${provider}` }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    )
                }
            } catch (err) {
                return new Response(
                    JSON.stringify({ success: false, error: `Falha de rede: ${textoSemSegredo(err?.message, [token])}` }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }
        }

        // ROUTE: save_credentials (release 1.5.5 — SÓ SuperFrete)
        if (action === 'save_credentials') {
            return await salvarCredenciaisDaSuperFrete(req, body, supabaseClient, deps, supabaseUrl, supabaseServiceRole)
        }

        // ROUTE: calculate (default flow)
        if (!cep) {
            return new Response(
                JSON.stringify({ error: 'CEP de destino é obrigatório' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Clean CEP (only digits)
        const cleanCep = cep.replace(/\D/g, '')
        if (cleanCep.length !== 8) {
            return new Response(
                JSON.stringify({ error: 'CEP inválido' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 1. Fetch public store configuration
        const { data: storeConfig, error: configError } = await supabaseClient
            .from('store_config')
            .select('origin_cep, shipping_provider, shipping_fee, free_shipping_min, enabled_shipping_methods, shipping_coverage, local_delivery_fee, local_cep_range')
            .eq('id', 1)
            .single()

        if (configError || !storeConfig) {
            console.error('Error fetching store config:', configError)
            throw new Error('Falha ao obter configuração da loja')
        }

        const provider = storeConfig.shipping_provider || 'flat_fee'

        // Falha fechado: sem CEP de origem, a função não calcula nada. Ver
        // `validarOrigemEFrete` acima — a exigência de taxa fixa que vivia
        // aqui saiu junto com o caminho de taxa fixa (frete v2, 03/09/2026).
        const erroDeConfiguracao = validarOrigemEFrete(storeConfig.origin_cep)
        if (erroDeConfiguracao) {
            throw new Error(erroDeConfiguracao)
        }

        const originCep = storeConfig.origin_cep.replace(/\D/g, '')
        const enabledMethods = storeConfig.enabled_shipping_methods || ['sedex', 'pac']
        // Só as chaves de TRANSPORTADORA filtram serviço — a da retirada na
        // loja (`store-pickup`) mora no mesmo array e não conta aqui (ver
        // `chavesDeTransportadora`). Lista vazia continua = todas.
        const chavesDeServico = chavesDeTransportadora(enabledMethods)
        
        const shippingCoverage = storeConfig.shipping_coverage || 'national'
        const localDeliveryFee = Number(storeConfig.local_delivery_fee ?? 10)
        const localCepRange = storeConfig.local_cep_range || ''

        // 2. Check if destination is local CEP
        const isLocal = isLocalCep(originCep, cleanCep, localCepRange)

        // 2. Resolve products in cart securely using the database
        const productIds = cart && Array.isArray(cart) 
            ? cart.map((item: any) => item.product?.id || item.productId).filter(Boolean)
            : []

        let dbProducts: any[] = []
        if (productIds.length > 0) {
            const { data: prods, error: prodsError } = await supabaseClient
                .from('produtos')
                .select('id, nome, preco_venda, peso_kg, largura_cm, altura_cm, comprimento_cm, frete_gratis')
                .in('id', productIds)

            if (prodsError) {
                console.error('[calculate-shipping] Error querying database products:', prodsError)
            } else {
                dbProducts = prods || []
            }
        }

        const dbProductsMap = new Map(dbProducts.map(p => [p.id, p]))

        // FRETE V2 (revisão A1, 03/09/2026): a marcação `produtos.frete_gratis`
        // vale SÓ dentro do preset "por_produto" — modelo EXCLUSIVO de presets:
        // a estratégia gravada em `store_config.free_shipping_min` é a ÚNICA
        // que vale, aqui e na RPC do pedido (migration 20261081000000) e no
        // carrinho (CartContext). Fonte única do predicado:
        // `src/lib/presets-de-frete-gratis.ts` (`presetDoConfig` — `min < 0`
        // = por_produto; a sentinela é FRETE_GRATIS_POR_PRODUTO = -1). Esta
        // edge roda em Deno com imports de URL e não alcança o `src/` do app,
        // então o predicado MÍNIMO é replicado com a fonte apontada — lição
        // #53: regra em dois lugares diverge; se a sentinela mudar lá, muda
        // aqui na mesma rodada (o teste irmão em index_test.ts prende os dois
        // lados).
        const presetPorProduto = Number(storeConfig.free_shipping_min ?? 0) < 0

        // 3. Check if the order's shipping should be free — SÓ no preset
        // por_produto. Fora dele (desligado/sempre/acima_de_valor) TODOS os
        // itens são tratados como não-grátis: antes este `allFree` honrava a
        // marcação INCONDICIONALMENTE e devolvia "Frete Grátis (Promoção)"
        // R$ 0 para loja com o grátis desligado — preço que a RPC do pedido
        // NÃO honrava (ela cobra a entrega local real no último clique).
        //
        // index-736: aqui era `cart.every(...)` — exigia TODOS os itens
        // marcados. A RPC do pedido (20261081000000:294-296, :315) e o front
        // (CartContext.tsx:803) usam `some`: BASTA um item marcado para o
        // frete do PEDIDO INTEIRO zerar. Com `every`, um carrinho MISTO (um
        // item marcado + um não marcado) não batia aqui e caía no ramo de
        // baixo, que cotava só os itens não marcados (`nonFreeCart`, morto
        // nesta mesma correção) — uma TERCEIRA resposta para a mesma
        // pergunta que a RPC e o front já respondem igual. `some` alinha os
        // três: um item marcado é o bastante para o pedido inteiro sair de
        // graça, do mesmo jeito que sairia de graça no checkout.
        const allFree = presetPorProduto && cart && Array.isArray(cart) && cart.length > 0 && cart.some((item: any) => {
            const prodId = item.product?.id || item.productId
            const dbProd = dbProductsMap.get(prodId)
            return !!(dbProd?.frete_gratis ?? item.product?.freeShipping)
        })

        // Se a cobertura da loja é só local, o CEP de fora não é atendido.
        if (shippingCoverage === 'local') {
            if (!isLocal) {
                return new Response(
                    JSON.stringify({ error: 'Esta loja realiza apenas entregas locais na sua região.' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }
            return new Response(
                JSON.stringify({
                    options: await opcoesDaClienteLocal(supabaseClient, enabledMethods, allFree ? 0 : localDeliveryFee, aceitaRetirada),
                    cotacaoIncompleta: false
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Cliente LOCAL recebe SÓ a Entrega Local — mesmo com a loja
        // atendendo o Brasil inteiro (pedido do Gabriel, 02/09: na foto do
        // carrinho, um CEP da própria cidade listava SEDEX e .Package ao
        // lado da Entrega Local; o cliente da cidade não escolhe
        // transportadora nacional, e a cotação dela não custa de graça).
        // Este retorno cedo tem que vir ANTES da cotação de transportadora
        // e do cache — a partir daqui, `isLocal` é invariantemente falso em
        // todo o resto do handler.
        //
        // R3 da revisão: o caminho que existia antes (national+isLocal até
        // o fim do handler) GRAVAVA linha no `shipping_calculation_logs` —
        // era a cotação local que aparecia no "Histórico de Cotações" do
        // painel. O retorno cedo mantém esse registro (mesmo formato dos
        // outros, provider 'local'), senão a lojista perde a janela de
        // todas as cotações locais do dia.
        if (isLocal) {
            fireAndForget(
                supabaseClient.from('shipping_calculation_logs').insert({
                    origin_cep: originCep,
                    destination_cep: cleanCep,
                    provider: 'local',
                    cart_items: cart,
                    response_time_ms: 0,
                    status: 'success'
                }),
                'Failed to log local quote:',
            )
            // RETIRADA NA LOJA (release 1.5.3): a única companhia que a
            // Entrega Local ganha aqui é a retirada — opção da PRÓPRIA loja,
            // não transportadora nacional (a decisão de 02/09 continua).
            return new Response(
                JSON.stringify({
                    options: await opcoesDaClienteLocal(supabaseClient, enabledMethods, allFree ? 0 : localDeliveryFee, aceitaRetirada),
                    cotacaoIncompleta: false
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        if (allFree) {
            console.log('[calculate-shipping] Item com frete grátis no carrinho (preset por_produto): frete zerado para o pedido inteiro.')
            return new Response(
                JSON.stringify({
                    options: [
                        {
                            id: 'free-shipping-promo',
                            name: 'Frete Grátis (Promoção)',
                            price: 0,
                            deliveryDays: 3,
                            provider: 'free'
                        }
                    ],
                    cotacaoIncompleta: false
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 4. SEM COTAÇÃO DE FORA quando não há transportadora real para cotar.
        //
        // FRETE V2 (03/09/2026, ordem do dono — "entrega fixa não faz
        // sentido existir, parece opção duplicada"): o caminho de TAXA FIXA
        // que vivia aqui (`getFlatFeeResponse`, opção "Entrega Padrão" com o
        // valor de `store_config.shipping_fee`) foi REMOVIDO. Fora da cidade
        // o preço vem SÓ da transportadora conectada (Melhor Envio/Frenet).
        // Restam dois casos sem o que cotar de verdade:
        //
        //   - carrinho ausente/vazio: nada para colocar na balança da
        //     cotação (a transportadora cobra por item). Nada de log de
        //     erro: não há nada para a lojista consertar.
        //   - provedor `flat_fee` remanescente no config de loja antiga
        //     (ou ausente — o default lá em cima): tratado como "sem
        //     cotação de fora", sem explodir. O motivo vai para o histórico
        //     (log de erro) — a única janela da lojista para o frete.
        //
        // A resposta é a lista VAZIA com `cotacaoIncompleta: false` — a
        // mesma forma que o carrinho já consumia para "não há opções"
        // (ver `respostaSemCotacaoDeFora`): nenhum preço inventado, nenhum
        // spinner eterno.
        if (!cart || !Array.isArray(cart) || cart.length === 0) {
            return await respostaSemCotacaoDeFora(supabaseClient, null)
        }
        if (provider === 'flat_fee') {
            return await respostaSemCotacaoDeFora(supabaseClient, {
                originCep,
                destinationCep: cleanCep,
                provider,
                cart,
                motivo: 'Loja sem transportadora conectada para entregas fora da cidade (o frete de taxa fixa foi descontinuado). Conecte Melhor Envio, Frenet ou SuperFrete para cotar o frete nacional.',
            })
        }

        // ── CACHE LOOKUP ──
        const cartHash = getCartHash(cart)
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

        // Leitura TOLERANTE a mais de uma linha para a mesma chave
        // (index-880). `shipping_quotes_cache` não tem UNIQUE em
        // (origin_cep, destination_cep, cart_hash) — só PK em `id` — e o
        // INSERT só acontece no miss. Duas cotações do MESMO carrinho que
        // erram o cache ao mesmo tempo (duas abas, ou o debounce de 700ms
        // cruzando com o clique manual em "Calcular") gravam DUAS linhas.
        // `.maybeSingle()` ESTOURA quando mais de uma linha bate no filtro,
        // e o erro derrubava o cache daquela chave por até 2h: toda
        // releitura seguinte caía no mesmo erro, ia de novo para a
        // transportadora e GRAVAVA MAIS uma linha, realimentando o problema.
        // `.order(created_at desc).limit(1)` nunca estoura com duplicata —
        // pega a mais recente e ignora o resto, a mesma disciplina que a RPC
        // do pedido já usa para este caso (`ORDER BY q.created_at DESC
        // LIMIT 1`). A gravação em `salvarCotacaoNoCache`, abaixo, faz a
        // outra metade: evita empilhar mais linha na mesma chave.
        const { data: linhasDoCache, error: cacheQueryError } = await supabaseClient
            .from('shipping_quotes_cache')
            .select('options')
            .eq('origin_cep', originCep)
            .eq('destination_cep', cleanCep)
            .eq('cart_hash', cartHash)
            .gt('created_at', twoHoursAgo)
            .order('created_at', { ascending: false })
            .limit(1)

        const cachedQuote = linhasDoCache?.[0] ?? null

        // Release 1.5.4: acerto só vale se a cotação for do provedor ATUAL
        // (ver `cotacaoDoCacheServeAoProvedor`); senão segue como falta,
        // recota e o upsert abaixo sobrescreve a mesma chave.
        if (cachedQuote && !cacheQueryError && cotacaoDoCacheServeAoProvedor(cachedQuote.options, provider)) {
            console.log(`[calculate-shipping] Caching hit for CEP: ${cleanCep}`)
            
            // Log cache hit asynchronously (fire and forget)
            fireAndForget(
                supabaseClient.from('shipping_calculation_logs').insert({
                    origin_cep: originCep,
                    destination_cep: cleanCep,
                    provider: `${provider} (Cache)`,
                    cart_items: cart,
                    response_time_ms: 0,
                    status: 'success'
                }),
                'Failed to log cache hit:',
            )

            return new Response(
                JSON.stringify({ options: cachedQuote.options, cotacaoIncompleta: false }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 5. Fetch carrier credentials securely
        const { data: credsData, error: credsError } = await supabaseClient
            .from('store_shipping_credentials')
            .select('credentials')
            .eq('provider', provider)
            .maybeSingle()

        if (credsError || !credsData) {
            // FRETE V2 (03/09/2026): este ramo devolvia a taxa fixa como
            // "Entrega Padrão" (`getFlatFeeResponse`) — o plano B que fazia
            // loja SEM transportadora conectada aparecer cobrando fora da
            // cidade. O plano B morreu com o flat_fee: sem credencial não há
            // cotação de fora, e a resposta honesta é a lista vazia com o
            // motivo no histórico para a lojista conectar.
            console.warn(
                "Credentials not found for provider:",
                provider,
                "— responding with no out-of-city options (flat fee is gone). Error:",
                credsError
            )
            return await respostaSemCotacaoDeFora(supabaseClient, {
                originCep,
                destinationCep: cleanCep,
                provider,
                cart,
                motivo: `Sem credencial cadastrada para o provedor "${provider}". Conecte a transportadora para cotar entregas fora da cidade.`,
            })
        }

        const credentials = credsData.credentials || {}
        let shippingOptions: any[] = []

        // index-736: até aqui existia um `nonFreeCart` neste ponto — cotava
        // só os itens NÃO marcados quando o preset por_produto não zerava o
        // pedido inteiro (`every` não batia). Com `allFree` agora em `some`
        // (acima), chegar até aqui com `presetPorProduto` true só é possível
        // quando NENHUM item está marcado (senão `some` já teria disparado o
        // retorno `Frete Grátis` logo acima) — ou seja, o filtro do
        // `nonFreeCart` sempre devolvia o `cart` inteiro sem tirar nada.
        // Cotar o `cart` direto é o mesmo resultado, sem o ramo morto que
        // fingia cobrar só parte do carrinho.
        const apiStartTime = performance.now()
        let apiError: string | null = null
        let cepInvalidoNaTransportadora = false

        try {
            if (provider === 'melhor_envio') {
                const token = credentials.token
                if (!token) throw new Error('Token do Melhor Envio ausente')

                const products = cart.map((item: any) => {
                    const prodId = item.product?.id || item.productId
                    const dbProd = dbProductsMap.get(prodId)

                    const price = Number(dbProd?.preco_venda ?? item.product?.price ?? 0)
                    const weight = Number(dbProd?.peso_kg ?? 0.3)
                    const width = Number(dbProd?.largura_cm ?? 15)
                    const height = Number(dbProd?.altura_cm ?? 15)
                    const length = Number(dbProd?.comprimento_cm ?? 15)

                    return {
                        name: dbProd?.nome || item.product?.nome || 'Produto',
                        quantity: Number(item.quantity || 1),
                        unitary_weight: weight,
                        price: price,
                        width: width,
                        height: height,
                        length: length
                    }
                })

                const isSandbox = credentials.sandbox === true
                const baseUrl = isSandbox 
                    ? 'https://sandbox.melhorenvio.com.br' 
                    : 'https://melhorenvio.com.br'

                const response = await buscarComTempo(fetch, `${baseUrl}/api/v2/me/shipment/calculate`, {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'User-Agent': 'IKCOUS-Marketplace-Integration (contato@ikcous.com.br)'
                    },
                    body: JSON.stringify({
                        from: { postal_code: originCep },
                        to: { postal_code: cleanCep },
                        products: products
                    })
                })

                if (!response.ok) {
                    // Redigido aqui; cortado no `catch` abaixo (a classificação
                    // de CEP inválido lê a mensagem inteira antes do corte).
                    const errText = textoSemSegredo(await response.text(), [token], Number.POSITIVE_INFINITY)
                    throw new Error(`Melhor Envio API retornou ${response.status}: ${errText}`)
                }

                const data = await response.json()
                if (Array.isArray(data)) {
                    shippingOptions = data
                        .filter(service => !service.error && service.price)
                        .map(service => {
                            const isEnabled = chavesDeServico.length === 0 || chavesDeServico.some((m: string) => servicoCasaChave(service.name, m))
                            if (!isEnabled) return null

                            return {
                                id: `melhor-envio-${service.id}`,
                                name: nomeAmigavelDoServico(service),
                                price: Number(service.price),
                                deliveryDays: Number(service.delivery_time),
                                provider: 'melhor_envio'
                            }
                        })
                        .filter(Boolean)
                }
            } 
            else if (provider === 'frenet') {
                const token = credentials.token
                if (!token) throw new Error('Token da Frenet ausente')

                const invoiceValue = cart.reduce((sum: number, item: any) => {
                    const prodId = item.product?.id || item.productId
                    const dbProd = dbProductsMap.get(prodId)
                    const price = Number(dbProd?.preco_venda ?? item.product?.price ?? 0)
                    return sum + (price * Number(item.quantity || 1))
                }, 0)

                const items = cart.map((item: any) => {
                    const prodId = item.product?.id || item.productId
                    const dbProd = dbProductsMap.get(prodId)

                    const weight = Number(dbProd?.peso_kg ?? 0.3)
                    const width = Number(dbProd?.largura_cm ?? 15)
                    const height = Number(dbProd?.altura_cm ?? 15)
                    const length = Number(dbProd?.comprimento_cm ?? 15)

                    return {
                        Weight: weight,
                        Length: length,
                        Height: height,
                        Width: width,
                        Quantity: Number(item.quantity || 1)
                    }
                })

                const response = await buscarComTempo(fetch, 'https://api.frenet.com.br/shipping/quote', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'token': token
                    },
                    body: JSON.stringify({
                        SellerCEP: originCep,
                        RecipientCEP: cleanCep,
                        ShipmentInvoiceValue: invoiceValue,
                        ShippingItemArray: items
                    })
                })

                if (!response.ok) {
                    const errText = textoSemSegredo(await response.text(), [token], Number.POSITIVE_INFINITY)
                    throw new Error(`Frenet API retornou ${response.status}: ${errText}`)
                }

                const data = await response.json()
                const services = data?.ShippingSevicesArray || []
                shippingOptions = services
                    .filter((s: any) => !s.Error && s.ShippingPrice)
                    .map((s: any) => {
                        const isEnabled = chavesDeServico.length === 0 || chavesDeServico.some((m: string) => servicoCasaChave(s.ServiceDescription, m))
                        if (!isEnabled) return null

                        return {
                            id: `frenet-${s.ServiceCode || s.ServiceDescription}`,
                            name: nomeAmigavelDoServico({ name: s.ServiceDescription }),
                            price: Number(s.ShippingPrice),
                            deliveryDays: Number(s.DeliveryTime),
                            provider: 'frenet'
                        }
                    })
                    .filter(Boolean)
            }
            else if (provider === 'superfrete') {
                const token = credentials.token
                if (!token) throw new Error('Token da SuperFrete ausente')

                // Falha FECHADA antes de qualquer rede: sem o User-Agent que
                // a SuperFrete exige, a chamada não sai (nunca um UA
                // inventado nem o fixo do ME). Release 1.5.5: o UA sai SÓ do
                // e-mail salvo DESTA loja, revalidado aqui (a linha pode ter
                // sido gravada sem passar pelo `save_credentials`).
                const userAgent = userAgentDaSuperFrete(credentials.contact_email)
                if (!userAgent) throw new Error(MOTIVO_SEM_EMAIL_SUPERFRETE)

                const services = servicosSuperFrete(chavesDeServico)
                if (!services) {
                    throw new Error('SuperFrete não consultada: nenhum serviço habilitado (sedex, pac ou jadlog) corresponde a um serviço da SuperFrete.')
                }

                const response = await buscarComTempo(fetch, urlDaCotacaoSuperFrete(credentials.sandbox), {
                    method: 'POST',
                    headers: cabecalhosDaSuperFrete(token, userAgent),
                    body: JSON.stringify(pedidoDeCotacaoSuperFrete({
                        originCep,
                        destinationCep: cleanCep,
                        services,
                        cart,
                        dbProductsMap,
                    })),
                })

                const texto = await response.text()
                if (!response.ok) {
                    throw new Error(`SuperFrete API retornou ${response.status}: ${textoSemSegredo(texto, [token], Number.POSITIVE_INFINITY)}`)
                }

                // JSON lido à mão: o SyntaxError do `response.json()` cita um
                // trecho do corpo cru — a mensagem própria não cita nada.
                let data: unknown
                try {
                    data = JSON.parse(texto)
                } catch {
                    throw new Error('SuperFrete: resposta não é JSON válido.')
                }
                shippingOptions = mapearRespostaSuperFrete(data, chavesDeServico)
            }
        } catch (apiErr) {
            // Release 1.5.4: nada de token nem corpo cru inteiro no console
            // nem no histórico — redigido e cortado (~300) num lugar só.
            const mensagemCrua = textoSemSegredo(apiErr?.message ?? apiErr, [credentials.token], Number.POSITIVE_INFINITY)
            apiError = textoSemSegredo(mensagemCrua)
            console.error("[calculate-shipping] API quotation failed for %s:", provider, apiError)
            // A classificação de CEP inválido (mais abaixo) lê a mensagem
            // INTEIRA — o corte de 300 não pode esconder o `cep_destino`.
            cepInvalidoNaTransportadora = erroDeTransportadoraEhCepInvalido(mensagemCrua)
        }

        const apiEndTime = performance.now()
        const latency = Math.round(apiEndTime - apiStartTime)

        // (O prepend de `local-delivery` que vivia aqui foi absorvido pelo
        // retorno cedo de `isLocal`, logo acima do ramo de taxa fixa: o
        // cliente local não chega mais até a cotação de transportadora.)

        // A lista devolvida é a lista INTEIRA? Só deixa de ser quando a
        // gravação da cotação falha e opções que dependiam dela são removidas
        // (ver abaixo). O campo viaja nas NOVE rotas normais de 200 — as
        // oito saídas antecipadas mais o `return` final —, inclusive quando é
        // `false`: campo que só aparece quando é verdadeiro é campo que quem
        // consome esquece de checar, e a tela passa a "funcionar" por omissão.
        //
        // FRETE V2 (03/09/2026): a DÉCIMA resposta — a contingência do
        // `catch` de topo, que respondia 200 com `fallback: true` — deixou de
        // existir junto com o flat_fee; exceção inesperada agora é 500 sem
        // preço. Toda resposta 200 com `options` leva o campo.
        let cotacaoIncompleta = false

        // Transportadora falhou ou não devolveu nenhuma opção habilitada.
        //
        // ATÉ 25/08/2026 este ramo inventava um preço por `calculateSmartFallback`
        // (estimativa por REGIÃO de CEP) e o devolvia com id `flat-fee-contingency`.
        // A RPC que valida o pedido ignora esse preço para QUALQUER id
        // `flat-fee-%` e cobra `COALESCE(store_config.shipping_fee, 0)` — ver
        // `precoResolvidoSemCache` acima e
        // `20260960000000_variacao_obrigatoria_no_servidor.sql:223-224`. Como a
        // estimativa por região quase nunca bate com a taxa fixa da loja, a
        // cliente preenchia endereço e pagamento, clicava em Finalizar, e a RPC
        // recusava por divergência de total — venda perdida no último clique,
        // sem que nada aparecesse deste lado.
        //
        // ATÉ 03/09/2026 ainda havia um SEGUNDO plano B aqui: com a taxa fixa
        // configurada, o ramo devolvia `getFlatFeeResponse()` ("Entrega
        // Padrão", preço idêntico ao que a RPC leria). FRETE V2 matou o
        // flat_fee e com ele o último plano B: fora da cidade só preço de
        // transportadora real. Sem opção real, não há preço honesto — a
        // função falha fechado (503), com o motivo no histórico.
        if (shippingOptions.length === 0) {
            // O log é AGUARDADO pelo mesmo motivo do 503: aqui não há preço
            // para entregar, então esperar não tira nada de ninguém, e é a
            // ÚNICA janela que a lojista tem para essa falha.
            //
            // O status é 'error', não 'contingency': este ramo não entrega
            // NENHUM preço — a resposta é 503 e ninguém compra. O painel
            // (`AdminShippingView.tsx`) pinta 'contingency' de âmbar,
            // reservado a "deu certo pelo plano B", e só 'error' de
            // vermelho. O irmão que gravava 'contingency' com razão (plano B
            // da taxa fixa) foi removido com o flat_fee.
            const logEmVoo = Promise.resolve(
                supabaseClient.from('shipping_calculation_logs').insert({
                    origin_cep: originCep,
                    destination_cep: cleanCep,
                    provider: provider,
                    cart_items: cart,
                    response_time_ms: latency,
                    status: 'error',
                    error_message: apiError || 'Nenhum método de envio retornado.'
                }),
            )
            fireAndForget(logEmVoo, 'Failed to log contingency:')
            await logEmVoo.catch(() => {})

            if (cepInvalidoNaTransportadora) {
                return new Response(
                    JSON.stringify({ error: 'CEP não encontrado. Confira o número e tente de novo.', codigo: 'cep_invalido' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            return new Response(
                JSON.stringify({ error: 'Não foi possível calcular o frete agora. Tente novamente em instantes.' }),
                { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        } else {
            // Save to cache — AGUARDANDO, e a resposta sai daqui.
            //
            // Esta linha é a cotação que a validação do pedido vai exigir na
            // hora de fechar a compra. Enquanto ela era `fireAndForget`, o
            // preço ia para o navegador com a gravação ainda em voo — e a doc
            // do Supabase é explícita: promessa não aguardada pode morrer no
            // encerramento da instância (`EarlyDrop`). A cliente então
            // preenchia endereço, escolhia pagamento, clicava em finalizar, e
            // só ali era recusada. Falhar aqui custa um clique; falhar lá
            // custa a compra inteira.
            const erroDeGravacao = await salvarCotacaoNoCache(supabaseClient, {
                originCep,
                destinationCep: cleanCep,
                cartHash,
                options: shippingOptions,
            })

            // Log — DEPOIS de saber se a gravação deu certo, e derivado dela.
            //
            // `shipping_calculation_logs` é a única janela da lojista para o
            // frete, e o painel pinta `status === 'success'` de verde
            // "Sucesso". Enquanto a resposta era 200 com preço, gravar
            // 'success' aqui era verdade. Com a recusa abaixo, deixou de ser:
            // numa loja em que a gravação esteja falhando, ninguém compra e o
            // único lugar onde ela veria a quebra afirmaria que está tudo bem.
            //
            // A query é materializada numa Promise de verdade porque o ramo
            // que responde 503 precisa AGUARDÁ-LA (ver abaixo), e o builder do
            // supabase-js é lazy: chamar `.then` nele duas vezes gravaria duas
            // linhas. `Promise.resolve` dispara a query UMA vez, e o
            // `fireAndForget` logo abaixo recebe a Promise já pronta — para
            // ele, `Promise.resolve` de uma Promise nativa é identidade.
            const logEmVoo = Promise.resolve(
                supabaseClient.from('shipping_calculation_logs').insert({
                    origin_cep: originCep,
                    destination_cep: cleanCep,
                    provider: provider,
                    cart_items: cart,
                    response_time_ms: latency,
                    status: erroDeGravacao ? 'error' : 'success',
                    error_message: erroDeGravacao
                        ? `Falha ao gravar a cotação: ${mensagemDoErro(erroDeGravacao)}`
                        : null,
                }),
            )
            fireAndForget(logEmVoo, 'Failed to log shipping calculation:')

            if (erroDeGravacao) {
                // Sem a linha gravada, cai a opção cujo preço a validação do
                // pedido buscaria NO CACHE. O que a RPC resolve pela
                // `store_config` continua válido e continua vendável — ver
                // `precoResolvidoSemCache`. Recusar essas junto era perder uma
                // venda que o checkout teria aceitado.
                const opcoesQueDispensamOCache = shippingOptions.filter(opt => precoResolvidoSemCache(opt?.id))

                if (opcoesQueDispensamOCache.length === 0) {
                    // Aqui a recusa é a resposta certa: todo preço restante
                    // dependia da linha que não foi gravada. Responder erro
                    // AGORA é a forma barata de falhar — a cliente reaperta
                    // "calcular"; falhar no último clique custa a compra.
                    //
                    // E o log espera AQUI, pelo mesmo motivo que a gravação da
                    // cotação virou `await`: promessa não aguardada pode morrer
                    // no encerramento da instância. Neste ramo a linha do log é
                    // a ÚNICA coisa que a lojista recebe — e a falha é
                    // correlacionada, porque a mesma causa que derruba o insert
                    // do cache derruba o insert do log. Sem esperar, o sintoma
                    // dela é "ninguém compra" sem linha nenhuma no painel, nem
                    // verde nem vermelha. Custo zero: aqui não há preço para
                    // entregar, então atrasar a resposta não tira nada de
                    // ninguém — o mesmo não vale para o 200 acima.
                    //
                    // O `catch` vazio é obrigatório: `fireAndForget` já
                    // registrou o erro no console, e uma exceção solta aqui
                    // subiria ao `catch` de topo, que a converteria num 200 com
                    // preço de contingência — exatamente o que esta recusa
                    // existe para impedir.
                    await logEmVoo.catch(() => {})

                    return new Response(
                        JSON.stringify({ error: 'Não foi possível registrar a cotação de frete. Tente calcular novamente.' }),
                        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    )
                }

                // Incompleta é sobre o que FOI TIRADO, não sobre ter havido
                // erro: se nada precisava do cache, a lista continua inteira.
                cotacaoIncompleta = opcoesQueDispensamOCache.length < shippingOptions.length
                shippingOptions = opcoesQueDispensamOCache
            }
        }

        return new Response(
            JSON.stringify({ options: shippingOptions, cotacaoIncompleta }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (err) {
        console.error('[calculate-shipping] Top-level Edge Function Error:', err)

        // LAUDO 31/08 (D2): o `err.message` que sobe até aqui pode carregar
        // texto de API de terceiros (o errText do Melhor Envio/Frenet vem
        // cru dentro dele) ou de banco — e até hoje esse texto era devolvido
        // AO NAVEGADOR DO CLIENTE no retorno abaixo. O detalhe que
        // presta fica no console.error acima, nos logs da função; quem paga
        // lê uma frase utilizável. (O `err.message` do caminho
        // `test_credentials` fica como está: é o painel da LOJISTA lendo o
        // erro do token DELA.)
        const mensagemSegura = 'Não foi possível calcular o frete agora. Tente novamente.'

        // MESMO DEFEITO DO OUTRO FALLBACK, NUM SEGUNDO LUGAR: até 25/08/2026
        // esta contingência de último recurso usava `precoDeContingenciaDoTopo`
        // — a escada por região de `calculateSmartFallback` — e devolvia a
        // estimativa com id `flat-fee-fallback`. A RPC que valida o pedido
        // ignora esse preço para qualquer id `flat-fee-%` e cobra
        // `COALESCE(store_config.shipping_fee, 0)` (ver `precoResolvidoSemCache`
        // acima). A escada quase nunca bate com a taxa fixa real da loja, então
        // mostrar a estimativa aqui também levava ao "os valores do pedido
        // mudaram" no último clique.
        //
        // FRETE V2 (03/09/2026): a correção intermediária — mostrar a taxa
        // fixa da loja (`taxaDaLoja`) quando configurada — foi REMOVIDA junto
        // com o flat_fee. Fora da cidade o único preço honesto é o da
        // transportadora real; exceção inesperada é falha fechado, sem preço
        // nenhum.
        return new Response(
            JSON.stringify({ error: mensagemSegura }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
}

// `(req) => handler(req)`, e não `serve(handler)` direto: o `serve` do std
// passa um segundo argumento (ConnInfo) que cairia em `deps`.
if (!isTesting) serve((req: Request) => handler(req));
