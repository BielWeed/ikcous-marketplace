// @ts-nocheck
/**
 * O `verify_jwt` de cada edge function está versionado em supabase/config.toml
 * (#162) e é ele que decide quem passa pelo portão do Supabase.
 *
 * POR QUE ESTE ARQUIVO EXISTE: `criar-pagamento` lê o `sub` do JWT SEM validar
 * a assinatura (`subDoToken`, em criar-pagamento/index.ts) — a premissa é que o
 * gateway já validou. A linha `verify_jwt = true` do bloco dela é a ÚNICA coisa
 * que impede um token forjado de pagar ou cancelar pedido de outra pessoa.
 * Nenhum teste lia esse bloco: trocar para `false` passava em tudo.
 *
 * O contrário é igualmente grave: o Mercado Pago não manda JWT, então
 * `webhook-mercadopago` ligada em `true` recusa toda confirmação de pagamento em
 * silêncio, e `reconciliar-pagamentos` (chamada pelo pg_cron com segredo próprio)
 * pararia de reconciliar.
 *
 * O teste lê o arquivo como TEXTO (sem comentários) e afirma o que EXISTE hoje,
 * nomeando a function na mensagem.
 */
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const CONFIG = fromFileUrl(new URL("../supabase/config.toml", import.meta.url));

/**
 * Lê `[functions."nome"]` -> valores de `verify_jwt` daquele bloco (lista, para
 * pegar linha duplicada). Comentário de linha inteira e comentário no fim da
 * linha são ignorados: o cabeçalho do arquivo CITA `verify_jwt = true`.
 */
function verifyJwtPorFunction(toml: string): Map<string, string[]> {
  const mapa = new Map<string, string[]>();
  let atual: string | null = null;
  for (const bruta of toml.split(/\r?\n/)) {
    const linha = bruta.replace(/#.*$/, "").trim();
    if (!linha) continue;
    const cabecalho = /^\[functions\."([^"]+)"\]$/.exec(linha);
    if (cabecalho) {
      atual = cabecalho[1];
      if (!mapa.has(atual)) mapa.set(atual, []);
      continue;
    }
    if (/^\[/.test(linha)) {
      atual = null; // outra tabela do TOML: o que vier não é de function
      continue;
    }
    const valor = /^verify_jwt\s*=\s*(\S+)$/.exec(linha);
    if (valor && atual !== null) mapa.get(atual)!.push(valor[1]);
  }
  return mapa;
}

const mapa = verifyJwtPorFunction(await Deno.readTextFile(CONFIG));

function valorDe(nome: string): string {
  const valores = mapa.get(nome);
  assert(valores, `config.toml perdeu o bloco [functions."${nome}"]`);
  assertEquals(
    valores!.length,
    1,
    `[functions."${nome}"] precisa ter exatamente UMA linha verify_jwt (achei ${valores!.length})`,
  );
  return valores![0];
}

// Autenticadas pelo token do usuário (ou pelo portão, no caso das de admin).
// `criar-pagamento` é a crítica: lê o `sub` sem validar assinatura.
const COM_JWT = [
  "criar-pagamento",
  "estornar-pagamento",
  "credenciais-mercado-pago",
  "send-push",
];

// Quem chama não manda JWT de usuário: Mercado Pago (x-signature) e pg_cron
// (RECONCILIACAO_SECRET). Ligar `true` aqui derruba a confirmação de pagamento.
const SEM_JWT = ["webhook-mercadopago", "reconciliar-pagamentos"];

for (const nome of COM_JWT) {
  Deno.test(`config.toml: ${nome} tem verify_jwt = true`, () => {
    assertEquals(
      valorDe(nome),
      "true",
      `${nome} com verify_jwt diferente de true: o portão do Supabase deixa de barrar token forjado/ausente`,
    );
  });
}

for (const nome of SEM_JWT) {
  Deno.test(`config.toml: ${nome} continua verify_jwt = false (quem chama não manda JWT)`, () => {
    assertEquals(
      valorDe(nome),
      "false",
      `${nome} com verify_jwt diferente de false: o gateway passa a recusar o Mercado Pago/pg_cron em silêncio`,
    );
  });
}

Deno.test("config.toml: nenhuma function de pagamento aceita valor fora de true/false (aspas, 1, 'true')", () => {
  for (const nome of [...COM_JWT, ...SEM_JWT]) {
    assert(
      ["true", "false"].includes(valorDe(nome)),
      `${nome}: verify_jwt precisa ser booleano TOML`,
    );
  }
});

Deno.test("config.toml: o leitor ignora comentário (o cabeçalho cita verify_jwt = true e não vira valor de ninguém)", () => {
  const amostra = [
    "# verify_jwt = true  (comentário solto)",
    '[functions."a"]',
    "verify_jwt = false # verify_jwt = true no fim da linha",
    '[functions."b"]',
    "# verify_jwt = false",
    "verify_jwt = true",
  ].join("\n");
  const m = verifyJwtPorFunction(amostra);
  assertEquals(m.get("a"), ["false"]);
  assertEquals(m.get("b"), ["true"]);
});
