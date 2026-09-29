// @ts-nocheck
/**
 * Testes para `scripts/migracao/descompactar.mjs` — o passo (a) do
 * `docs/runbooks/migrar-banco-da-loja.md`: descompactar, no Windows do
 * Gabriel, o backup que o painel do Supabase entrega como `.backup.gz`
 * (ou qualquer outro nome terminado em `.gz`), sem instalar nada além do
 * Node que ele já tem.
 *
 * Por que testar aqui e não só "rodar na mão": o arquivo real é o backup de
 * produção baixado pelo dono — nenhum destes testes toca nele. Todo caso usa
 * um arquivo `.gz` pequeno, gerado na hora com `node:zlib`, num diretório
 * temporário. `deno test` roda isto (tests:unit), o script em si é ESM puro
 * (`node:fs`, `node:zlib`, `node:path`) e Deno importa `.mjs` direto, sem
 * `createRequire` — só os `.cjs` deste repositório precisam dele.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Todo caminho aqui é um arquivo dentro de um diretório criado por
 * `mkdtempSync` NESTE teste — nunca entrada externa. Mesma justificativa de
 * tests/db_prove_rollback_test.ts.
 */
import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

import {
  descompactarArquivo,
  listarArquivosGz,
  nomeSemGz,
} from "../scripts/migracao/descompactar.mjs";

Deno.test("nomeSemGz tira só o .gz final, preservando a extensão de antes", () => {
  assertEquals(
    nomeSemGz("db_cluster-2026-09-28.backup.gz"),
    "db_cluster-2026-09-28.backup",
  );
  assertEquals(nomeSemGz("dump.sql.gz"), "dump.sql");
});

Deno.test("nomeSemGz aceita .GZ maiúsculo (Windows não distingue caixa)", () => {
  assertEquals(nomeSemGz("backup.BACKUP.GZ"), "backup.BACKUP");
});

Deno.test("nomeSemGz recusa arquivo que não termina em .gz", () => {
  assertThrows(() => nomeSemGz("backup.backup"), Error, ".gz");
});

Deno.test("listarArquivosGz lista só os .gz do diretório, ordenados, sem subpasta", () => {
  const dir = mkdtempSync(join(tmpdir(), "descompactar-"));
  writeFileSync(join(dir, "b.backup.gz"), "x");
  writeFileSync(join(dir, "a.sql.gz"), "x");
  writeFileSync(join(dir, "leiame.txt"), "x");
  Deno.mkdirSync(join(dir, "subpasta"));
  writeFileSync(join(dir, "subpasta", "c.gz"), "x");

  const achados = listarArquivosGz(dir);

  assertEquals(achados, ["a.sql.gz", "b.backup.gz"]);
});

Deno.test("descompactarArquivo grava o conteúdo original, sem o .gz no nome", async () => {
  const dir = mkdtempSync(join(tmpdir(), "descompactar-"));
  const conteudoOriginal = "SELECT 1;\n".repeat(1000); // grande o bastante para exercitar o stream
  const origem = join(dir, "dump.sql.gz");
  writeFileSync(origem, gzipSync(conteudoOriginal));

  const resultado = await descompactarArquivo(origem);

  assertEquals(resultado.destino, join(dir, "dump.sql"));
  assertEquals(resultado.pulou, false);
  assert(resultado.bytesSaida === Buffer.byteLength(conteudoOriginal));
  assertEquals(readFileSync(resultado.destino, "utf8"), conteudoOriginal);
});

Deno.test("descompactarArquivo é idempotente: roda de novo e não reescreve sem --forcar", async () => {
  const dir = mkdtempSync(join(tmpdir(), "descompactar-"));
  const origem = join(dir, "dump.sql.gz");
  writeFileSync(origem, gzipSync("conteudo original"));
  await descompactarArquivo(origem);

  // Alguém abriu o arquivo já descompactado e mexeu nele — a segunda
  // chamada, sem --forcar, tem de deixar essa marca em paz.
  writeFileSync(join(dir, "dump.sql"), "MARCA MANUAL");

  const segunda = await descompactarArquivo(origem);

  assertEquals(segunda.pulou, true);
  assertEquals(readFileSync(join(dir, "dump.sql"), "utf8"), "MARCA MANUAL");
});

Deno.test("descompactarArquivo com forcar:true sobrescreve o destino existente", async () => {
  const dir = mkdtempSync(join(tmpdir(), "descompactar-"));
  const origem = join(dir, "dump.sql.gz");
  const conteudoNovo = "conteudo depois do forcar";
  writeFileSync(origem, gzipSync(conteudoNovo));
  writeFileSync(join(dir, "dump.sql"), "conteudo velho, tem de sumir");

  const resultado = await descompactarArquivo(origem, { forcar: true });

  assertEquals(resultado.pulou, false);
  assertEquals(readFileSync(join(dir, "dump.sql"), "utf8"), conteudoNovo);
});

Deno.test("descompactarArquivo falha (rejeita) se a origem não existir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "descompactar-"));
  await assertRejects(() => descompactarArquivo(join(dir, "nao-existe.gz")));
});

Deno.test("descompactarArquivo com destino explícito grava nesse caminho, não em nomeSemGz", async () => {
  const dir = mkdtempSync(join(tmpdir(), "descompactar-"));
  const origem = join(dir, "db_cluster-28-09-2026@03-20-37.backup.gz");
  const conteudo = "-- dump do pg_dumpall\nCREATE ROLE postgres;\n";
  writeFileSync(origem, gzipSync(conteudo));
  const destinoEscolhido = join(dir, "db_cluster.sql");

  const resultado = await descompactarArquivo(origem, {
    destino: destinoEscolhido,
  });

  assertEquals(resultado.destino, destinoEscolhido);
  assertEquals(resultado.pulou, false);
  assertEquals(readFileSync(destinoEscolhido, "utf8"), conteudo);
  // O nome "natural" (sem .gz) não deve ter sido criado — só o explícito.
  assert(!existsSync(join(dir, "db_cluster-28-09-2026@03-20-37.backup")));
});

Deno.test("descompactarArquivo falha alto (não grava lixo) se o .gz estiver corrompido", async () => {
  const dir = mkdtempSync(join(tmpdir(), "descompactar-"));
  const origem = join(dir, "corrompido.sql.gz");
  writeFileSync(origem, "isto não é gzip de verdade");

  await assertRejects(() => descompactarArquivo(origem));
  assert(
    !existsSync(join(dir, "corrompido.sql")),
    "não devia sobrar arquivo parcial",
  );
});
