// @ts-nocheck
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { ID_RETIRADA_NA_LOJA } from "../_shared/retirada-na-loja.ts"
import { textoSemSegredo } from './regua.ts'
import {
    cotarPeloProvedor,
    FalhaDoProvedor,
    precosMudadosPelaRegra,
    ROTULO_DO_PROVEDOR,
    type ResultadoDoProvedor,
    servicosSalvos,
    servicosSuperFrete,
    tokenDe,
    userAgentDoMelhorEnvio,
} from './provedores.ts'
import {
    assinaturaDaCotacao,
    calcularRevisaoConfig,
    chavesDeTransportadora,
    COLUNAS_DA_LOJA,
    conjuntoLigado,
    cotacaoDoCacheServe,
    lerCredenciais,
    lerEstrategiaNacionalDaLoja,
    lerRevisao,
    metodosDaLoja,
    montarInsumos,
} from './configuracao.ts'
import { tratarAcao } from './acoes.ts'
import { aplicarEstrategiaNacional, espelhoLegado, type EstrategiaNacional, subtotalDoCarrinho } from './estrategia-nacional.ts'

// RELEASE 1.5.7 (vários provedores): a régua comum mora em `regua.ts`, os
// adaptadores das transportadoras em `provedores.ts`, o modo legado/multi, a
// revisão e a assinatura do cache em `configuracao.ts` e as ações de admin em
// `acoes.ts`. Os nomes que os testes e as outras peças já importavam daqui
// continuam exportados daqui.
export {
    aoCentavo,
    buscarComTempo,
    codigoDeServicoValido,
    jsonCanonico,
    medidaPositivaDoBanco,
    nomeDaOpcao,
    prazoDaApi,
    precoDaApi,
    textoSemSegredo,
    valorUnitarioDoBanco,
} from './regua.ts'
export {
    emailDeContatoValido,
    erroDeTransportadoraEhCepInvalido,
    FalhaDoProvedor,
    MOTIVO_EMAIL_DE_CONTATO_INVALIDO,
    MOTIVO_SEM_EMAIL_MELHOR_ENVIO,
    MOTIVO_SEM_EMAIL_SUPERFRETE,
    servicoCasaChave,
    servicosSuperFrete,
    SUPERFRETE_SERVICOS_POR_CHAVE,
    SUPERFRETE_TODOS_OS_SERVICOS,
    TEMPO_LIMITE_DO_PROVEDOR_MS,
    urlDaCotacaoSuperFrete,
    userAgentDaSuperFrete,
    userAgentDoMelhorEnvio,
    VERSAO_DA_COTACAO_SUPERFRETE,
    VERSAO_DA_INTEGRACAO_SUPERFRETE,
} from './provedores.ts'
export { assinaturaDaCotacao, calcularRevisaoConfig, chavesDeTransportadora, conjuntoLigado, cotacaoDoCacheServe, lerEstrategiaNacionalDaLoja, montarInsumos } from './configuracao.ts'
export { testarCredencial, validarServicos } from './acoes.ts'
export { aplicarEstrategiaNacional, espelhoLegado, estrategiaNacionalDaLinha, subtotalDoCarrinho } from './estrategia-nacional.ts'
export type { EstrategiaNacional } from './estrategia-nacional.ts'


const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    revisaoConfig: string | null = null,
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
        JSON.stringify(revisaoConfig ? { options: [], cotacaoIncompleta: false, revisaoConfig } : { options: [], cotacaoIncompleta: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
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

/** Sinal interno: a revisão mudou durante a cotação e ela deve ser refeita UMA vez (R3-2). */
const RECOTAR = Symbol('recotar')

const respostaJson = (conteudo: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(conteudo), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

/** O que a linha do log estruturado sabe dos serviços pedidos, com ou sem a cotação. */
function servicosPedidosParaOLog(provider: string, credenciais: any, chaves: string[]): string[] | 'legado' {
    const salvos = servicosSalvos(provider, credenciais)
    if (salvos) return salvos
    if (provider === 'superfrete') return servicosSuperFrete(chaves).split(',').filter(Boolean)
    return 'legado'
}

/**
 * LOG ESTRUTURADO da cotação (release 1.5.7): UMA linha
 * `console.log(JSON.stringify(...))` POR PROVEDOR ligado, em toda cotação
 * (falta ou acerto do cache, deu certo ou não). NUNCA token, e-mail, nome de
 * produto, endereço, CEP nem o texto de erro da transportadora — só códigos,
 * preços, prazos, contagens e o motivo classificado.
 */
function linhaDoLogDaCotacao(entrada: {
    provider: string
    modo: 'legado' | 'multi'
    credenciais: any
    chaves: string[]
    resultado: ResultadoDoProvedor | null
    falha: FalhaDoProvedor | null
    opcoesFinais: any[]
    cache: 'hit' | 'miss'
    contrato: unknown
    produtosSemCadastro: number
    camposPadrao: number
}) {
    const retornados = entrada.resultado?.retornados ?? []
    return {
        evento: 'cotacao_frete',
        provedor: entrada.provider,
        modo: entrada.modo,
        resultado: entrada.falha ? 'falha' : 'ok',
        motivo: entrada.falha ? entrada.falha.motivo : undefined,
        ambiente: entrada.credenciais?.sandbox === true ? 'sandbox' : 'producao',
        servicos_pedidos: entrada.resultado?.servicosPedidos ??
            servicosPedidosParaOLog(entrada.provider, entrada.credenciais, entrada.chaves),
        retornados: retornados.map((r) => ({
            codigo: r.codigo,
            preco: r.preco,
            preco_original: r.preco_original,
            prazo: r.prazo,
            erro: r.erro,
        })),
        opcoes_finais: entrada.opcoesFinais
            .filter((opcao) => opcao?.provider === entrada.provider)
            .map((opcao) => ({
                id: typeof opcao?.id === 'string' ? opcao.id : null,
                preco: typeof opcao?.price === 'number' ? opcao.price : null,
                prazo: typeof opcao?.deliveryDays === 'number' ? opcao.deliveryDays : null,
            })),
        precos_mudados_pela_regra: precosMudadosPelaRegra(retornados),
        // R3-7: se o ME saiu com o contato DA LOJA ou com o recuo legado (nunca o e-mail em si).
        ua_contato: entrada.provider === 'melhor_envio' ? userAgentDoMelhorEnvio(entrada.credenciais).contato : undefined,
        cache: entrada.cache,
        contrato: typeof entrada.contrato === 'number' && Number.isFinite(entrada.contrato) ? entrada.contrato : null,
        produtos_sem_cadastro: entrada.produtosSemCadastro,
        campos_padrao: entrada.camposPadrao,
    }
}

/** A linha do histórico (`shipping_calculation_logs`), materializada numa Promise de verdade. */
function gravarHistorico(supabaseClient: any, linha: Record<string, unknown>): Promise<unknown> {
    const emVoo = Promise.resolve(supabaseClient.from('shipping_calculation_logs').insert(linha))
    fireAndForget(emVoo, 'Failed to log shipping calculation:')
    return emVoo.catch(() => {})
}

export async function handler(req: Request, deps: CalculateShippingDeps = {}): Promise<Response> {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    // FRETE V2 (03/09/2026): a contingência de preço do `catch` de topo saiu
    // junto com o caminho de taxa fixa — exceção inesperada é falha fechada
    // (500), sem preço nenhum.
    try {
        const body = await req.json()
        const { cep, cart, action } = body ?? {}
        // Só o booleano `true` EXATO: "true", 1, objeto… = app que não pediu.
        const aceitaRetirada = body?.aceitaRetirada === true

        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
        const supabaseServiceRole = readKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
        const supabaseClient = deps.supabase ?? createClient(supabaseUrl, supabaseServiceRole)

        // Ações de admin (e a pública `revisao_config_frete`) — TODAS antes do
        // `if (!cep)`. Ver `acoes.ts`.
        const respostaDaAcao = await tratarAcao(action, {
            body,
            supabase: supabaseClient,
            cabecalhos: corsHeaders,
            ehAdmin: () => {
                const authHeader = req.headers.get('Authorization')
                return deps.verificarAdmin
                    ? deps.verificarAdmin(authHeader)
                    : verifyIsAdmin(authHeader, supabaseUrl, supabaseServiceRole)
            },
        })
        if (respostaDaAcao) return respostaDaAcao

        // ROUTE: calculate (default flow)
        if (!cep) return respostaJson({ error: 'CEP de destino é obrigatório' }, 400)
        const cleanCep = String(cep).replace(/\D/g, '')
        if (cleanCep.length !== 8) return respostaJson({ error: 'CEP inválido' }, 400)

        const pedido = { cleanCep, cart, aceitaRetirada, contratoCliente: body?.contratoCliente }
        // R3-2: a revisão mudou entre a leitura e a gravação? Recota UMA vez;
        // na segunda, `cotarUmaVez` responde como falha de gravação.
        const primeira = await cotarUmaVez(supabaseClient, pedido, false)
        if (primeira !== RECOTAR) return primeira
        return (await cotarUmaVez(supabaseClient, pedido, true)) as Response
    } catch (err) {
        // O detalhe fica no console da função — redigido, porque a mensagem
        // pode carregar texto de API de terceiro. Quem paga lê uma frase
        // utilizável, nunca o texto cru.
        console.error('[calculate-shipping] Top-level Edge Function Error:', textoSemSegredo((err as Error)?.message ?? err))
        return respostaJson({ error: 'Não foi possível calcular o frete agora. Tente novamente.' }, 500)
    }
}

/**
 * UMA passada da cotação pública. Ordem (contrato §3 + R1 + R3-2):
 * `_revisao` → `store_config` → produtos → credenciais (ANTES do cache) →
 * local/retirada/grátis → cache assinado → provedores ligados em PARALELO →
 * relê `_revisao` → grava o cache → responde.
 */
async function cotarUmaVez(
    supabaseClient: any,
    pedido: { cleanCep: string; cart: any; aceitaRetirada: boolean; contratoCliente: unknown },
    ultimaTentativa: boolean,
): Promise<Response | typeof RECOTAR> {
    const { cleanCep, cart, aceitaRetirada } = pedido

    // 0. A revisão das credenciais — ANTES da configuração (R3-2).
    const revisaoLida = await lerRevisao(supabaseClient)

    // 1. Configuração pública da loja.
    const { data: storeConfig, error: configError } = await supabaseClient
        .from('store_config')
        .select(COLUNAS_DA_LOJA)
        .eq('id', 1)
        .single()
    if (configError || !storeConfig) {
        console.error('Error fetching store config:', configError?.code ?? configError)
        throw new Error('Falha ao obter configuração da loja')
    }

    // Falha fechado: sem CEP de origem, a função não calcula nada.
    const erroDeConfiguracao = validarOrigemEFrete(storeConfig.origin_cep)
    if (erroDeConfiguracao) throw new Error(erroDeConfiguracao)

    const originCep = storeConfig.origin_cep.replace(/\D/g, '')
    const enabledMethods = metodosDaLoja(storeConfig)
    const chavesDeServico = chavesDeTransportadora(enabledMethods)
    const shippingCoverage = storeConfig.shipping_coverage || 'national'
    const localDeliveryFee = Number(storeConfig.local_delivery_fee ?? 10)
    const localCepRange = storeConfig.local_cep_range || ''
    const isLocal = isLocalCep(originCep, cleanCep, localCepRange)

    // 2. Produtos (e variações) pelo BANCO — o navegador não decide peso,
    // medida nem valor.
    const itensDoCarrinho = Array.isArray(cart) ? cart : []
    const productIds = itensDoCarrinho.map((item: any) => item?.product?.id || item?.productId).filter(Boolean)
    let dbProducts: any[] = []
    if (productIds.length > 0) {
        const { data: prods, error: prodsError } = await supabaseClient
            .from('produtos')
            .select('id, nome, preco_venda, peso_kg, largura_cm, altura_cm, comprimento_cm, frete_gratis')
            .in('id', productIds)
        if (prodsError) console.error('[calculate-shipping] Error querying database products:', prodsError?.code ?? prodsError)
        else dbProducts = prods || []
    }
    const dbProductsMap = new Map(dbProducts.map((p) => [p.id, p]))
    const variantIds = itensDoCarrinho.map((item: any) => item?.variantId).filter(Boolean)
    let variantes: any[] = []
    if (variantIds.length > 0) {
        const { data, error } = await supabaseClient
            .from('product_variants')
            .select('id, product_id, price_override')
            .in('id', variantIds)
        if (error) console.error('[calculate-shipping] Error querying product variants:', error?.code ?? error)
        else variantes = data || []
    }
    const variantesMap = new Map(variantes.map((v) => [v.id, v]))

    // FRETE V2 (revisão A1): `produtos.frete_gratis` vale SÓ no preset
    // "por_produto" (`free_shipping_min < 0`); basta UM item marcado (`some`,
    // igual à RPC e ao CartContext). Fonte do predicado:
    // `src/lib/presets-de-frete-gratis.ts`.
    const presetPorProduto = Number(storeConfig.free_shipping_min ?? 0) < 0
    const itemComFreteGratisMarcado = itensDoCarrinho.length > 0 && itensDoCarrinho.some((item: any) => {
        const dbProd = dbProductsMap.get(item?.product?.id || item?.productId)
        return !!(dbProd?.frete_gratis ?? item?.product?.freeShipping)
    })
    const allFree = presetPorProduto && itemComFreteGratisMarcado

    // 3. Credenciais — ANTES do cache (A5/D8). Uma consulta só, todas as
    // linhas; a revisão da configuração sai daqui e vai em TODA resposta.
    //
    // ESTRATÉGIA NACIONAL (23/09, T2): leitura SEPARADA e tolerante das 5
    // colunas (`lerEstrategiaNacionalDaLoja`, molde `lerEnderecoDaLoja`).
    // Falhou/ausente (banco antigo) → espelho legado de `free_shipping_min`
    // (comportamento de hoje). Entra em `revisaoConfig` SÓ quando a leitura
    // teve sucesso — banco antigo mantém o hash de hoje, byte a byte.
    const leituraNacional = await lerEstrategiaNacionalDaLoja(supabaseClient)
    const estrategiaNacionalAtual: EstrategiaNacional = leituraNacional.ok ? leituraNacional.estrategia : espelhoLegado(storeConfig.free_shipping_min)
    const lidas = await lerCredenciais(supabaseClient)
    const revisaoConfig = lidas.ok && revisaoLida.ok
        ? await calcularRevisaoConfig(storeConfig, lidas.linhas, revisaoLida.revisao, leituraNacional.ok ? leituraNacional.estrategia : null)
        : null
    const comRevisao = (conteudo: Record<string, unknown>) => (revisaoConfig ? { ...conteudo, revisaoConfig } : conteudo)

    // Cobertura só local: CEP de fora não é atendido.
    if (shippingCoverage === 'local') {
        if (!isLocal) return respostaJson({ error: 'Esta loja realiza apenas entregas locais na sua região.' }, 400)
        return respostaJson(comRevisao({
            options: await opcoesDaClienteLocal(supabaseClient, enabledMethods, allFree ? 0 : localDeliveryFee, aceitaRetirada),
            cotacaoIncompleta: false,
        }))
    }

    // Cliente LOCAL recebe SÓ a Entrega Local (e a retirada) — nunca frete
    // nacional (pedido do Gabriel, 02/09). Mantém a linha no histórico.
    if (isLocal) {
        fireAndForget(
            supabaseClient.from('shipping_calculation_logs').insert({
                origin_cep: originCep,
                destination_cep: cleanCep,
                provider: 'local',
                cart_items: cart,
                response_time_ms: 0,
                status: 'success',
            }),
            'Failed to log local quote:',
        )
        return respostaJson(comRevisao({
            options: await opcoesDaClienteLocal(supabaseClient, enabledMethods, allFree ? 0 : localDeliveryFee, aceitaRetirada),
            cotacaoIncompleta: false,
        }))
    }

    // O atalho de grátis por produto (`free-shipping-promo`) é NACIONAL — o
    // preset LOCAL usou `allFree` acima (free_shipping_min, sem mudança).
    // Aqui a estratégia é a NACIONAL (colunas novas, com o espelho legado
    // como queda): só dispara quando ela é `por_produto` E há item marcado.
    // Sem cache (a RPC resolve este id pela regra, como hoje).
    if (estrategiaNacionalAtual.estrategia === 'por_produto' && itemComFreteGratisMarcado) {
        console.log('[calculate-shipping] Item com frete grátis no carrinho (estratégia nacional por_produto): frete zerado para o pedido inteiro.')
        return respostaJson(comRevisao({
            options: [{ id: 'free-shipping-promo', name: 'Frete Grátis (Promoção)', price: 0, deliveryDays: 3, provider: 'free' }],
            cotacaoIncompleta: false,
        }))
    }

    // 4. Sem cotação de fora quando não há o que cotar (lista VAZIA honesta).
    if (itensDoCarrinho.length === 0 || !Array.isArray(cart)) {
        return await respostaSemCotacaoDeFora(supabaseClient, null, revisaoConfig)
    }
    const provedorDoLog = storeConfig.shipping_provider || 'flat_fee'
    if (!lidas.ok) {
        console.warn('[calculate-shipping] Credenciais indisponíveis:', lidas.erro?.code ?? 'sem código')
        return await respostaSemCotacaoDeFora(supabaseClient, {
            originCep,
            destinationCep: cleanCep,
            provider: provedorDoLog,
            cart,
            motivo: 'Não foi possível ler as credenciais das transportadoras agora. A cotação de fora da cidade não foi feita.',
        }, revisaoConfig)
    }
    // Revisão ilegível: o caminho nacional falha FECHADO (R3-2) — sem saber a
    // revisão, a opção não pode ser carimbada nem conferida pela RPC.
    if (!revisaoLida.ok) {
        await gravarHistorico(supabaseClient, {
            origin_cep: originCep,
            destination_cep: cleanCep,
            provider: provedorDoLog,
            cart_items: cart,
            response_time_ms: 0,
            status: 'error',
            error_message: 'Não foi possível ler a revisão da configuração do frete; a cotação de fora da cidade não foi feita.',
        })
        return respostaJson({ error: 'Não foi possível calcular o frete agora. Tente novamente em instantes.' }, 503)
    }

    const conjunto = conjuntoLigado(storeConfig, lidas.linhas)
    if (conjunto.pedidos.length === 0) {
        return await respostaSemCotacaoDeFora(supabaseClient, {
            originCep,
            destinationCep: cleanCep,
            provider: provedorDoLog,
            cart,
            motivo: conjunto.modo === 'multi'
                ? 'Nenhuma transportadora ligada para entregas fora da cidade. Ligue ao menos uma em Ajustes > Transportadoras.'
                : 'Loja sem transportadora conectada para entregas fora da cidade (o frete de taxa fixa foi descontinuado). Conecte Melhor Envio, Frenet ou SuperFrete para cotar o frete nacional.',
        }, revisaoConfig)
    }
    const ligados = conjunto.modo === 'legado'
        ? conjunto.ligados.filter((p) => lidas.linhas.has(p))
        : conjunto.ligados
    if (ligados.length === 0) {
        const provider = conjunto.pedidos.join(', ')
        return await respostaSemCotacaoDeFora(supabaseClient, {
            originCep,
            destinationCep: cleanCep,
            provider,
            cart,
            motivo: conjunto.modo === 'multi'
                ? 'As transportadoras ligadas estão sem chave de acesso. Salve a chave em Ajustes > Transportadoras.'
                : `Sem credencial cadastrada para o provedor "${provider}". Conecte a transportadora para cotar entregas fora da cidade.`,
        }, revisaoConfig)
    }
    const credenciaisDe = (p: string) => lidas.linhas.get(p)?.credentials ?? {}
    // Redigidos de todo texto de terceiro: o token de cada ligado e o e-mail
    // de contato da SF (a API pode ecoar os dois).
    const segredos = ligados.flatMap((p) => [tokenDe(credenciaisDe(p)), credenciaisDe(p)?.contact_email])
    const provedorNoHistorico = ligados.join(', ')

    const insumos = montarInsumos(itensDoCarrinho, dbProductsMap, variantesMap)
    const assinatura = await assinaturaDaCotacao(revisaoConfig as string, insumos.itens)
    const baseDoLog = {
        modo: conjunto.modo,
        chaves: chavesDeServico,
        contrato: pedido.contratoCliente,
        produtosSemCadastro: insumos.produtosSemCadastro,
        camposPadrao: insumos.camposPadrao,
    }

    // ── CACHE (leitura tolerante a duplicata: a mais nova) ──
    const cartHash = getCartHash(cart)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
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

    // Acerto só com a assinatura ATUAL e nenhuma opção parcial (§3 + R1-1).
    if (cachedQuote && !cacheQueryError && cotacaoDoCacheServe(cachedQuote.options, assinatura)) {
        console.log('[calculate-shipping] Caching hit')
        for (const p of ligados) {
            console.log(JSON.stringify(linhaDoLogDaCotacao({
                ...baseDoLog,
                provider: p,
                credenciais: credenciaisDe(p),
                resultado: null,
                falha: null,
                opcoesFinais: cachedQuote.options,
                cache: 'hit',
            })))
        }
        fireAndForget(
            supabaseClient.from('shipping_calculation_logs').insert({
                origin_cep: originCep,
                destination_cep: cleanCep,
                provider: `${provedorNoHistorico} (Cache)`,
                cart_items: cart,
                response_time_ms: 0,
                status: 'success',
            }),
            'Failed to log cache hit:',
        )
        return respostaJson({ options: cachedQuote.options, cotacaoIncompleta: false, cotacaoParcial: false, revisaoConfig })
    }

    // 5. Os ligados em PARALELO, cada um isolado, sem retry (A2).
    const apiStartTime = performance.now()
    const entrada = { originCep, destinationCep: cleanCep, itens: insumos.itens, chaves: chavesDeServico }
    // Defesa (revisão Opus, 1.5.7), SÓ no multi: ligado com a credencial em
    // Sandbox (gravada por fora, ex.: painel 1.5.6) não cota para cliente —
    // é a falha DAQUELE provedor e os outros seguem. O legado fica como na 1.5.6.
    const liquidados = await Promise.allSettled(
        ligados.map((p) => conjunto.modo === 'multi' && credenciaisDe(p)?.sandbox === true
            ? Promise.reject(new FalhaDoProvedor('sandbox', `${ROTULO_DO_PROVEDOR.get(p) ?? p}: credencial em modo de testes (Sandbox) não cota para clientes`))
            : cotarPeloProvedor(p, credenciaisDe(p), entrada, servicosSalvos(p, credenciaisDe(p)))),
    )
    const latency = Math.round(performance.now() - apiStartTime)

    const resultados: Array<{ p: string; resultado: ResultadoDoProvedor | null; falha: FalhaDoProvedor | null }> = liquidados.map((l, i) => {
        // `allSettled` devolve na MESMA ordem de `ligados`.
        const p = ligados.at(i) as string
        if (l.status === 'fulfilled') return { p, resultado: l.value, falha: null }
        const erro = l.reason
        const falha = erro instanceof FalhaDoProvedor
            ? erro
            : new FalhaDoProvedor('indisponivel', String((erro as Error)?.message ?? erro))
        return { p, resultado: null, falha }
    })
    const falhas = resultados.filter((r) => r.falha)
    const responderam = resultados.filter((r) => r.resultado)
    const cotacaoParcial = falhas.length > 0 && responderam.length > 0

    let shippingOptions: any[] = responderam.flatMap((r) => (r.resultado as ResultadoDoProvedor).opcoes).map((opcao) => ({
        ...opcao,
        revisaoCredenciais: revisaoLida.revisao,
        assinaturaCotacao: assinatura,
        ...(cotacaoParcial ? { cotacaoParcial: true } : {}),
    }))

    // Mensagem de cada falha, redigida (todos os tokens ligados) e cortada.
    const mensagens = falhas.map((r) => {
        const texto = textoSemSegredo((r.falha as FalhaDoProvedor).message, segredos)
        console.error('[calculate-shipping] API quotation failed for %s:', r.p, texto)
        return ligados.length === 1 ? texto : `${r.p}: ${texto}`
    })
    const apiError = mensagens.length > 0 ? mensagens.join(' | ') : null

    for (const r of resultados) {
        console.log(JSON.stringify(linhaDoLogDaCotacao({
            ...baseDoLog,
            provider: r.p,
            credenciais: credenciaisDe(r.p),
            resultado: r.resultado,
            falha: r.falha,
            opcoesFinais: shippingOptions,
            cache: 'miss',
        })))
    }

    // Nenhuma opção real: falha fechado (503), com o motivo no histórico.
    if (shippingOptions.length === 0) {
        await gravarHistorico(supabaseClient, {
            origin_cep: originCep,
            destination_cep: cleanCep,
            provider: provedorNoHistorico,
            cart_items: cart,
            response_time_ms: latency,
            status: 'error',
            error_message: apiError || 'Nenhum método de envio retornado.',
        })
        if (responderam.length === 0 && falhas.some((r) => r.falha?.motivo === 'cep_invalido')) {
            return respostaJson({ error: 'CEP não encontrado. Confira o número e tente de novo.', codigo: 'cep_invalido' }, 400)
        }
        return respostaJson({ error: 'Não foi possível calcular o frete agora. Tente novamente em instantes.' }, 503)
    }

    // 6. A revisão mudou enquanto cotava? (R3-2)
    const releitura = await lerRevisao(supabaseClient)
    if (!releitura.ok || releitura.revisao !== revisaoLida.revisao) {
        if (!ultimaTentativa) {
            console.warn(JSON.stringify({ evento: 'configuracao_mudou_durante_cotacao', acao: 'recotar' }))
            return RECOTAR
        }
        console.error(JSON.stringify({ evento: 'configuracao_mudou_durante_cotacao', acao: 'recusar' }))
        await gravarHistorico(supabaseClient, {
            origin_cep: originCep,
            destination_cep: cleanCep,
            provider: provedorNoHistorico,
            cart_items: cart,
            response_time_ms: latency,
            status: 'error',
            error_message: 'configuracao_mudou_durante_cotacao: a configuração do frete mudou duas vezes durante a cotação; nada foi gravado.',
        })
        return respostaJson({ error: 'Não foi possível registrar a cotação de frete. Tente calcular novamente.', cotacaoIncompleta: true }, 503)
    }

    // 6-bis. Estratégia NACIONAL: aplicada UMA vez aqui, sobre as opções que
    // vão para o cache (todas nacionais — local e retirada já retornaram
    // antes). SÓ quando a leitura tolerante teve sucesso E o subtotal é
    // confiável (nenhum item do carrinho ficou "sem cadastro" — decisão da
    // hub, 23/09: subtotal incompleto nunca decide um grátis/desconto em
    // silêncio). Sem isso, o preço fica CHEIO e SEM carimbo — o
    // "comportamento de hoje" que a RPC (e qualquer edge velha na janela de
    // publicação) trata como espelho legado.
    if (leituraNacional.ok && insumos.produtosSemCadastro === 0) {
        const subtotal = subtotalDoCarrinho(itensDoCarrinho, dbProductsMap, variantesMap)
        shippingOptions = aplicarEstrategiaNacional(shippingOptions, estrategiaNacionalAtual, subtotal)
    }

    // 7. Grava o cache — AGUARDANDO (a RPC do pedido exige esta linha).
    let cotacaoIncompleta = false
    const erroDeGravacao = await salvarCotacaoNoCache(supabaseClient, {
        originCep,
        destinationCep: cleanCep,
        cartHash,
        options: shippingOptions,
    })
    const logEmVoo = gravarHistorico(supabaseClient, {
        origin_cep: originCep,
        destination_cep: cleanCep,
        provider: provedorNoHistorico,
        cart_items: cart,
        response_time_ms: latency,
        status: erroDeGravacao ? 'error' : 'success',
        error_message: erroDeGravacao
            ? `Falha ao gravar a cotação: ${textoSemSegredo(mensagemDoErro(erroDeGravacao), segredos)}`
            : (apiError ? `Cotação parcial: ${apiError}` : null),
    })

    if (erroDeGravacao) {
        // Sem a linha gravada, cai o que a RPC buscaria no cache; fica só o
        // que ela resolve pela `store_config` (`precoResolvidoSemCache`).
        const opcoesQueDispensamOCache = shippingOptions.filter((opt) => precoResolvidoSemCache(opt?.id))
        if (opcoesQueDispensamOCache.length === 0) {
            await logEmVoo
            return respostaJson({ error: 'Não foi possível registrar a cotação de frete. Tente calcular novamente.' }, 503)
        }
        cotacaoIncompleta = opcoesQueDispensamOCache.length < shippingOptions.length
        shippingOptions = opcoesQueDispensamOCache
    }

    return respostaJson({ options: shippingOptions, cotacaoIncompleta, cotacaoParcial, revisaoConfig })
}

// `(req) => handler(req)`, e não `serve(handler)` direto: o `serve` do std
// passa um segundo argumento (ConnInfo) que cairia em `deps`.
if (!isTesting) serve((req: Request) => handler(req));
