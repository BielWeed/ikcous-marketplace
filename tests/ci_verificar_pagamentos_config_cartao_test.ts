// @ts-nocheck
/**
 * A checagem da config do cartão em scripts/publicacao/verificar-pagamentos-ikcous.cjs
 * (a prova somente leitura que o publicar-functions.yml roda ANTES de publicar
 * na loja `ikcous-publicada`).
 *
 * Até 03/10/2026 ela exigia o estado EXATO da fase de blindagem — crédito
 * ligado, débito desligado, 1 parcela — e por isso recusou publicar a edge
 * `criar-pagamento` depois que o dono ligou "parcelar em até 2x" no painel
 * (run 37119556162). Com a blindagem no ar, quem escolhe crédito, débito e o
 * teto de parcelas é o dono pelo painel (autorizado por ele em 03/10/2026).
 * A trava passa a conferir só que a config é VÁLIDA: uma linha (id 1),
 * crédito e débito booleanos, parcelas de 1 a 12. Linha ausente, duplicada
 * ou fora de forma continua recusando.
 */
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  avaliar,
} = require("../scripts/publicacao/verificar-pagamentos-ikcous.cjs");

const NOME = "config de cartao valida (uma linha, booleanos, 1 a 12 parcelas)";

function checagemDaConfig(config) {
  const checks = avaliar(
    { funcoes: [], colunas: [], config },
    {
      liberar: "x",
      expirar: "y",
    },
  );
  const achadas = checks.filter((c) => c.checagem === NOME);
  assertEquals(
    achadas.length,
    1,
    "a checagem da config tem de existir uma vez",
  );
  return achadas[0].ok;
}

const linha = (campos) => ({
  id: 1,
  credito: true,
  debito: false,
  parcelas_max: 1,
  ...campos,
});

Deno.test("aceita o estado escolhido pelo dono no painel", () => {
  assert(checagemDaConfig([linha({})]), "crédito 1x");
  assert(checagemDaConfig([linha({ parcelas_max: 2 })]), "crédito até 2x");
  assert(
    checagemDaConfig([linha({ parcelas_max: 12, debito: true })]),
    "12x com débito",
  );
  assert(
    checagemDaConfig([linha({ credito: false, debito: false })]),
    "cartão desligado",
  );
});

Deno.test("recusa config ausente, duplicada ou fora de forma", () => {
  assert(!checagemDaConfig([]), "sem linha");
  assert(!checagemDaConfig([linha({}), linha({})]), "duas linhas");
  assert(!checagemDaConfig([linha({ id: null })]), "id diferente de 1");
  // `verificar` normaliza parcelas fora de 1..12 e booleano inválido para null.
  assert(
    !checagemDaConfig([linha({ parcelas_max: null })]),
    "parcelas inválidas",
  );
  assert(!checagemDaConfig([linha({ credito: null })]), "crédito não booleano");
  assert(!checagemDaConfig([linha({ debito: null })]), "débito não booleano");
  assert(!checagemDaConfig([linha({ parcelas_max: 13 })]), "13 parcelas");
  assert(!checagemDaConfig([linha({ parcelas_max: 0 })]), "0 parcelas");
});

Deno.test("a exigência antiga de 1x/sem débito não existe mais", () => {
  const checks = avaliar(
    { funcoes: [], colunas: [], config: [linha({ parcelas_max: 2 })] },
    {
      liberar: "x",
      expirar: "y",
    },
  );
  assert(
    !checks.some(
      (c) => c.checagem === "credito ligado, debito desligado, 1 parcela",
    ),
    "a checagem da fase de blindagem voltou",
  );
});

// ---------------------------------------------------------------------------
// O pin dos hashes esperados não pode envelhecer em silêncio (04/10/2026).
// `hashesEsperados()` tira o corpo de `liberar_cobranca_do_pedido` da 20261176
// e o de `expirar_pedidos_vencidos` da 20261186. Se uma migration POSTERIOR
// redefinir uma das duas, a prova somente leitura que roda ANTES do deploy
// das edges passa a recusar um banco que está certo (ou, pior, a aceitar um
// banco que não tem a definição nova).
//
// Medido em 04/10/2026: a 20261190 só põe um COMMENT em liberar_cobranca_do_pedido
// (não redefine o corpo); a última definição do corpo continua sendo a 20261176.
// ---------------------------------------------------------------------------
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";

const PINS = {
  liberar_cobranca_do_pedido: "20261176000000_o_cartao_online_nasce.sql",
  expirar_pedidos_vencidos:
    "20261186000000_cartao_em_analise_segura_a_expiracao.sql",
};

/** Migrations de 14 dígitos (nunca rollback-manual) POSTERIORES à fonte que
 * definem `fn` com CREATE [OR REPLACE] FUNCTION (corpo novo). */
function redefinicoesPosteriores(dir, fn, fonte) {
  const re = new RegExp(
    `CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+(public\\.)?${fn}\\s*\\(`,
    "i",
  );
  return [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n) && n > fonte)
    .sort()
    .filter((n) => re.test(Deno.readTextFileSync(join(dir, n))));
}

const MIGRATIONS = fromFileUrl(
  new URL("../supabase/migrations", import.meta.url),
);

Deno.test("o pin dos hashes: nenhuma migration posterior à fonte redefine liberar_cobranca_do_pedido nem expirar_pedidos_vencidos", () => {
  for (const [fn, fonte] of Object.entries(PINS)) {
    assert(
      Deno.readTextFileSync(join(MIGRATIONS, fonte)).match(
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`),
      ),
      `${fonte} deveria definir ${fn}`,
    );
    assertEquals(
      redefinicoesPosteriores(MIGRATIONS, fn, fonte),
      [],
      `${fn}: uma migration posterior à ${fonte} redefiniu a função — troque a fonte de hashesEsperados() em verificar-pagamentos-ikcous.cjs (e PINS aqui) antes de publicar`,
    );
  }
});

Deno.test("o pin dos hashes: as fontes deste teste são as que o script usa", () => {
  const script = Deno.readTextFileSync(
    fromFileUrl(
      new URL(
        "../scripts/publicacao/verificar-pagamentos-ikcous.cjs",
        import.meta.url,
      ),
    ),
  );
  for (const fonte of Object.values(PINS)) {
    assert(script.includes(fonte), `o script não usa mais ${fonte}`);
  }
});

Deno.test("o detector do pin enxerga uma redefinição posterior (mutante: fixture com uma migration nova que redefine a função)", () => {
  const dir = Deno.makeTempDirSync();
  try {
    for (const fonte of Object.values(PINS)) {
      Deno.copyFileSync(join(MIGRATIONS, fonte), join(dir, fonte));
    }
    for (const [fn, fonte] of Object.entries(PINS)) {
      assertEquals(
        redefinicoesPosteriores(dir, fn, fonte),
        [],
        "controle: sem mutante, nada",
      );
    }
    // a 20261190 real só faz COMMENT ON FUNCTION: não é redefinição
    Deno.writeTextFileSync(
      join(dir, "20261190000000_so_comenta.sql"),
      "COMMENT ON FUNCTION public.liberar_cobranca_do_pedido(uuid, text) IS 'x';\n",
    );
    assertEquals(
      redefinicoesPosteriores(
        dir,
        "liberar_cobranca_do_pedido",
        PINS.liberar_cobranca_do_pedido,
      ),
      [],
      "COMMENT ON FUNCTION não redefine o corpo",
    );
    // mutante: uma migration posterior com o corpo novo
    Deno.writeTextFileSync(
      join(dir, "20261195000000_redefine.sql"),
      "CREATE OR REPLACE FUNCTION public.liberar_cobranca_do_pedido(p uuid, q text)\nRETURNS void LANGUAGE sql AS $$ SELECT 1 $$;\n",
    );
    assertEquals(
      redefinicoesPosteriores(
        dir,
        "liberar_cobranca_do_pedido",
        PINS.liberar_cobranca_do_pedido,
      ),
      ["20261195000000_redefine.sql"],
    );
    // anterior à fonte não conta; rollback-manual não conta
    Deno.writeTextFileSync(
      join(dir, "rollback-manual-20261199000000_x.sql"),
      "CREATE OR REPLACE FUNCTION public.expirar_pedidos_vencidos() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;\n",
    );
    assertEquals(
      redefinicoesPosteriores(
        dir,
        "expirar_pedidos_vencidos",
        PINS.expirar_pedidos_vencidos,
      ),
      [],
    );
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
