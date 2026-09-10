#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename -- Todo caminho lido/escrito aqui vem
   ou do proprio script (raiz + "node_modules/.identidade-bootstrap-tmp/" + process.pid, sem
   entrada externa) ou de flags de CLI (--valores, --subidos, --saida) que o OPERADOR local passa
   na propria maquina -- mesmo modelo de ameaca do eslint-disable de scripts/identidadeBootstrap.ts
   (kit local validado por sha256), nunca rede ou entrada nao confiavel. */
// Bootstrap da identidade real de UMA loja. Empacota scripts/identidadeBootstrap.ts em memoria
// (esbuild ja instalado; padrao do validar.mjs do kit A6a) porque o Node nao roda .ts com imports
// sem extensao. Nunca imprime DATABASE_URL, chave nem o caminho absoluto de um objeto do kit
// (ObjetoDoKit.arquivo -- filtrado pelo replacer nucleo.semArquivo em toda saida JSON).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mascarar = (texto) =>
  String(texto).replace(/postgres(ql)?:\/\/[^\s'"]+/g, "<url-mascarada>");

async function carregarNucleo() {
  const bundle = await esbuild.build({
    entryPoints: [path.join(raiz, "scripts", "identidadeBootstrap.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node22",
    // Medido em 10/09/2026 (rodando o bundle de verdade, sem "sharp" no
    // grafo de identidadeBootstrap.ts -> src/lib/{storeIdentity,publicStoreIdentity}.ts):
    // sem external nenhum, o bundle arrasta os 118 arquivos de
    // @supabase/supabase-js (realtime-js/functions-js incluidos, 1.36 MB);
    // com so' estes dois, 0 arquivos de node_modules entram no bundle
    // (ambos resolvem em runtime, de node_modules, pela import ESM comum --
    // ver a nota no relatorio desta tarefa). "sharp" nao aparece no grafo
    // desta ferramenta (so' o preparador de imagem o usa) -- nao e' external.
    external: ["@supabase/supabase-js", "zod"],
  });
  const arquivo = path.join(
    raiz,
    "node_modules",
    ".identidade-bootstrap-tmp",
    `nucleo-${process.pid}.mjs`,
  );
  await fs.mkdir(path.dirname(arquivo), { recursive: true });
  await fs.writeFile(arquivo, bundle.outputFiles[0].text);
  try {
    return await import(pathToFileURL(arquivo).href);
  } finally {
    await fs.rm(arquivo, { force: true });
  }
}

function portaBanco(databaseUrl, nucleo) {
  async function chamar(sql, params) {
    const { Client } = await import("pg");
    const client = new Client({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    try {
      await client.query("BEGIN");
      // is_admin() autoriza service_role/postgres pelo current_setting('role');
      // LOCAL morre com a transacao (pooler em transaction mode) -- por isso
      // BEGIN/SET LOCAL/COMMIT vivem juntos, por CHAMADA (uma transacao nova
      // a cada ler()/gravar(), nunca uma so' compartilhada entre as duas).
      await client.query("SET LOCAL ROLE service_role");
      const { rows } = await client.query(sql, params);
      await client.query("COMMIT");
      return rows[0].r;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  }
  return {
    async ler() {
      return chamar("SELECT public.read_store_identity() AS r", []);
    },
    async gravar(rev, expected, desired) {
      try {
        return await chamar(
          "SELECT public.save_store_identity($1, $2::jsonb, $3::jsonb) AS r",
          [rev, JSON.stringify(expected), JSON.stringify(desired)],
        );
      } catch (error) {
        if (error?.code === "P0001" && /IDENTITY_CONFLICT/.test(error.message))
          throw new nucleo.BootstrapError("CONFLITO", "IDENTITY_CONFLICT");
        throw error;
      }
    },
  };
}

// cmd.exe/MSVCRT: entre aspas, aspa interna dobrada. Sem isso, um spawnSync
// com shell:true no Windows so' CONCATENA os elementos do array com espaco
// (DEP0190) -- medido offline (Step 3 do relatorio desta tarefa):
// ["--cache-control", "public, max-age=31536000, immutable"] chega ao
// processo filho como TRES argumentos separados ("public,", "max-age=...,",
// "immutable"), corrompendo o comando. Quotar cada parte e montar UM
// comando (sem args[]) preserva cada valor inteiro e nao dispara o aviso.
export const quotarWindows = (valor) =>
  `"${String(valor).replace(/"/g, '""')}"`;

// Medido pela hub em 10/09/2026 (loja real, ANTES de tocar o banco;
// script "prova-npx-cmd.mjs" desta tarefa reproduz offline): no Windows, a
// `cli()` montava `"npx" "supabase" ...` -- "npx" ENTRE ASPAS e SEM CAMINHO.
// O cmd.exe, para um .cmd citado assim, expande `%~dp0` (usado pelo proprio
// npx.cmd para achar `node_modules\npm\bin\npx-cli.js`) para o CWD do
// processo PAI, nao para a pasta onde o npx.cmd de verdade mora. Num
// worktree isolado o CWD nao tem esse `node_modules`, e a chamada falha
// ANTES de rodar qualquer coisa: "Cannot find module
// '...worktree...\npm-prefix.js'" -> BootstrapError UPLOAD -> exit 3 no
// primeiro objeto (mesmo com a loja certa e o comando certo). Um CAMINHO
// ABSOLUTO entre aspas nao sofre disso (`%~dp0` do proprio arquivo): esta
// funcao devolve `<pasta do node.exe>\npx.cmd` quando esse arquivo existe
// (instalacao padrao do Node no Windows poe os dois lado a lado) e cai para
// o literal "npx" (resolvido pelo PATH) fora do Windows ou se o arquivo nao
// estiver la'.
export function executavelNpx({ plataforma, execPath, existe }) {
  if (plataforma !== "win32") return "npx";
  const candidato = path.join(path.dirname(execPath), "npx.cmd");
  return existe(candidato) ? candidato : "npx";
}

// Medido pela hub em 10/09/2026 (loja real, CLI supabase 2.109.1 via npx,
// Windows): `cp` com <src> ABSOLUTO de Windows (com "C:/..." ou "C:\\...")
// falha SEMPRE -- o CLI le "C:" como esquema de URL, nao como drive letter
// ({"code":"LegacyStorageUnsupportedOperationError","message":"Unsupported
// operation","suggestion":"Run cp -r <src> <dst> to copy between local
// directories."}). Com <src> RELATIVO ao diretorio atual (cwd = a propria
// pasta do arquivo, <src> = so' o nome) funciona: upload confirmado, sha e
// Content-Type corretos no objeto publico. Extraida como funcao pura (sem
// spawnSync) para o teste montar o MESMO array que `subir()` manda ao CLI,
// sem rede -- reusa executavelNpx (mesmo problema do %~dp0 documentado
// acima).
export function montarChamadaCp(
  objeto,
  { plataforma, execPath, existe, workdir },
) {
  const cwd = path.dirname(objeto.arquivo);
  const partes = [
    executavelNpx({ plataforma, execPath, existe }),
    "supabase",
    "storage",
    "cp",
    path.basename(objeto.arquivo),
    `ss:///branding/${objeto.path}`,
    "--content-type",
    objeto.mime,
    "--cache-control",
    // Medido pela hub em 10/09/2026 (loja real): o CLI 2.109.1 IGNORA esta
    // flag (antes ou depois dos posicionais) -- o objeto serve
    // "Cache-Control: no-cache" ate alguem regravar pelo painel/API. Nao ha'
    // o que fazer aqui alem de documentar; o valor (31536000) e' o mesmo
    // que src/lib/uploadIdentityImage.ts:501 manda no metadata TUS
    // (cacheControl: "31536000") para o upload real pelo navegador.
    "max-age=31536000",
    "--linked",
    "--experimental",
    "--workdir",
    workdir,
  ];
  return { cwd, partes };
}

function portaStorage(workdir, nucleo) {
  const executar = (partes, cwd) => {
    const r =
      process.platform === "win32"
        ? spawnSync(partes.map(quotarWindows).join(" "), [], {
            encoding: "utf8",
            shell: true,
            cwd,
          })
        : spawnSync(partes[0], partes.slice(1), { encoding: "utf8", cwd });
    if (r.error)
      throw new nucleo.BootstrapError(
        "UPLOAD",
        `nao foi possivel executar supabase: ${mascarar(String(r.error))}`,
      );
    if (r.status !== 0) {
      const saidaCrua = r.stderr || r.stdout || "";
      // Medido pela hub em 10/09/2026 (loja real): o CLI NAO sobrescreve --
      // `cp` para um path ja existente devolve LegacyStorageGatewayStatusError
      // com statusCode 409. Compativel com o nucleo (estadoNoBucket pula o
      // que ja existe com o mesmo sha), mas a mensagem original (409 cru
      // dentro do JSON) nao dizia isso -- so' reescreve o texto, o codigo de
      // saida continua o de UPLOAD (CODIGOS_DE_SAIDA.upload).
      if (saidaCrua.includes("409"))
        throw new nucleo.BootstrapError(
          "UPLOAD",
          `objeto ja existe no bucket (409); estadoNoBucket deveria ter pulado — conteudo diferente? ${mascarar(saidaCrua)}`,
        );
      throw new nucleo.BootstrapError(
        "UPLOAD",
        `supabase ${partes[2]} ${partes[3]} falhou: ${mascarar(saidaCrua)}`,
      );
    }
    return r.stdout;
  };
  const cli = (args, cwd) =>
    executar(
      [
        executavelNpx({
          plataforma: process.platform,
          execPath: process.execPath,
          existe: existsSync,
        }),
        "supabase",
        ...args,
        "--linked",
        "--experimental",
        "--workdir",
        workdir,
      ],
      cwd,
    );
  return {
    async subir(objeto) {
      const { cwd, partes } = montarChamadaCp(objeto, {
        plataforma: process.platform,
        execPath: process.execPath,
        existe: existsSync,
        workdir,
      });
      executar(partes, cwd);
    },
    async remover(paths) {
      // Chamado so' quando ha' algo para remover -- o nucleo (desfazer) ja
      // guarda essa condicao, mas a porta e' defensiva por conta propria.
      // Sem <src> local, nao precisa de cwd especial (undefined = cwd do
      // proprio processo, igual ao comportamento anterior a esta tarefa).
      if (!paths.length) return;
      cli(["storage", "rm", ...paths.map((p) => `ss:///branding/${p}`)]);
    },
  };
}

// principal(argv, env, fabricas) -- exportado para o teste do lancador
// (tests/front/identidade-bootstrap-lancador.test.ts, achado A1 da revisao
// A11) rodar contra portas falsas em memoria, sem tocar banco, Storage nem
// rede. `fabricas` so' troca o que o teste precisa duplicar: as duas
// fabricas de porta e o fetchImpl (mesmo padrao do `portasFalsas` da suite
// do nucleo) e, opcionalmente, carregarNucleo. Os defaults sao as
// implementacoes reais deste arquivo -- o `main` no fim so' chama
// `principal(process.argv.slice(2), process.env, {})`.
export async function principal(argv, env, fabricas = {}) {
  const {
    portaBanco: fabricaPortaBanco = portaBanco,
    portaStorage: fabricaPortaStorage = portaStorage,
    fetchImpl = globalThis.fetch,
    carregarNucleo: fabricaCarregarNucleo = carregarNucleo,
  } = fabricas;

  // ANOTADO da revisao A11 (.mjs:160): carregarNucleo() agora vive DENTRO do
  // try. Antes, uma falha do esbuild ou do import do bundle escapava ate o
  // `await principal()` do topo e o Node imprimia o stack cru (caminho
  // absoluto incluido) sem passar pelo `mascarar`. Sem nucleo carregado nao
  // ha' CODIGOS_DE_SAIDA para consultar -- 1 e' literal aqui porque e' o
  // mesmo valor de CODIGOS_DE_SAIDA.inesperado, so' que antes dele existir.
  let nucleo;
  try {
    nucleo = await fabricaCarregarNucleo();
  } catch (error) {
    console.error("inesperado:", mascarar(error?.stack ?? error));
    return 1;
  }
  const { BootstrapError, CODIGOS_DE_SAIDA } = nucleo;
  const CODIGO_POR_ERRO = new Map([
    ["CONFLITO", CODIGOS_DE_SAIDA.conflito],
    ["ESTADO", CODIGOS_DE_SAIDA.recusa],
    ["UPLOAD", CODIGOS_DE_SAIDA.upload],
    ["CONFERENCIA", CODIGOS_DE_SAIDA.upload],
    // PROVA e' o unico erro em que o banco JA FOI GRAVADO -- codigo proprio
    // (6), nunca confundido com falha de upload/conferencia (achado C3 da
    // revisao A11).
    ["PROVA", CODIGOS_DE_SAIDA.prova],
  ]);

  let argumentos;
  try {
    argumentos = nucleo.lerArgumentos(argv);
  } catch (error) {
    console.error(mascarar(error.message));
    return CODIGOS_DE_SAIDA.entrada;
  }

  const { DATABASE_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY } = env;
  if (!DATABASE_URL || !VITE_SUPABASE_URL || !VITE_SUPABASE_ANON_KEY) {
    console.error(
      "faltam DATABASE_URL, VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY no ambiente",
    );
    return CODIGOS_DE_SAIDA.entrada;
  }
  try {
    nucleo.normalizeSupabaseOrigin(VITE_SUPABASE_URL);
  } catch {
    // Mensagem propria em vez de deixar montarIdentidade confundir isto com
    // um valor de identidade ruim (ANOTADO da revisao A11: "VALORES: o build
    // recusaria esta linha: IDENTITY_ORIGIN" aponta para o arquivo de
    // valores quando o defeito e' o ambiente). Nunca imprime a URL inteira.
    console.error("VITE_SUPABASE_URL invalida");
    return CODIGOS_DE_SAIDA.entrada;
  }

  // --aplicar (bootstrap) exige --saida e recusa ANTES de tocar rede/banco:
  // descobrir so' depois de subir objetos e gravar que o relatorio nao tem
  // onde ser salvo seria pior que recusar cedo.
  if (argumentos.aplicar && argumentos.saida) {
    try {
      await fs.access(argumentos.saida);
      // ANOTADO da revisao A11 (.mjs:206): nao ecoar o caminho que o
      // operador passou em --saida (pode ser absoluto, com nome de usuario).
      console.error("o arquivo --saida ja existe, nao sobrescrevo");
      return CODIGOS_DE_SAIDA.entrada;
    } catch {
      // ENOENT esperado: arquivo nao existe, segue.
    }
  }

  const portas = {
    banco: fabricaPortaBanco(DATABASE_URL, nucleo),
    storage: fabricaPortaStorage(argumentos.workdirSupabase, nucleo),
    fetchImpl,
    supabaseUrl: VITE_SUPABASE_URL,
    chavePublica: VITE_SUPABASE_ANON_KEY,
  };
  // "modo" vem de aplicado, nunca da flag nem de acao: em dry-run, desfazer
  // ainda devolve acao "desfeito" com aplicado false (ANOTADO 1 da revisao
  // A11b) -- ler acao sozinho mentiria sobre o que aconteceu.
  const imprimirRelatorio = (relatorio) =>
    console.log(
      JSON.stringify(
        {
          ...relatorio,
          modo: relatorio.aplicado ? "APLICADO" : "DRY-RUN (nada gravado)",
        },
        nucleo.semArquivo,
        2,
      ),
    );
  try {
    const kit = await nucleo.lerKit(argumentos.kit, argumentos.loja);
    const valores = JSON.parse(await fs.readFile(argumentos.valores, "utf8"));
    let relatorio;
    if (argumentos.desfazer) {
      let removerPaths = [];
      if (argumentos.subidos) {
        const anterior = JSON.parse(
          await fs.readFile(argumentos.subidos, "utf8"),
        );
        if (!Array.isArray(anterior.subidos))
          throw new BootstrapError(
            "VALORES",
            // ANOTADO da revisao A11 (.mjs:233): idem, sem ecoar o caminho
            // de --subidos.
            'arquivo --subidos ilegivel: falta campo "subidos" (array)',
          );
        removerPaths = anterior.subidos;
      } else {
        console.error(
          "aviso: sem --subidos, desfazer nao remove nenhum objeto do bucket (grava NULL so' com --aplicar)",
        );
      }
      console.log(
        `modo: desfazer -- removerPaths: ${removerPaths.length} path(s)`,
      );
      relatorio = await nucleo.desfazer(kit, valores, portas, {
        // Mesma regra do bootstrap: sem --aplicar e' dry-run (nada gravado
        // nem removido); --desfazer --aplicar executa de verdade. Correcao
        // da leitura anterior (o desfazer nao deveria "sempre aplicar" so'
        // por ser chamado pela CLI) -- ver
        // central/tarefa-A11c-desfazer-dry-run-relatorio.md.
        aplicar: argumentos.aplicar,
        removerPaths,
      });
    } else {
      const desired = nucleo.montarIdentidade(kit, valores, VITE_SUPABASE_URL);
      const atual = await portas.banco.ler();
      const plano = nucleo.planejar(desired, atual, kit);
      console.log(
        `plano: ${plano.acao}${plano.acao === "bootstrap" ? "" : ` — ${plano.motivo}`} (revisao atual ${atual.revision})`,
      );
      if (plano.acao === "recusa") return CODIGOS_DE_SAIDA.recusa;
      relatorio = await nucleo.executar(plano, portas, {
        aplicar: argumentos.aplicar,
      });
      if (argumentos.aplicar && argumentos.saida) {
        // B1 (revisao A11, BLOQUEIA): imprimir o relatorio em stdout ANTES
        // de gravar --saida. stdout e' o canal que a hub ja captura e
        // mascara, e e' o unico que sobrevive se a gravacao do arquivo
        // falhar DEPOIS do banco ja gravado -- sem isto, a lista "subidos"
        // (o unico jeito de --desfazer --subidos saber o que remover) se
        // perdia por inteiro. Falha aqui e' PROVA (banco ja gravado), nunca
        // "inesperado": o exit 1 antigo mentia que nada tinha acontecido.
        imprimirRelatorio(relatorio);
        try {
          await fs.writeFile(
            argumentos.saida,
            JSON.stringify(relatorio, nucleo.semArquivo, 2),
            { flag: "wx" },
          );
        } catch (error) {
          console.error(
            `PROVA: BANCO JA GRAVADO (revisao ${relatorio.revisao}); falha ao gravar --saida: ${mascarar(error?.message ?? String(error))}`,
          );
          return CODIGOS_DE_SAIDA.prova;
        }
        return CODIGOS_DE_SAIDA.ok;
      }
    }
    imprimirRelatorio(relatorio);
    return CODIGOS_DE_SAIDA.ok;
  } catch (error) {
    if (error instanceof BootstrapError) {
      console.error(`${error.code}: ${mascarar(error.message)}`);
      return CODIGO_POR_ERRO.get(error.code) ?? CODIGOS_DE_SAIDA.entrada;
    }
    console.error("inesperado:", mascarar(error?.stack ?? error));
    return CODIGOS_DE_SAIDA.inesperado;
  }
}

// So' executa quando este arquivo e' o modulo principal (`node
// identidade-bootstrap.mjs ...`) -- nunca quando um teste o importa
// (tests/front/identidade-bootstrap-lancador.test.ts importa `principal` e
// chama com portas falsas; sem esta guarda, o import sozinho ja tentaria
// ler process.argv/process.env reais e sair do processo do runner).
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await principal(process.argv.slice(2), process.env, {});
}
