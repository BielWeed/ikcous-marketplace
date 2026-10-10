// @ts-nocheck
// CI-BANCO bloqueante (PR 766, 04/10/2026): o job "Migrations do zero
// (efêmero)" deixou de ser informacional. Estes testes travam por texto as
// duas formas de um vermelho virar verde em silêncio:
//   1. tolerância no workflow (`continue-on-error`, `|| true`, pipe que engole
//      o exit code do node);
//   2. saída 0 nos runners quando um arquivo foi PULADO por provisionamento
//      (não provado) — foi o pulo da 20260901 que escondeu o PR 766.
// (Bucket cego não precisa de guarda própria: avaliar() de
// db-check-objetos-do-codigo.mjs já conta bucket sem catálogo como AUSENTE e
// o passo sai FALHOU — medido em 04/10 com storage.buckets apagado.)
// A prova VIVA (exit != 0 com o stub de cron removido) é a sequência do
// db-ci.yml contra um Postgres de verdade.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const ler = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));
const semComentarios = (yml: string) =>
  yml
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

const YML = ler("../.github/workflows/db-ci.yml");

Deno.test("db-ci.yml não tem continue-on-error em lugar nenhum (job nem passo)", () => {
  assert(
    !/continue-on-error/i.test(semComentarios(YML)),
    "continue-on-error voltou ao db-ci.yml — o job deixa de bloquear",
  );
});

Deno.test("db-ci.yml: cada run é UM comando node/npm, sem || true, pipe ou ;", () => {
  const runs = semComentarios(YML)
    .split("\n")
    .map((l) => l.trim().replace(/^- /, ""))
    .filter((l) => l.startsWith("run:"))
    .map((l) => l.slice("run:".length).trim());
  assertEquals(
    runs.length,
    6,
    `esperava 6 run: (npm ci + 5 passos), achei ${runs.length}`,
  );
  for (const r of runs) {
    assert(/^(node|npm) /.test(r), `run inesperado: ${r}`);
    assert(!/\|\||\||;|&&|\bset \+e\b/.test(r), `run engole exit code: ${r}`);
  }
});

Deno.test("db-ci.yml roda os 5 passos da prova, na ordem", () => {
  const ordem = [
    "provisionar-efemero.cjs",
    "aplicar-migrations.cjs",
    "objetos-do-codigo-efemero.cjs",
    "prova-dupla-aplicacao.cjs",
    "inventario-rollback.cjs",
  ];
  let ultimo = -1;
  for (const s of ordem) {
    const i = semComentarios(YML).indexOf(`scripts/ci/banco/${s}`);
    assert(i > ultimo, `${s} ausente ou fora de ordem`);
    ultimo = i;
  }
});

Deno.test("aplicar-migrations: pulado por provisionamento sai FALHOU, antes do OK", () => {
  const t = ler("../scripts/ci/banco/aplicar-migrations.cjs");
  const guarda = t.search(/if \(pulados\.length > 0\) \{\s*sair\(\s*"FALHOU"/);
  const ok = t.lastIndexOf('"OK"');
  assert(guarda > 0, "guarda de pulados ausente");
  assert(guarda < ok, "guarda de pulados depois do sair OK");
});

Deno.test("prova-dupla-aplicacao: pulado na 2ª passada sai FALHOU, antes do OK", () => {
  const t = ler("../scripts/ci/banco/prova-dupla-aplicacao.cjs");
  const guarda = t.search(/if \(pulados\.length > 0\) \{\s*sair\(\s*"FALHOU"/);
  const ok = t.lastIndexOf('"OK"');
  assert(guarda > 0, "guarda de pulados ausente");
  assert(guarda < ok, "guarda de pulados depois do sair OK");
});
