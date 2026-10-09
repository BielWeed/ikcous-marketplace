/* eslint-disable security/detect-non-literal-fs-filename --
 * Lê só `.claude/settings.json` do próprio repositório; o caminho é constante. */
// @vitest-environment node
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * As regras de permissão do `.claude/settings.json` que seguram as frentes paralelas.
 *
 * O que este teste PROVA: com a semântica de casamento que a documentação do Claude Code garante
 * (`*` casa qualquer texto, `Bash(x *)` casa também `x` sozinho, `:*` final = ` *`; deny vence ask
 * vence allow; deny/ask valem para QUALQUER subcomando de um comando composto) e que foi conferida
 * contra o motor real (`claude -p` sem modelo, 09/10/2026), a forma LITERAL de cada flag que faz
 * uma ferramenta auto-aprovada carregar e EXECUTAR um arquivo escolhido pela frente é barrada, e o
 * uso legítimo (`npx eslint src/admin-card.tsx --quiet`) segue sem pedir confirmação.
 *
 * O que NÃO prova (e por isso o último bloco documenta): o casamento é TEXTUAL. Aspas partidas,
 * barra invertida e ferramentas que leem configuração ao lado do arquivo escapam de qualquer
 * regra. A regra é um quebra-molas, não uma fronteira — a fronteira é `integrar` + revisão.
 */
const RAIZ = resolve(__dirname, "../..");
const settings = JSON.parse(
  readFileSync(join(RAIZ, ".claude/settings.json"), "utf8"),
) as { permissions: { allow: string[]; ask: string[]; deny: string[] } };
const { allow, ask, deny } = settings.permissions;

/** `Bash(<padrão>)` → o padrão, ou null se a regra é de outra ferramenta. */
const padraoDeBash = (regra: string): string | null => {
  const m = /^Bash\((.*)\)$/s.exec(regra);
  return m ? m[1] : null;
};

/** Casamento de UMA regra Bash com UM comando simples, como a doc descreve. */
function casa(padrao: string, comando: string): boolean {
  const p = padrao.endsWith(":*") ? `${padrao.slice(0, -2)} *` : padrao;
  const cmd = comando.trim().replace(/\s+/g, " "); // o motor normaliza espaços (medido)
  // `Bash(ls *)` casa também `ls`, desde que o `*` final seja o único curinga.
  const soUmCuringa = p.endsWith(" *") && !p.slice(0, -2).includes("*");
  if (soUmCuringa && cmd === p.slice(0, -2)) return true;
  const re = p
    .split("*")
    .map((t) => t.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  // eslint-disable-next-line security/detect-non-literal-regexp -- `re` é montado só com literais escapados acima.
  return new RegExp(`^${re}$`, "s").test(cmd);
}

type Decisao = "deny" | "ask" | "allow" | "pergunta";

/**
 * Descasque que a doc garante antes de casar deny/ask: `timeout`, `time`, `nice`, `nohup`, `stdbuf` e
 * qualquer atribuição `VAR=valor` à frente (para allow o motor só descasca variáveis seguras; aqui o
 * allow usa o texto cru, que é o mais conservador).
 */
const semEmbrulho = (parte: string): string => {
  let atual = parte;
  for (;;) {
    const proximo = atual
      .replace(/^timeout\s+\S+\s+/, "")
      .replace(/^(?:time|nice|nohup)\s+/, "")
      .replace(/^[A-Za-z_]\w*=\S*\s+/, "");
    if (proximo === atual) return atual;
    atual = proximo;
  }
};

/** Decisão do motor para um comando: deny e ask valem se QUALQUER subcomando casa; allow, se TODOS. */
function decidir(comando: string): Decisao {
  const partes = comando
    .split(/&&|\|\||;|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
  const casaAlguma = (regras: string[], parte: string) =>
    regras.some((r) => {
      const p = padraoDeBash(r);
      return p !== null && casa(p, parte);
    });
  if (partes.some((p) => casaAlguma(deny, semEmbrulho(p)))) return "deny";
  if (partes.some((p) => casaAlguma(ask, semEmbrulho(p)))) return "ask";
  if (partes.every((p) => casaAlguma(allow, p))) return "allow";
  return "pergunta";
}

describe("permissões das frentes: flags que carregam arquivo da frente", () => {
  const barradas = [
    "npx eslint -c x.mjs src",
    "npx eslint src --config=x.mjs",
    "npx eslint --config x.mjs",
    "npx eslint --parser x src",
    "npx eslint --plugin x src",
    "npx eslint --flag v10_config_lookup_from_file src/a/x.ts",
    "npx knip --config x",
    "npx knip -c x",
    "npx knip --directory d",
    "npx vite build --config x",
    "npx vite build -c x",
    "npx vite preview -c x",
    "npx vite preview --config=x",
    "npx stylelint -c x a.css",
    "npx stylelint a.css --custom-syntax x",
    "npx stylelint a.css --custom-formatter x",
    "npx cspell -c x a",
    "npx cspell a --config x",
    "npx htmlhint --rulesdir d x.html",
    "npx htmlhint -R d x.html",
    "npx commitlint -g x",
    "npx commitlint --config=x",
    "npx commitlint --extends x",
    "npx commitlint -p x",
    "npx commitlint --parser-preset x",
    "npx commitlint --cwd d",
    // `git show/diff/log --output=<arquivo>` escreve o conteúdo de um blob da frente por cima de
    // qualquer arquivo (medido): é a via sem aspas para sobrescrever scripts/paralelo/.
    "git show HEAD:src/lib/x.mjs --output=scripts/paralelo/frente.mjs",
    "git diff --output=x",
    "git log --output=x",
    // aspas que preservam o texto da flag continuam casando a subcadeia
    "git show HEAD:a '--output=x'",
    'npx eslint "--config" x',
    // composto, espaço duplo, wrapper e atribuição de variável segura: o motor ainda vê o subcomando
    "npx  eslint   -c x",
    "timeout 5 npx eslint -c x",
    "NODE_ENV=test npx eslint -c x src",
    "echo ok && npx eslint -c x",
    "npx eslint src; npx knip --config x",
  ];
  it.each(barradas)("deny: %s", (cmd) => {
    expect(decidir(cmd)).toBe("deny");
  });

  const pedemConfirmacao = [
    "npx eslint -f json src",
    "npx eslint --format ./f.js src",
    "npx knip --reporter ./r.js",
    "npx knip --preprocessor p",
    "npx commitlint -o x",
    "git push origin main",
  ];
  it.each(pedemConfirmacao)("ask: %s", (cmd) => {
    expect(decidir(cmd)).toBe("ask");
  });

  const liberadas = [
    "npx eslint src/a.ts --quiet",
    "npx eslint src/admin-card.tsx", // `-c` dentro do nome do arquivo não pode casar
    "npx eslint src/foo-config.ts",
    "npx eslint --fix src/a.ts",
    "npx eslint --max-warnings 0 src",
    "npx knip",
    "npx knip --production",
    "npx stylelint src/a.css",
    "npx vite build",
    "npx vite build --mode production",
    "npx vite preview",
    "npx cspell src/a.ts",
    "npx htmlhint index.html",
    "npx htmlhint -r tag-pair index.html", // `-r` (regras) é outra flag que `-R` (pasta de regras)
    "npx commitlint --from HEAD~1",
    "npx biome check src",
    "npx tsc -p tsconfig.app.json --noEmit",
    "git show HEAD:src/a.ts",
    "git log --oneline -5",
    "git diff --stat HEAD",
    'git log --format="%h %s"',
  ];
  it.each(liberadas)("allow: %s", (cmd) => {
    expect(decidir(cmd)).toBe("allow");
  });
});

describe("permissões das frentes: nada existente foi relaxado", () => {
  it("as travas anteriores continuam onde estavam", () => {
    for (const r of [
      "Bash(git push --force:*)",
      "Bash(git push -f:*)",
      "Bash(git reset --hard:*)",
      "Bash(rm -rf:*)",
      "Bash(supabase db push:*)",
      "Bash(vercel deploy:*)",
      "Bash(psql:*)",
      "Read(./.env)",
    ]) {
      expect(deny).toContain(r);
    }
    for (const r of [
      "Bash(git push:*)",
      "Bash(git checkout:*)",
      "Bash(git commit:*)",
      "Bash(curl:*)",
      "Bash(npm install:*)",
    ]) {
      expect(ask).toContain(r);
    }
    expect(allow).toContain("Bash(npx eslint:*)");
    expect(allow).toContain("Bash(deno test:*)");
  });

  it("deny, ask e allow não repetem regra nem se contradizem na mesma string", () => {
    for (const lista of [allow, ask, deny])
      expect(new Set(lista).size).toBe(lista.length);
    expect(deny.filter((r) => ask.includes(r) || allow.includes(r))).toEqual(
      [],
    );
  });
});

describe("permissões das frentes: o que a regra textual NÃO fecha (medido, 09/10/2026)", () => {
  // Estes casos EXECUTAM no motor real. Estão aqui para ninguém acreditar que a lista é uma
  // fronteira: quem fechar um deles deve mudar o teste E a seção de riscos do ARQUITETURA-PARALELA.
  const escapam = [
    "npx eslint '-c' x", // aspas partem a flag
    "npx eslint \\-c x", // barra invertida: não há sintaxe de padrão que a case
    'npx eslint --con"fig" x',
    'git show HEAD:a --out"put"=x',
    // código que a frente escreve e a regra não enxerga: o fluxo prescrito do frente.md
    "deno test --allow-all --no-check supabase/functions/x/",
    "python -m sqlfluff lint src/lib/x/q.sql", // lê `.sqlfluff` ao lado do arquivo (library_path executa Python)
    "npx stylelint src/lib/x/a.css", // lê stylelint.config.cjs ao lado do arquivo
    "npx cspell src/lib/x/a.ts", // lê cspell.config.cjs numa subpasta
  ];
  it.each(escapam)("continua auto-aprovado: %s", (cmd) => {
    expect(decidir(cmd)).toBe("allow");
  });
});
