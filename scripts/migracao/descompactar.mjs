#!/usr/bin/env node
/**
 * Descompacta o backup do banco que o painel do Supabase entrega — hoje,
 * `db_cluster-<data>.backup.gz` (um dump de `pg_dumpall`, em texto puro,
 * dentro de um gzip) — sem exigir nada além do Node que o dono já tem.
 *
 * Por que existe: o passo (a) do
 * `docs/runbooks/migrar-banco-da-loja.md` roda no Windows do Gabriel, que só
 * tem o Node/npm do projeto e o PostgreSQL 17 (`winget install -e --id
 * PostgreSQL.PostgreSQL.17`) — sem 7-Zip, sem WSL, sem `gunzip` de sistema.
 * `node:zlib` já traz o descompressor; não precisa instalar mais nada.
 *
 * USO:
 *   node scripts/migracao/descompactar.mjs <arquivo.gz>
 *   node scripts/migracao/descompactar.mjs <pasta-com-.gz>
 *   node scripts/migracao/descompactar.mjs <arquivo.gz> --forcar
 *
 * Aceita um arquivo `.gz` OU uma pasta (descompacta todo `.gz` que achar,
 * direto nela — sem entrar em subpasta). Idempotente: rodar de novo não
 * reescreve o arquivo já descompactado, a menos que `--forcar` seja passado
 * (útil se o dono editou o backup por engano e quer repetir do zero).
 *
 * Escreve sempre num arquivo temporário (`<destino>.parcial`) e só troca de
 * nome no final: um backup mal formado (ou uma queda no meio do caminho)
 * nunca deixa um `.sql` pela metade que pareça pronto para o passo (b).
 */
/* eslint-disable security/detect-non-literal-fs-filename --
 * Todo caminho aqui vem do próprio argumento de linha de comando de quem
 * roda o script (o dono, na mão, apontando para o backup que ELE baixou) ou
 * é derivado dele (nomeSemGz/path.join) — nunca de uma requisição de rede ou
 * de entrada não confiável. Ler/escrever caminho calculado é literalmente o
 * trabalho deste script, mesma justificativa de scripts/verifica-links-md.mjs.
 */
import {
  createReadStream,
  createWriteStream,
  existsSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

/** "arquivo.backup.gz" -> "arquivo.backup". Só tira o `.gz` final — o resto
 * do nome (inclusive outra extensão no meio) fica como está. Aceita `.GZ`
 * maiúsculo: o backup foi baixado num Windows, que não distingue caixa no
 * nome do arquivo. */
export function nomeSemGz(nomeArquivo) {
  if (!/\.gz$/i.test(nomeArquivo)) {
    throw new Error(
      `"${nomeArquivo}" não termina em .gz — nada para descompactar`,
    );
  }
  return nomeArquivo.slice(0, -3);
}

/** Nomes (não caminho completo) dos `.gz` de um diretório, ordenados —
 * ignora subpasta e qualquer arquivo que não termine em `.gz`. */
export function listarArquivosGz(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entrada) => entrada.isFile() && /\.gz$/i.test(entrada.name))
    .map((entrada) => entrada.name)
    .sort();
}

/**
 * Descompacta UM arquivo `.gz`. Devolve `{ origem, destino, pulou,
 * bytesEntrada, bytesSaida }` — `pulou: true` quando o destino já existia e
 * `forcar` não foi pedido (idempotência: a segunda chamada não reescreve).
 *
 * `opcoes.destino`, se passado, escolhe o caminho de saída (ex.: renomear
 * `db_cluster-28-09-2026@03-20-37.backup` para `db_cluster.sql`, mais fácil
 * de digitar depois no `psql -f`). Sem ele, o padrão é só tirar o `.gz` do
 * nome de origem (`nomeSemGz`), na mesma pasta.
 */
export async function descompactarArquivo(origem, opcoes = {}) {
  const { forcar = false, destino: destinoExplicito } = opcoes;
  if (!existsSync(origem)) {
    throw new Error(`arquivo de origem não existe: ${origem}`);
  }

  const dir = path.dirname(origem);
  const destino =
    destinoExplicito ?? path.join(dir, nomeSemGz(path.basename(origem)));

  if (existsSync(destino) && !forcar) {
    return { origem, destino, pulou: true, bytesSaida: statSync(destino).size };
  }

  const bytesEntrada = statSync(origem).size;
  const parcial = `${destino}.parcial`;
  try {
    await pipeline(
      createReadStream(origem),
      createGunzip(),
      createWriteStream(parcial),
    );
  } catch (erro) {
    if (existsSync(parcial)) unlinkSync(parcial);
    throw new Error(`falha ao descompactar "${origem}": ${erro.message}`);
  }
  renameSync(parcial, destino);

  return {
    origem,
    destino,
    pulou: false,
    bytesEntrada,
    bytesSaida: statSync(destino).size,
  };
}

/** Resolve o argumento da linha de comando (um arquivo `.gz` ou uma pasta)
 * na lista de caminhos de origem a descompactar. */
function resolverOrigens(caminho) {
  const info = statSync(caminho);
  if (info.isDirectory()) {
    const nomes = listarArquivosGz(caminho);
    if (nomes.length === 0) {
      throw new Error(`nenhum .gz encontrado em "${caminho}"`);
    }
    return nomes.map((nome) => path.join(caminho, nome));
  }
  return [caminho];
}

async function main() {
  const argumentos = process.argv.slice(2);
  const forcar = argumentos.includes("--forcar");
  const posicionais = argumentos.filter((a) => a !== "--forcar");
  const [alvo, destinoExplicito] = posicionais;

  if (!alvo) {
    console.error(
      "Uso: node scripts/migracao/descompactar.mjs <arquivo.gz|pasta> [destino.sql] [--forcar]",
    );
    process.exit(1);
    return;
  }

  let origens;
  try {
    origens = resolverOrigens(alvo);
  } catch (erro) {
    console.error("FALHOU:", erro.message);
    process.exit(1);
    return;
  }

  if (destinoExplicito && origens.length > 1) {
    console.error(
      "FALHOU: um destino explícito só vale para UM arquivo — você passou uma pasta com mais de um .gz.",
    );
    process.exit(1);
    return;
  }

  let falhas = 0;
  for (const origem of origens) {
    try {
      const resultado = await descompactarArquivo(origem, {
        forcar,
        destino: destinoExplicito,
      });
      if (resultado.pulou) {
        console.log(
          `[pulei]  ${resultado.destino} já existe (${resultado.bytesSaida} bytes) — use --forcar para refazer`,
        );
      } else {
        console.log(
          `[ok]     ${resultado.origem} (${resultado.bytesEntrada} bytes) -> ${resultado.destino} (${resultado.bytesSaida} bytes)`,
        );
      }
    } catch (erro) {
      falhas += 1;
      console.error(`[falhou] ${origem}: ${erro.message}`);
    }
  }

  if (falhas > 0) {
    console.error(
      `\n${falhas} arquivo(s) falharam — veja as linhas [falhou] acima.`,
    );
    process.exit(1);
  }
}

// pathToFileURL, e não o template `file://${argv[1]}`: no Windows
// `process.argv[1]` vem com `\` e letra de unidade ("C:\..."), e o template
// nunca bate com `import.meta.url` ("file:///C:/...") — main() nunca
// rodaria, em silêncio (achado do coordenador, 28/09/2026, contra este mesmo
// padrão usado antes aqui). Em POSIX os dois já coincidiam por acidente (o
// path já começa com "/"), o que escondeu o bug nos testes deste repositório
// — todos rodados em Linux.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
