#!/usr/bin/env node
/**
 * Sobe os arquivos do zip "Storage objects" (baixado do painel do projeto
 * pausado, ex.: `cafkrminfnokvgjqtkle.storage.zip`) para os buckets do
 * projeto NOVO — passo (d) do `docs/runbooks/migrar-banco-da-loja.md`.
 *
 * Por que existe: a restauração do banco (parte b) traz só os METADADOS do
 * Storage (nome do bucket, caminho, tamanho, em `storage.objects`) — o
 * CONTEÚDO de cada arquivo mora fora do banco, num bucket S3 que o
 * `pg_dumpall` não alcança. Sem este passo, toda foto de produto/banner
 * quebra na loja nova.
 *
 * ESTRUTURA DO ZIP: o export "Storage objects" do painel Supabase organiza os
 * arquivos como `<bucket>/<caminho-dentro-do-bucket>` (ex.:
 * `products/abc123/foto.png`) — é o caso padrão, tratado sem flag nenhuma.
 * Se um dia vier achatado (um único bucket, sem essa pasta na frente), passe
 * `--bucket <nome>` e o caminho INTEIRO deste lado vira o caminho dentro
 * daquele bucket.
 *
 * NÃO recria bucket — os buckets já existem no projeto novo (vieram no dump
 * da parte b, com o `public`/`file_size_limit`/`allowed_mime_types` de cada
 * um). Se um upload falhar por "bucket not found", o bucket em questão não
 * veio na restauração — resolva isso na parte (b)/(c), não aqui.
 *
 * USO:
 *   $env:NOVO_SUPABASE_URL = "https://dekxabvqdsuukijblazl.supabase.co"
 *   $env:NOVO_SERVICE_ROLE_KEY = Read-Host "service_role do projeto novo" -MaskInput
 *   node scripts/migracao/subir-storage.mjs "C:\...\cafkrminfnokvgjqtkle.storage.zip"
 *   node scripts/migracao/subir-storage.mjs "C:\...\pasta-ja-extraida"
 *   node scripts/migracao/subir-storage.mjs "C:\...\pasta" --bucket devolucoes
 *
 * Se o argumento terminar em `.zip`, extrai antes com o `Expand-Archive` do
 * PowerShell (nativo do Windows — sem instalar biblioteca de zip nenhuma,
 * mesmo espírito do `descompactar.mjs` da parte (a); só funciona no Windows,
 * que é onde este runbook roda).
 *
 * Idempotente: todo upload vai com `upsert: true` — rodar de novo sobre o
 * mesmo arquivo substitui pelo mesmo conteúdo, nunca duplica.
 *
 * A `NOVO_SERVICE_ROLE_KEY` NUNCA é impressa — só entra no header que o
 * cliente do Supabase monta por dentro.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Todo caminho aqui vem do argumento de linha de comando (o dono apontando
 * para o zip/pasta que ELE baixou) ou é derivado dele ao andar a árvore de
 * diretório — nunca de entrada de rede. Mesma justificativa de
 * scripts/migracao/descompactar.mjs.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Extensão (minúscula, sem ponto) -> content-type. Cobre o que os buckets
 * desta loja aceitam (`allowed_mime_types` das migrations de branding/
 * devoluções) — o que não está aqui cai em application/octet-stream, que o
 * Storage aceita do mesmo jeito. */
// Map, não objeto plano: indexar objeto com uma chave calculada (a
// extensão do arquivo) é exatamente o padrão que
// security/detect-object-injection existe para pegar — Map.get() não sofre
// disso (não há prototype chain para poluir), então não precisa de
// eslint-disable nem de Object.hasOwn aqui.
const MAPA_CONTENT_TYPE = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
  ["svg", "image/svg+xml"],
  ["ico", "image/vnd.microsoft.icon"],
  ["pdf", "application/pdf"],
]);

export function contentTypePorExtensao(nomeArquivo) {
  const semQuery = nomeArquivo.split(/[?#]/)[0];
  const ponto = semQuery.lastIndexOf(".");
  if (ponto === -1) return "application/octet-stream";
  const ext = semQuery.slice(ponto + 1).toLowerCase();
  return MAPA_CONTENT_TYPE.get(ext) ?? "application/octet-stream";
}

/** Marcador que o próprio Storage do Supabase cria para representar uma
 * pasta vazia — nunca é uma foto de verdade, não faz sentido subir de volta. */
function ehPlaceholderDePasta(nome) {
  return nome === ".emptyFolderPlaceholder";
}

/** Anda a árvore inteira a partir de `raiz` e devolve os caminhos relativos
 * (sempre com `/`, mesmo no Windows — é o separador que o Storage usa) de
 * todo arquivo, ordenados, sem os marcadores de pasta vazia. */
export function listarArquivos(raiz) {
  const achados = [];
  const pilha = [""];
  while (pilha.length > 0) {
    const relativoAtual = pilha.pop();
    const absolutoAtual = relativoAtual ? path.join(raiz, relativoAtual) : raiz;
    for (const entrada of readdirSync(absolutoAtual, { withFileTypes: true })) {
      const relativoFilho = relativoAtual
        ? `${relativoAtual}/${entrada.name}`
        : entrada.name;
      if (entrada.isDirectory()) {
        pilha.push(relativoFilho);
      } else if (entrada.isFile() && !ehPlaceholderDePasta(entrada.name)) {
        achados.push(relativoFilho);
      }
    }
  }
  return achados.sort();
}

/** "products/abc/foto.png" -> { bucket: "products", caminho: "abc/foto.png" }.
 * Com `bucketFixo`, o caminho relativo INTEIRO vira o caminho dentro daquele
 * bucket (o caso "zip achatado", sem pasta de bucket na frente). */
export function bucketECaminho(relativo, opcoes = {}) {
  const { bucketFixo } = opcoes;
  if (bucketFixo) return { bucket: bucketFixo, caminho: relativo };
  const partes = relativo.split("/");
  if (partes.length < 2) {
    throw new Error(
      `"${relativo}" não tem a forma <bucket>/<caminho> — se o zip vier achatado, rode de novo com --bucket <nome>`,
    );
  }
  const [bucket, ...resto] = partes;
  return { bucket, caminho: resto.join("/") };
}

export function ehZip(caminho) {
  return /\.zip$/i.test(caminho);
}

/** Extrai um `.zip` com o `Expand-Archive` do PowerShell (Windows, nativo —
 * sem instalar nada) para uma pasta temporária, e devolve o caminho dela.
 * Não testado por `deno test` (chama um processo externo de verdade); a
 * decisão de QUANDO chamar isto (`ehZip`) é o que os testes cobrem. */
function extrairZipWindows(caminhoZip) {
  const destino = mkdtempSync(path.join(tmpdir(), "storage-extraido-"));
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Expand-Archive -LiteralPath '${caminhoZip}' -DestinationPath '${destino}' -Force`,
  ]);
  return destino;
}

/** Sobe UM arquivo. `cliente` é o objeto do `@supabase/supabase-js`
 * (`createClient(...)`) OU uma dublê com a mesma forma
 * (`cliente.storage.from(bucket).upload(caminho, bytes, opcoes)`) — é essa
 * injeção que deixa este teste sem rede. */
export async function enviarArquivo({ cliente, bucket, caminho, absoluto }) {
  const bytes = readFileSync(absoluto);
  const { error } = await cliente.storage.from(bucket).upload(caminho, bytes, {
    contentType: contentTypePorExtensao(caminho),
    upsert: true,
  });
  return { bucket, caminho, ok: !error, erro: error?.message };
}

/** Orquestra: lista os arquivos de `raiz`, resolve bucket/caminho de cada um
 * e sobe um por um (serial — nada aqui é grande o bastante para justificar
 * paralelismo, e serial dá um log fácil de acompanhar). `onProgresso`,
 * opcional, recebe cada resultado assim que ele sai (para o CLI imprimir na
 * hora, sem esperar o lote inteiro). */
export async function subirPasta({ raiz, cliente, bucketFixo, onProgresso }) {
  const relativos = listarArquivos(raiz);
  const resultados = [];
  for (const relativo of relativos) {
    const { bucket, caminho } = bucketECaminho(relativo, { bucketFixo });
    const absoluto = path.join(raiz, ...relativo.split("/"));
    const resultado = await enviarArquivo({
      cliente,
      bucket,
      caminho,
      absoluto,
    });
    resultados.push(resultado);
    onProgresso?.(resultado);
  }
  const falhas = resultados.filter((r) => !r.ok).length;
  return { total: resultados.length, falhas, resultados };
}

async function main() {
  const argumentos = process.argv.slice(2);
  const indiceBucket = argumentos.indexOf("--bucket");
  const bucketFixo =
    indiceBucket === -1 ? undefined : argumentos[indiceBucket + 1];
  const alvo = argumentos.find(
    (a, i) => a !== "--bucket" && i !== indiceBucket + 1,
  );

  const url = process.env.NOVO_SUPABASE_URL;
  const chave = process.env.NOVO_SERVICE_ROLE_KEY;
  if (!alvo) {
    console.error(
      "Uso: node scripts/migracao/subir-storage.mjs <zip|pasta> [--bucket <nome>]",
    );
    process.exit(1);
    return;
  }
  if (!url || !chave) {
    console.error(
      "FALHOU: defina NOVO_SUPABASE_URL e NOVO_SERVICE_ROLE_KEY no ambiente antes de rodar (nunca em arquivo).",
    );
    process.exit(1);
    return;
  }

  const raiz = ehZip(alvo) ? extrairZipWindows(alvo) : alvo;
  if (!statSync(raiz).isDirectory()) {
    console.error(`FALHOU: "${raiz}" não é uma pasta.`);
    process.exit(1);
    return;
  }

  // Import tardio, só aqui dentro: um teste que importa as funções puras
  // acima não precisa de `@supabase/supabase-js` resolvido — mesmo padrão de
  // `carregarClient()` em scripts/db-apply.cjs.
  const { createClient } = await import("@supabase/supabase-js");
  const cliente = createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const resumo = await subirPasta({
    raiz,
    cliente,
    bucketFixo,
    onProgresso: (r) => {
      console.log(
        r.ok
          ? `[ok]     ${r.bucket}/${r.caminho}`
          : `[falhou] ${r.bucket}/${r.caminho}: ${r.erro}`,
      );
    },
  });

  console.log(`\n${resumo.total} arquivo(s), ${resumo.falhas} falha(s).`);
  if (resumo.falhas > 0) process.exit(1);
}

// pathToFileURL, não o template `file://${argv[1]}` — no Windows
// `process.argv[1]` vem com `\` e letra de unidade, e o template nunca bate
// com `import.meta.url` (achado do coordenador contra o mesmo padrão em
// descompactar.mjs; corrigido aqui também antes de o bug se repetir).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
