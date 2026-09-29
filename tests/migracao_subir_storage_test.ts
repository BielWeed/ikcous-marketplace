// @ts-nocheck
/**
 * Testes para `scripts/migracao/subir-storage.mjs` — o passo (d) do
 * `docs/runbooks/migrar-banco-da-loja.md`: subir os arquivos do zip
 * "Storage objects" (`cafkrminfnokvgjqtkle.storage.zip`) para os buckets do
 * projeto novo.
 *
 * Nenhum teste aqui fala com a rede ou com o Supabase de verdade: o cliente
 * de Storage é injetado (uma dublê que grava as chamadas), e o `createClient`
 * real só é importado dentro de `main()` — o mesmo padrão de
 * `carregarClient()` em scripts/db-apply.cjs, para o teste poder importar o
 * módulo sem precisar de `@supabase/supabase-js` resolvido.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Todo caminho aqui é um arquivo dentro de um diretório criado por
 * `mkdtempSync` NESTE teste — nunca entrada externa. Mesma justificativa de
 * tests/db_prove_rollback_test.ts.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

import {
  bucketECaminho,
  contentTypePorExtensao,
  ehZip,
  enviarArquivo,
  listarArquivos,
  subirPasta,
} from "../scripts/migracao/subir-storage.mjs";

Deno.test("contentTypePorExtensao reconhece os tipos que os buckets aceitam", () => {
  assertEquals(contentTypePorExtensao("foto.png"), "image/png");
  assertEquals(contentTypePorExtensao("foto.JPG"), "image/jpeg");
  assertEquals(contentTypePorExtensao("foto.jpeg"), "image/jpeg");
  assertEquals(contentTypePorExtensao("foto.webp"), "image/webp");
  assertEquals(contentTypePorExtensao("icone.svg"), "image/svg+xml");
  assertEquals(
    contentTypePorExtensao("favicon.ico"),
    "image/vnd.microsoft.icon",
  );
});

Deno.test("contentTypePorExtensao cai em application/octet-stream para extensão desconhecida", () => {
  assertEquals(
    contentTypePorExtensao("arquivo.xyz"),
    "application/octet-stream",
  );
  assertEquals(
    contentTypePorExtensao("sem-extensao"),
    "application/octet-stream",
  );
});

Deno.test("bucketECaminho tira o primeiro segmento como bucket (estrutura <bucket>/<caminho>)", () => {
  assertEquals(bucketECaminho("products/abc/foto.png"), {
    bucket: "products",
    caminho: "abc/foto.png",
  });
  assertEquals(bucketECaminho("banners/foto.png"), {
    bucket: "banners",
    caminho: "foto.png",
  });
});

Deno.test("bucketECaminho recusa caminho sem <bucket>/<caminho>, a menos que --bucket fixe um", () => {
  let capturou = false;
  try {
    bucketECaminho("foto-solta.png");
  } catch {
    capturou = true;
  }
  assert(capturou, "devia recusar sem bucketFixo");

  assertEquals(bucketECaminho("foto-solta.png", { bucketFixo: "devolucoes" }), {
    bucket: "devolucoes",
    caminho: "foto-solta.png",
  });
});

Deno.test("bucketECaminho com --bucket usa o caminho INTEIRO, mesmo com mais de um segmento", () => {
  assertEquals(bucketECaminho("2026/09/foto.png", { bucketFixo: "produtos" }), {
    bucket: "produtos",
    caminho: "2026/09/foto.png",
  });
});

Deno.test("ehZip reconhece só a extensão .zip (sem distinguir caixa)", () => {
  assert(ehZip("C:\\pasta\\arquivo.zip"));
  assert(ehZip("C:\\pasta\\ARQUIVO.ZIP"));
  assert(!ehZip("C:\\pasta\\ja-extraida"));
});

Deno.test("listarArquivos lista todo arquivo recursivamente, em caminho POSIX, ordenado", () => {
  const dir = mkdtempSync(join(tmpdir(), "storage-"));
  mkdirSync(join(dir, "products", "abc"), { recursive: true });
  writeFileSync(join(dir, "products", "abc", "foto.png"), "x");
  mkdirSync(join(dir, "banners"), { recursive: true });
  writeFileSync(join(dir, "banners", "b.png"), "x");

  const achados = listarArquivos(dir);

  assertEquals(achados, ["banners/b.png", "products/abc/foto.png"]);
});

Deno.test("listarArquivos ignora .emptyFolderPlaceholder (marcador de pasta vazia do Storage)", () => {
  const dir = mkdtempSync(join(tmpdir(), "storage-"));
  mkdirSync(join(dir, "banners"), { recursive: true });
  writeFileSync(join(dir, "banners", ".emptyFolderPlaceholder"), "");
  writeFileSync(join(dir, "banners", "real.png"), "x");

  assertEquals(listarArquivos(dir), ["banners/real.png"]);
});

/** Dublê do `cliente.storage.from(bucket).upload(...)` do supabase-js —
 * grava toda chamada, sem tocar rede. `falharPara` é um Set de "bucket/caminho"
 * que devem devolver erro (simula upload que falha). */
function clienteFalso({ falharPara = new Set() } = {}) {
  const chamadas = [];
  return {
    chamadas,
    storage: {
      from(bucket) {
        return {
          async upload(caminho, bytes, opcoes) {
            chamadas.push({ bucket, caminho, bytes, opcoes });
            if (falharPara.has(`${bucket}/${caminho}`)) {
              return { data: null, error: { message: "falha simulada" } };
            }
            return { data: { path: caminho }, error: null };
          },
        };
      },
    },
  };
}

Deno.test("enviarArquivo sobe com upsert:true e o content-type certo, e não erra", async () => {
  const dir = mkdtempSync(join(tmpdir(), "storage-"));
  const absoluto = join(dir, "foto.png");
  writeFileSync(absoluto, "conteudo-fake-de-imagem");
  const cliente = clienteFalso();

  const resultado = await enviarArquivo({
    cliente,
    bucket: "products",
    caminho: "abc/foto.png",
    absoluto,
  });

  assertEquals(resultado.ok, true);
  assertEquals(cliente.chamadas.length, 1);
  assertEquals(cliente.chamadas[0].bucket, "products");
  assertEquals(cliente.chamadas[0].caminho, "abc/foto.png");
  assertEquals(cliente.chamadas[0].opcoes.upsert, true);
  assertEquals(cliente.chamadas[0].opcoes.contentType, "image/png");
});

Deno.test("enviarArquivo devolve ok:false e a mensagem quando o upload falha", async () => {
  const dir = mkdtempSync(join(tmpdir(), "storage-"));
  const absoluto = join(dir, "foto.png");
  writeFileSync(absoluto, "x");
  const cliente = clienteFalso({ falharPara: new Set(["products/foto.png"]) });

  const resultado = await enviarArquivo({
    cliente,
    bucket: "products",
    caminho: "foto.png",
    absoluto,
  });

  assertEquals(resultado.ok, false);
  assertEquals(resultado.erro, "falha simulada");
});

Deno.test("subirPasta sobe cada arquivo no bucket certo e soma sucesso/falha", async () => {
  const dir = mkdtempSync(join(tmpdir(), "storage-"));
  mkdirSync(join(dir, "products"), { recursive: true });
  mkdirSync(join(dir, "banners"), { recursive: true });
  writeFileSync(join(dir, "products", "ok.png"), "x");
  writeFileSync(join(dir, "banners", "vai-falhar.png"), "x");
  const cliente = clienteFalso({
    falharPara: new Set(["banners/vai-falhar.png"]),
  });

  const resumo = await subirPasta({ raiz: dir, cliente });

  assertEquals(resumo.total, 2);
  assertEquals(resumo.falhas, 1);
  assertEquals(cliente.chamadas.length, 2);
});

Deno.test("subirPasta com bucketFixo trata TODO arquivo como pertencente a esse bucket só", async () => {
  const dir = mkdtempSync(join(tmpdir(), "storage-"));
  mkdirSync(join(dir, "sub"), { recursive: true });
  writeFileSync(join(dir, "a.png"), "x");
  writeFileSync(join(dir, "sub", "b.png"), "x");
  const cliente = clienteFalso();

  const resumo = await subirPasta({
    raiz: dir,
    cliente,
    bucketFixo: "devolucoes",
  });

  assertEquals(resumo.total, 2);
  assertEquals(resumo.falhas, 0);
  assert(cliente.chamadas.every((c) => c.bucket === "devolucoes"));
});

Deno.test("subirPasta é idempotente por construção: upload sempre com upsert:true", async () => {
  const dir = mkdtempSync(join(tmpdir(), "storage-"));
  writeFileSync(join(dir, "produtos-x.png"), "x");
  const cliente = clienteFalso();

  await subirPasta({ raiz: dir, cliente, bucketFixo: "produtos" });
  await subirPasta({ raiz: dir, cliente, bucketFixo: "produtos" }); // de novo

  assertEquals(cliente.chamadas.length, 2);
  assert(cliente.chamadas.every((c) => c.opcoes.upsert === true));
});
