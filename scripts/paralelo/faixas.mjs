/* eslint-disable security/detect-object-injection --
 * Índices numéricos de arrays locais (percurso de segmentos de glob) e consulta
 * de `liberados` por chave comparada com ===: o manifesto é JSON versionado,
 * escrito pelo time, nunca entrada de rede. Nada aqui executa ou atribui por chave. */
/**
 * Faixas de arquivo das frentes paralelas — a garantia "sem conflito".
 *
 * Por que existe: paralelizar ESCRITA só é seguro se duas frentes nunca podem
 * tocar o mesmo arquivo. Isolar em worktree evita que uma sobrescreva a outra
 * em disco, mas NÃO evita o conflito de merge depois. A única defesa de verdade
 * é decidir ANTES quem é dono de cada arquivo e provar que os donos não se
 * cruzam. Este módulo é essa prova: funções puras, sem rede e sem git, para a
 * decomposição ser validada em milissegundos e testada sem ambiente.
 *
 * Três ideias, todas aprendidas neste repositório (ver
 * docs/processo/ARQUITETURA-PARALELA.md):
 *
 * 1. POSSE — cada frente lista globs que ela e só ela escreve. Dois globs que
 *    PODEM casar o mesmo arquivo contam como sobreposição (teste conservador:
 *    falso alarme custa uma conversa; falso "ok" custa um merge quebrado).
 * 2. COMPARTILHADOS — arquivos que quase toda feature quer tocar e que não
 *    admitem dois autores (lockfile, tipos gerados, roteador, vercel.json…).
 *    Nenhuma frente é dona deles por padrão: a frente PEDE a mudança no
 *    relatório e o integrador aplica uma vez só, no fim. O manifesto pode
 *    ENTREGAR um deles a uma única frente (`liberados`).
 * 3. FAIXA DE MIGRATION — a versão é um timestamp sequencial; duas frentes
 *    criando migration colidem na numeração e na ordem de aplicação. Cada
 *    frente que mexe em banco recebe um intervalo de prefixos de 8 dígitos.
 */

/** Arquivos que não admitem dois autores. Edite por PR: é política do repo. */
export const COMPARTILHADOS_PADRAO = Object.freeze([
  "package.json",
  "package-lock.json",
  "src/types/database.types.ts",
  "src/types/index.ts",
  "src/App.tsx",
  "src/config/rotas.ts",
  "scripts/hospedagem.mjs",
  "tests/front/rotas-de-entrada.test.ts",
  "tests/front/hospedagem-rotas.test.ts",
  "vercel.json",
  "supabase/config.toml",
  ".github/workflows/**",
  "tests/banco/LEIA-ME.md",
  "tests/ci_conferir_banco_test.ts",
  "DEPLOYMENT.md",
  "CHANGELOG.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".lint-baseline.json",
  ".size-limit.cjs",
  "scripts/portaoDividido.ts",
  // Configuração que roda os hooks e os portões: uma frente que a altera muda as
  // regras de TODAS as outras (e `commitar` é auto-aprovado em settings.json).
  "lefthook.yml",
  ".commitlintrc.json",
  ".secretlintrc.json",
  ".secretlintignore",
  "eslint.config.js",
  "eslint.config.rapido.js",
  "biome.json",
  "knip.json",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "tsconfig.middleware.json",
  "vite.config.ts",
  "vitest.config.ts",
  "vitest.porteiro.config.ts",
  ".vercelignore",
  ".dependency-cruiser.cjs",
  "deno.json",
  "deno.lock",
  // Processo, não produto: faixa, agentes e manifestos são do orquestrador.
  // Inclui `.claude/lane.json` — a frente não alarga a própria faixa.
  ".claude/**",
  "docs/superpowers/lanes/**",
  "scripts/paralelo/**",
]);

const NOME_DE_FRENTE = /^[a-z0-9][a-z0-9-]{0,39}$/;
/**
 * Plano + frente cabem na mensagem do merge de `integrar`
 * (`chore(<escopo>): integra <frente> (<plano>)`) sob o `header-max-length` 100
 * do commitlint: 20 fixos + escopo (até ~13) + frente + plano. Sobra 60.
 */
export const ORCAMENTO_DE_NOMES = 60;
const PREFIXO_DE_MIGRATION = /^\d{8}$/;

/** Troca `\` por `/` e tira `./` e `/` inicial — o git sempre fala com `/`. */
export function normalizar(caminho) {
  return String(caminho)
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

function escaparRegex(texto) {
  return texto.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/**
 * Glob → RegExp. Suporta `**` (zero ou mais segmentos), `*` (dentro de um
 * segmento) e `?`. Sem chaves nem classes: a posse tem que ser legível.
 */
export function globParaRegex(glob, { semCaixa = false } = {}) {
  const g = normalizar(glob);
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") {
      // `**/` casa zero ou mais diretórios; `**` no fim casa qualquer resto.
      if (g[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += escaparRegex(c);
    }
  }
  // eslint-disable-next-line security/detect-non-literal-regexp -- `re` é montado só com literais e com o texto do glob já escapado por escaparRegex.
  return new RegExp(`^${re}$`, semCaixa ? "i" : "");
}

export function casa(glob, caminho) {
  return globParaRegex(glob).test(normalizar(caminho));
}

/**
 * Sem distinguir caixa: Windows e macOS (o disco do dono) tratam `src/app.tsx` e
 * `src/App.tsx` como o MESMO arquivo, então a lista de compartilhados tem que casar assim.
 */
export function casaSemCaixa(glob, caminho) {
  return globParaRegex(glob, { semCaixa: true }).test(normalizar(caminho));
}

const temCuringa = (s) => /[*?]/.test(s);

/**
 * Dois globs PODEM casar o mesmo arquivo? Percorre segmento a segmento.
 * Conservador: na dúvida (curinga contra curinga), diz que sim.
 */
export function globsSeSobrepoem(a, b) {
  // Minúsculas: duas frentes que criam `src/Foo.ts` e `src/foo.ts` colidem no disco do dono.
  const sa = normalizar(a).toLowerCase().split("/");
  const sb = normalizar(b).toLowerCase().split("/");
  return sobrepoe(sa, 0, sb, 0);
}

function sobrepoe(sa, i, sb, j) {
  if (i === sa.length && j === sb.length) return true;
  const x = sa[i];
  const y = sb[j];
  // `**` num dos lados engole o que vier: se o outro lado também acabou ou tem
  // qualquer coisa, pode casar. Conservador de propósito.
  // `includes`, não `===`: `**` dentro de um segmento (`src/lib/**.ts`, `src/t**`) vira `.*`
  // em globParaRegex e atravessa `/` — tratá-lo como curinga de um segmento só dava falso "disjunto".
  if (x?.includes("**") || y?.includes("**")) return true;
  if (i === sa.length || j === sb.length) return false;
  if (!temCuringa(x) && !temCuringa(y)) {
    return x === y && sobrepoe(sa, i + 1, sb, j + 1);
  }
  if (!temCuringa(x))
    return globParaRegex(y).test(x) && sobrepoe(sa, i + 1, sb, j + 1);
  if (!temCuringa(y))
    return globParaRegex(x).test(y) && sobrepoe(sa, i + 1, sb, j + 1);
  // curinga contra curinga no mesmo segmento: não dá para provar disjunção.
  return sobrepoe(sa, i + 1, sb, j + 1);
}

/** `20261206000000_nome.sql` ou `rollback-manual-20261206000000_nome.sql` → 8 dígitos. */
export function prefixoDeMigration(caminho) {
  const n = normalizar(caminho);
  const m =
    /^supabase\/migrations\/(\d{14})_[^/]+\.sql$/.exec(n) ??
    /^rollback-manual-(\d{14})_[^/]+\.sql$/.exec(n);
  return m ? m[1].slice(0, 8) : null;
}

/** O caminho é de migration (ou do seu rollback manual)? */
export function ehMigration(caminho) {
  const n = normalizar(caminho);
  return n.startsWith("supabase/migrations/") || /^rollback-manual-/.test(n);
}

/**
 * Valida o manifesto. Devolve `{ erros, avisos }`; ok quando `erros` é vazio.
 * `maiorMigrationExistente` (prefixo de 8 dígitos) vem de fora para o módulo
 * continuar puro.
 */
export function validarManifesto(
  manifesto,
  { maiorMigrationExistente = null } = {},
) {
  const erros = [];
  const avisos = [];
  if (!manifesto || typeof manifesto !== "object") {
    return { erros: ["manifesto ausente ou não é objeto JSON"], avisos };
  }
  if (!NOME_DE_FRENTE.test(String(manifesto.plano ?? ""))) {
    erros.push(
      `"plano" inválido (minúsculas, números e hífen, até 40): ${manifesto.plano}`,
    );
  }
  const frentes = Array.isArray(manifesto.frentes) ? manifesto.frentes : [];
  if (frentes.length === 0) erros.push('"frentes" vazio: nada a paralelizar');
  if (frentes.length === 1) {
    avisos.push(
      "só uma frente: paralelizar não ganha nada — use /executar-plano",
    );
  }

  const nomes = new Set();
  for (const f of frentes) {
    if (!NOME_DE_FRENTE.test(String(f?.nome ?? ""))) {
      erros.push(`frente com nome inválido: ${f?.nome}`);
      continue;
    }
    if (
      String(manifesto.plano ?? "").length + f.nome.length >
      ORCAMENTO_DE_NOMES
    ) {
      erros.push(
        `frente ${f.nome}: plano + frente passam de ${ORCAMENTO_DE_NOMES} caracteres — a mensagem do merge estouraria o limite de 100 do commitlint`,
      );
    }
    if (nomes.has(f.nome)) erros.push(`frente repetida: ${f.nome}`);
    nomes.add(f.nome);
    if (!Array.isArray(f.posse) || f.posse.length === 0) {
      erros.push(`frente ${f.nome}: "posse" vazia — sem arquivo, sem frente`);
    }
    for (const g of f.posse ?? []) {
      if (typeof g !== "string" || g.trim() === "") {
        erros.push(`frente ${f.nome}: glob de posse inválido`);
      } else if (normalizar(g).startsWith("**") || normalizar(g) === "*") {
        erros.push(
          `frente ${f.nome}: glob largo demais ("${g}") — ancore num diretório`,
        );
      } else if (
        normalizar(g)
          .split("/")
          .some((seg) => seg.includes("**") && seg !== "**")
      ) {
        erros.push(
          `frente ${f.nome}: "**" só vale como segmento inteiro ("${g}") — use "dir/**" ou "dir/**/*.ts"`,
        );
      } else if (ehMigration(g)) {
        erros.push(
          `frente ${f.nome}: migration não entra em "posse" ("${g}") — use "faixa_migrations"`,
        );
      }
    }
  }

  // Migrations: intervalos disjuntos e acima do que já existe.
  const faixas = [];
  for (const f of frentes) {
    const fm = f?.faixa_migrations;
    if (fm == null) continue;
    const { de, ate } = fm;
    if (
      !PREFIXO_DE_MIGRATION.test(String(de)) ||
      !PREFIXO_DE_MIGRATION.test(String(ate))
    ) {
      erros.push(
        `frente ${f.nome}: faixa_migrations exige "de"/"ate" com 8 dígitos`,
      );
      continue;
    }
    if (de > ate) {
      erros.push(
        `frente ${f.nome}: faixa_migrations invertida (${de} > ${ate})`,
      );
      continue;
    }
    if (maiorMigrationExistente && de <= maiorMigrationExistente) {
      erros.push(
        `frente ${f.nome}: faixa_migrations começa em ${de}, mas já existe migration ${maiorMigrationExistente}`,
      );
    }
    faixas.push({ nome: f.nome, de, ate });
  }
  for (let i = 0; i < faixas.length; i++) {
    for (let j = i + 1; j < faixas.length; j++) {
      const a = faixas[i];
      const b = faixas[j];
      if (a.de <= b.ate && b.de <= a.ate) {
        erros.push(
          `faixas de migration se cruzam: ${a.nome} (${a.de}-${a.ate}) × ${b.nome} (${b.de}-${b.ate})`,
        );
      }
    }
  }

  // Posse: duas frentes não podem ter globs que se cruzam.
  for (let i = 0; i < frentes.length; i++) {
    for (let j = i + 1; j < frentes.length; j++) {
      for (const ga of frentes[i]?.posse ?? []) {
        for (const gb of frentes[j]?.posse ?? []) {
          if (
            typeof ga === "string" &&
            typeof gb === "string" &&
            globsSeSobrepoem(ga, gb)
          ) {
            erros.push(
              `posse se cruza: ${frentes[i].nome} "${ga}" × ${frentes[j].nome} "${gb}"`,
            );
          }
        }
      }
    }
  }

  // Compartilhados: ninguém é dono, a menos que o manifesto entregue a UMA frente.
  // Só se libera um caminho EXATO (nunca glob), para UMA frente: quem recebe vira
  // o único autor daquele arquivo, e a posse dela tem que citá-lo literalmente.
  const liberados = Object.fromEntries(
    Object.entries(manifesto.liberados ?? {}).map(([arq, dono]) => [
      normalizar(arq),
      dono,
    ]),
  );
  const compartilhados = [
    ...COMPARTILHADOS_PADRAO,
    ...(manifesto.compartilhados ?? []),
  ];
  for (const [arq, dono] of Object.entries(liberados)) {
    if (temCuringa(arq))
      erros.push(`liberados: "${arq}" é glob — só caminho exato`);
    if (!nomes.has(dono))
      erros.push(`liberados: "${arq}" entregue a frente inexistente "${dono}"`);
    if (!compartilhados.some((c) => globsSeSobrepoem(c, arq))) {
      avisos.push(`liberados: "${arq}" nem era compartilhado — entrada inútil`);
    }
  }
  for (const f of frentes) {
    for (const g of f?.posse ?? []) {
      if (typeof g !== "string") continue;
      for (const c of compartilhados) {
        if (!globsSeSobrepoem(c, g)) continue;
        if (liberados[normalizar(g)] === f.nome) continue;
        erros.push(
          `frente ${f.nome}: "${g}" encosta no arquivo compartilhado "${c}" — peça ao integrador ou libere o caminho exato em "liberados"`,
        );
      }
    }
  }
  return { erros, avisos };
}

/**
 * A frente pode escrever neste caminho? Devolve `{ ok, motivo }`.
 * `frente` é uma entrada do manifesto; `manifesto` dá os compartilhados.
 */
export function arquivoPermitido(frente, manifesto, caminho) {
  const n = normalizar(caminho);
  // 1. Liberado explicitamente a esta frente (inclusive compartilhado).
  for (const [arq, dono] of Object.entries(manifesto.liberados ?? {})) {
    if (normalizar(arq) === n) {
      return dono === frente.nome
        ? { ok: true }
        : { ok: false, motivo: `entregue à frente "${dono}" (liberados)` };
    }
  }
  // 2. Migration: só dentro da faixa da frente.
  if (ehMigration(n)) {
    const prefixo = prefixoDeMigration(n);
    const fm = frente.faixa_migrations;
    if (!prefixo)
      return {
        ok: false,
        motivo: "nome de migration fora do padrão de 14 dígitos",
      };
    if (!fm)
      return { ok: false, motivo: "esta frente não tem faixa_migrations" };
    return prefixo >= fm.de && prefixo <= fm.ate
      ? { ok: true }
      : {
          ok: false,
          motivo: `migration ${prefixo} fora da faixa ${fm.de}-${fm.ate}`,
        };
  }
  // 3. Compartilhado: de ninguém.
  const compartilhados = [
    ...COMPARTILHADOS_PADRAO,
    ...(manifesto.compartilhados ?? []),
  ];
  const c = compartilhados.find((g) => casaSemCaixa(g, n));
  if (c)
    return {
      ok: false,
      motivo: `arquivo compartilhado (${c}) — peça ao integrador`,
    };
  // 4. Posse da frente.
  if ((frente.posse ?? []).some((g) => casa(g, n))) return { ok: true };
  return { ok: false, motivo: "fora da posse desta frente" };
}

/** Confere uma lista de caminhos alterados; devolve as violações. */
export function conferirAlterados(frente, manifesto, caminhos) {
  const violacoes = [];
  for (const c of caminhos) {
    const r = arquivoPermitido(frente, manifesto, c);
    if (!r.ok) violacoes.push({ caminho: normalizar(c), motivo: r.motivo });
  }
  return violacoes;
}

/** Maior prefixo de 8 dígitos entre nomes de migration reais. */
export function maiorPrefixoDeMigration(nomesDeArquivo) {
  let maior = null;
  for (const nome of nomesDeArquivo) {
    const p = prefixoDeMigration(`supabase/migrations/${nome}`);
    if (p && (maior === null || p > maior)) maior = p;
  }
  return maior;
}
