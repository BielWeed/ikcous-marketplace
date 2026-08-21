// @ts-nocheck
/**
 * A trava de credencial enxerga JWT — .secretlintrc.json
 *
 * O BURACO QUE ESTE TESTE FECHA (medido em 20/08/2026): o
 * `.secretlintrc.json` carregava SÓ o `@secretlint/secretlint-rule-preset-recommend`,
 * e esse preset não tem regra de JWT. Medido com `--format json` (sem ele,
 * "pegou" e "não pegou" produzem a mesma saída vazia com exit 0):
 *
 *   isca `ghp_` + 36 chars ................ 1 achado  (secretlint-rule-github)
 *   isca connection string com senha ...... 1 achado  (…-database-connection-string)
 *   isca JWT `service_role` bem formado ... 0 achados  <- o buraco
 *   arquivo limpo (controle negativo) ..... 0 achados
 *
 * Ou seja: a trava pegava senha de banco e token do GitHub, e deixava passar a
 * chave `service_role` do Supabase — que é a credencial mais perigosa deste
 * projeto, porque ela ignora RLS. O histórico deste repositório já teve
 * `service_role` e senha de banco commitados, e hoje o hook local é a única
 * barreira: branch protection retorna 403 neste plano do GitHub e a cota de
 * Actions está esgotada.
 *
 * O QUE ESTE TESTE MEDE: o COMPORTAMENTO do padrão declarado, não o texto dele.
 * Ele lê o `.secretlintrc.json` de verdade, monta os `RegExp` do mesmo jeito
 * que o secretlint monta, e roda contra iscas GERADAS AQUI. Assertar a string
 * do regex faria o teste passar com um padrão que não casa nada.
 *
 * NENHUMA CREDENCIAL DE VERDADE ENTRA AQUI. Os JWT são sintéticos, montados em
 * tempo de execução — um teste que carrega credencial real é o próprio
 * incidente que ele deveria pegar.
 */
// Ordem alfabética por especificador: é o que o `organizeImports` do Biome
// cobra, e ele conta como erro na catraca de lint (`Found N errors.`).
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

// `fromFileUrl` e não `.pathname`: o caminho deste projeto tem espaços, e o
// pathname devolve `%20` mais uma barra sobrando no Windows.
const RC = fromFileUrl(new URL("../.secretlintrc.json", import.meta.url));
const PKG = fromFileUrl(new URL("../package.json", import.meta.url));

const ID_PATTERN = "@secretlint/secretlint-rule-pattern";
const ID_PRESET = "@secretlint/secretlint-rule-preset-recommend";

/**
 * Monta o `RegExp` como o secretlint monta.
 *
 * O `@secretlint/secretlint-rule-pattern` delega para o
 * `@textlint/regexp-string-matcher`, que aceita a forma `"/fonte/flags"` e
 * ACRESCENTA `u` e `g` SEMPRE (`DEFAULT_FLAGS = "ug"`, medido na v2.0.2). Um
 * padrão que só é válido sem `u` reprovaria em produção e passaria aqui se este
 * detalhe fosse ignorado.
 */
function regexDoPadrao(texto: string): RegExp {
  const m = texto.match(/^\/(.+)\/([a-z]*)$/s);
  assert(m !== null, `padrão "${texto}" não está na forma /fonte/flags`);
  const [, fonte, flags] = m;
  // `security/detect-non-literal-regexp` é o ponto deste teste, não um
  // descuido: compilar a fonte que está no `.secretlintrc.json` é exatamente o
  // que o secretlint faz, e é o que separa "o padrão existe" de "o padrão
  // casa". A fonte sai de um arquivo versionado do próprio repositório, nunca
  // de entrada externa.
  // eslint-disable-next-line security/detect-non-literal-regexp
  return new RegExp(fonte, [...new Set(`${flags}ug`.split(""))].join(""));
}

/**
 * base64url na mão, com `btoa`, em vez de importar `std/encoding`.
 *
 * O `deno.lock` é versionado e compartilhado, e as outras suítes deste
 * repositório vivem inteiras no `std@0.177.0`. Puxar uma segunda versão do std
 * só para três linhas de base64 encheria o lockfile de todo mundo — o custo
 * fica no arquivo compartilhado, o benefício era zero.
 */
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** Um JWT sintético bem formado, com o `role` que o Supabase emite. */
function jwtSintetico(role: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const parte = (o: unknown) =>
    base64url(new TextEncoder().encode(JSON.stringify(o)));
  const cabecalho = parte({ alg: "HS256", typ: "JWT" });
  const corpo = parte({
    iss: "supabase",
    ref: "projetoquenaoexiste",
    role,
    iat: 1700000000,
    exp: 2000000000,
  });
  return `${cabecalho}.${corpo}.${base64url(bytes)}`;
}

const rc = JSON.parse(await Deno.readTextFile(RC));
const pkg = JSON.parse(await Deno.readTextFile(PKG));

/** Todos os padrões declarados na regra de padrão, já como `RegExp`. */
function padroesDeclarados(): RegExp[] {
  const regra = (rc.rules ?? []).find((r) => r.id === ID_PATTERN);
  if (regra === undefined) return [];
  return (regra.options?.patterns ?? []).flatMap((p) =>
    (p.patterns ?? (p.pattern === undefined ? [] : [p.pattern])).map(
      regexDoPadrao,
    ),
  );
}

const casaAlgum = (texto: string) =>
  padroesDeclarados().some((re) => re.test(texto));

// --------------------------------------------------------------------------

Deno.test("a trava de credencial declara e aplica um padrão de JWT", async (t) => {
  await t.step("o preset recomendado CONTINUA declarado", () => {
    // A regra de padrão é somada ao preset, nunca no lugar dele: é o preset
    // que pega `ghp_`, chave de nuvem e connection string com senha.
    const ids = (rc.rules ?? []).map((r) => r.id);
    assert(
      ids.includes(ID_PRESET),
      `o \`.secretlintrc.json\` perdeu o ${ID_PRESET}. Sem ele a trava para de\n` +
        `ver senha de banco e token do GitHub. ids declarados: ${ids.join(", ")}`,
    );
  });

  await t.step("a regra de padrão está declarada", () => {
    const ids = (rc.rules ?? []).map((r) => r.id);
    assert(
      ids.includes(ID_PATTERN),
      `o \`.secretlintrc.json\` não declara o ${ID_PATTERN}. Sem ela a chave
\`service_role\` do Supabase volta a passar livre pelo pre-commit.
ids declarados: ${ids.join(", ")}`,
    );
  });

  await t.step("a regra de padrão está instalada (devDependencies)", () => {
    // Regra declarada e não instalada faz o secretlint ABORTAR, e um abort não
    // é o mesmo que "não achou segredo".
    //
    // `Object.entries` e não `devDependencies[ID_PATTERN]`: indexar objeto por
    // variável acende o `security/detect-object-injection`, e warning novo
    // reprova a catraca igual a erro novo.
    const entrada = Object.entries(pkg.devDependencies ?? {}).find(
      ([nome]) => nome === ID_PATTERN,
    );
    assert(
      entrada !== undefined && typeof entrada[1] === "string",
      `${ID_PATTERN} não está em devDependencies do package.json`,
    );
  });

  await t.step("POSITIVO — um JWT `service_role` sintético CASA", () => {
    assert(
      casaAlgum(`SUPABASE_SERVICE_ROLE_KEY=${jwtSintetico("service_role")}`),
      "nenhum padrão declarado casou um JWT `service_role` bem formado",
    );
  });

  await t.step("POSITIVO — um JWT `anon` sintético CASA", () => {
    assert(
      casaAlgum(`SUPABASE_ANON_KEY=${jwtSintetico("anon")}`),
      "nenhum padrão declarado casou um JWT `anon` bem formado",
    );
  });

  await t.step(
    "CONTROLE — há padrão declarado para casar (instrumento)",
    () => {
      // Sem isto, "não casou" nas iscas malformadas abaixo teria o mesmo valor
      // com uma lista de padrões VAZIA — que é exatamente o estado que este
      // teste existe para reprovar.
      assert(
        padroesDeclarados().length > 0,
        "a regra de padrão está declarada sem nenhum padrão dentro",
      );
    },
  );

  await t.step("NEGATIVO — iscas malformadas NÃO podem disparar", () => {
    // Falso positivo aqui é caro de um jeito específico: a trava é um hook de
    // pre-commit, e um padrão largo demais bloqueia commit legítimo até alguém
    // desligar a trava inteira — que é pior do que ela nunca ter existido.
    const naoPodem = [
      ["`eyJ` solto", "if (token.startsWith('eyJ')) return true;"],
      [
        "base64 comum",
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ],
      [
        "`eyJ` no meio de uma URL",
        "https://cdn.exemplo.invalido/assets/eyJhbGciOi/thumb.png",
      ],
      [
        // Cabeçalho e corpo bem formados, SEM assinatura: um JWT truncado não
        // abre porta nenhuma, e bloquear commit por causa dele seria ruído.
        "dois segmentos só",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSJ9",
      ],
    ];
    for (const [rotulo, isca] of naoPodem) {
      assertEquals(
        casaAlgum(isca),
        false,
        `falso positivo em ${rotulo}: ${isca}`,
      );
    }
  });
});
