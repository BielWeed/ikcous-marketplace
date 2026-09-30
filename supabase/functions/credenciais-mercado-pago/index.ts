// ============================================================================
// Edge function credenciais-mercado-pago — peça 20 (14/09/2026).
//
// O LOJISTA CADASTRA AS CHAVES DELE do Mercado Pago na tela de Ajustes
// (grupo "Pagamentos", seção "Mercado Pago") sem depender de ninguém de
// fora: esta function GUARDA, ESCONDE e TESTA as chaves que ele colar.
//
// A FICHA DA LOJA (tarefa mp-3, 15/09/2026) — por que esta function mexe em
// store_config: o checkout do cliente só mostra PIX quando a ficha pública
// da loja (lida de v_store_config pelo porteiro, ver
// src/config/configuracaoDaLoja.ts) traz `pagamento_online = true` E
// `mp_public_key` preenchida. Chave cadastrada aqui sem essas duas colunas é
// tela dizendo "salvo" e cliente sem forma de pagar. Essas colunas só aceitam
// escrita com o claim service_role (trigger
// dominio_publico_so_muda_pela_frota, migrations 20261140000000 e
// 20261150000000) — e esta function é exatamente quem tem esse claim e já
// está trancada por admin. Por isso:
//   * `salvar` PUBLICA a Public Key na ficha (store_config.mp_public_key);
//     se a ficha recusar, o lojista OUVE isso — nunca "salvo" calado.
//   * `ligar_pix` / `desligar_pix` acendem e apagam `pagamento_online`, e
//     ligar exige teste de conexão bem-sucedido (ver a ação, abaixo).
//
// O PIX SÓ ACENDE COM A LOJA INTEIRA (tarefa mp-8, 16/09/2026):
//   * `ligar_pix` publica a Public Key no MESMO update que acende — e recusa
//     com 409 se o registro não tiver Public Key em formato válido.
//   * `salvar` com credencial NOVA (token ou Public Key) desliga o PIX no
//     mesmo update e conta isso na resposta (`pix_desligado` + `aviso`);
//     re-salvar sem trocar credencial não derruba quem está vendendo.
//   * O carimbo de auditoria do liga (pix_ligado_em/pix_ligado_por) tem
//     try/catch próprio: falhou, sai 200 com `aviso` — a verdade é a ficha,
//     e "falhou" com o PIX aceso faz o lojista ligar duas vezes.
//   * Escrita na ficha sem linha afetada é RECUSA, não sucesso (o UPDATE pede
//     `select('id')`): ficha ausente vira 500 honesto, nunca "salvo" calado.
//   * (30/09/2026) `ligar_pix` também recusa com 409 quando a loja não salvou
//     a Chave de notificações (assinatura do webhook) — o criar-pagamento
//     recusa PIX sem ela, e o interruptor aceso viraria erro no fim da
//     compra. Só a chave da PRÓPRIA loja conta (não a MP_WEBHOOK_SECRET do
//     ambiente). `desligar_pix` segue sempre permitido; `salvar` não mudou.
//
// SOBRAS DAS REVISÕES (tarefa mp-10, 16/09/2026):
//   * `salvar` escreve a FICHA antes do REGISTRO (era o contrário): se a
//     ficha recusar, a credencial anterior (a que está vendendo de verdade)
//     continua intacta, em vez de já trocada com o PIX aceso na chave velha.
//   * Ficha AUSENTE (zero linha, sem `error`) tem recado PRÓPRIO — "fale com
//     o suporte", nunca "tente de novo" (nenhum retry cria a linha sozinho).
//   * `avisos.join(" ")` normaliza cada frase para terminar em ponto antes de
//     juntar — sem isso, dois avisos grudavam sem separação de leitura.
//
// LIBERAÇÃO AUTOMÁTICA DO PAGAMENTO PELO APP (30/09/2026, pedido do dono: "a
// partir do momento que ela cola lá, webhook dela, ela já libera... tem que
// ser assim pra todo mundo"): `store_config.pagamento_online` (que cobre PIX
// E cartão pelo app) deixou de ser um interruptor que o lojista liga à mão.
//   * ALVO = as três chaves salvas (Public Key válida, Access Token e Chave
//     de notificações da PRÓPRIA loja) E o último teste de conexão passou E o
//     lojista NÃO pausou. Falta qualquer uma -> desliga sozinho. A lista do
//     que falta sai de `faltasParaReceber` (pura, ordem fixa) e viaja para a
//     tela em `faltando`; a pausa NÃO é falta, é o campo `pausado`.
//   * `salvar`: se alguma credencial mudou (Access Token novo, Public Key
//     diferente ou Chave de notificações nova), o TESTE DE CONEXÃO RODA NA
//     HORA, ANTES de escrever qualquer coisa — com o token novo em claro, ou
//     o salvo decifrado. Credencial nova só fica ligada se o teste DELA
//     passou (substitui o "credencial nova desliga" da mp-8). Erro de rede no
//     teste = `conectado: false` (não liga; a resposta manda tocar em
//     Testar). Re-salvar sem mudar nada não testa nem mexe no estado. A ordem
//     mp-10 segue: ficha (Public Key + `pagamento_online` quando muda) antes
//     do registro.
//   * `testar`: grava o resultado e RECONCILIA — liga se tudo passou e não
//     está pausado; desliga se o teste falhou. Só escreve na ficha quando o
//     estado muda. Se o invariante LOJA_SEM_FORMA_DE_PAGAMENTO recusar o
//     desligamento, o teste fica gravado, a ficha fica como estava e a
//     resposta leva `aviso` (200, nunca 500).
//   * `ler` é SÓ leitura: nunca liga nem desliga (loja que já existia com o
//     estado antigo só muda quando o lojista salva, testa ou pausa).
//   * `desligar_pix` virou PAUSAR (mesmo nome, compatibilidade): ficha
//     primeiro, e só se ela aceitar a pausa é gravada no registro
//     (`pagamento_pausado`/`pausado_em`/`pausado_por`, em app_settings — SEM
//     migration). A pausa VENCE salvar e testar. `ligar_pix` virou RETOMAR:
//     recusa com 409 (nada gravado) se faltar alguma chave; senão tira a
//     pausa e reconcilia (registro antes da ficha, para uma falha no meio
//     nunca deixar a ficha ligada com a pausa ainda de pé).
//
// DINHEIRO/CREDENCIAL — as proteções desta function:
//   * Admin-only duas vezes: verify_jwt = true no portão (config.toml) E a
//     porta interna aqui — JWT do lojista validado com anon key e papel
//     subido por profiles com service role (MESMA cópia do verifyIsAdmin
//     do estornar-pagamento/calculate-shipping).
//   * O SEGREDO NUNCA VOLTA para o navegador: desta function só sai
//     MÁSCARA ("••••1234") e o resultado do teste. Na ida, entra cifrado.
//   * CIFRAÇÃO NO SERVIDOR: AES-256-GCM (WebCrypto) com chave de 32 bytes
//     da env MP_CHAVES_ENCRYPTION_KEY (base64). A chave de cifra NUNCA
//     mora no banco: o banco (app_settings, RLS só-admin — anônimo não lê
//     nada) guarda ciphertext + iv. Sem a env, salvar e testar falham
//     FECHADOS com recado claro — nada é gravado em claro "para não
//     perder".
//   * NADA DE CHAVE EM LOG: nenhum log recebe token/chave; erros do MP
//     viram recados amigáveis, sem ecoar segredo.
//   * O TESTE DE CONEXÃO roda AQUI DENTRO (GET /users/me do MP, com o
//     fetchComTempo da casa, injetável para teste): a chave real nunca
//     chega ao navegador. O live_mode do MP vira "produção"/"teste" no
//     recado — o prefixo do token NÃO discrimina ambiente (medido na doc
//     do MP; tokens de produção e teste hoje nascem APP_USR-).
//   * app_settings é chave/valor (texto JSON) — NENHUMA migration nesta
//     peça. Public Key NÃO é segredo (é a credencial de frente do MP), e
//     por isso fica em claro no registro.
// ============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BASE_URL_PADRAO, fetchComTempo } from "../_shared/mercadopago.ts";
import {
    chaveDeCifra,
    cifrar,
    CHAVE_SETTINGS,
    decifrar,
    lerRegistroMp,
    type Registro,
    registroTemChaveDeAssinatura,
    type UltimoTeste,
} from "../_shared/credenciais-mp.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
};

/**
 * Formato RELAXADO das credenciais MP: prefixo APP_USR- (produção e teste
 * hoje) ou TEST- (teste legado) + cauda longa. Formato não prova validade —
 * só pega erro de colar pela metade; a validade é do teste de conexão.
 */
const FORMATO_CREDENCIAL = /^(APP_USR|TEST)-[A-Za-z0-9_-]{10,}$/;

// O formato do registro e o de UltimoTeste moram no módulo compartilhado
// (quem cobra precisa do MESMO formato que esta tela grava); seguem saindo
// por aqui para quem já importava desta function.
export type { Registro, UltimoTeste };

/**
 * O registro de app_settings mais o carimbo de auditoria do liga/desliga do
 * PIX. Fica AQUI, e não no módulo compartilhado, porque só esta tela liga e
 * desliga o PIX — quem cobra (criar-pagamento, webhook) não olha o carimbo.
 */
type RegistroComPix = Registro & {
    pix_ligado_em?: string | null;
    pix_ligado_por?: string | null;
    /** O lojista PAUSOU o pagamento pelo app: vence o automático até "Retomar". */
    pagamento_pausado?: boolean;
    pausado_em?: string | null;
    pausado_por?: string | null;
};

/**
 * O que ainda impede a loja de receber pelo app. A ORDEM é a da tela e a do
 * recado de `ligar_pix` (a primeira falta é a que o recado cita).
 */
export type Falta =
    | "public_key"
    | "access_token"
    | "chave_notificacoes"
    | "teste";

/**
 * Lista, em ordem fixa, o que falta para a loja receber pelo app (30/09/2026).
 * Função PURA, sem I/O: `ler`, `salvar`, `testar` e `retomar` respondem a
 * mesma pergunta pelo mesmo lugar (duas cópias divergem calado, com dinheiro
 * em cima). A pausa NÃO é falta — é decisão do lojista, campo à parte.
 *
 * "Tem chave de notificações" é a definição ÚNICA de quem cobra
 * (`registroTemChaveDeAssinatura`): só a da PRÓPRIA loja conta.
 */
export function faltasParaReceber(
    registro: RegistroComPix | null | undefined,
): Falta[] {
    const faltas: Falta[] = [];
    if (!FORMATO_CREDENCIAL.test(String(registro?.public_key ?? "").trim())) {
        faltas.push("public_key");
    }
    if (!(registro?.token_cifrado && registro?.token_iv)) {
        faltas.push("access_token");
    }
    if (!registroTemChaveDeAssinatura(registro)) {
        faltas.push("chave_notificacoes");
    }
    if (registro?.ultimo_teste?.conectado !== true) {
        faltas.push("teste");
    }
    return faltas;
}

/** O que sai para a tela — JAMAIS ciphertext nem segredo. */
export type RespostaLer = {
    configurado: boolean;
    public_key: string | null;
    mascara_token: string | null;
    mascara_webhook: string | null;
    ultimo_teste: UltimoTeste | null;
    atualizado_em: string | null;
    /** `store_config.pagamento_online` — o PIX está aceso para o cliente? */
    pix_ligado: boolean;
    /** A ficha da loja já carrega ESTA Public Key (e não outra, nem nenhuma). */
    public_key_na_loja: boolean;
    /** O que ainda falta para receber pelo app (vazio = tudo pronto). */
    faltando: Falta[];
    /** O lojista pausou o pagamento pelo app (vence o automático). */
    pausado: boolean;
};

/** A parte da ficha pública da loja que esta tela precisa enxergar. */
type FichaDaLoja = {
    pagamento_online: boolean;
    mp_public_key: string | null;
};

const json = (corpo: unknown, status: number): Response =>
    new Response(JSON.stringify(corpo), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

/**
 * O projeto está migrando das chaves legadas para as novas
 * (publishable/secret). MESMA cópia do estornar-pagamento: lê a nova e
 * cai para a legada.
 */
function readKey(newVar: string, legacyVar: string): string {
    try {
        const parsed = JSON.parse(Deno.env.get(newVar) ?? "{}");
        if (parsed?.default) return parsed.default;
    } catch {
        // variável ausente ou JSON inválido — segue para o fallback
    }
    return Deno.env.get(legacyVar) ?? "";
}

/**
 * Verifica se quem chamou é admin e devolve o UID dele (null = não é
 * admin). MESMA cópia do padrão estornar-pagamento/melhor-envio-etiqueta —
 * valida o JWT com a anon key e sobe o papel de `profiles` com service role;
 * a única diferença é devolver o uid em vez de um booleano, porque ligar o
 * PIX é ato de dinheiro e fica carimbado com QUEM ligou (`pix_ligado_por`).
 */
async function uidDoAdmin(
    authHeader: string | null,
    supabaseUrl: string,
    serviceRoleKey: string,
): Promise<string | null> {
    if (!authHeader) return null;
    try {
        const anonKey = readKey(
            "SUPABASE_PUBLISHABLE_KEYS",
            "SUPABASE_ANON_KEY",
        );
        const userClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } },
        });
        const {
            data: { user },
            error: userError,
        } = await userClient.auth.getUser();
        if (userError || !user) return null;
        const systemClient = createClient(supabaseUrl, serviceRoleKey);
        const { data: profile, error: profileError } = await systemClient
            .from("profiles")
            .select("role")
            .eq("id", user.id)
            .single();
        if (profileError || !profile) return null;
        return profile.role === "admin" ? user.id : null;
    } catch (err) {
        console.error("[credenciais-mp] Falha no check de admin:", err);
        return null;
    }
}

// As primitivas de cifra (chaveDeCifra/cifrar/decifrar, AES-256-GCM do
// WebCrypto) saíram daqui para ../_shared/credenciais-mp.ts na tarefa mp-1:
// quem GRAVA o segredo (esta tela) e quem o LÊ na hora de cobrar
// (criar-pagamento, webhook, reconciliar, estornar) têm de usar exatamente a
// mesma cifra — duas cópias divergem calado e o dinheiro para de entrar.

/** Só o rabo da chave — o suficiente para o lojista reconhecer qual colou. */
function mascaraDe(segredo: string): string {
    return `••••${segredo.slice(-4)}`;
}

/**
 * Garante que a frase termine em pontuação (mp-10): `avisos.join(" ")`
 * gruda a frase seguinte sem espaço de leitura quando a anterior não
 * termina em ponto — "...de verdadeO PIX está ligado..." em vez de duas
 * frases. Idempotente: frase que já termina em `.`/`!`/`?` sai igual.
 */
function comPontoFinal(frase: string): string {
    const limpa = frase.trim();
    return /[.!?]$/.test(limpa) ? limpa : `${limpa}.`;
}

// ── app_settings (via supabase client injetável) ─────────────────────────

async function gravarRegistro(supabase: any, registro: Registro): Promise<void> {
    const { error } = await supabase
        .from("app_settings")
        .upsert(
            {
                key: CHAVE_SETTINGS,
                value: JSON.stringify(registro),
                updated_at: new Date().toISOString(),
            },
            { onConflict: "key" },
        );
    if (error) throw new Error(`storage_escrita: ${error.message}`);
}

// ── store_config: a ficha que o checkout do cliente lê (linha única id = 1) ─

/** Lê a ficha da loja. Erro de banco vira `storage_` — o catch traduz. */
async function lerFichaDaLoja(supabase: any): Promise<FichaDaLoja> {
    const { data, error } = await supabase
        .from("store_config")
        .select("pagamento_online, mp_public_key")
        .eq("id", 1)
        .maybeSingle();
    if (error) throw new Error(`storage_leitura_loja: ${error.message}`);
    return {
        pagamento_online: data?.pagamento_online === true,
        mp_public_key: data?.mp_public_key ?? null,
    };
}

/**
 * Escreve na ficha da loja. Devolve a mensagem da recusa (ou null quando deu
 * certo) em vez de estourar: quem chama precisa dizer ao lojista O QUE ficou
 * pela metade — "não consegui ligar o PIX" é recado diferente de "a ficha
 * nem existe, chame o suporte" (`mensagemDeRecusaDaFicha`, abaixo), e o
 * genérico do catch confundiria os dois.
 *
 * O `.select("id")` não é enfeite (mp-8): sem ele, UPDATE que não achou a
 * linha id = 1 volta SEM error e com zero linha afetada — ficha inexistente
 * (banco novo) ou RLS/trigger recusando calado passariam por "publicado", e a
 * tela diria "salvo" com o cliente sem PIX. Zero linha é recusa.
 */
/**
 * Zero linha afetada SEM `error` (mp-10): o comentário desta function já
 * explicava a causa real — banco novo sem a linha `id = 1` (RLS/trigger
 * recusando calado devolve `error`, tratado acima). É esse texto exato que
 * `mensagemDeRecusaDaFicha` reconhece para trocar "tente de novo" (promessa
 * vazia — tentar de novo não cria a linha) por "fale com o suporte".
 */
const FICHA_NAO_EXISTE = "a ficha da loja (store_config id=1) não existe";

/**
 * `error.message` EXATO que a trigger `store_config_exige_forma_de_pagamento`
 * (migration 20261174000000) devolve quando um UPDATE deixaria a loja sem
 * NENHUMA forma de pagamento (nem na entrega, nem pelo app) — RAISE
 * EXCEPTION sem texto em português: a trigger é fonte única do INVARIANTE,
 * a tradução amigável mora aqui (mesmo desenho da FICHA_NAO_EXISTE acima).
 * `escreverNaFichaDaLoja` só devolve `error.message` (nunca `error.code`),
 * então o código tem de viajar como o próprio texto da mensagem — ver o
 * comentário da migration (achado A8 do crítico de desenho, 25/09/2026).
 */
const LOJA_SEM_FORMA_DE_PAGAMENTO = "LOJA_SEM_FORMA_DE_PAGAMENTO";

async function escreverNaFichaDaLoja(
    supabase: any,
    campos: Partial<FichaDaLoja>,
): Promise<string | null> {
    const { data, error } = await supabase
        .from("store_config")
        .update(campos)
        .eq("id", 1)
        .select("id");
    if (error) return String(error.message ?? "recusado");
    if (!Array.isArray(data) || data.length === 0) {
        return FICHA_NAO_EXISTE;
    }
    return null;
}

/**
 * Traduz a recusa da ficha para o recado do lojista (mp-10). Ficha AUSENTE
 * é caso de suporte (nenhum retry cria a linha `id = 1` sozinho — prometer
 * "tente de novo" é mentira). A recusa do invariante de forma de pagamento
 * (LOJA_SEM_FORMA_DE_PAGAMENTO) usa o recado ESPECÍFICO de quem chamou —
 * desligar o PIX e trocar as chaves do MP explicam o mesmo invariante com
 * palavras diferentes (25/09/2026, achado B2 do crítico de desenho); sem
 * `mensagemSemFormaDePagamento`, cai no `mensagemPadrao` de quem chamou (não
 * quebra chamador nenhum que ainda não previu este caso). Qualquer outra
 * recusa (RLS/trigger desconhecida) também usa o recado padrão de quem
 * chamou, que já sabe o que ficou pela metade.
 */
function mensagemDeRecusaDaFicha(
    recusa: string,
    mensagemPadrao: string,
    mensagemSemFormaDePagamento?: string,
): string {
    if (recusa === FICHA_NAO_EXISTE) {
        return "A ficha da loja (store_config id=1) não existe. Isto não se resolve tentando de novo — fale com o suporte.";
    }
    if (recusa === LOJA_SEM_FORMA_DE_PAGAMENTO && mensagemSemFormaDePagamento) {
        return mensagemSemFormaDePagamento;
    }
    return mensagemPadrao;
}

/**
 * A Public Key da ficha só "confere" quando existe dos DOIS lados e é a
 * mesma: ficha vazia, ou ficha com a chave de outra loja, é exatamente o
 * caso em que o cliente não vê PIX — a tela precisa poder contar isso.
 */
function publicKeyNaLoja(
    registro: RegistroComPix | null,
    ficha: FichaDaLoja,
): boolean {
    return Boolean(registro?.public_key) &&
        ficha.mp_public_key === registro?.public_key;
}

function respostaLer(
    registro: RegistroComPix | null,
    ficha: FichaDaLoja,
): RespostaLer {
    const faltando = faltasParaReceber(registro);
    const pausado = registro?.pagamento_pausado === true;
    const public_key_na_loja = publicKeyNaLoja(registro, ficha);
    if (!registro) {
        return {
            configurado: false,
            public_key: null,
            mascara_token: null,
            mascara_webhook: null,
            ultimo_teste: null,
            atualizado_em: null,
            pix_ligado: ficha.pagamento_online,
            public_key_na_loja,
            faltando,
            pausado,
        };
    }
    return {
        configurado: Boolean(registro.token_cifrado),
        public_key: registro.public_key,
        mascara_token: registro.mascara_token,
        mascara_webhook: registro.mascara_webhook,
        ultimo_teste: registro.ultimo_teste,
        atualizado_em: registro.atualizado_em,
        pix_ligado: ficha.pagamento_online,
        public_key_na_loja,
        faltando,
        pausado,
    };
}

// ── O teste de conexão (usado por `testar` e pelo `salvar`) ────────────────

/** O resultado do teste + se o MP nem chegou a responder direito. */
type ResultadoDoTeste = {
    ultimoTeste: UltimoTeste;
    /**
     * O MP não respondeu como esperado (rede caiu, tempo esgotado, status
     * inesperado): tentar de novo pode resolver. Falso quando o MP RECUSOU a
     * chave (401/403) — aí repetir não adianta, a chave é que está errada.
     */
    semResposta: boolean;
};

/**
 * GET /users/me do MP com o token em claro (só existe em memória aqui dentro).
 * As mensagens são as do `testar` de sempre — o corpo saiu de lá para o
 * `salvar` reaproveitar (30/09/2026), sem duas cópias das frases. `buscar` é
 * a costura injetável de teste.
 */
async function executarTesteDeConexao(
    token: string,
    buscar: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<ResultadoDoTeste> {
    let conectado = false;
    let semResposta = false;
    let mensagem: string;
    let ambiente: "producao" | "teste" | null = null;
    let conta: string | null = null;
    try {
        const resposta = await buscar(`${BASE_URL_PADRAO}/users/me`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (resposta.status === 200) {
            const dados = await resposta.json().catch(() => ({}));
            conectado = true;
            ambiente = dados.live_mode === true
                ? "producao"
                : dados.live_mode === false
                ? "teste"
                : null;
            conta = typeof dados.nickname === "string" ? dados.nickname : null;
            // `GET /users/me` do MP (medido 25/09/2026) não devolve
            // `live_mode` — o struct oficial do SDK Go do MP para
            // esse endpoint só tem id/nickname/first_name/last_name/
            // country_id/email/site_id. Com `ambiente` null, a
            // mensagem NÃO pode afirmar "de teste" nem "de
            // produção" — dizia "de teste" até para credencial de
            // PRODUÇÃO.
            mensagem = conta
                ? ambiente === null
                    ? `Conectado! Conta "${conta}".`
                    : `Conectado! Conta "${conta}" no ambiente ${ambiente === "producao" ? "de produção" : "de teste"}.`
                : "Conectado ao Mercado Pago!";
        } else if (resposta.status === 401 || resposta.status === 403) {
            mensagem =
                "O Mercado Pago recusou a chave: o Access Token está errado, expirou ou veio incompleto. Cole a chave de novo e salve.";
        } else {
            semResposta = true;
            mensagem =
                "O Mercado Pago não respondeu como esperado agora. Tente de novo em instantes.";
        }
    } catch (err) {
        // A causa vai para os Registros da function: sem isto a tela
        // dizia "confira a internet" e o log ficava mudo, impossível
        // separar DNS, TLS, tempo esgotado ou versão publicada errada.
        // Quem não alcançou o Mercado Pago foi ESTE servidor, não o
        // navegador do lojista — a frase agora diz isso.
        const causa = err instanceof Error
            ? `${err.name}: ${err.message}`
            : String(err);
        console.error(
            "[credenciais-mp] teste de conexão: a chamada a api.mercadopago.com falhou:",
            causa,
        );
        semResposta = true;
        mensagem =
            `Não consegui falar com o Mercado Pago agora: o servidor não conseguiu chamar a API do Mercado Pago (${err instanceof Error ? err.name : "erro"}). Tente de novo em instantes; se continuar, a causa está nos registros da function credenciais-mercado-pago.`;
    }
    return {
        ultimoTeste: {
            quando: new Date().toISOString(),
            conectado,
            mensagem,
            ambiente,
            conta,
        },
        semResposta,
    };
}

// ── A liberação automática: alvo, reconciliação e recados ─────────────────

/** Como a lista de faltas aparece dentro de uma frase do servidor. */
const ROTULO_DA_FALTA: ReadonlyMap<Falta, string> = new Map<Falta, string>([
    ["public_key", "a Public Key"],
    ["access_token", "o Access Token"],
    ["chave_notificacoes", "a Chave de notificações"],
    ["teste", "o teste de conexão"],
]);

/**
 * O recado do 409 de `ligar_pix` (retomar) para a PRIMEIRA falta. As frases
 * são as de antes da liberação automática (reaproveitadas de propósito).
 */
function recadoDaFalta(falta: Falta): string {
    switch (falta) {
        case "teste":
            return "Teste a conexão com sucesso antes de ligar o PIX.";
        case "public_key":
            // O Payment Brick do checkout não sobe sem a Public Key: acender
            // o PIX sem ela é o cliente chegando no fim da compra e vendo
            // "Pagamento indisponível".
            return "Salve a Public Key do Mercado Pago antes de ligar o PIX — sem ela o cliente vê o PIX e trava no fim da compra.";
        case "access_token":
            return "Salve o Access Token do Mercado Pago antes de ligar o PIX — é a chave que processa os pagamentos.";
        case "chave_notificacoes":
            // O criar-pagamento recusa PIX (409 pixSemChaveDeAssinatura) em
            // loja sem a chave de assinatura do webhook SALVA PELA PRÓPRIA
            // LOJA; a MP_WEBHOOK_SECRET do ambiente não conta.
            return "Cole a Chave de notificações (assinatura secreta do webhook do Mercado Pago) e salve antes de ligar o PIX — sem ela o cliente escolhe PIX e o pagamento é recusado no fim da compra.";
    }
}

/**
 * O estado que a loja DEVE ter: recebendo pelo app quando não falta nada e o
 * lojista não pausou. É a única definição — salvar, testar e retomar chamam
 * esta função.
 */
function estadoDesejado(registro: RegistroComPix | null) {
    const faltas = faltasParaReceber(registro);
    const pausado = registro?.pagamento_pausado === true;
    return { faltas, pausado, alvo: faltas.length === 0 && !pausado };
}

/**
 * O que escrever na ficha para ela ficar como o alvo manda — ou `null` quando
 * já está assim (escreve SÓ quando muda). Ligar leva a Public Key JUNTO, no
 * mesmo update (a ficha nunca fica meio ligada), e uma ficha já ligada com
 * outra Public Key (ou nenhuma) também conta como "mudou": é exatamente o
 * caso em que o cliente não vê PIX.
 */
function camposDaFicha(
    alvo: boolean,
    registro: RegistroComPix,
    ficha: FichaDaLoja,
): Partial<FichaDaLoja> | null {
    if (alvo) {
        const publicKey = String(registro.public_key ?? "").trim();
        if (ficha.pagamento_online && ficha.mp_public_key === publicKey) {
            return null;
        }
        return { pagamento_online: true, mp_public_key: publicKey };
    }
    return ficha.pagamento_online ? { pagamento_online: false } : null;
}

/** Por que o pagamento pelo app está (ou ficou) desligado, em uma frase. */
function motivoDoDesligamento(faltas: Falta[], pausado: boolean): string {
    if (pausado) return "ele está pausado";
    if (faltas.includes("teste")) return "o teste de conexão não passou";
    return `falta ${faltas.map((f) => ROTULO_DA_FALTA.get(f) ?? f).join(", ")}`;
}

/** Resultado de `reconciliarFicha`. */
type Reconciliacao = {
    /** A ficha DEPOIS (a mesma de antes quando nada mudou ou a escrita recusou). */
    ficha: FichaDaLoja;
    ligouAgora: boolean;
    desligouAgora: boolean;
    /** A mensagem da recusa da ficha, ou null. */
    recusa: string | null;
};

/**
 * Compara a ficha com o alvo do registro e escreve SÓ quando muda. Recusa da
 * ficha não estoura: quem chama decide o recado (o `testar` já gravou o
 * teste e não pode dar 500 por causa disso).
 */
async function reconciliarFicha(
    supabase: any,
    registro: RegistroComPix,
): Promise<Reconciliacao> {
    const fichaAntes = await lerFichaDaLoja(supabase);
    const { alvo } = estadoDesejado(registro);
    const campos = camposDaFicha(alvo, registro, fichaAntes);
    if (!campos) {
        return {
            ficha: fichaAntes,
            ligouAgora: false,
            desligouAgora: false,
            recusa: null,
        };
    }
    const recusa = await escreverNaFichaDaLoja(supabase, campos);
    if (recusa) {
        return {
            ficha: fichaAntes,
            ligouAgora: false,
            desligouAgora: false,
            recusa,
        };
    }
    return {
        ficha: { ...fichaAntes, ...campos },
        ligouAgora: alvo && !fichaAntes.pagamento_online,
        desligouAgora: !alvo && fichaAntes.pagamento_online,
        recusa: null,
    };
}

/**
 * Carimbo de auditoria de QUEM ligou (`pix_ligado_em/por`), DEPOIS de a ficha
 * já ter ligado: o que vale para o cliente é a ficha, e carimbar antes
 * deixaria auditoria de um "ligou" que não ligou. Try/catch PRÓPRIO (mp-8):
 * a falha do carimbo vira `aviso`, nunca 500 com o pagamento aceso — o lojista
 * tentaria de novo achando que está desligado. Devolve o registro que ficou
 * gravado (para o chamador seguir com a versão certa).
 */
async function carimbarLigacao(
    supabase: any,
    registro: RegistroComPix,
    uidAdmin: string,
    avisos: string[],
): Promise<RegistroComPix> {
    const agora = new Date().toISOString();
    const carimbado: RegistroComPix = {
        ...registro,
        pix_ligado_em: agora,
        pix_ligado_por: uidAdmin,
        atualizado_em: agora,
    };
    try {
        await gravarRegistro(supabase, carimbado);
        return carimbado;
    } catch (err) {
        console.error(
            "[credenciais-mp] PIX ligado, mas o carimbo de auditoria falhou:",
            err instanceof Error ? err.message : err,
        );
        avisos.push(
            "O PIX está ligado, mas não consegui registrar quem ligou; tente salvar de novo mais tarde.",
        );
        return registro;
    }
}

/** Chave de sandbox conecta igualzinho à de produção — quem não for avisado vai achar que vendeu. */
const AVISO_CHAVE_DE_TESTE =
    "Chave de TESTE: o PIX não vai receber dinheiro de verdade";

/** Junta os avisos numa frase só (cada um terminando em ponto — mp-10). */
function juntarAvisos(avisos: string[]): { aviso?: string } {
    return avisos.length ? { aviso: avisos.map(comPontoFinal).join(" ") } : {};
}

/**
 * Costura de teste (padrão da casa): client do Supabase e chamada ao MP
 * injetáveis. Em produção nada muda.
 */
export type CredenciaisDeps = {
    supabase?: any;
    buscar?: (url: string, init?: RequestInit) => Promise<Response>;
};

export async function handler(
    req: Request,
    deps: CredenciaisDeps = {},
): Promise<Response> {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
        return json(
            { erro: "Use POST com { acao: ler | salvar | testar | ligar_pix | desligar_pix }." },
            405,
        );
    }

    let body: {
        acao?: unknown;
        public_key?: unknown;
        access_token?: unknown;
        webhook_secret?: unknown;
    };
    try {
        body = await req.json();
    } catch {
        return json({ erro: "Corpo inválido: esperado JSON." }, 400);
    }

    // Porta de admin ANTES de qualquer leitura/escrita — dinheiro.
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = readKey(
        "SUPABASE_SECRET_KEYS",
        "SUPABASE_SERVICE_ROLE_KEY",
    );
    const uidAdmin = await uidDoAdmin(
        req.headers.get("Authorization"),
        supabaseUrl,
        serviceRoleKey,
    );
    if (!uidAdmin) {
        return json(
            { erro: "Não autorizado: só o dono da loja mexe nas chaves de pagamento." },
            401,
        );
    }

    const supabase = deps.supabase ?? createClient(supabaseUrl, serviceRoleKey);
    // fetchComTempo (shared/mercadopago.ts) tem assinatura (fetchFn, url,
    // init, tempoMs) — o PRIMEIRO parâmetro é o próprio fetch. Usá-lo cru aqui
    // (peça 27) fazia a URL string ocupar o lugar do fetch e todo `testar`
    // morria em TypeError dentro dele, caindo no catch de rede — o lojista
    // via "sem internet" SEMPRE, mesmo com chave boa e internet boa. A seta
    // adapta a assinatura: quem chega aqui é (url, init), como o dublê dos
    // testes e o resto da casa usam.
    const buscar = deps.buscar ??
        ((url: string, init?: RequestInit) => fetchComTempo(fetch, url, init));

    try {
        // ── ler: o que a tela mostra — só máscaras, último teste e o que falta.
        // SÓ leitura: nunca liga nem desliga nada (loja que já existia com o
        // estado antigo só muda quando o lojista salva, testa ou pausa).
        if (body.acao === "ler") {
            const registro = await lerRegistroMp(
                supabase,
            ) as RegistroComPix | null;
            const ficha = await lerFichaDaLoja(supabase);
            return json(respostaLer(registro, ficha), 200);
        }

        // ── salvar: valida, testa NA HORA se a credencial mudou, cifra e grava;
        // segredo vazio = mantém o salvo ────────────────────────────────────
        if (body.acao === "salvar") {
            const publicKey = String(body.public_key ?? "").trim();
            const accessToken = String(body.access_token ?? "").trim();
            const webhookSecret = String(body.webhook_secret ?? "").trim();

            if (!publicKey) {
                return json({ erro: "Cole a Public Key do Mercado Pago." }, 400);
            }
            if (!FORMATO_CREDENCIAL.test(publicKey)) {
                return json(
                    { erro: "A Public Key do Mercado Pago começa com APP_USR- ou TEST-. Confira se copiou a chave inteira." },
                    400,
                );
            }
            if (accessToken && !FORMATO_CREDENCIAL.test(accessToken)) {
                return json(
                    { erro: "O Access Token começa com APP_USR- ou TEST-. Confira se copiou a chave inteira." },
                    400,
                );
            }
            if (webhookSecret && webhookSecret.length < 8) {
                return json(
                    { erro: "A chave de notificações parece curta demais. Confira se copiou inteira." },
                    400,
                );
            }

            const registroAntigo = await lerRegistroMp(
                supabase,
            ) as RegistroComPix | null;
            if (!accessToken && !registroAntigo?.token_cifrado) {
                return json(
                    { erro: "Cole também o Access Token — é a chave que processa os pagamentos." },
                    400,
                );
            }

            const chave = await chaveDeCifra();
            if (!chave) {
                return json(
                    { erro: "O cofre de chaves desta loja ainda não está configurado. Fale com o suporte." },
                    503,
                );
            }

            // O que conta como "credencial mudou": Access Token novo, Public
            // Key diferente (chave de outra conta publicada na ficha é Payment
            // Brick de uma conta cobrando pela outra — mp-8; sem registro
            // anterior, é troca) ou Chave de notificações nova. Só nesse caso
            // o teste de conexão roda aqui dentro; re-salvar sem mudar nada
            // não chama o MP nem mexe no estado.
            const trocouToken = Boolean(accessToken);
            const trocouPublicKey = registroAntigo?.public_key !== publicKey;
            const trocouChaveDeNotificacoes = Boolean(webhookSecret);
            const credencialMudou = trocouToken || trocouPublicKey ||
                trocouChaveDeNotificacoes;
            const agora = new Date().toISOString();

            // O TESTE VEM ANTES DE QUALQUER ESCRITA (30/09/2026): o resultado
            // decide se o pagamento pelo app fica ligado com a credencial
            // nova. Token novo em claro se veio; senão o salvo, decifrado.
            let ultimoTeste: UltimoTeste | null = registroAntigo?.ultimo_teste ??
                null;
            let testeSemResposta = false;
            if (credencialMudou) {
                let tokenDoTeste: string | null = accessToken || null;
                if (tokenDoTeste === null) {
                    try {
                        // `!`: sem token no corpo, o 400 acima já garantiu
                        // que o registro antigo tem token cifrado.
                        tokenDoTeste = await decifrar(
                            registroAntigo!.token_cifrado,
                            registroAntigo!.token_iv,
                            chave,
                        );
                    } catch {
                        tokenDoTeste = null;
                    }
                }
                if (tokenDoTeste === null) {
                    // Token salvo ilegível: o teste falha (nunca 500) e o
                    // recado é o mesmo do `testar`.
                    ultimoTeste = {
                        quando: agora,
                        conectado: false,
                        mensagem:
                            "Não consegui ler a chave salva. Cole e salve as chaves de novo.",
                        ambiente: null,
                        conta: null,
                    };
                } else {
                    const resultado = await executarTesteDeConexao(
                        tokenDoTeste,
                        buscar,
                    );
                    ultimoTeste = resultado.ultimoTeste;
                    testeSemResposta = resultado.semResposta;
                }
            }

            const novoToken = accessToken
                ? await cifrar(accessToken, chave)
                : null;
            const novoWebhook = webhookSecret
                ? await cifrar(webhookSecret, chave)
                : null;

            // RegistroComPix (e não Registro): o carimbo do liga/desliga e a
            // PAUSA viajam junto com o que é gravado em app_settings.
            const registro: RegistroComPix = {
                public_key: publicKey,
                token_cifrado: novoToken?.cifrado ??
                    registroAntigo?.token_cifrado ?? "",
                token_iv: novoToken?.iv ?? registroAntigo?.token_iv ?? "",
                mascara_token: accessToken
                    ? mascaraDe(accessToken)
                    : registroAntigo?.mascara_token ?? "",
                webhook_cifrado: novoWebhook?.cifrado ??
                    registroAntigo?.webhook_cifrado ?? null,
                webhook_iv: novoWebhook?.iv ??
                    registroAntigo?.webhook_iv ?? null,
                mascara_webhook: webhookSecret
                    ? mascaraDe(webhookSecret)
                    : registroAntigo?.mascara_webhook ?? null,
                // Credencial que mudou: o teste dela substitui o antigo (que
                // falava da chave anterior). Nada mudou: o teste guardado
                // continua valendo.
                ultimo_teste: ultimoTeste,
                // O carimbo de quem ligou o PIX ATRAVESSA o salvar: auditoria
                // que some porque o lojista reeditou a chave não é auditoria.
                pix_ligado_em: registroAntigo?.pix_ligado_em ?? null,
                pix_ligado_por: registroAntigo?.pix_ligado_por ?? null,
                // A PAUSA também atravessa: ela vence salvar e testar.
                pagamento_pausado: registroAntigo?.pagamento_pausado,
                pausado_em: registroAntigo?.pausado_em,
                pausado_por: registroAntigo?.pausado_por,
                atualizado_em: agora,
            };

            // O alvo sai do registro NOVO (com o teste novo). Só mexemos em
            // `pagamento_online` quando a credencial mudou E o alvo é outro
            // que a ficha de hoje: numa troca de credencial o ligado só
            // permanece se o teste DELA passou, e nos dois updates (ligar e
            // desligar) a Public Key vai NO MESMO update. Re-salvar igual
            // deixa o estado como está.
            const { faltas, alvo } = estadoDesejado(registro);
            const fichaAntes = await lerFichaDaLoja(supabase);
            const mudarPagamento = credencialMudou &&
                alvo !== fichaAntes.pagamento_online;
            if (mudarPagamento && alvo) {
                // Ligou agora: o carimbo entra no MESMO registro que é
                // gravado aqui (não há segunda escrita a falhar).
                registro.pix_ligado_em = agora;
                registro.pix_ligado_por = uidAdmin;
            }

            // A FICHA PRIMEIRO, o REGISTRO (app_settings) DEPOIS (mp-10): a
            // versão anterior gravava o registro (a credencial NOVA) antes de
            // publicar a Public Key, e esse update na ficha vinha DEPOIS. Se a
            // ficha recusasse, o 500 saía com a credencial nova já em vigor e
            // o PIX ainda aceso na ficha com a chave ANTIGA — toda tentativa
            // de PIX cairia numa credencial que ninguém testou, e "tente
            // salvar de novo" não desfazia nada. Nesta ordem, uma ficha que
            // recusa deixa a credencial anterior — a que está de fato vendendo
            // — intacta; só gravamos o registro depois de a ficha confirmar.
            //
            // A Public Key não é segredo: é a credencial de FRENTE, e o
            // checkout do cliente lê a da ficha da loja, não a daqui. Sem
            // publicar, a tela diz "salvo" e o cliente segue sem PIX.
            const recusa = await escreverNaFichaDaLoja(supabase, {
                mp_public_key: publicKey,
                ...(mudarPagamento ? { pagamento_online: alvo } : {}),
            });
            if (recusa) {
                console.error(
                    "[credenciais-mp] ficha da loja recusou a Public Key:",
                    recusa,
                );
                // B2 (revisão do desenho, 25/09/2026): a troca de credencial
                // que não passa no teste desliga o pagamento no MESMO update
                // (mp-8, acima) — numa loja com nenhuma forma "na entrega",
                // isso deixaria a loja SEM NENHUMA forma de pagamento, e a
                // trigger do invariante recusa. mp-8 NÃO relaxa: a saída é a
                // lojista ligar uma forma na entrega antes de trocar a chave
                // (ou não trocar ainda) — nunca o servidor decidir por ela.
                const semFormaDePagamento = recusa === LOJA_SEM_FORMA_DE_PAGAMENTO;
                return json(
                    {
                        erro: mensagemDeRecusaDaFicha(
                            recusa,
                            "Não consegui publicar a Public Key na ficha da loja — as chaves não foram salvas, para o pagamento pelo app não ficar com uma credencial que ninguém testou. Tente salvar de novo.",
                            "Ligue ao menos uma forma de pagamento na entrega antes de trocar as chaves do Mercado Pago.",
                        ),
                    },
                    semFormaDePagamento ? 409 : 500,
                );
            }
            try {
                await gravarRegistro(supabase, registro);
            } catch (err) {
                // A ficha JÁ gravou (linha acima) — o catch geral (fim do
                // arquivo) devolveria "não consegui gravar as chaves agora",
                // que é verdade sobre o registro e SILÊNCIO sobre o que a
                // ficha acabou de fazer; o lojista só descobriria recarregando
                // a tela (ressalva da revisão de mp-10). Sem `mudarPagamento`,
                // nada mudou na ficha além da Public Key — o catch geral já
                // diz a coisa certa.
                if (mudarPagamento && !alvo) {
                    console.error(
                        "[credenciais-mp] gravarRegistro falhou com o pagamento pelo app já desligado na ficha:",
                        err instanceof Error ? err.message : err,
                    );
                    return json(
                        {
                            erro: "Não salvei as chaves novas E desliguei o pagamento pelo app por segurança (a credencial trocou e a nova não passou no teste). Salve as chaves de novo depois de conferir o Access Token.",
                        },
                        500,
                    );
                }
                if (mudarPagamento && alvo) {
                    // A ficha LIGOU e o registro que a sustenta não gravou:
                    // pagamento aceso sem as chaves por trás (ou, na 1ª vez,
                    // sem registro nenhum — o criar-pagamento cairia nas chaves
                    // da PLATAFORMA). Desfaz o que a ficha acabou de fazer.
                    console.error(
                        "[credenciais-mp] gravarRegistro falhou com o pagamento pelo app já ligado na ficha; revertendo:",
                        err instanceof Error ? err.message : err,
                    );
                    const desfez = await escreverNaFichaDaLoja(supabase, {
                        pagamento_online: false,
                    });
                    if (desfez) {
                        console.error(
                            "[credenciais-mp] a reversão da ficha também falhou:",
                            desfez,
                        );
                        return json(
                            {
                                erro: "Não salvei as chaves novas e não consegui desligar o pagamento pelo app que tinha acabado de ligar. Confira o estado nesta tela e fale com o suporte.",
                            },
                            500,
                        );
                    }
                    return json(
                        {
                            erro: "Não salvei as chaves novas; o pagamento pelo app ficou desligado por segurança. Tente salvar de novo.",
                        },
                        500,
                    );
                }
                throw err;
            }

            const ficha = await lerFichaDaLoja(supabase);
            // Só ACRESCENTA campos (a tela de Ajustes já consome o resto):
            // desligar calado seria o lojista descobrindo pelo cliente.
            const avisos: string[] = [];
            if (credencialMudou) {
                if (!ultimoTeste?.conectado) {
                    const dica = testeSemResposta
                        ? "Toque em Testar conexão para tentar de novo."
                        : "Confira o Access Token e salve de novo.";
                    avisos.push(
                        mudarPagamento && !alvo
                            ? `Desliguei o pagamento pelo app: o teste de conexão com as chaves novas não passou. ${dica}`
                            : `Salvei as chaves, mas o pagamento pelo app não ligou: o teste de conexão não passou. ${dica}`,
                    );
                } else if (mudarPagamento && !alvo) {
                    avisos.push(
                        `Desliguei o pagamento pelo app: ${motivoDoDesligamento(faltas, false)}.`,
                    );
                }
                if (alvo && ultimoTeste?.ambiente === "teste") {
                    avisos.push(AVISO_CHAVE_DE_TESTE);
                }
            }
            return json(
                {
                    ...respostaLer(registro, ficha),
                    ...(mudarPagamento && !alvo ? { pix_desligado: true } : {}),
                    ...juntarAvisos(avisos),
                },
                200,
            );
        }

        // ── testar: fala com o MP DAQUI, com a chave decifrada no servidor ──
        // e RECONCILIA a ficha com o resultado: liga se tudo passou e o
        // lojista não pausou; desliga se o teste falhou.
        if (body.acao === "testar") {
            const registro = await lerRegistroMp(
                supabase,
            ) as RegistroComPix | null;
            if (!registro?.token_cifrado) {
                return json(
                    { erro: "Salve o Access Token antes de testar a conexão." },
                    409,
                );
            }
            const chave = await chaveDeCifra();
            if (!chave) {
                return json(
                    { erro: "O cofre de chaves desta loja ainda não está configurado. Fale com o suporte." },
                    503,
                );
            }
            let token: string;
            try {
                token = await decifrar(
                    registro.token_cifrado,
                    registro.token_iv,
                    chave,
                );
            } catch {
                return json(
                    { erro: "Não consegui ler a chave salva. Cole e salve as chaves de novo." },
                    500,
                );
            }

            const { ultimoTeste } = await executarTesteDeConexao(token, buscar);
            let registroAtual: RegistroComPix = {
                ...registro,
                ultimo_teste: ultimoTeste,
                atualizado_em: ultimoTeste.quando,
            };
            await gravarRegistro(supabase, registroAtual);

            const avisos: string[] = [];
            const { faltas, pausado } = estadoDesejado(registroAtual);
            const reconciliacao = await reconciliarFicha(supabase, registroAtual);
            if (reconciliacao.recusa) {
                // O teste JÁ está gravado; a recusa da ficha não vira 500 (o
                // lojista perderia o resultado do teste). A ficha fica como
                // estava e o recado diz o que fazer.
                console.error(
                    "[credenciais-mp] ficha da loja recusou a reconciliação depois do teste:",
                    reconciliacao.recusa,
                );
                avisos.push(
                    reconciliacao.recusa === LOJA_SEM_FORMA_DE_PAGAMENTO
                        ? "O teste de conexão não passou, mas não consegui desligar o pagamento pelo app: a loja ficaria sem nenhuma forma de pagamento. Ligue ao menos uma forma de pagamento na entrega e teste de novo"
                        : mensagemDeRecusaDaFicha(
                            reconciliacao.recusa,
                            "O teste foi feito, mas não consegui atualizar o pagamento pelo app na ficha da loja agora. Toque em Testar conexão para tentar de novo",
                        ),
                );
            } else if (reconciliacao.ligouAgora) {
                if (ultimoTeste.ambiente === "teste") {
                    avisos.push(AVISO_CHAVE_DE_TESTE);
                }
                registroAtual = await carimbarLigacao(
                    supabase,
                    registroAtual,
                    uidAdmin,
                    avisos,
                );
            } else if (reconciliacao.desligouAgora) {
                avisos.push(
                    `Desliguei o pagamento pelo app: ${motivoDoDesligamento(faltas, pausado)}.`,
                );
            }
            return json(
                {
                    conectado: ultimoTeste.conectado,
                    mensagem: ultimoTeste.mensagem,
                    ambiente: ultimoTeste.ambiente,
                    conta: ultimoTeste.conta,
                    quando: ultimoTeste.quando,
                    pix_ligado: reconciliacao.ficha.pagamento_online,
                    public_key_na_loja: publicKeyNaLoja(
                        registroAtual,
                        reconciliacao.ficha,
                    ),
                    faltando: faltas,
                    pausado,
                    ...juntarAvisos(avisos),
                },
                200,
            );
        }

        // ── ligar_pix = RETOMAR: tira a pausa e reconcilia ─────────────────
        // (nome da ação mantido por compatibilidade com quem já a chama). Só
        // retoma com a loja INTEIRA: faltando qualquer chave ou o teste, 409
        // com o recado do que falta e NADA gravado — vitrine com PIX que o
        // Mercado Pago recusa é cliente travado no fim da compra.
        if (body.acao === "ligar_pix") {
            const registro = await lerRegistroMp(
                supabase,
            ) as RegistroComPix | null;
            const faltas = faltasParaReceber(registro);
            if (!registro || faltas.length > 0) {
                return json({ erro: recadoDaFalta(faltas[0] ?? "teste") }, 409);
            }

            // REGISTRO (a pausa sai) ANTES da ficha: uma falha no meio só
            // pode deixar "completo e não pausado, com a ficha desligada" — o
            // lado seguro, que o próximo teste ou retomar conserta. Na ordem
            // inversa a ficha ficaria LIGADA com a pausa ainda de pé no
            // registro (a tela diria "Pausado" com a loja vendendo).
            let registroAtual: RegistroComPix = registro;
            if (
                registro.pagamento_pausado === true || registro.pausado_em ||
                registro.pausado_por
            ) {
                registroAtual = {
                    ...registro,
                    pagamento_pausado: false,
                    pausado_em: null,
                    pausado_por: null,
                    atualizado_em: new Date().toISOString(),
                };
                await gravarRegistro(supabase, registroAtual);
            }

            // Ligar leva a Public Key no MESMO update: a ficha nunca fica
            // meio ligada (aceso sem chave é justamente o beco sem saída do
            // checkout).
            const reconciliacao = await reconciliarFicha(supabase, registroAtual);
            if (reconciliacao.recusa) {
                console.error(
                    "[credenciais-mp] ficha da loja recusou ligar o PIX:",
                    reconciliacao.recusa,
                );
                return json(
                    {
                        erro: mensagemDeRecusaDaFicha(
                            reconciliacao.recusa,
                            "Não consegui ligar o PIX na ficha da loja agora. Tente de novo em instantes.",
                        ),
                    },
                    500,
                );
            }

            const avisos: string[] = [];
            if (registroAtual.ultimo_teste?.ambiente === "teste") {
                avisos.push(AVISO_CHAVE_DE_TESTE);
            }
            const agora = new Date().toISOString();
            if (reconciliacao.ligouAgora) {
                await carimbarLigacao(supabase, registroAtual, uidAdmin, avisos);
            }
            return json(
                {
                    pix_ligado: reconciliacao.ficha.pagamento_online,
                    public_key_na_loja: publicKeyNaLoja(
                        registroAtual,
                        reconciliacao.ficha,
                    ),
                    quando: agora,
                    pausado: false,
                    faltando: [],
                    // `comPontoFinal` (mp-10): sem ele, dois avisos juntos
                    // grudavam sem pontuação.
                    ...juntarAvisos(avisos),
                },
                200,
            );
        }

        // ── desligar_pix = PAUSAR: sempre permitido ────────────────────────
        // Desligar é o lado seguro (o cliente volta a ver só os meios de
        // pagamento manuais), então não depende de teste nem de chave salva.
        // A FICHA PRIMEIRO; só se ela aceitar a pausa é gravada no registro
        // (senão a tela diria "Pausado" com o pagamento vendendo, e a recusa
        // do invariante deixaria uma pausa que nunca aconteceu).
        if (body.acao === "desligar_pix") {
            const recusa = await escreverNaFichaDaLoja(supabase, {
                pagamento_online: false,
            });
            if (recusa) {
                console.error(
                    "[credenciais-mp] ficha da loja recusou desligar o PIX:",
                    recusa,
                );
                // Formas de pagamento por loja (25/09/2026): desligar o PIX
                // numa loja SEM nenhuma forma "na entrega" deixaria a loja
                // sem forma de pagamento nenhuma — a trigger do invariante
                // (migration 20261174000000) recusa, e o recado aqui é
                // amigável em vez do 500 genérico.
                const semFormaDePagamento = recusa === LOJA_SEM_FORMA_DE_PAGAMENTO;
                return json(
                    {
                        erro: mensagemDeRecusaDaFicha(
                            recusa,
                            "Não consegui desligar o PIX na ficha da loja agora. Tente de novo em instantes.",
                            "Ligue ao menos uma forma de pagamento na entrega antes de desligar o PIX pelo app.",
                        ),
                    },
                    semFormaDePagamento ? 409 : 500,
                );
            }
            // Sem registro (loja que vende pelas chaves da plataforma) não há
            // onde gravar a pausa — e nem o que o automático religasse.
            let registroPausado: RegistroComPix | null = null;
            try {
                const registro = await lerRegistroMp(
                    supabase,
                ) as RegistroComPix | null;
                if (registro) {
                    const agora = new Date().toISOString();
                    registroPausado = {
                        ...registro,
                        pagamento_pausado: true,
                        pausado_em: agora,
                        pausado_por: uidAdmin,
                        atualizado_em: agora,
                    };
                    await gravarRegistro(supabase, registroPausado);
                }
            } catch (err) {
                console.error(
                    "[credenciais-mp] pagamento desligado, mas a pausa não ficou registrada:",
                    err instanceof Error ? err.message : err,
                );
                return json(
                    {
                        erro: "Desliguei o pagamento pelo app, mas não consegui registrar a pausa: ele pode voltar a ligar sozinho no próximo teste. Toque em Pausar de novo.",
                    },
                    500,
                );
            }
            return json(
                {
                    pix_ligado: false,
                    pausado: registroPausado !== null,
                    faltando: faltasParaReceber(registroPausado),
                },
                200,
            );
        }

        return json(
            {
                erro:
                    "Ação desconhecida: use ler, salvar, testar, ligar_pix ou desligar_pix.",
            },
            400,
        );
    } catch (err) {
        // Nada do corpo da requisição entra aqui — só a falha estrutural.
        console.error(
            "[credenciais-mp] Falha interna:",
            err instanceof Error ? err.message : err,
        );
        const mensagem = String(
            err instanceof Error ? err.message : "",
        ).startsWith("storage_")
            ? "Não consegui gravar as chaves agora. Tente de novo em instantes."
            : "Algo saiu do previsto aqui dentro. Tente de novo em instantes.";
        return json({ erro: mensagem }, 500);
    }
}

// `(req) => handler(req)`, e não `serve(handler)` direto: o `serve` do std
// passa um segundo argumento (ConnInfo) que cairia em `deps`. Em teste não
// sobe servidor (mesmo padrão do estornar-pagamento).
const isTesting = Deno.mainModule.endsWith("_test.ts") ||
    Deno.mainModule.endsWith("_test.js") ||
    Deno.mainModule.includes("index_test");
if (!isTesting) serve((req: Request) => handler(req));
