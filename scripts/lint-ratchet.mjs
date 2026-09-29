#!/usr/bin/env node
/**
 * Catraca de lint.
 *
 * Roda eslint e biome, conta erros e warnings, e compara com os tetos de
 * `.lint-baseline.json`. Reprova só se algum número SUBIR.
 *
 * Por que não é só `eslint .` no CI: este repositório entrou na dupla com
 * dívida pré-existente (7 erros e 553 warnings de eslint, 31 erros de biome,
 * medidos no CI em 30/07/2026 — números HISTÓRICOS, e a dívida caiu desde
 * então; os tetos vivos são os de `.lint-baseline.json`, sempre). Um job que reprova por causa dela ficaria
 * vermelho em todo PR desde o primeiro dia, e o resultado conhecido disso é
 * a equipe aprender a ignorar o CI inteiro — inclusive os jobs que importam.
 *
 * Por que não é `continue-on-error: true`: aquilo deixa um X vermelho
 * permanente no PR, com o mesmo efeito de treinar a dupla a ignorar X
 * vermelho. E um job que nunca pode falhar não vale nada.
 *
 * A catraca resolve os dois: nasce verde e bloqueia dívida nova.
 *
 * Uso: npm run lint:ratchet
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = JSON.parse(
  fs.readFileSync(path.join(RAIZ, ".lint-baseline.json"), "utf8"),
);

const NO_CI = Boolean(process.env.CI);

/**
 * Roda um comando e devolve a saída, mesmo quando o processo sai com erro
 * (eslint e biome saem com 1 quando acham algo — que é o caso normal aqui).
 *
 * O maxBuffer alto não é exagero: o JSON do eslint deste repositório passa de
 * 1,1 MB, e o padrão do Node é 1 MB. Com o padrão, a saída chega truncada no
 * meio de uma string e o JSON.parse estoura com "Unterminated string" — um
 * erro que parece bug do eslint e não é.
 */
function rodar(comando) {
  const maxBuffer = 256 * 1024 * 1024;
  try {
    return execSync(comando, {
      cwd: RAIZ,
      encoding: "utf8",
      stdio: "pipe",
      maxBuffer,
    });
  } catch (e) {
    if (e.code === "ENOBUFS") {
      throw new Error(
        `A saída de \`${comando}\` estourou ${maxBuffer} bytes. Aumente o maxBuffer aqui.`,
      );
    }
    return `${e.stdout || ""}${e.stderr || ""}`;
  }
}

/**
 * O `--cache` NAO afrouxa a catraca: o eslint guarda o RESULTADO de cada
 * arquivo (achados inclusive) chaveado por conteudo e pelo hash da config, e
 * devolve o mesmo relatorio na rodada seguinte. O que ele evita e' reanalisar
 * arquivo que nao mudou.
 *
 * `--cache-strategy content` em vez do padrao (metadata, por mtime+tamanho):
 * trocar de branch reescreve o mtime de arquivo com o MESMO conteudo, e pelo
 * padrao isso invalidaria o cache inteiro justamente no momento em que ele mais
 * serve. Por conteudo, so muda o que mudou de verdade.
 *
 * POR QUE ISTO IMPORTA AQUI, medido em 10/08/2026: uma unica regra —
 * `tailwindcss/no-custom-classname` — respondia por 97,9% do tempo do eslint
 * nesta maquina (609 s de 627 s em 76 arquivos), enquanto produzia 33 dos 553
 * warnings. No Linux do CI a catraca inteira fecha em 1,2 min; no Windows
 * passava de 40. O custo caia sobre cada subagente que rodava a verificacao, e
 * a regra continua ligada porque ela pega classe Tailwind escrita errada, que
 * falha em silencio — o cache tira o preco sem tirar o sinal.
 *
 * No CI nao ha cache em disco, entao a primeira (e unica) rodada mede tudo do
 * zero, como antes. Quem cobra continua sendo o CI.
 */
function contarEslint() {
  const saida = rodar(
    "npx eslint . --format json --cache --cache-strategy content",
  );
  const inicio = saida.indexOf("[");
  if (inicio === -1) {
    throw new Error(`eslint não devolveu JSON:\n${saida.slice(0, 800)}`);
  }
  let errors = 0;
  let warnings = 0;
  for (const arquivo of JSON.parse(saida.slice(inicio))) {
    errors += arquivo.errorCount;
    warnings += arquivo.warningCount;
  }
  return { errors, warnings };
}

/**
 * Acha o primeiro objeto JSON top-level dentro de `saida` e devolve o seu
 * `JSON.parse`, ou `null` se não achar chave casada.
 *
 * Por que não dá pra fazer como o `contarEslint` faz com `[` — pegar do
 * primeiro caractere até o fim e mandar direto pro `JSON.parse`: o
 * `--reporter=json` do Biome escreve o resumo JSON e DEPOIS ainda imprime,
 * na MESMA saída, o rodapé decorativo ("check ━━━...", "× Some errors...");
 * texto sobrando depois do `}` que quebra o parser. E não dá pra contar
 * chave por caractere sem saber se está dentro de string: o campo
 * `dictionary` de um diff de formatação carrega código-fonte inteiro, com
 * `{`/`}` de verdade dentro do valor.
 */
function primeiroJsonBalanceado(saida) {
  const inicio = saida.indexOf("{");
  if (inicio === -1) return null;
  let profundidade = 0;
  let dentroDeString = false;
  let escapando = false;
  for (let i = inicio; i < saida.length; i++) {
    // `.charAt`, não `saida[i]`: indexação por variável dispara
    // security/detect-object-injection (a regra não distingue string de
    // objeto), e este script não pode ser o primeiro a furar a própria
    // catraca que instala — mesmo motivo do comentário sobre `comparacoes`
    // mais abaixo, já existente antes desta correção.
    const c = saida.charAt(i);
    if (dentroDeString) {
      if (escapando) escapando = false;
      else if (c === "\\") escapando = true;
      else if (c === '"') dentroDeString = false;
      continue;
    }
    if (c === '"') dentroDeString = true;
    else if (c === "{") profundidade++;
    else if (c === "}") {
      profundidade--;
      if (profundidade === 0) {
        try {
          return JSON.parse(saida.slice(inicio, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * lint-ratchet-103 — antes desta correção, `contarBiome` só extraía o número
 * por regex (`/Found (\d+) errors?\./`) em cima de `npx biome check .` (saída
 * decorativa, não pensada pra máquina ler) e, quando a regex não casava,
 * devolvia `{errors: 0, warnings: 0}` sem distinguir "zero achados" de
 * "o Biome não rodou". Isso é diferente do teto (`.lint-baseline.json`,
 * hoje 19 erros): {errors:0} SEMPRE lê como "a dívida caiu pra zero" —
 * delta negativo, `baixou`, a catraca nunca chama `process.exit`.
 * `contarEslint` já tinha o guarda certo (lança se a saída não tiver `[`);
 * a assimetria era o defeito.
 *
 * Reproduzido (ver relatório da tarefa): `npx biome check --reporter=json
 * /caminho/inexistente` sai com exit 1 e a saída JSON tem
 * `summary.errors: 0, summary.warnings: 0` — igual ao caso de zero achados
 * de verdade — mesmo com um diagnóstico `internalError/io` no array, porque
 * `summary.errors` só conta achado de lint/formatação, nunca falha de
 * execução. Por isso o guarda abaixo NÃO confia só em `summary.errors`: ele
 * exige que o Biome tenha de fato PROCESSADO arquivo (`changed + unchanged +
 * matches > 0`). Rodando `npx biome check .` na raiz do repo, esse total é
 * sempre > 0 quando o Biome roda de verdade — se vier zero, ou a saída não
 * tem `summary` nenhum, é falha de execução, e falha de execução REPROVA
 * (lança), nunca vira "zero achados". Isso vale em qualquer ambiente: o
 * `cobra: NO_CI` mais abaixo (Windows/CRLF) só decide se a CONTAGEM cobra o
 * PR; aqui a pergunta é "o Biome respondeu alguma coisa", que é anterior a
 * isso e não tem exceção de sistema operacional.
 *
 * `executar` tem valor padrão (`rodar`) só pra o teste poder injetar uma
 * saída falsa sem precisar mexer em PATH nem em processo de verdade.
 */
export function contarBiome(executar = rodar) {
  const saida = executar("npx biome check --reporter=json .");
  const resumo = primeiroJsonBalanceado(saida)?.summary;
  const arquivosProcessados =
    resumo && resumo.changed + resumo.unchanged + resumo.matches;
  // As contagens têm de ser NÚMEROS: um resumo com as chaves renomeadas
  // devolveria undefined, o delta contra o teto viraria NaN (nem > 0 nem
  // < 0) e a catraca aprovaria em silêncio (ressalva da revisão).
  const contagensSaoNumeros =
    resumo &&
    typeof resumo.errors === "number" &&
    typeof resumo.warnings === "number";
  if (!resumo || !arquivosProcessados || !contagensSaoNumeros) {
    throw new Error(
      `biome não rodou (nenhum arquivo processado) ou o resumo veio sem contagens numéricas — trate como falha de execução, nunca como "zero achados":\n${saida.slice(0, 800)}`,
    );
  }
  return { errors: resumo.errors, warnings: resumo.warnings };
}

/**
 * Lê `biome.json` NO ATO (não presume nem cacheia de memória) e devolve
 * `files.ignore` — as pastas que o Biome não olha nem no CI nem aqui.
 *
 * Isto existe porque o número de Biome, sozinho, não diz de si mesmo se pode
 * ter relação com o diff de quem está lendo. Quem mexeu só em pasta ignorada
 * (ex.: `supabase/`, hoje) precisa saber que o Biome não tem como ter opinião
 * sobre aquele diff — sem isso, a única pista disponível vira a explicação de
 * CRLF abaixo, que nem sempre é a certa.
 */
function pastasIgnoradasPeloBiome() {
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(RAIZ, "biome.json"), "utf8"),
    );
    // `Array.isArray` e não `?? []`: um `"ignore": "supabase"` (string em vez de
    // array, erro de digitação plausível) é JSON válido, escapa do catch, e
    // quebra no `.join` do consumidor com um TypeError que parece defeito de
    // infraestrutura. Formato errado é tão "ilegível" quanto arquivo ausente.
    const ignore = config.files?.ignore;
    return Array.isArray(ignore) ? ignore : [];
  } catch {
    // biome.json ilegível não pode derrubar a catraca — o diagnóstico fica
    // mais pobre, mas o script continua reprovando/aprovando pelo número.
    return [];
  }
}

/**
 * Todo o corpo executável do script mora aqui dentro, e não solto no topo do
 * módulo, por causa do teste desta correção (lint-ratchet-103): o teste
 * importa este arquivo para chamar `contarBiome` isolado, e um `import` de
 * módulo ESM roda o topo do arquivo inteiro. Sem este `main()` e o guarda no
 * fim do arquivo, IMPORTAR o script pra testar já dispararia eslint e biome
 * de verdade (lento e ruidoso dentro da suíte) e, pior, o `process.exit(1)`
 * de baixo terminaria o processo do test runner no meio — mesmo padrão já
 * usado em scripts/guarda-de-branch.mjs pelo mesmo motivo.
 */
function main() {
  const medido = { eslint: contarEslint(), biome: contarBiome() };

  /**
   * O Biome só é COBRADO no CI.
   *
   * Motivo medido: no Linux do CI ele acha 31 erros; na máquina Windows do
   * Gabriel, 100. A diferença não é código, é fim de linha — o repositório
   * está em CRLF no disco e o Biome formata em LF por padrão, então no
   * Windows ele reclama de arquivos que no CI passam. Cobrar isso localmente
   * reprovaria qualquer commit feito no Windows, o que é pior do que não
   * cobrar.
   *
   * A correção de verdade é normalizar fim de linha (`.gitattributes` com
   * `eol=lf`), que é uma mudança grande e vai junto com a INFRA-220.
   *
   * (Isto é sobre a CONTAGEM ser diferente por causa de CRLF, não sobre o
   * Biome deixar de rodar — a falha de execução do lint-ratchet-103, acima,
   * reprova em qualquer sistema, sem exceção de Windows.)
   */
  // Acesso estático de propriedade, não `objeto[variavel]`: indexação
  // dinâmica dispara security/detect-object-injection, e este script não
  // pode ser o primeiro a furar a própria catraca que instala.
  const comparacoes = [
    {
      ferramenta: "eslint",
      tipo: "errors",
      agora: medido.eslint.errors,
      teto: BASE.eslint.errors,
      cobra: true,
    },
    {
      ferramenta: "eslint",
      tipo: "warnings",
      agora: medido.eslint.warnings,
      teto: BASE.eslint.warnings,
      cobra: true,
    },
    {
      ferramenta: "biome",
      tipo: "errors",
      agora: medido.biome.errors,
      teto: BASE.biome.errors,
      cobra: NO_CI,
    },
    {
      ferramenta: "biome",
      tipo: "warnings",
      agora: medido.biome.warnings,
      teto: BASE.biome.warnings,
      cobra: NO_CI,
    },
  ];

  const linhas = [];
  let subiu = false;
  let baixou = false;

  for (const { ferramenta, tipo, agora, teto, cobra } of comparacoes) {
    const delta = agora - teto;

    let situacao = "ok";
    if (delta > 0) {
      situacao = cobra
        ? `SUBIU +${delta}`
        : `subiu +${delta} (não cobrado fora do CI)`;
      if (cobra) subiu = true;
    } else if (delta < 0) {
      situacao = `baixou ${delta} — abaixe o teto`;
      if (cobra) baixou = true;
    }

    linhas.push({ ferramenta, tipo, agora, teto, situacao });
  }

  const col = (s) => String(s).padEnd(11);
  console.log(
    [
      `${col("ferramenta")}${col("tipo")}${col("agora")}${col("teto")}situação`,
      "".padEnd(72, "-"),
      ...linhas.map(
        (l) =>
          `${col(l.ferramenta)}${col(l.tipo)}${col(l.agora)}${col(l.teto)}${l.situacao}`,
      ),
    ].join("\n"),
  );

  if (!NO_CI) {
    const ignoradas = pastasIgnoradasPeloBiome();
    const linhaIgnoradas = ignoradas.length
      ? `O Biome não olha estas pastas (biome.json → files.ignore): ${ignoradas.join(", ")}.\nSe o seu diff só tocou uma delas, o número de Biome acima não pode falar dele.\n`
      : "";
    console.log(
      `\nFora do CI o Biome não é cobrado — quem cobra é o CI (Linux). Este script não mede\nquanto do excesso local é fim de linha (CRLF); não trate isso como a causa sem medir.\n${linhaIgnoradas}Para medir Biome nesta máquina sem esse ruído, siga a receita em ~/.claude/mural/core_app_mkt/_REGRAS.md.`,
    );
  }

  const resumo = process.env.GITHUB_STEP_SUMMARY;
  if (resumo) {
    const md = [
      "## Catraca de lint",
      "",
      "| ferramenta | tipo | agora | teto | situação |",
      "| --- | --- | --- | --- | --- |",
      ...linhas.map(
        (l) =>
          `| ${l.ferramenta} | ${l.tipo} | ${l.agora} | ${l.teto} | ${l.situacao} |`,
      ),
      "",
      subiu
        ? "**Reprovado.** Alguma contagem subiu. Corrija o que este PR introduziu, ou justifique e suba o teto em `.lint-baseline.json` explicitamente."
        : baixou
          ? "Aprovado — e alguma contagem **caiu**. Abaixe o teto em `.lint-baseline.json` neste mesmo PR, senão a dívida volta sem ninguém perceber."
          : "Aprovado. Nada subiu.",
      "",
    ].join("\n");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho vem do runner do GitHub Actions, não de entrada de usuário
    fs.appendFileSync(resumo, md);
  }

  if (subiu) {
    console.error(
      "\nReprovado: a dívida de lint aumentou.\n" +
        "Rode `npx eslint .` e corrija o que o seu PR introduziu.\n" +
        "Se o aumento for intencional, suba o teto em .lint-baseline.json e explique no PR.",
    );
    process.exit(1);
  }

  if (baixou) {
    console.log(
      "\nAlguma contagem caiu. Abaixe o teto em .lint-baseline.json neste PR,\n" +
        "senão a dívida pode voltar sem o CI reclamar.",
    );
  }
}

// Só executa quando chamado como programa (`node scripts/lint-ratchet.mjs`).
// Mesmo guarda de scripts/guarda-de-branch.mjs: sem ele, o teste que importa
// este módulo para chamar `contarBiome` isolado dispararia o script inteiro
// de passagem.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
