// Testes do módulo compartilhado de credenciais do Mercado Pago —
// tarefa mp-1 (15/09/2026). Nenhuma rede, nenhum banco: o client do
// Supabase e o ambiente entram DUBLADOS (o `env` é parâmetro justamente
// para o teste poder tirar o cofre do lugar sem mexer no Deno.env do
// processo, que é global e vaza entre passos).
//
// As chaves daqui são FALSAS de mentira, legíveis de propósito — nunca a
// chave real de ninguém (mesma regra do credenciais-mercado-pago/index_test).
//
// Afirmativas nomeadas:
//   R1  registro decifrável -> origem "lojista" com o token E o segredo de
//       webhook do LOJISTA (nunca os do ambiente, que aqui estão setados)
//   R2  sem registro + env -> origem "ambiente" com MP_ACCESS_TOKEN e
//       MP_WEBHOOK_SECRET (a loja que ainda roda pelo env segue rodando)
//   R3  sem registro e sem env -> origem "ambiente" com token null e motivo
//   R4  registro + cofre ausente -> FALHA FECHADA: origem "indisponivel",
//       token null, e NÃO cai no token do ambiente (cobrar na conta errada
//       é pior que não cobrar)
//   R5  registro corrompido (ciphertext lixo) -> "indisponivel"; e nada do
//       segredo aparece no que foi para o console
//   R6  registro cifrado com OUTRA chave (cofre trocado) -> "indisponivel"
//   R7  valor ilegível em app_settings -> "indisponivel" (na dúvida sobre
//       existir chave do lojista, NÃO se usa o token do ambiente)
//   R8  falha na LEITURA do app_settings -> "indisponivel" pelo mesmo motivo
//   R9  registro sem token_cifrado (nunca chegou a configurar) -> "ambiente"
//   R10 registro do lojista SEM segredo de webhook -> origem "lojista" com
//       segredoWebhook null MESMO com MP_WEBHOOK_SECRET no ambiente (a
//       reserva do segredo é decisão de quem valida o HMAC, não daqui)
//   R11 as primitivas movidas continuam de pé: cifrar/decifrar fecham o
//       ciclo e chaveDeCifra devolve null para cofre ausente/curto/inválido
//   R12 lerRegistroMp traduz erro do banco em storage_leitura (o recado que
//       a edge credenciais-mercado-pago já mapeia para o lojista)
//   R13 client de USUÁRIO (chave anon) -> "indisponivel": a RLS de
//       app_settings esconderia a linha do lojista e o resolvedor cairia
//       calado no "ambiente" — cobrar na conta ERRADA sem nem um log
//   R14 o mesmo com a chave publicável do formato novo (sb_publishable_)
//   R15 client de service role (JWT e formato novo) resolve normalmente, e
//       client dublê sem chave nenhuma também — a trava só fecha quando dá
//       para AFIRMAR que a chave não é de service role
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
    chaveDeCifra,
    cifrar,
    decifrar,
    lerRegistroMp,
    type Registro,
    resolverCredenciaisMp,
} from "./credenciais-mp.ts";
// Os dublês moram em `credenciais-mp_fixtures.ts` (ressalva da revisão de
// mp-1): este arquivo era a origem deles e as quatro functions de pagamento
// copiavam o registro à mão. Fixture em um lugar só — e num módulo que o
// `deno test` NÃO coleta, senão estes casos rodariam dentro de cada suíte.
import {
    CHAVE_ANON_FALSA,
    CHAVE_CIFRA_TESTE,
    CHAVE_CIFRA_TESTE_OUTRA,
    CHAVE_PUBLISHABLE_NOVA_FALSA,
    CHAVE_SECRET_NOVA_FALSA,
    CHAVE_SERVICE_ROLE_FALSA,
    envDaPlataforma,
    envFalso,
    PUBLIC_KEY_LOJISTA_FALSA,
    registroMpDeTeste,
    supabaseComRegistro,
    TOKEN_AMBIENTE_FALSO,
    TOKEN_LOJISTA_FALSO,
    WEBHOOK_AMBIENTE_FALSO,
    WEBHOOK_LOJISTA_FALSO,
} from "./credenciais-mp_fixtures.ts";

/** Anota o que foi para o console — nenhum segredo pode passar por aqui. */
async function comConsoleAnotado(
    executar: () => Promise<void>,
): Promise<string> {
    const erroOriginal = console.error;
    const logOriginal = console.log;
    let anotado = "";
    const anotar = (...partes: unknown[]) => {
        anotado += partes.map((parte) => String(parte)).join(" ") + "\n";
    };
    console.error = anotar;
    console.log = anotar;
    try {
        await executar();
    } finally {
        console.error = erroOriginal;
        console.log = logOriginal;
    }
    return anotado;
}

Deno.test("credenciais-mp (módulo compartilhado)", async (t) => {
    await t.step("R1 — registro decifrável -> origem lojista", async () => {
        const registro = await registroMpDeTeste();
        const credenciais = await resolverCredenciaisMp(
            supabaseComRegistro(registro),
            envDaPlataforma(),
        );
        assertEquals(credenciais.origem, "lojista");
        assertEquals(credenciais.token, TOKEN_LOJISTA_FALSO);
        assertEquals(credenciais.segredoWebhook, WEBHOOK_LOJISTA_FALSO);
        assertEquals(credenciais.publicKey, PUBLIC_KEY_LOJISTA_FALSA);
    });

    await t.step("R2 — sem registro + env -> origem ambiente", async () => {
        const credenciais = await resolverCredenciaisMp(
            supabaseComRegistro(null),
            envDaPlataforma(),
        );
        assertEquals(credenciais.origem, "ambiente");
        assertEquals(credenciais.token, TOKEN_AMBIENTE_FALSO);
        assertEquals(credenciais.segredoWebhook, WEBHOOK_AMBIENTE_FALSO);
        assertEquals(credenciais.publicKey, null);
    });

    await t.step("R3 — sem registro e sem env -> ambiente sem token", async () => {
        const credenciais = await resolverCredenciaisMp(
            supabaseComRegistro(null),
            envFalso({}),
        );
        assertEquals(credenciais.origem, "ambiente");
        assertEquals(credenciais.token, null);
        assertEquals(credenciais.segredoWebhook, null);
        assertEquals(typeof credenciais.motivo, "string");
    });

    await t.step("R4 — registro + cofre ausente -> falha FECHADA", async () => {
        const registro = await registroMpDeTeste();
        const credenciais = await resolverCredenciaisMp(
            supabaseComRegistro(registro),
            envFalso({
                MP_ACCESS_TOKEN: TOKEN_AMBIENTE_FALSO,
                MP_WEBHOOK_SECRET: WEBHOOK_AMBIENTE_FALSO,
            }),
        );
        assertEquals(credenciais.origem, "indisponivel");
        assertEquals(credenciais.token, null);
        assertEquals(credenciais.segredoWebhook, null);
        assertEquals(credenciais.motivo, "cofre_ausente");
    });

    await t.step("R5 — registro corrompido -> indisponivel e sem vazar", async () => {
        const registro = await registroMpDeTeste();
        const corrompido: Registro = {
            ...registro,
            token_cifrado: "isto-nao-e-base64-de-verdade!!!",
        };
        let credenciais: Awaited<ReturnType<typeof resolverCredenciaisMp>> | null =
            null;
        const console_ = await comConsoleAnotado(async () => {
            credenciais = await resolverCredenciaisMp(
                supabaseComRegistro(corrompido),
                envDaPlataforma(),
            );
        });
        assertEquals(credenciais!.origem, "indisponivel");
        assertEquals(credenciais!.token, null);
        assertEquals(credenciais!.motivo, "token_ilegivel");
        // Log só com origem/motivo: nem o token do lojista nem o da
        // plataforma nem o ciphertext podem aparecer.
        assertEquals(console_.includes(TOKEN_LOJISTA_FALSO), false);
        assertEquals(console_.includes(TOKEN_AMBIENTE_FALSO), false);
        assertEquals(console_.includes(registro.token_cifrado), false);
    });

    await t.step("R6 — cofre trocado (outra chave) -> indisponivel", async () => {
        const registro = await registroMpDeTeste({
            chaveCifra: CHAVE_CIFRA_TESTE_OUTRA,
        });
        const credenciais = await resolverCredenciaisMp(
            supabaseComRegistro(registro),
            envDaPlataforma(),
        );
        assertEquals(credenciais.origem, "indisponivel");
        assertEquals(credenciais.token, null);
        assertEquals(credenciais.motivo, "token_ilegivel");
    });

    await t.step("R7 — valor ilegível em app_settings -> indisponivel", async () => {
        const credenciais = await resolverCredenciaisMp(
            supabaseComRegistro("{isto não é json}"),
            envDaPlataforma(),
        );
        assertEquals(credenciais.origem, "indisponivel");
        assertEquals(credenciais.token, null);
        assertEquals(credenciais.motivo, "registro_ilegivel");
    });

    await t.step("R8 — leitura do app_settings falhou -> indisponivel", async () => {
        const credenciais = await resolverCredenciaisMp(
            supabaseComRegistro(null, { message: "conexão caiu" }),
            envDaPlataforma(),
        );
        assertEquals(credenciais.origem, "indisponivel");
        assertEquals(credenciais.token, null);
        assertEquals(credenciais.motivo, "registro_ilegivel");
    });

    await t.step("R9 — registro sem token_cifrado -> ambiente", async () => {
        const registro = await registroMpDeTeste();
        const semToken: Registro = {
            ...registro,
            token_cifrado: "",
            token_iv: "",
            mascara_token: "",
        };
        const credenciais = await resolverCredenciaisMp(
            supabaseComRegistro(semToken),
            envDaPlataforma(),
        );
        assertEquals(credenciais.origem, "ambiente");
        assertEquals(credenciais.token, TOKEN_AMBIENTE_FALSO);
    });

    await t.step("R10 — lojista sem segredo de webhook -> null, sem reserva", async () => {
        const registro = await registroMpDeTeste({ webhookSecret: null });
        const credenciais = await resolverCredenciaisMp(
            supabaseComRegistro(registro),
            envDaPlataforma(),
        );
        assertEquals(credenciais.origem, "lojista");
        assertEquals(credenciais.token, TOKEN_LOJISTA_FALSO);
        assertEquals(credenciais.segredoWebhook, null);
    });

    await t.step("R11 — primitivas movidas seguem de pé", async () => {
        const chave = await chaveDeCifra(
            envFalso({ MP_CHAVES_ENCRYPTION_KEY: CHAVE_CIFRA_TESTE }),
        );
        assertEquals(chave === null, false);
        const { cifrado, iv } = await cifrar(TOKEN_LOJISTA_FALSO, chave!);
        assertEquals(cifrado.includes(TOKEN_LOJISTA_FALSO), false);
        assertEquals(await decifrar(cifrado, iv, chave!), TOKEN_LOJISTA_FALSO);
        // Cofre ausente, curto demais e não-base64 caem todos em null.
        assertEquals(await chaveDeCifra(envFalso({})), null);
        assertEquals(
            await chaveDeCifra(
                envFalso({ MP_CHAVES_ENCRYPTION_KEY: btoa("curta demais") }),
            ),
            null,
        );
        assertEquals(
            await chaveDeCifra(
                envFalso({ MP_CHAVES_ENCRYPTION_KEY: "não#é#base64" }),
            ),
            null,
        );
    });

    await t.step("R13 — client de USUÁRIO (anon) -> indisponivel", async () => {
        // O cenário que a revisão de mp-1 apontou: alguém passa o client do
        // usuário logado (como o `userClient` que estornar-pagamento monta
        // para conferir admin). A RLS de app_settings é só-admin, então a
        // leitura volta VAZIA — indistinguível de "o lojista nunca
        // cadastrou chave". Sem esta trava a resolução seguiria para o
        // ambiente e cobraria o cliente na conta da PLATAFORMA, calada.
        const credenciais = await resolverCredenciaisMp(
            supabaseComRegistro(null, null, CHAVE_ANON_FALSA),
            envDaPlataforma(),
        );
        assertEquals(credenciais.origem, "indisponivel");
        assertEquals(credenciais.token, null);
        assertEquals(credenciais.segredoWebhook, null);
        assertEquals(credenciais.motivo, "client_sem_service_role");
    });

    await t.step("R14 — chave publicável do formato novo -> indisponivel", async () => {
        const credenciais = await resolverCredenciaisMp(
            supabaseComRegistro(null, null, CHAVE_PUBLISHABLE_NOVA_FALSA),
            envDaPlataforma(),
        );
        assertEquals(credenciais.origem, "indisponivel");
        assertEquals(credenciais.motivo, "client_sem_service_role");
    });

    await t.step("R15 — service role (e dublê sem chave) seguem passando", async () => {
        // JWT de service role: o caminho de verdade das quatro functions.
        const comJwt = await resolverCredenciaisMp(
            supabaseComRegistro(await registroMpDeTeste(), null, CHAVE_SERVICE_ROLE_FALSA),
            envDaPlataforma(),
        );
        assertEquals(comJwt.origem, "lojista");
        assertEquals(comJwt.token, TOKEN_LOJISTA_FALSO);

        // Formato novo da chave secreta — o repositório já lê as duas.
        const comChaveNova = await resolverCredenciaisMp(
            supabaseComRegistro(await registroMpDeTeste(), null, CHAVE_SECRET_NOVA_FALSA),
            envDaPlataforma(),
        );
        assertEquals(comChaveNova.origem, "lojista");

        // Client dublê SEM `supabaseKey` (o que as suítes das functions
        // montam à mão): não dá para afirmar nada, então NÃO fecha. A trava
        // existe para pegar erro de programação provado, não para chutar.
        const semChave = await resolverCredenciaisMp(
            { from: supabaseComRegistro(null).from },
            envDaPlataforma(),
        );
        assertEquals(semChave.origem, "ambiente");
        assertEquals(semChave.token, TOKEN_AMBIENTE_FALSO);
    });

    await t.step("R12 — erro de leitura vira storage_leitura", async () => {
        let mensagem = "";
        try {
            await lerRegistroMp(
                supabaseComRegistro(null, { message: "conexão caiu" }),
            );
        } catch (err) {
            mensagem = err instanceof Error ? err.message : String(err);
        }
        assertEquals(mensagem.startsWith("storage_leitura:"), true);
    });
});
