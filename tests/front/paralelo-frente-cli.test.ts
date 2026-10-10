/* eslint-disable security/detect-non-literal-fs-filename --
 * Teste de ponta a ponta num repositório git descartável em os.tmpdir(): todo
 * caminho é montado pelo próprio teste a partir de constantes, nunca de entrada externa. */
// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
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

    // criar → worktree + branch + faixa registrada. NENHUM link de node_modules: um link
    // (junction no Windows) é atravessado por `git worktree remove --force` e esvazia a principal.
    // O Node resolve o pacote SUBINDO diretórios até o node_modules da árvore principal.
    for (const n of ["a", "b"]) {
      const r = frente(repo, "criar", M, n);
      expect(r.status, r.out).toBe(0);
      expect(existsSync(join(wt(repo, n), ".claude/lane.json"))).toBe(true);
      expect(existsSync(join(wt(repo, n), "node_modules"))).toBe(false);
      const resolvido = sh(
        process.execPath,
        ["-e", "console.log(require.resolve('pkg'))"],
        wt(repo, n),
      );
      expect(resolvido.status, resolvido.out).toBe(0);
      expect(resolvido.out).toMatch(/node_modules[\\/]pkg[\\/]index\.js$/);
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
      "integra a (t)",
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

  it("nome com acento e espaço (português) passa em conferir, commitar e integrar", () => {
    const repo = novoRepo();
    for (const n of ["a", "b"])
      expect(frente(repo, "criar", M, n).status).toBe(0);
    escrever(
      wt(repo, "a"),
      "src/a/configuração do pedido.ts",
      "export const c = 1;\n",
    );
    expect(frente(wt(repo, "a"), "conferir").status).toBe(0);
    // e a violação com acento é reportada com o nome LEGÍVEL, não com octais
    escrever(wt(repo, "a"), "src/b/fora é.ts", "x\n");
    const ruim = frente(wt(repo, "a"), "conferir");
    expect(ruim.status).toBe(1);
    expect(ruim.out).toContain("src/b/fora é.ts");
    rmSync(join(wt(repo, "a"), "src/b/fora é.ts"));
    const c = frente(
      wt(repo, "a"),
      "commitar",
      "-m",
      "feat(ui): arquivo com acento",
    );
    expect(c.status, c.out).toBe(0);
    const int = frente(repo, "integrar", M);
    expect(int.status, int.out).toBe(0);
    expect(existsSync(join(repo, "src/a/configuração do pedido.ts"))).toBe(
      true,
    );
  }, 60_000);

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

describe("achados da revisão independente — CLI e guarda", () => {
  it("guarda: lane.json corrompido NÃO abre a porta para agent_type=frente (falhava aberto)", () => {
    const repo = novoRepo();
    expect(frente(repo, "criar", M, "a").status).toBe(0);
    const A = wt(repo, "a");
    writeFileSync(join(A, ".claude/lane.json"), ""); // a frente corrompe a faixa por Bash
    const principal = guarda(
      A,
      [],
      join(repo, "src/a/x.ts"),
      "Write",
      "frente",
    );
    expect(principal.status).toBe(2);
    expect(principal.out).toMatch(/erro ao avaliar a faixa/);
    // sessão normal (sem agent_type, sem flag) continua aberta: o modo global é inerte
    expect(guarda(A, [], join(repo, "src/a/x.ts"), "Write").status).toBe(0);
  }, 60_000);

  it("integrar recusa ANTES de mesclar se a mensagem do merge passaria de 100 colunas", () => {
    const repo = novoRepo();
    for (const n of ["a", "b"])
      expect(frente(repo, "criar", M, n).status).toBe(0);
    escrever(wt(repo, "a"), "src/a/x.ts", "export const a = 5;\n");
    expect(frente(wt(repo, "a"), "commitar", "-m", "feat(ui): a").status).toBe(
      0,
    );
    const antes = git(repo, "rev-parse", "HEAD").out;
    const r = frente(repo, "integrar", M, "--escopo", "e".repeat(90));
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/passa de 100 caracteres/);
    expect(git(repo, "rev-parse", "HEAD").out).toBe(antes);
  }, 60_000);

  it("merge recusado por hook NÃO é rotulado como conflito de decomposição", () => {
    const repo = novoRepo();
    for (const n of ["a", "b"])
      expect(frente(repo, "criar", M, n).status).toBe(0);
    escrever(wt(repo, "a"), "src/a/x.ts", "export const a = 6;\n");
    expect(frente(wt(repo, "a"), "commitar", "-m", "feat(ui): a").status).toBe(
      0,
    );
    // commit-msg que recusa só a mensagem de integração (os commits das frentes já foram feitos)
    const hook = join(repo, ".git/hooks/commit-msg");
    writeFileSync(
      hook,
      '#!/bin/sh\ngrep -q "integra" "$1" && exit 1\nexit 0\n',
      { mode: 0o755 },
    );
    const antes = git(repo, "rev-parse", "HEAD").out;
    const r = frente(repo, "integrar", M);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/recusado SEM conflito/);
    expect(r.out).not.toMatch(/decomposição errada/);
    expect(git(repo, "rev-parse", "HEAD").out).toBe(antes);
    expect(
      git(repo, "status", "--porcelain").out.replace(
        /\?\? \.worktrees\/\n?/,
        "",
      ),
    ).toBe("");
  }, 60_000);
});

describe("achados da 2ª revisão e do comentário do dono no PR", () => {
  const faixaDe = (wtPath: string) => join(wtPath, ".claude/lane.json");

  it("entrar só aceita manifesto COMMITADO de docs/superpowers/lanes/ e não troca a faixa", () => {
    const repo = novoRepo();
    expect(frente(repo, "criar", M, "a").status).toBe(0);
    const A = wt(repo, "a");

    // 1. manifesto fora de docs/superpowers/lanes/ (a frente o escreveu na própria posse)
    escrever(
      A,
      "src/a/m2.json",
      JSON.stringify({ ...MANIFESTO, liberados: { "package.json": "a" } }),
    );
    const fora = frente(A, "entrar", "src/a/m2.json", "a");
    expect(fora.status).toBe(1);
    expect(fora.out).toMatch(
      /tem que ser um \.json de docs\/superpowers\/lanes\//,
    );

    // 2. no lugar certo, mas NÃO commitado
    escrever(
      A,
      "docs/superpowers/lanes/forjado.json",
      JSON.stringify(MANIFESTO),
    );
    const solto = frente(
      A,
      "entrar",
      "docs/superpowers/lanes/forjado.json",
      "a",
    );
    expect(solto.status).toBe(1);
    expect(solto.out).toMatch(/não está commitado no HEAD/);

    // 3. a faixa se registra UMA vez: nem trocar por outra frente, nem refazer a mesma
    const troca = frente(A, "entrar", M, "b");
    expect(troca.status).toBe(1);
    expect(troca.out).toMatch(/já tem uma faixa registrada/);
    const refaz = frente(A, "entrar", M, "a");
    expect(refaz.status).toBe(1);
    expect(refaz.out).toMatch(/já tem uma faixa registrada/);
  }, 60_000);

  it("faixa adulterada no lane.json é recusada por conferir, commitar e pelo hook", () => {
    const repo = novoRepo();
    expect(frente(repo, "criar", M, "a").status).toBe(0);
    const A = wt(repo, "a");
    const lane = JSON.parse(readFileSync(faixaDe(A), "utf8"));
    lane.manifesto.liberados = { "package.json": "a" };
    lane.manifesto.frentes[0].posse.push("package.json");
    writeFileSync(faixaDe(A), JSON.stringify(lane)); // o que um `echo >` por Bash faria

    escrever(A, "src/a/x.ts", "export const a = 9;\n");
    const conf = frente(A, "conferir");
    expect(conf.status).toBe(1);
    expect(conf.out).toMatch(/faixa não confiável: faixa adulterada/);
    expect(frente(A, "commitar", "-m", "feat(ui): a").status).toBe(1);
    const hook = guarda(A, [], join(A, "package.json"), "Write", "frente");
    expect(hook.status).toBe(2);
    expect(hook.out).toMatch(/faixa não confiável/);
    // lane.json que aponta para um manifesto fora da pasta também é recusado
    lane.manifesto = MANIFESTO;
    lane.origem = "src/a/m2.json";
    writeFileSync(faixaDe(A), JSON.stringify(lane));
    expect(frente(A, "conferir").out).toMatch(
      /origem fora de docs\/superpowers\/lanes\//,
    );
  }, 60_000);

  /** Âncora do worktree: gravada por `entrar` DENTRO do gitdir (fora da árvore de trabalho). */
  const ancoraDe = (wtPath: string) =>
    join(
      git(wtPath, "rev-parse", "--path-format=absolute", "--absolute-git-dir")
        .out,
      "paralelo-ancora.json",
    );

  /**
   * B2 (re-revisão do #782). Repo em que o manifesto foi ALARGADO num commit antigo e depois
   * estreitado: a → [src/a/**, src/c/**] em C1, de volta a a → [src/a/**] em C2. O worktree da
   * frente `a` nasce em C2. Um lane.json com `base` = C1 e o manifesto largo embutido passava em
   * `verificarFaixa` (C1 é ancestral do HEAD e o blob de C1 bate com o embutido).
   */
  function repoComManifestoAlargadoNoPassado() {
    const repo = novoRepo();
    const largo = {
      ...MANIFESTO,
      frentes: MANIFESTO.frentes.map((f) =>
        f.nome === "a" ? { ...f, posse: [...f.posse, "src/c/**"] } : f,
      ),
    };
    escrever(repo, M, JSON.stringify(largo));
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "chore(tooling): alarga o manifesto");
    const c1 = git(repo, "rev-parse", "HEAD").out;
    escrever(repo, M, JSON.stringify(MANIFESTO));
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "chore(tooling): estreita o manifesto");
    return { repo, c1, largo };
  }

  it("B2/E2c: trocar só o NOME da frente no lane.json não dá a faixa de outra frente", () => {
    const repo = novoRepo();
    expect(frente(repo, "criar", M, "a").status).toBe(0);
    const A = wt(repo, "a");
    const lane = JSON.parse(readFileSync(faixaDe(A), "utf8"));
    lane.frente = "b"; // o manifesto embutido segue idêntico ao commitado: só o nome muda
    writeFileSync(faixaDe(A), JSON.stringify(lane));
    escrever(A, "src/b/y.ts", "export const b = 99;\n"); // arquivo da frente b

    const conf = frente(A, "conferir");
    expect(conf.status, conf.out).toBe(1);
    expect(conf.out).toMatch(/faixa não confiável: .*frente/);
    expect(frente(A, "commitar", "-m", "feat(ui): b").status).toBe(1);
    const hook = guarda(A, [], join(A, "src/b/y.ts"), "Write", "frente");
    expect(hook.status).toBe(2);
    expect(hook.out).toMatch(/faixa não confiável/);
  }, 60_000);

  it("B2/E2d: base trocada por um commit antigo com manifesto mais largo é recusada", () => {
    const { repo, c1, largo } = repoComManifestoAlargadoNoPassado();
    expect(frente(repo, "criar", M, "a").status).toBe(0);
    const A = wt(repo, "a");
    const lane = JSON.parse(readFileSync(faixaDe(A), "utf8"));
    expect(lane.base).not.toBe(c1);
    // ainda não adulterado: a faixa estreita vale e src/c/ está fora dela
    escrever(A, "src/c/z.ts", "export const z = 1;\n");
    expect(frente(A, "conferir").status).toBe(1);

    lane.base = c1;
    lane.manifesto = largo; // idêntico ao blob de `origem` em C1, que é ancestral do HEAD
    writeFileSync(faixaDe(A), JSON.stringify(lane));
    // sem a correção: o hook deixava escrever e `commitar` COMMITAVA src/c/z.ts (fora da faixa real)
    const hook = guarda(A, [], join(A, "src/c/z.ts"), "Write", "frente");
    expect(hook.status, hook.out).toBe(2);
    expect(hook.out).toMatch(/faixa não confiável/);
    const commit = frente(A, "commitar", "-m", "feat(ui): c");
    expect(commit.status, commit.out).toBe(1);
    expect(commit.out).toMatch(/faixa não confiável: .*base/);
    const conf = frente(A, "conferir");
    expect(conf.status, conf.out).toBe(1);
    expect(conf.out).toMatch(/faixa não confiável: .*base/);
  }, 60_000);

  it("B2: o nome da frente também fica amarrado ao ramo paralelo/<plano>/<frente> (defesa sem a âncora)", () => {
    const repo = novoRepo();
    expect(frente(repo, "criar", M, "a").status).toBe(0);
    const A = wt(repo, "a");
    // mesmo que a âncora (no gitdir) fosse reescrita junto com o lane.json, o ramo ainda diz quem é
    const lane = JSON.parse(readFileSync(faixaDe(A), "utf8"));
    lane.frente = "b";
    writeFileSync(faixaDe(A), JSON.stringify(lane));
    const ancora = JSON.parse(readFileSync(ancoraDe(A), "utf8"));
    ancora.frente = "b";
    writeFileSync(ancoraDe(A), JSON.stringify(ancora));
    const conf = frente(A, "conferir");
    expect(conf.status, conf.out).toBe(1);
    expect(conf.out).toMatch(/ramo/);
  }, 60_000);

  it("B2: entrar numa frente que não é a do ramo é recusado, e deletar o lane.json não permite refazer", () => {
    const repo = novoRepo();
    expect(frente(repo, "criar", M, "a").status).toBe(0);
    const A = wt(repo, "a");
    const lane = readFileSync(faixaDe(A), "utf8");
    rmSync(faixaDe(A)); // a frente apaga a faixa para tentar `entrar` como outra frente
    const troca = frente(A, "entrar", M, "b");
    expect(troca.status).toBe(1);
    expect(troca.out).toMatch(/registrad/);
    expect(existsSync(faixaDe(A))).toBe(false);
    // a mesma frente tampouco refaz: a âncora persiste e a decisão volta ao orquestrador
    expect(frente(A, "entrar", M, "a").status).toBe(1);
    // restaurar o lane.json original devolve a faixa (a âncora e o arquivo concordam)
    writeFileSync(faixaDe(A), lane);
    escrever(A, "src/a/x.ts", "export const a = 3;\n");
    expect(frente(A, "conferir").status).toBe(0);
  }, 60_000);

  it("B2 (compat): worktree registrado antes da âncora existir é recusado com mensagem clara", () => {
    const repo = novoRepo();
    expect(frente(repo, "criar", M, "a").status).toBe(0);
    const A = wt(repo, "a");
    rmSync(ancoraDe(A)); // o que um worktree de uma versão anterior tem: lane.json, sem âncora
    const conf = frente(A, "conferir");
    expect(conf.status).toBe(1);
    expect(conf.out).toMatch(/sem âncora/);
    expect(conf.out).toMatch(/recri/); // diz o que fazer: recriar o worktree
    expect(guarda(A, [], join(A, "src/a/x.ts"), "Write", "frente").status).toBe(
      2,
    );
  }, 60_000);

  it("B2: worktree NATIVO de subagente (ramo worktree-agent-<id>): o nome não vem do ramo, a âncora segura", () => {
    const repo = novoRepo();
    const A = join(repo, ".claude", "worktrees", "agent-x1");
    expect(
      git(repo, "worktree", "add", "-q", "-b", "worktree-agent-x1", A).status,
    ).toBe(0);
    const entra = frente(A, "entrar", M, "a");
    expect(entra.status, entra.out).toBe(0);
    escrever(A, "src/a/x.ts", "export const a = 5;\n");
    expect(frente(A, "conferir").status).toBe(0);
    // a âncora diz "a": trocar o nome no lane.json é recusado mesmo sem ramo paralelo/…
    const lane = JSON.parse(readFileSync(faixaDe(A), "utf8"));
    lane.frente = "b";
    writeFileSync(faixaDe(A), JSON.stringify(lane));
    const conf = frente(A, "conferir");
    expect(conf.status, conf.out).toBe(1);
    expect(conf.out).toMatch(/faixa não confiável: .*frente/);
    // e a faixa não se refaz com outro nome nem depois de apagar o lane.json
    rmSync(faixaDe(A));
    expect(frente(A, "entrar", M, "b").status).toBe(1);
  }, 60_000);

  it("B2: o fluxo legítimo não muda (entrar, conferir, commitar, integrar) e a âncora mora fora da árvore", () => {
    const repo = novoRepo();
    expect(frente(repo, "criar", M, "a").status).toBe(0);
    const A = wt(repo, "a");
    const ancora = JSON.parse(readFileSync(ancoraDe(A), "utf8"));
    const lane = JSON.parse(readFileSync(faixaDe(A), "utf8"));
    expect(ancora).toMatchObject({
      plano: "t",
      frente: "a",
      base: lane.base,
      origem: M,
    });
    expect(ancoraDe(A).startsWith(A)).toBe(false); // gitdir, não a árvore de trabalho
    expect(git(A, "status", "--porcelain").out).toBe(""); // a âncora não sujou nada
    escrever(A, "src/a/x.ts", "export const a = 4;\n");
    expect(frente(A, "conferir").status).toBe(0);
    expect(frente(A, "commitar", "-m", "feat(ui): a").status).toBe(0);
    expect(frente(A, "conferir").status).toBe(0); // depois do commit a base não muda
  }, 60_000);

  it("integrar roda num worktree de INTEGRAÇÃO (sem trocar de ramo na principal) e não no de uma frente", () => {
    const repo = novoRepo();
    for (const n of ["a", "b"])
      expect(frente(repo, "criar", M, n).status).toBe(0);
    escrever(wt(repo, "a"), "src/a/x.ts", "export const a = 7;\n");
    expect(frente(wt(repo, "a"), "commitar", "-m", "feat(ui): a").status).toBe(
      0,
    );

    const recusa = frente(wt(repo, "a"), "integrar", M);
    expect(recusa.status).toBe(1);
    expect(recusa.out).toMatch(/não roda dentro do worktree de uma frente/);

    const integracao = join(repo, ".worktrees", "integracao");
    expect(
      git(repo, "worktree", "add", "-q", "-b", "integracao", integracao).status,
    ).toBe(0);
    const principalAntes = git(repo, "rev-parse", "main").out;
    const r = frente(integracao, "integrar", M);
    expect(r.status, r.out).toBe(0);
    expect(readFileSync(join(integracao, "src/a/x.ts"), "utf8")).toContain(
      "a = 7",
    );
    expect(git(repo, "rev-parse", "main").out).toBe(principalAntes); // a principal não se mexeu
  }, 60_000);

  it("commitar funciona depois de um `git rm` (a deleção já está no índice)", () => {
    const repo = novoRepo();
    expect(frente(repo, "criar", M, "a").status).toBe(0);
    const A = wt(repo, "a");
    expect(git(A, "rm", "-q", "src/a/x.ts").status).toBe(0);
    const r = frente(A, "commitar", "-m", "feat(ui): remove x");
    expect(r.status, r.out).toBe(0);
    expect(git(A, "show", "--name-status", "--format=", "HEAD").out).toMatch(
      /^D\s+src\/a\/x\.ts/m,
    );
  }, 60_000);

  it("integrar merge o SHA conferido: commit feito na frente DEPOIS da conferência não entra", () => {
    const repo = novoRepo();
    for (const n of ["a", "b"])
      expect(frente(repo, "criar", M, n).status).toBe(0);
    escrever(wt(repo, "a"), "src/a/x.ts", "export const a = 8;\n");
    expect(frente(wt(repo, "a"), "commitar", "-m", "feat(ui): a").status).toBe(
      0,
    );
    escrever(wt(repo, "b"), "src/b/y.ts", "export const b = 8;\n");
    expect(frente(wt(repo, "b"), "commitar", "-m", "feat(ui): b").status).toBe(
      0,
    );
    // durante o merge da frente A, a frente B (ainda viva) commita um arquivo COMPARTILHADO
    const hook = join(repo, ".git/hooks/commit-msg");
    writeFileSync(
      hook,
      `#!/bin/sh
grep -q "integra a (t)" "$1" || exit 0
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX GIT_EXEC_PATH
cd "${wt(repo, "b")}" || exit 0
echo '{"burlou":true}' > package.json
git add package.json
git commit -q -m "feat(ui): b burla depois da conferencia"
exit 0
`,
      { mode: 0o755 },
    );
    const r = frente(repo, "integrar", M);
    expect(r.status, r.out).toBe(0);
    expect(git(repo, "show", "paralelo/t/b:package.json").out).toContain(
      "burlou",
    ); // a burla aconteceu
    expect(git(repo, "show", "HEAD:package.json").out).not.toContain("burlou"); // e NÃO entrou
  }, 60_000);

  it("o mapa de risco sai dos CAMINHOS do diff, não da palavra da frente", () => {
    const repo = novoRepo();
    for (const n of ["a", "b"])
      expect(frente(repo, "criar", M, n).status).toBe(0);
    escrever(wt(repo, "a"), "src/a/checkout-cupom.ts", "export const c = 1;\n");
    escrever(
      wt(repo, "a"),
      "supabase/migrations/20261300000000_a.sql",
      "select 1;\n",
    );
    escrever(wt(repo, "b"), "src/b/y.ts", "export const b = 9;\n");
    expect(frente(wt(repo, "a"), "commitar", "-m", "feat(db): a").status).toBe(
      0,
    );
    expect(frente(wt(repo, "b"), "commitar", "-m", "feat(ui): b").status).toBe(
      0,
    );
    const r = frente(repo, "integrar", M, "--so-conferir");
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/revisor-risco. é OBRIGATÓRIO/);
    expect(r.out).toMatch(/checkout-cupom\.ts {2}\(checkout \/ pagamento\)/);
    expect(r.out).toMatch(/20261300000000_a\.sql {2}\(migration/);
    expect(r.out).not.toMatch(/y\.ts {2}\(/); // a frente b é rotina
  }, 60_000);

  it("guarda: symlink dentro da posse que aponta para o worktree de outra frente é resolvido", () => {
    const repo = novoRepo();
    for (const n of ["a", "b"])
      expect(frente(repo, "criar", M, n).status).toBe(0);
    const A = wt(repo, "a");
    symlinkSync(join(wt(repo, "b"), "src/b/y.ts"), join(A, "src/a/link.ts"));
    const r = guarda(A, [], join(A, "src/a/link.ts"), "Write", "frente");
    expect(r.status).toBe(2);
    expect(r.out).toMatch(/fora do worktree da frente "a"/);
  }, 60_000);

  it("guarda: módulo que não carrega FECHA para a frente (exit 1 deixaria passar) e abre para sessão normal", () => {
    const solto = realpathSync(mkdtempSync(join(tmpdir(), "guarda-solta-")));
    temporarios.push(solto);
    const copia = join(solto, "guarda-de-faixa.mjs");
    writeFileSync(copia, readFileSync(GUARDA, "utf8")); // sem faixas.mjs nem integridade.mjs ao lado
    const entrada = (agente?: string) =>
      JSON.stringify({
        tool_name: "Write",
        cwd: solto,
        tool_input: { file_path: join(solto, "x.ts") },
        ...(agente ? { agent_type: agente } : {}),
      });
    expect(sh(process.execPath, [copia], solto, entrada("frente")).status).toBe(
      2,
    );
    expect(sh(process.execPath, [copia], solto, entrada()).status).toBe(0);
  }, 60_000);

  it("criar --base não aceita valor que o git leria como OPÇÃO (--force, --detach)", () => {
    const repo = novoRepo();
    for (const base of ["--force", "--detach", "nao-existe"]) {
      const r = frente(repo, "criar", M, "a", "--base", base);
      expect(r.status, base).toBe(1);
      expect(r.out, base).toMatch(/--base inválido/);
    }
    expect(existsSync(join(repo, ".worktrees"))).toBe(false);
  }, 60_000);

  it("risco semântico no conteúdo do diff entra no mapa mesmo sem palavra-chave no caminho (Codex P1)", () => {
    const repo = novoRepo();
    for (const n of ["a", "b"])
      expect(frente(repo, "criar", M, n).status).toBe(0);
    // `useCaixaDoMes.ts` não casa nenhum padrão de caminho (desde o M2 o nome `useFinanceiro.ts` casa `financ`), mas chama as RPCs de dinheiro
    escrever(
      wt(repo, "a"),
      "src/a/useCaixaDoMes.ts",
      'export const x = () => supabase.rpc("fin_saldo");\n',
    );
    // a frente b só muda o VALOR de um export literal e acrescenta um símbolo novo: rotina
    escrever(
      wt(repo, "b"),
      "src/b/y.ts",
      "export const b = 11;\nexport function novo() {}\n",
    );
    expect(frente(wt(repo, "a"), "commitar", "-m", "feat(ui): a").status).toBe(
      0,
    );
    expect(frente(wt(repo, "b"), "commitar", "-m", "feat(ui): b").status).toBe(
      0,
    );
    const r = frente(repo, "integrar", M, "--so-conferir");
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(
      /useCaixaDoMes\.ts {2}\(RPC\/tabela fin_\* \(dinheiro\)\)/,
    );
    expect(r.out).not.toMatch(/y\.ts {2}\(/);
  }, 60_000);

  it("lista de risco VAZIA não diz 'rotina': diz que nenhum padrão conhecido casou (M2)", () => {
    const repo = novoRepo();
    for (const n of ["a", "b"])
      expect(frente(repo, "criar", M, n).status).toBe(0);
    escrever(wt(repo, "a"), "src/a/x.ts", "export const a = 2;\n");
    escrever(wt(repo, "b"), "src/b/y.ts", "export const b = 2;\n");
    for (const n of ["a", "b"])
      expect(
        frente(wt(repo, n), "commitar", "-m", `feat(ui): ${n}`).status,
      ).toBe(0);
    const r = frente(repo, "integrar", M, "--so-conferir");
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/nenhum padrão conhecido casou/);
    expect(r.out).toMatch(/NÃO significa .rotina./);
    expect(r.out).not.toMatch(/revisor-risco. é OBRIGATÓRIO/);
    // e quando há risco, a frase do "nada casou" não aparece junto da lista
    escrever(
      wt(repo, "a"),
      "src/a/useConfigDoCartao.ts",
      "export const c = 1;\n",
    );
    expect(frente(wt(repo, "a"), "commitar", "-m", "feat(ui): a2").status).toBe(
      0,
    );
    const r2 = frente(repo, "integrar", M, "--so-conferir");
    expect(r2.out).toMatch(/revisor-risco. é OBRIGATÓRIO/);
    expect(r2.out).toMatch(/useConfigDoCartao\.ts {2}\(/);
    expect(r2.out).not.toMatch(/nenhum padrão conhecido casou/);
  }, 60_000);
});
