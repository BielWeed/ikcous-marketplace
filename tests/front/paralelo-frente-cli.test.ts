/* eslint-disable security/detect-non-literal-fs-filename --
 * Teste de ponta a ponta num repositório git descartável em os.tmpdir(): todo
 * caminho é montado pelo próprio teste a partir de constantes, nunca de entrada externa. */
// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Ponta a ponta das frentes paralelas, num repositório git DESCARTÁVEL: o que
 * se prova aqui é o contrato que protege a árvore de verdade — frente fora da
 * faixa não commita, nada é integrado se UMA frente estiver fora da faixa, e o
 * guarda bloqueia escrita no worktree alheio e na árvore principal.
 */
const RAIZ = resolve(__dirname, "../..");
const FRENTE = join(RAIZ, "scripts/paralelo/frente.mjs");
const GUARDA = join(RAIZ, "scripts/paralelo/guarda-de-faixa.mjs");

const temporarios: string[] = [];
afterAll(() => {
  for (const t of temporarios) rmSync(t, { recursive: true, force: true });
});

function sh(cmd: string, args: string[], cwd: string, input?: string) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", input });
  return { status: r.status, out: `${r.stdout}${r.stderr}`.trim() };
}
const git = (cwd: string, ...args: string[]) => sh("git", args, cwd);
const frente = (cwd: string, ...args: string[]) =>
  sh(process.execPath, [FRENTE, ...args], cwd);
const guarda = (
  cwd: string,
  modo: string[],
  alvo: string,
  ferramenta = "Edit",
  agente?: string,
) =>
  sh(
    process.execPath,
    [GUARDA, ...modo],
    cwd,
    JSON.stringify({
      tool_name: ferramenta,
      cwd,
      tool_input: { file_path: alvo },
      ...(agente ? { agent_type: agente } : {}),
    }),
  );

function escrever(base: string, rel: string, conteudo: string) {
  const arq = join(base, rel);
  mkdirSync(dirname(arq), { recursive: true });
  writeFileSync(arq, conteudo);
}

const MANIFESTO = {
  plano: "t",
  frentes: [
    {
      nome: "a",
      posse: ["src/a/**"],
      faixa_migrations: { de: "20261300", ate: "20261309" },
    },
    { nome: "b", posse: ["src/b/**"] },
  ],
};

/** Repo com `main`, dois diretórios de código, uma migration e um node_modules "instalado". */
function novoRepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "frentes-")));
  temporarios.push(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "Teste");
  git(dir, "config", "commit.gpgsign", "false");
  escrever(dir, ".gitignore", ".claude/*\nnode_modules/\n");
  escrever(dir, "src/a/x.ts", "export const a = 1;\n");
  escrever(dir, "src/b/y.ts", "export const b = 1;\n");
  escrever(dir, "package.json", "{}\n");
  escrever(dir, "supabase/migrations/20261000000000_base.sql", "select 1;\n");
  escrever(dir, "docs/superpowers/lanes/t.json", JSON.stringify(MANIFESTO));
  escrever(dir, "node_modules/pkg/index.js", "module.exports = 1;\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "chore(tooling): base");
  return dir;
}

const M = "docs/superpowers/lanes/t.json";
const wt = (repo: string, nome: string) =>
  join(repo, ".worktrees", `t-${nome}`);

describe("frente.mjs — ciclo completo", () => {
  it("cria worktrees isolados, confere a faixa, commita, integra e limpa", () => {
    const repo = novoRepo();

    expect(frente(repo, "validar", M).status).toBe(0);

    // criar → worktree + branch + faixa registrada + node_modules ligado
    for (const n of ["a", "b"]) {
      const r = frente(repo, "criar", M, n);
      expect(r.status, r.out).toBe(0);
      expect(existsSync(join(wt(repo, n), ".claude/lane.json"))).toBe(true);
      expect(
        lstatSync(join(wt(repo, n), "node_modules")).isSymbolicLink(),
      ).toBe(true);
      expect(existsSync(join(wt(repo, n), "node_modules/pkg/index.js"))).toBe(
        true,
      );
    }
    expect(git(repo, "worktree", "list").out).toContain("paralelo/t/a");

    // não deixa criar de novo por cima do trabalho antigo
    expect(frente(repo, "criar", M, "a").status).toBe(1);

    // frente A: dentro da faixa passa (arquivo novo, migration da faixa); o link não conta
    escrever(wt(repo, "a"), "src/a/x.ts", "export const a = 2;\n");
    escrever(wt(repo, "a"), "src/a/novo.ts", "export const n = 1;\n");
    escrever(
      wt(repo, "a"),
      "supabase/migrations/20261300000000_a.sql",
      "select 2;\n",
    );
    expect(frente(wt(repo, "a"), "conferir").status).toBe(0);

    // fora da faixa: arquivo da frente B, compartilhado, migration fora da faixa
    escrever(wt(repo, "a"), "src/b/y.ts", "export const b = 99;\n");
    escrever(wt(repo, "a"), "package.json", '{"x":1}\n');
    escrever(
      wt(repo, "a"),
      "supabase/migrations/20261399000000_a.sql",
      "select 3;\n",
    );
    const ruim = frente(wt(repo, "a"), "conferir");
    expect(ruim.status).toBe(1);
    expect(ruim.out).toMatch(/src\/b\/y\.ts/);
    expect(ruim.out).toMatch(/package\.json.*compartilhado/);
    expect(ruim.out).toMatch(/20261399.*fora da faixa/);

    // commitar recusa TUDO enquanto houver violação (nada entra no histórico)
    const antes = git(wt(repo, "a"), "rev-parse", "HEAD").out;
    const recusa = frente(wt(repo, "a"), "commitar", "-m", "feat(ui): a");
    expect(recusa.status).toBe(1);
    expect(git(wt(repo, "a"), "rev-parse", "HEAD").out).toBe(antes);

    // desfaz as violações (a frente só mexe no que é dela) e commita
    git(wt(repo, "a"), "checkout", "--", "src/b/y.ts", "package.json");
    rmSync(join(wt(repo, "a"), "supabase/migrations/20261399000000_a.sql"));
    const ok = frente(wt(repo, "a"), "commitar", "-m", "feat(ui): frente a");
    expect(ok.status, ok.out).toBe(0);
    expect(
      git(wt(repo, "a"), "show", "--stat", "--format=%s", "HEAD").out,
    ).toContain("src/a/novo.ts");

    // frente B
    escrever(wt(repo, "b"), "src/b/y.ts", "export const b = 2;\n");
    expect(
      frente(wt(repo, "b"), "commitar", "-m", "feat(ui): frente b").status,
    ).toBe(0);

    // status enxerga as duas, 1 commit cada, nenhuma fora da faixa
    const st = frente(repo, "status", M).out;
    expect(st).toMatch(/a\s+commits\+1\s+sujo:0\s+fora-da-faixa:0/);
    expect(st).toMatch(/b\s+commits\+1\s+sujo:0\s+fora-da-faixa:0/);

    // ensaio: confere as faixas e NÃO mescla (worktree nativo usa branch com outro nome → mapa)
    const antesDoEnsaio = git(repo, "rev-parse", "HEAD").out;
    const ensaio = frente(
      repo,
      "integrar",
      M,
      "--so-conferir",
      "a=paralelo/t/a",
    );
    expect(ensaio.status, ensaio.out).toBe(0);
    expect(ensaio.out).toMatch(/ensaio: 2 frente\(s\) dentro da faixa/);
    expect(git(repo, "rev-parse", "HEAD").out).toBe(antesDoEnsaio);
    expect(
      frente(repo, "integrar", M, "--so-conferir", "a=nao-existe").out,
    ).toMatch(/branch nao-existe não existe/);

    // integrar na árvore principal: dois merges, sem conflito
    const int = frente(repo, "integrar", M);
    expect(int.status, int.out).toBe(0);
    expect(readFileSync(join(repo, "src/a/x.ts"), "utf8")).toContain("a = 2");
    expect(readFileSync(join(repo, "src/b/y.ts"), "utf8")).toContain("b = 2");
    expect(git(repo, "log", "--format=%s", "-3").out).toContain(
      "integra a frente a do plano t",
    );

    // retry é idempotente (frentes já integradas são puladas)
    const de_novo = frente(repo, "integrar", M);
    expect(de_novo.status, de_novo.out).toBe(0);
    expect(de_novo.out).toMatch(/sem alterações, pulada/);

    // limpar remove worktree e branch, e NÃO apaga o node_modules de verdade
    const lim = frente(repo, "limpar", M);
    expect(lim.status, lim.out).toBe(0);
    expect(existsSync(wt(repo, "a"))).toBe(false);
    expect(git(repo, "branch", "--list", "paralelo/*").out).toBe("");
    expect(existsSync(join(repo, "node_modules/pkg/index.js"))).toBe(true);
  }, 90_000);

  it("não integra NADA se uma única frente estiver fora da faixa", () => {
    const repo = novoRepo();
    for (const n of ["a", "b"])
      expect(frente(repo, "criar", M, n).status).toBe(0);
    escrever(wt(repo, "a"), "src/a/x.ts", "export const a = 3;\n");
    expect(frente(wt(repo, "a"), "commitar", "-m", "feat(ui): a").status).toBe(
      0,
    );
    // B burla o `commitar` (git cru) e commita arquivo compartilhado
    escrever(wt(repo, "b"), "package.json", '{"burlou":true}\n');
    git(wt(repo, "b"), "add", "package.json");
    git(wt(repo, "b"), "commit", "-q", "-m", "feat(ui): b burlou");

    const antes = git(repo, "rev-parse", "HEAD").out;
    const r = frente(repo, "integrar", M);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/b: 1 arquivo\(s\) fora da faixa/);
    expect(git(repo, "rev-parse", "HEAD").out).toBe(antes); // nem a frente A entrou
  }, 90_000);

  it("recusa comandos de worktree na árvore principal e integrar com árvore suja", () => {
    const repo = novoRepo();
    expect(frente(repo, "entrar", M, "a").out).toMatch(
      /só roda DENTRO do worktree/,
    );
    expect(frente(repo, "conferir").status).toBe(1);
    expect(frente(repo, "commitar", "-m", "x").status).toBe(1);
    escrever(repo, "sujo.txt", "x");
    git(repo, "add", "sujo.txt");
    expect(frente(repo, "integrar", M).out).toMatch(/mudanças não commitadas/);
    expect(frente(repo, "desconhecido").status).toBe(2);
  }, 60_000);

  it("o piso de migration também olha as branches remotas (outra sessão já publicou à frente)", () => {
    const repo = novoRepo();
    const remoto = realpathSync(mkdtempSync(join(tmpdir(), "remoto-")));
    temporarios.push(remoto);
    git(remoto, "init", "-q", "--bare");
    git(repo, "remote", "add", "origin", remoto);
    git(repo, "switch", "-q", "-c", "outra-sessao");
    escrever(
      repo,
      "supabase/migrations/20261500000000_da_outra_sessao.sql",
      "select 9;\n",
    );
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "chore(db): migration da outra sessao");
    git(repo, "push", "-q", "origin", "outra-sessao");
    git(repo, "switch", "-q", "main");
    git(repo, "branch", "-D", "outra-sessao"); // sobra só refs/remotes/origin/outra-sessao

    const r = frente(repo, "validar", M);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/já existe migration 20261500/);
  }, 60_000);

  it("reprova manifesto com posse cruzada antes de criar qualquer worktree", () => {
    const repo = novoRepo();
    const ruim = {
      ...MANIFESTO,
      frentes: [MANIFESTO.frentes[0], { nome: "b", posse: ["src/a/x.ts"] }],
    };
    escrever(repo, "docs/superpowers/lanes/ruim.json", JSON.stringify(ruim));
    const r = frente(repo, "criar", "docs/superpowers/lanes/ruim.json", "a");
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/posse se cruza/);
    expect(existsSync(join(repo, ".worktrees"))).toBe(false);
  }, 60_000);
});

describe("guarda-de-faixa.mjs — hook PreToolUse", () => {
  it("modo global só age dentro de worktree com faixa; modo estrito fecha por padrão", () => {
    const repo = novoRepo();
    for (const n of ["a", "b"])
      expect(frente(repo, "criar", M, n).status).toBe(0);
    const A = wt(repo, "a");
    const B = wt(repo, "b");

    // global (sem flag): não atrapalha a árvore principal nem o orquestrador
    expect(guarda(repo, [], join(repo, "package.json")).status).toBe(0);
    expect(guarda(repo, [], join(repo, "src/a/x.ts")).status).toBe(0);
    // ...mas protege qualquer worktree com faixa, mesmo vindo da árvore principal
    expect(guarda(repo, [], join(B, "src/a/x.ts")).status).toBe(2);
    expect(guarda(A, [], join(A, "package.json")).out).toMatch(/compartilhado/);
    expect(guarda(A, [], join(A, ".claude/lane.json")).status).toBe(2); // não alarga a própria faixa
    expect(guarda(A, [], join(A, "src/a/x.ts")).status).toBe(0);
    expect(guarda(A, [], "src/a/novo.ts", "Write").status).toBe(0); // caminho relativo ao cwd

    // estrito (agente `frente`): só a própria faixa, só o próprio worktree
    expect(guarda(A, ["--estrito"], join(A, "src/a/x.ts")).status).toBe(0);
    expect(guarda(A, ["--estrito"], join(A, "src/b/y.ts")).status).toBe(2);
    expect(guarda(A, ["--estrito"], join(B, "src/b/y.ts")).out).toMatch(
      /fora do worktree/,
    );
    expect(guarda(A, ["--estrito"], join(repo, "src/a/x.ts")).status).toBe(2); // árvore principal
    expect(guarda(repo, ["--estrito"], join(repo, "src/a/x.ts")).out).toMatch(
      /não tem faixa registrada/,
    );

    // estrito por IDENTIDADE do agente (o hook do frontmatter não dispara no harness real):
    // `agent_type: frente` fecha por padrão mesmo sem a flag; outro agente segue aberto.
    const A2 = wt(repo, "a");
    const semFaixa = guarda(
      repo,
      [],
      join(repo, "src/a/x.ts"),
      "Write",
      "frente",
    );
    expect(semFaixa.status).toBe(2);
    expect(semFaixa.out).toMatch(/não tem faixa registrada/);
    expect(
      guarda(A2, [], join(A2, "src/b/y.ts"), "Write", "frente").status,
    ).toBe(2);
    expect(
      guarda(A2, [], join(A2, "src/a/x.ts"), "Write", "frente").status,
    ).toBe(0);
    expect(
      guarda(repo, [], join(repo, "src/a/x.ts"), "Write", "general-purpose")
        .status,
    ).toBe(0);

    // sem alvo (ex.: ferramenta sem file_path) e entrada torta
    expect(
      sh(process.execPath, [GUARDA], repo, JSON.stringify({ tool_input: {} }))
        .status,
    ).toBe(0);
    expect(sh(process.execPath, [GUARDA], repo, "não é json").status).toBe(0); // global abre
    expect(
      sh(process.execPath, [GUARDA, "--estrito"], repo, "não é json").status,
    ).toBe(2); // estrito fecha
  }, 90_000);
});
