import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
// @ts-nocheck
/**
 * O secretlint varre mesmo `.ps1` e `.bat` — .secretlintignore
 *
 * O DEFEITO QUE ESTES TESTES FECHAM (medido em 20/08/2026): o
 * `.secretlintignore` tinha `*.bat` e `*.ps1`. Efeito: o arquivo NEM É
 * ABERTO, e a saída da varredura é IDÊNTICA à de um arquivo limpo.
 *
 * A/B com o mesmo conteúdo byte a byte (token falso do GitHub), com as
 * iscas DENTRO da árvore:
 *
 *   ZZ-isca-temporaria.js    varrido=1  achados=1   <- controle, ACENDEU
 *   ZZ-isca-temporaria.ps1   varrido=0  achados=0   <- nem abriu
 *   ZZ-isca-temporaria.bat   varrido=0  achados=0   <- nem abriu
 *
 * A isca TEM de ficar dentro da árvore: em `%TEMP%` as três extensões
 * acendem, porque o `.secretlintignore` só se aplica a caminho sob o cwd —
 * e `scratch/` também não serve, porque o secretlint respeita o cascade do
 * `.gitignore` e nem o controle positivo acende lá.
 *
 * Onde doía: dos quatro `.ps1`/`.bat` versionados, dois vivem em
 * `supabase/setup/` — o lugar mais provável de alguém colar uma senha de
 * conexão. Os outros dois (`scripts/scratch_audit.*`) já eram varridos por
 * acidente: o `.gitignore` os desfaz com `!scripts/scratch_audit.bat`, e
 * essa negação vence o `.secretlintignore` no cascade. Cobertura que depende
 * de uma negação escrita para outra finalidade não é cobertura.
 *
 * O QUE ESTES TESTES MEDEM: se o arquivo É VARRIDO. Não a ausência de
 * achado — "varreu e não achou" e "não varreu" produzem o MESMO exit 0 e o
 * MESMO `messages: []` na leitura ingênua. Só `--format json` separa os dois:
 *
 *   sujo         -> exit=1, json = [{ ..., messages: [{...}] }]
 *   limpo        -> exit=0, json = [{ ..., messages: [] }]
 *   NÃO VARRIDO  -> exit=0, json = []          <- o arquivo some do array
 *
 * Por isso a asserção que importa é sobre o COMPRIMENTO do array de
 * arquivos, nunca sobre `messages` estar vazio.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

// `fromFileUrl` e não `.pathname`: o caminho deste projeto tem espaços, e o
// pathname devolve `%20` mais uma barra sobrando no Windows.
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const IGNORE = fromFileUrl(new URL("../.secretlintignore", import.meta.url));

/**
 * Isca sintética, montada em tempo de execução. Escrita inteira num literal,
 * ela faria o próprio secretlint acusar ESTE arquivo de teste — que é
 * exatamente o comportamento que estamos provando existir.
 *
 * `ghp_` + 36 de `[A-Za-z0-9_]` é o formato clássico de personal access token
 * do GitHub, e é o que a regra `@secretlint/secretlint-rule-github` do preset
 * `recommend` procura. Nunca uma credencial de verdade.
 */
const TOKEN_FALSO = `ghp_${"A".repeat(36)}`;

/** Só o que é código: comentário citando `*.ps1` não pode reprovar o teste. */
function linhasDeRegra(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

type Isca = { nome: string; conteudo: string; sujo: boolean };

const ISCAS: Isca[] = [
  // POSITIVO — o defeito em si.
  { nome: "alvo.ps1", conteudo: `$token = "${TOKEN_FALSO}"\n`, sujo: true },
  // POSITIVO 2.
  { nome: "alvo.bat", conteudo: `set TOKEN="${TOKEN_FALSO}"\n`, sujo: true },
  // CONTROLE DE INSTRUMENTO — extensão que sempre foi varrida. Se esta não
  // acender, a rodada inteira não vale nada: o problema é o instrumento.
  {
    nome: "controle.js",
    conteudo: `const t = "${TOKEN_FALSO}";\n`,
    sujo: true,
  },
  // NEGATIVO — varrido e sem achado, que é diferente de não varrido.
  {
    nome: "limpo.ps1",
    conteudo: `Write-Host "sem segredo nenhum aqui"\n`,
    sujo: false,
  },
];

type Resultado = { varrido: boolean; achados: number; mensagens: string };

/**
 * Escreve as iscas numa pasta descartável DENTRO da árvore, roda o secretlint
 * com `--format json` e devolve o que aconteceu com cada uma.
 *
 * A pasta carrega o pid para que duas suítes rodando ao mesmo tempo na mesma
 * árvore não leiam a isca uma da outra, e some num `finally` — arquivo
 * estranho em árvore compartilhada vira alerta órfão para outras sessões.
 */
async function rodarIscas(): Promise<Map<string, Resultado>> {
  const pasta = `ZZ-isca-temporaria-${Deno.pid}`;
  const dir = `${RAIZ}${pasta}`;
  await Deno.mkdir(dir, { recursive: true });
  try {
    for (const isca of ISCAS) {
      await Deno.writeTextFile(`${dir}/${isca.nome}`, isca.conteudo);
    }

    const proc = new Deno.Command("node", {
      args: [
        "node_modules/secretlint/bin/secretlint.js",
        "--secretlintignore",
        ".secretlintignore",
        "--format",
        "json",
        `${pasta}/*`,
      ],
      cwd: RAIZ,
      stdout: "piped",
      stderr: "piped",
    });
    const saida = await proc.output();
    const stdout = new TextDecoder().decode(saida.stdout);
    const stderr = new TextDecoder().decode(saida.stderr);

    let json: unknown[];
    try {
      json = JSON.parse(stdout || "[]");
    } catch {
      throw new Error(
        `o secretlint não devolveu JSON. Sem isso não dá para separar "varreu e não achou" de "não varreu".\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      );
    }

    const porNome = new Map<string, Resultado>();
    for (const arquivo of json as { filePath: string; messages: unknown[] }[]) {
      const nome = arquivo.filePath.split(/[\\/]/).pop();
      porNome.set(nome, {
        varrido: true,
        achados: arquivo.messages.length,
        mensagens: JSON.stringify(arquivo.messages),
      });
    }
    for (const isca of ISCAS) {
      if (!porNome.has(isca.nome)) {
        porNome.set(isca.nome, { varrido: false, achados: 0, mensagens: "" });
      }
    }
    return porNome;
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

// --------------------------------------------------------------------------

Deno.test("o secretlint varre .ps1 e .bat", async (t) => {
  const ignore = await Deno.readTextFile(IGNORE);
  const regras = linhasDeRegra(ignore);

  await t.step("o .secretlintignore não ignora .ps1 nem .bat", () => {
    for (const extensao of ["ps1", "bat"]) {
      // Comparação por sufixo, e não `new RegExp(...)` montado com a
      // variável: regex não literal é warning de `security/detect-non-literal-
      // regexp`, e a catraca de lint não abre exceção para arquivo de teste.
      const culpadas = regras.filter((l) => {
        const baixo = l.toLowerCase();
        return baixo.endsWith(`.${extensao}`) || baixo.endsWith(`*${extensao}`);
      });
      assertEquals(
        culpadas,
        [],
        `o .secretlintignore voltou a ignorar .${extensao} (${culpadas.join(", ")}). Arquivo ignorado NÃO é aberto, e a saída fica idêntica à de um arquivo limpo — inclusive para supabase/setup/, onde mora script de configuração de banco.`,
      );
    }
  });

  await t.step("as linhas que NÃO são desta tarefa continuam lá", () => {
    // Binário e arquivo gerado saíram por outro motivo (ruído plausível de
    // verdade) e não podem cair de carona nesta mudança.
    for (const regra of [
      "*.png",
      "*.jpg",
      "*.jpeg",
      "*.gif",
      "node_modules/",
    ]) {
      assert(
        regras.includes(regra),
        `sumiu a linha "${regra}" do .secretlintignore, que não é desta tarefa`,
      );
    }
  });

  await t.step(
    "o package-lock.json continua FORA do .secretlintignore (3026016)",
    () => {
      // ADAPTACAO de 29/08/2026, conferindo contra o .secretlintignore de
      // HOJE como a emenda do laudo mandou: o teste de 20/08 exigia o
      // CONTRARIO (o lockfile na lista de excecoes), mas a develop tirou ele
      // de proposito no 3026016 — o lockfile carrega URL de registro, e URL
      // de registro privado carrega credencial. Arquivo ignorado NAO e
      // aberto; fora da lista, ele e varrido como qualquer outro.
      const culpadas = regras.filter((l) =>
        l.toLowerCase().includes("package-lock"),
      );
      assertEquals(
        culpadas,
        [],
        `o package-lock.json voltou ao .secretlintignore (${culpadas.join(", ")}): ponto cego na unica trava contra segredo commitado`,
      );
    },
  );

  const resultado = await rodarIscas();
  const de = (nome: string) => {
    const r = resultado.get(nome);
    assert(r, `isca "${nome}" não foi montada`);
    return r;
  };

  await t.step("CONTROLE DE INSTRUMENTO: a mesma isca em .js acende", () => {
    const r = de("controle.js");
    assert(
      r.varrido && r.achados > 0,
      `a isca de controle não acendeu (varrido=${r.varrido}, achados=${r.achados}). O instrumento está quebrado: nenhum outro resultado desta rodada vale.`,
    );
    assertStringIncludes(r.mensagens, "GitHub");
  });

  await t.step("POSITIVO: isca em .ps1 é VARRIDA e detectada", () => {
    const r = de("alvo.ps1");
    assert(
      r.varrido,
      "o .ps1 nem foi aberto. Some do json inteiro, e isso é indistinguível " +
        `de "limpo" para quem lê só exit code ou só messages: [].`,
    );
    assert(r.achados > 0, "o .ps1 foi varrido mas o token falso passou");
  });

  await t.step("POSITIVO 2: isca em .bat é VARRIDA e detectada", () => {
    const r = de("alvo.bat");
    assert(r.varrido, "o .bat nem foi aberto");
    assert(r.achados > 0, "o .bat foi varrido mas o token falso passou");
  });

  await t.step("NEGATIVO: .ps1 limpo é varrido e não acusa nada", () => {
    const r = de("limpo.ps1");
    assert(r.varrido, "o .ps1 limpo nem foi aberto");
    assertEquals(
      r.achados,
      0,
      `falso positivo num .ps1 sem segredo nenhum: ${r.mensagens}`,
    );
  });
});
