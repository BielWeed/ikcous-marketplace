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
 * (`*` casa qualquer texto, `Bash(x *)` casa também `x` sozinho, `:*` final = ` *`; deny vence
 * allow; deny vale para QUALQUER subcomando de um comando composto) e que foi conferida contra o
 * motor real (`claude -p` sem modelo, 09/10/2026), a forma LITERAL de cada flag que faz uma
 * ferramenta auto-aprovada carregar e EXECUTAR um arquivo escolhido pela frente é barrada, e o uso
 * legítimo (`npx eslint src/admin-card.tsx --quiet`) segue sem pedir confirmação.
 *
 * DECISÃO DO DONO, 12/11/2026 ("não me peça mais nenhuma permissão para eu clicar em permitir"):
 * o `ask` do `.claude/settings.json` é VAZIO. Causa medida na documentação oficial
 * (https://code.claude.com/docs/en/permission-modes.md): no modo "Ignorar permissões" uma regra
 * `ask` EXPLÍCITA continua perguntando; hook PreToolUse e regra `allow` não vencem `ask`, só `deny`
 * vence tudo. Logo o que era `ask` virou `allow` (uso comum) ou `deny` (as flags que carregam
 * arquivo escolhido), e quem protege é o `deny`: este teste falha se alguém tirar uma regra de
 * `deny` ou reintroduzir um `ask`.
 *
 * O que NÃO prova (e por isso o último bloco documenta): o casamento é TEXTUAL. Aspas partidas,
 * barra invertida e ferramentas que leem configuração ao lado do arquivo escapam de qualquer
 * regra. A regra é um quebra-molas, não uma fronteira — a fronteira é `integrar` + revisão.
 */
const RAIZ = resolve(__dirname, "../..");
const settings = JSON.parse(
  readFileSync(join(RAIZ, ".claude/settings.json"), "utf8"),
) as { permissions: { allow: string[]; ask?: string[]; deny: string[] } };
const { allow, deny } = settings.permissions;
// Chave `ask` ausente equivale a lista vazia: as duas formas cumprem a decisão do dono.
const ask = settings.permissions.ask ?? [];

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

// Sem "ask": o `ask` é vazio por decisão do dono (ver cabeçalho). "pergunta" = nenhuma regra casou.
type Decisao = "deny" | "allow" | "pergunta";

/**
 * Descasque que a doc garante antes de casar deny: `timeout`, `time`, `nice`, `nohup`, `stdbuf` e
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

/** Decisão do motor para um comando: deny vale se QUALQUER subcomando casa; allow, se TODOS. */
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

  // Antes de 12/11/2026 estas flags eram `ask` (o dono clicava). Sem `ask`, a prova que importa
  // continua: a flag que carrega e executa um arquivo escolhido pela frente NÃO passa — agora é
  // `deny`, sem clique. `npx shadcn` (baixa e escreve código da rede) idem.
  const gadgetsAntesAsk = [
    "npx eslint -f json src",
    "npx eslint src -f json",
    "npx eslint --format ./f.js src",
    "npx eslint src --format=./f.js",
    "npx knip --reporter ./r.js",
    "npx knip --reporter=./r.js",
    "npx knip --preprocessor p",
    "npx commitlint -o x",
    "npx commitlint --from HEAD~1 -o x",
    "npx commitlint --format ./f.js",
    "npx shadcn add button",
    "echo ok && npx eslint -f ./f.js src",
  ];
  it.each(gadgetsAntesAsk)("deny (era ask): %s", (cmd) => {
    expect(decidir(cmd)).toBe("deny");
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

  // O que era `ask` e o dono clicava toda vez: agora passa direto (nenhum clique).
  const liberadasQueEramAsk = [
    "git push origin main",
    "git push -u origin claude/x",
    "git commit -F msg.txt",
    "git checkout -b claude/x",
    "git add src/a.ts",
    "git merge --ff-only origin/main",
    "git pull --ff-only",
    "git stash push -m x",
    "git switch main",
    "gh pr create --body-file b.md",
    "gh issue list",
    "curl -s https://example.com",
    "npm install",
    "npm i -D x",
    "mv a.txt b.txt",
    "rm a.txt",
    "supabase migration new x",
    "vercel ls",
    "python -m sqlfluff fix src/a.sql",
  ];
  it.each(liberadasQueEramAsk)("allow (era ask): %s", (cmd) => {
    expect(decidir(cmd)).toBe("allow");
  });

  // Com os `ask` virando `allow`, é o `deny` que segura o perigoso: ele tem de vencer a regra allow
  // vizinha (`git push:*`, `rm:*`, `vercel ...`), inclusive dentro de comando composto.
  const denyVenceAllowVizinho = [
    "git push --force origin main",
    "git push -f origin main",
    "git push --force-with-lease origin main",
    "git push origin main && git push --force",
    "rm -rf node_modules",
    "rm -r src",
    "git reset --hard HEAD~1",
    "git clean -fd",
    "supabase db push",
    "vercel deploy --prod",
    "vercel rollback",
    "npm publish",
    "psql -h x",
  ];
  it.each(denyVenceAllowVizinho)("deny (vence o allow vizinho): %s", (cmd) => {
    expect(decidir(cmd)).toBe("deny");
  });
});

/**
 * As 79 regras de `deny` que existiam ANTES da decisão do dono de 12/11/2026 (cópia literal,
 * de propósito: é o piso). Tirar qualquer uma do `.claude/settings.json` tem de deixar este teste
 * vermelho — com o `ask` vazio, é o `deny` que segura o perigoso. Para ACRESCENTAR trava, acrescente
 * aqui também; para tirar uma, é decisão do dono, não de quem edita o teste.
 */
const DENY_ORIGINAIS = [
  "Bash(Get-Content .env:*)",
  "Bash(Remove-Item -Recurse:*)",
  "Bash(cat ./.env:*)",
  "Bash(cat .env:*)",
  "Bash(git clean:*)",
  "Bash(git diff*--output*)",
  "Bash(git filter-branch:*)",
  "Bash(git log*--output*)",
  "Bash(git push --force-with-lease:*)",
  "Bash(git push --force:*)",
  "Bash(git push -f:*)",
  "Bash(git reset --hard:*)",
  "Bash(git show*--output*)",
  "Bash(git update-ref:*)",
  "Bash(npm install -g:*)",
  "Bash(npm publish:*)",
  "Bash(npx commitlint * -d*)",
  "Bash(npx commitlint * -g*)",
  "Bash(npx commitlint * -p*)",
  "Bash(npx commitlint * -x*)",
  "Bash(npx commitlint -d*)",
  "Bash(npx commitlint -g*)",
  "Bash(npx commitlint -p*)",
  "Bash(npx commitlint -x*)",
  "Bash(npx commitlint*--config*)",
  "Bash(npx commitlint*--cwd*)",
  "Bash(npx commitlint*--extends*)",
  "Bash(npx commitlint*--parser-preset*)",
  "Bash(npx cspell * -c*)",
  "Bash(npx cspell -c*)",
  "Bash(npx cspell*--config*)",
  "Bash(npx eslint * -c*)",
  "Bash(npx eslint -c*)",
  "Bash(npx eslint*--config*)",
  "Bash(npx eslint*--parser*)",
  "Bash(npx eslint*--plugin*)",
  "Bash(npx eslint*--flag*)",
  "Bash(npx htmlhint * -R*)",
  "Bash(npx htmlhint -R*)",
  "Bash(npx htmlhint*--rulesdir*)",
  "Bash(npx knip * -c*)",
  "Bash(npx knip -c*)",
  "Bash(npx knip*--config*)",
  "Bash(npx knip*--directory*)",
  "Bash(npx stylelint * -c*)",
  "Bash(npx stylelint -c*)",
  "Bash(npx stylelint*--config*)",
  "Bash(npx stylelint*--custom-formatter*)",
  "Bash(npx stylelint*--custom-syntax*)",
  "Bash(npx vite build * -c*)",
  "Bash(npx vite build -c*)",
  "Bash(npx vite build*--config*)",
  "Bash(npx vite preview * -c*)",
  "Bash(npx vite preview -c*)",
  "Bash(npx vite preview*--config*)",
  "Bash(psql:*)",
  "Bash(rm -fr:*)",
  "Bash(rm -r:*)",
  "Bash(rm -rf:*)",
  "Bash(supabase db push:*)",
  "Bash(supabase db remote:*)",
  "Bash(supabase db reset:*)",
  "Bash(supabase projects delete:*)",
  "Bash(supabase secrets:*)",
  "Bash(type .env:*)",
  "Bash(vercel alias:*)",
  "Bash(vercel deploy:*)",
  "Bash(vercel env:*)",
  "Bash(vercel promote:*)",
  "Bash(vercel remove:*)",
  "Bash(vercel rm:*)",
  "Bash(vercel rollback:*)",
  "Read(./.env)",
  "Read(./.env.local)",
  "Read(./.env.production)",
  "Read(./.env.production.local)",
  "Read(./.env.vercel.*)",
  "Read(./.gh_token)",
  "Read(./vapid_keys.json)",
];

/**
 * As flags que antes eram `ask` e que carregam e executam arquivo escolhido (ou, no caso do
 * `npx shadcn`, baixam código da rede): sem `ask`, viraram `deny` — bloqueadas, sem clique.
 */
const GADGETS_QUE_ERAM_ASK = [
  "Bash(npx commitlint * -o*)",
  "Bash(npx commitlint -o*)",
  "Bash(npx commitlint*--format*)",
  "Bash(npx eslint * -f*)",
  "Bash(npx eslint -f*)",
  "Bash(npx eslint*--format*)",
  "Bash(npx knip*--preprocessor*)",
  "Bash(npx knip*--reporter*)",
  "Bash(npx shadcn:*)",
];

/** As regras que eram `ask` de uso comum e viraram `allow` (o dono não clica mais). */
const ERAM_ASK_VIRARAM_ALLOW = [
  "Bash(Invoke-WebRequest:*)",
  "Bash(curl:*)",
  "Bash(gh issue:*)",
  "Bash(gh pr:*)",
  "Bash(git add:*)",
  "Bash(git checkout:*)",
  "Bash(git commit:*)",
  "Bash(git merge:*)",
  "Bash(git pull:*)",
  "Bash(git push:*)",
  "Bash(git rebase:*)",
  "Bash(git restore:*)",
  "Bash(git revert:*)",
  "Bash(git stash:*)",
  "Bash(git switch:*)",
  "Bash(mv:*)",
  "Bash(npm i:*)",
  "Bash(npm install:*)",
  "Bash(npm uninstall:*)",
  "Bash(npm update:*)",
  "Bash(python -m sqlfluff fix:*)",
  "Bash(rm:*)",
  "Bash(supabase functions serve:*)",
  "Bash(supabase link:*)",
  "Bash(supabase migration new:*)",
  "Bash(supabase start:*)",
  "Bash(supabase stop:*)",
  "Bash(vercel inspect:*)",
  "Bash(vercel ls:*)",
  "Bash(vercel whoami)",
  "Edit(./package.json)",
  "Edit(./src/config/branding.json)",
  "Edit(./supabase/migrations/**)",
  "Edit(./vercel.json)",
];

describe("permissões das frentes: a decisão do dono de 12/11/2026 (ask vazio, deny segura)", () => {
  it("o ask é VAZIO: nenhuma regra pede clique de permitir", () => {
    // No modo "Ignorar permissões" uma regra `ask` explícita continua perguntando (doc oficial
    // permission-modes) e nem hook nem allow a vencem. Reintroduzir qualquer `ask` devolve os cliques.
    expect(ask).toEqual([]);
  });

  it.each(DENY_ORIGINAIS)("deny original continua: %s", (regra) => {
    expect(deny).toContain(regra);
  });

  it.each(GADGETS_QUE_ERAM_ASK)(
    "gadget que era ask agora é deny: %s",
    (regra) => {
      expect(deny).toContain(regra);
      expect(allow).not.toContain(regra);
    },
  );

  it.each(ERAM_ASK_VIRARAM_ALLOW)("o que era ask virou allow: %s", (regra) => {
    expect(allow).toContain(regra);
    expect(deny).not.toContain(regra);
  });

  it("a lista de deny só cresce em relação ao piso (nenhuma sumiu)", () => {
    expect(DENY_ORIGINAIS.filter((r) => !deny.includes(r))).toEqual([]);
    expect(deny.length).toBeGreaterThanOrEqual(
      DENY_ORIGINAIS.length + GADGETS_QUE_ERAM_ASK.length,
    );
  });

  it("as travas de allow que sempre existiram continuam", () => {
    expect(allow).toContain("Bash(npx eslint:*)");
    expect(allow).toContain("Bash(deno test:*)");
  });

  it("deny e allow não repetem regra nem se contradizem na mesma string", () => {
    for (const lista of [allow, deny])
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
