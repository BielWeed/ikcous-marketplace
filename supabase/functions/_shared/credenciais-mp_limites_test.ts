// @ts-nocheck
/**
 * Caça por mutação (25/11/2026, segunda rodada) em `credenciais-mp.ts` (de quem é
 * a chave que cobra o cliente). O que sobrevivia às suítes `credenciais-mp_*_test.ts`:
 *
 *   * ONDE o registro do lojista mora: tabela `app_settings`, coluna `value`, linha
 *     de chave `pagamentos_mercado_pago` — um nome trocado leria uma linha vazia e
 *     cairia, calado, na chave da PLATAFORMA (dinheiro na conta errada). O dublê
 *     antigo ignorava os argumentos de `from`/`select`/`eq`; este os confere;
 *   * lojista que cadastrou só a chave de cobrança (sem segredo de webhook): a
 *     resolução NÃO tenta decifrar um segredo que não existe — nenhum log de
 *     "segredo ilegível" falso, o segredo fica `null` e o token vale.
 *
 * Equivalentes explicados (sem teste): `if (!segredo) return null` de `chaveDeCifra`
 * — uma env vazia vira zero bytes e cai no `bytes.length !== 32` logo abaixo, mesmo
 * resultado; o preenchimento (`padEnd`) do payload do JWT em `papelDaChaveDoClient`
 * — `atob` aceita base64 sem o `=` final, então `ceil`/`floor`/`*`/`/` dão o mesmo
 * papel.
 *
 * Chaves de MENTIRA (as fixtures da pasta); nenhum segredo real.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { CHAVE_SETTINGS, lerRegistroMp, resolverCredenciaisMp } from "./credenciais-mp.ts";
import {
  CHAVE_SERVICE_ROLE_FALSA,
  envDaPlataforma,
  registroMpDeTeste,
  supabaseComRegistro,
  TOKEN_LOJISTA_FALSO,
} from "./credenciais-mp_fixtures.ts";

Deno.test("a linha do lojista mora em app_settings, coluna value, chave pagamentos_mercado_pago — e o módulo pergunta exatamente isso", async () => {
  assertEquals(CHAVE_SETTINGS, "pagamentos_mercado_pago");
  const perguntas: Array<[string, unknown[]]> = [];
  const registro = await registroMpDeTeste();
  const cliente = {
    from(...a: unknown[]) {
      perguntas.push(["from", a]);
      return this;
    },
    select(...a: unknown[]) {
      perguntas.push(["select", a]);
      return this;
    },
    eq(...a: unknown[]) {
      perguntas.push(["eq", a]);
      return this;
    },
    maybeSingle() {
      return Promise.resolve({ data: { value: JSON.stringify(registro) }, error: null });
    },
  };
  const lido = await lerRegistroMp(cliente);
  assertEquals(lido?.public_key, registro.public_key);
  assertEquals(perguntas, [
    ["from", ["app_settings"]],
    ["select", ["value"]],
    ["eq", ["key", "pagamentos_mercado_pago"]],
  ]);
});

Deno.test("lojista sem segredo de webhook: token vale, segredo é null e NENHUM log de segredo ilegível", async () => {
  const registro = await registroMpDeTeste({ webhookSecret: null });
  const logs: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
  let cred;
  try {
    cred = await resolverCredenciaisMp(supabaseComRegistro(registro, null, CHAVE_SERVICE_ROLE_FALSA), envDaPlataforma());
  } finally {
    console.error = original;
  }
  assertEquals(cred.origem, "lojista");
  assertEquals(cred.token, TOKEN_LOJISTA_FALSO);
  assertEquals(cred.segredoWebhook, null);
  assertEquals(logs, []);
});
