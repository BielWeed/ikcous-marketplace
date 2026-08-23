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
 * SEGUNDO BURACO, fechado em 21/08/2026: o padrão de JWT só pega o formato
 * LEGADO da chave secreta do Supabase (`eyJ...`). O formato NOVO, `sb_secret_...`,
 * passava em silêncio — medido com controle positivo na mesma rodada: isca
 * `eyJ...` -> bloqueada; isca `sb_secret_...` -> exit 0. A doc oficial do
 * Supabase diz que as chaves legadas serão descontinuadas até o fim de 2026, e
 * o runbook deste projeto (`docs/runbooks/rotacao-credenciais-supabase.md:166`)
 * recomenda migrar para `sb_secret_...` — que é o sucessor do `service_role`
 * e também ignora RLS. O dia em que alguém seguir o próprio manual do projeto
 * era o dia em que a trava ficava cega.
 *
 * DELIBERADO: este arquivo NÃO cobra bloqueio de `sb_publishable_`. A doc
 * oficial do Supabase diz que a chave publishable é FEITA para ser pública
 * ("anyone can retrieve the key from the source code or build artifacts") —
 * é o substituto da `anon`, não do `service_role`. Bloqueá-la seria falso
 * positivo por construção, e falso positivo é o que faz alguém arrancar a
 * trava inteira (é hook de pre-commit: request legítimo bloqueado por engano
 * custa caro). O caso "NEGATIVO INTENCIONAL — sb_publishable_" abaixo existe
 * para que, se alguém "consertar" essa omissão sem ler este parágrafo, o
 * teste avise.
 *
 * ⚠️ O `{16,}` do sufixo de `sb_secret_` é ESCOLHA DE ENGENHARIA, não spec: a
 * doc oficial do Supabase não publica o alfabeto nem o comprimento do sufixo
 * dessas chaves. Ele foi calibrado para separar chave real de placeholder de
 * documentação (`sb_secret_...`, `sb_secret_xxx`, medidos neste repositório
 * em 21/08/2026) — não trate como fato do fornecedor.
 *
 * O QUE ESTE TESTE MEDE: o COMPORTAMENTO do padrão declarado, não o texto dele.
 * Ele lê o `.secretlintrc.json` de verdade, monta os `RegExp` do mesmo jeito
 * que o secretlint monta, e roda contra iscas GERADAS AQUI. Assertar a string
 * do regex faria o teste passar com um padrão que não casa nada.
 *
 * NENHUMA CREDENCIAL DE VERDADE ENTRA AQUI. As chaves são sintéticas, montadas
 * em tempo de execução — um teste que carrega credencial real é o próprio
 * incidente que ele deveria pegar.
 */
// Ordem alfabética por especificador: é o que o `organizeImports` do Biome
// cobra, e ele conta como erro na catraca de lint (`Found N errors.`).
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

// `fromFileUrl` e não `.pathname`: o caminho deste projeto tem espaços, e o
// pathname devolve `%20` mais uma barra sobrando no Windows.
const RC = fromFileUrl(new URL("../.secretlintrc.json", import.meta.url));
const PKG = fromFileUrl(new URL("../package.json", import.meta.url));
const RAIZ_DO_REPO = fromFileUrl(new URL("..", import.meta.url));
const SECRETLINTIGNORE = fromFileUrl(
  new URL("../.secretlintignore", import.meta.url),
);
const SECRETLINT_CLI = join(
  RAIZ_DO_REPO,
  "node_modules",
  "secretlint",
  "bin",
  "secretlint.js",
);

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

/**
 * Sufixo aleatório no alfabeto `[A-Za-z0-9_-]`, no comprimento pedido.
 *
 * Usado para montar as chaves `sb_secret_`/`sb_publishable_` sintéticas: o
 * texto do sufixo não importa, só o alfabeto e o comprimento — que são
 * exatamente as duas coisas que o padrão do `.secretlintrc.json` verifica.
 */
function sufixoAleatorio(tamanho: number): string {
  const alfabeto =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  const bytes = new Uint8Array(tamanho);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join("");
}

/** Uma chave `sb_secret_` sintética, com formato realista (prefixo + 40). */
function sbSecretSintetica(): string {
  return `sb_secret_${sufixoAleatorio(40)}`;
}

/** Uma chave `sb_publishable_` sintética, com formato realista. */
function sbPublishableSintetica(): string {
  return `sb_publishable_${sufixoAleatorio(40)}`;
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

  await t.step("POSITIVO — uma chave `sb_secret_` sintética CASA", () => {
    assert(
      casaAlgum(`SUPABASE_SECRET_KEY=${sbSecretSintetica()}`),
      "nenhum padrão declarado casou uma chave `sb_secret_` bem formada — " +
        "é o formato novo, sucessor do `service_role`, e ignora RLS igual",
    );
  });

  await t.step(
    "NEGATIVO — placeholder `sb_secret_...` (documentação) NÃO casa",
    () => {
      assertEquals(
        casaAlgum("SUPABASE_SECRET_KEY=sb_secret_..."),
        false,
        "o padrão de `sb_secret_` está casando placeholder de documentação — " +
          "o runbook e o onboarding usam exatamente essa forma",
      );
    },
  );

  await t.step(
    "NEGATIVO — placeholder `sb_secret_xxx` (documentação) NÃO casa",
    () => {
      assertEquals(
        casaAlgum("SUPABASE_SECRET_KEY=sb_secret_xxx"),
        false,
        "o padrão de `sb_secret_` está casando placeholder de documentação",
      );
    },
  );

  await t.step(
    "NEGATIVO INTENCIONAL — `sb_publishable_` NÃO é bloqueada",
    () => {
      // Deliberado, não esquecido: a publishable é FEITA para ser pública
      // (substituta da `anon`), e bloqueá-la seria falso positivo por
      // construção — ver o cabeçalho deste arquivo. Se este caso passar a
      // FALHAR porque alguém acrescentou um padrão para `sb_publishable_`,
      // essa é a mudança que precisa vir com a justificativa, não este teste.
      assertEquals(
        casaAlgum(`SUPABASE_PUBLISHABLE_KEY=${sbPublishableSintetica()}`),
        false,
        "a trava passou a bloquear `sb_publishable_` — isso é falso positivo " +
          "por construção, ver o cabeçalho deste arquivo",
      );
    },
  );

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

// ============================================================================
// SEGUNDO BURACO na mesma trava, medido e fechado em 21/08/2026: o
// `.secretlintignore` tinha `*.bat` e `*.ps1` na lista de exceções. Uma
// credencial dentro de um script PowerShell passava DIRETO — e isto importa
// neste projeto especificamente: o terminal do dono é PowerShell e há 4
// arquivos `.ps1`/`.bat` versionados no repositório. Um
// `$env:SUPABASE_SECRET_KEY = "sb_secret_..."` num `.ps1` escapava da trava.
//
// Medido em 21/08/2026, controle positivo e negativo na mesma rodada:
//
//   COM a exceção:  isca .ps1 com sb_secret_ .... 0 achados, exit 0  <- o buraco
//                   isca .bat com sb_secret_ .... 0 achados, exit 0  <- o buraco
//   SEM a exceção:  isca .ps1 com sb_secret_ .... 1 achado,  exit 1
//                   isca .bat com sb_secret_ .... 1 achado,  exit 1
//                   .ps1 LIMPO (controle negativo) ... 0 achados, exit 0
//
// E a varredura do repositório inteiro (`npm run secretlint`), com a exceção
// removida: 0 achados — nenhum `.ps1`/`.bat` rastreado hoje carrega
// credencial, então tirar a exceção não acende nada que já existisse.
//
// O QUE ESTE TESTE MEDE: o COMPORTAMENTO real do `secretlint` (subprocesso
// `node` de verdade, não regex isolado), contra uma isca sintética. Assertar
// só a AUSÊNCIA das linhas `*.ps1`/`*.bat` no arquivo provaria a intenção,
// não o efeito — e é o efeito que interessa: se alguém puser as linhas de
// volta, este teste cai porque o secretlint VOLTA a deixar passar, não
// porque um grep achou uma string.
//
// `--no-gitignore`: o secretlint v13 respeita `.gitignore` por padrão, e a
// isca deste teste é gravada em `scratch/`, que este repositório ignora. Sem
// a flag, um arquivo ignorado dá o mesmo "0 achados" que o próprio buraco —
// um falso "passou" pelo motivo errado. Isto é particularidade do ARRANJO
// deste teste: o hook real (`lefthook.yml`) roda contra `{staged_files}`,
// que por definição nunca são arquivos ignorados (o git recusa `add` num
// arquivo ignorado sem `-f`) — a flag não muda nada do comportamento em
// produção, só evita um falso negativo aqui.
//
// NENHUMA CREDENCIAL DE VERDADE ENTRA AQUI — mesma isca sintética
// `sb_secret_` de cima, montada em tempo de execução.
// ============================================================================

/**
 * Roda o `secretlint` DE VERDADE (subprocesso `node`, o mesmo binário que o
 * `lefthook.yml` chama) contra um arquivo escrito em `scratch/`, com o
 * `.secretlintignore` REAL deste repositório. Se alguém reintroduzir
 * `*.ps1`/`*.bat` naquele arquivo, é este processo real que passa a devolver
 * "0 achados" de novo — não uma cópia congelada dentro do teste.
 */
async function rodaSecretlintContra(
  nomeDoArquivo: string,
  conteudo: string,
): Promise<{ code: number; achados: unknown[]; stderr: string }> {
  const caminhoRelativo = `scratch/${nomeDoArquivo}`;
  const caminhoAbsoluto = join(RAIZ_DO_REPO, caminhoRelativo);
  await Deno.mkdir(join(RAIZ_DO_REPO, "scratch"), { recursive: true });
  await Deno.writeTextFile(caminhoAbsoluto, conteudo);
  try {
    const cmd = new Deno.Command("node", {
      args: [
        SECRETLINT_CLI,
        "--no-gitignore",
        "--secretlintignore",
        // Literal RELATIVO, não a constante `SECRETLINTIGNORE` (absoluta) —
        // medido em 21/08/2026: com `cwd` fixo, `--secretlintignore` com
        // caminho ABSOLUTO faz o secretlint parar de aplicar os padrões de
        // extensão do arquivo (`*.ps1`/`*.bat` deixavam de ignorar mesmo
        // estando lá). Só o caminho RELATIVO reproduz o comportamento real —
        // que é como `lefthook.yml` chama (`--secretlintignore
        // .secretlintignore`, também relativo). Um teste com o caminho
        // absoluto passaria SEMPRE, mutação ou não: não estaria medindo nada.
        ".secretlintignore",
        "--format",
        "json",
        caminhoRelativo,
      ],
      cwd: RAIZ_DO_REPO,
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout, stderr } = await cmd.output();
    const saidaStdout = new TextDecoder().decode(stdout).trim();
    const saidaStderr = new TextDecoder().decode(stderr).trim();
    let achados: unknown[] = [];
    try {
      const parsed = JSON.parse(saidaStdout || "[]");
      achados = Array.isArray(parsed) ? (parsed[0]?.messages ?? []) : [];
    } catch {
      throw new Error(
        `saída do secretlint não é JSON: ${saidaStdout}\n${saidaStderr}`,
      );
    }
    return { code, achados, stderr: saidaStderr };
  } finally {
    await Deno.remove(caminhoAbsoluto).catch(() => {});
  }
}

Deno.test("a trava de credencial enxerga .ps1 e .bat — .secretlintignore", async (t) => {
  await t.step(
    "o `.secretlintignore` não declara mais `*.ps1`, `*.bat` nem `package-lock.json`",
    async () => {
      const texto = await Deno.readTextFile(SECRETLINTIGNORE);
      const linhas = texto.split(/\r?\n/).map((l) => l.trim());
      assert(
        !linhas.includes("*.ps1"),
        "`.secretlintignore` voltou a ter `*.ps1` — o terminal deste " +
          "projeto é PowerShell e há arquivos `.ps1` versionados aqui; " +
          "uma credencial ali passaria despercebida.",
      );
      assert(
        !linhas.includes("*.bat"),
        "`.secretlintignore` voltou a ter `*.bat` — mesmo buraco do `*.ps1`.",
      );
      // Medido em 21/08/2026: as 1.381 entradas `resolved` do lockfile
      // apontam todas para `registry.npmjs.org`, sem token na URL, e
      // varrer o arquivo custa 600 ms sem gerar nenhum achado. A excecao
      // nao pagava nada e criava um ponto cego que passa a valer no dia
      // em que este projeto usar um registro PRIVADO de pacotes -- que e
      // o unico caminho pelo qual uma credencial cai num lockfile.
      assert(
        !linhas.includes("package-lock.json"),
        "`.secretlintignore` voltou a ter `package-lock.json` — se um dia " +
          "este projeto usar registro privado de pacotes, a credencial dele " +
          "cai no lockfile e passaria despercebida.",
      );
    },
  );

  await t.step(
    "POSITIVO — chave `sb_secret_` dentro de um `.ps1` é RECUSADA pela trava real",
    async () => {
      const r = await rodaSecretlintContra(
        `isca-ps1-${crypto.randomUUID()}.ps1`,
        `$env:SUPABASE_SECRET_KEY = "${sbSecretSintetica()}"\n`,
      );
      assert(
        r.code !== 0 && r.achados.length > 0,
        `o secretlint NÃO recusou uma chave sb_secret_ dentro de um .ps1 (exit=${r.code}, achados=${r.achados.length}). Isto é o buraco voltando — provavelmente *.ps1 voltou ao .secretlintignore.\n${r.stderr}`,
      );
    },
  );

  await t.step(
    "POSITIVO — chave `sb_secret_` dentro de um `.bat` é RECUSADA pela trava real",
    async () => {
      const r = await rodaSecretlintContra(
        `isca-bat-${crypto.randomUUID()}.bat`,
        `set SUPABASE_SECRET_KEY=${sbSecretSintetica()}\n`,
      );
      assert(
        r.code !== 0 && r.achados.length > 0,
        `o secretlint NÃO recusou uma chave sb_secret_ dentro de um .bat (exit=${r.code}, achados=${r.achados.length}).\n${r.stderr}`,
      );
    },
  );

  await t.step(
    "NEGATIVO — `.ps1` sem credencial PASSA (instrumento não recusa tudo)",
    async () => {
      const r = await rodaSecretlintContra(
        `isca-ps1-limpo-${crypto.randomUUID()}.ps1`,
        "$env:SUPABASE_SECRET_KEY = $env:MINHA_VARIAVEL_DE_AMBIENTE\n",
      );
      assertEquals(
        r.code,
        0,
        `um .ps1 sem credencial foi recusado (achados=${r.achados.length}) — falso positivo, e não é isso que este teste deveria provar.\n${r.stderr}`,
      );
    },
  );
});
