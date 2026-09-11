// servir.ts — ponto de entrada para subir o servidor de ensaio dos hosts
// SOZINHO, fora do Vitest (T6, ADENDO D, item 7 do revisor). Existe só para
// a prova no navegador (`PROVA-NO-NAVEGADOR.md`): o Vitest roda em
// `environment: "node"`, sem `navigator`/`caches`/Service Worker — a única
// forma de observar o SW de verdade é apontar um navegador de verdade para
// um servidor de verdade, de pé, parado, esperando requisição.
//
// Uso:
//   IKCOUS_IDENTITY_MODE=fixture npm run build   (se dist-test/ não existir)
//   ./node_modules/.bin/esbuild tests/porteiro-dois-hosts/servir.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=dist-test/servir.mjs
//   PORTA=4310 node dist-test/servir.mjs
//   (node direto NÃO resolve os imports sem extensão de src/ — ver README e PROVA-NO-NAVEGADOR.md)
//
// `PORTA` é OPCIONAL — sem ela, o SO escolhe uma porta livre
// (`iniciarServidorDoisHosts`, sem a corrida de abrir-fechar-reabrir de
// antes: o PRÓPRIO servidor faz `listen()` uma vez e lê `address()`).
//
// NUNCA sufixo `.test.ts` (regra da tarefa) — este arquivo não é um teste,
// não é descoberto por `vitest`/`deno test`, e não tem `describe`/`it`.
import { existsSync } from "node:fs";

import { DIST_TEST_DIR, iniciarServidorDoisHosts } from "./servidor.ts";

async function main(): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- DIST_TEST_DIR é a constante exportada por `servidor.ts` (`path.resolve(process.cwd(), "dist-test")`), nunca entrada externa.
  if (!existsSync(DIST_TEST_DIR)) {
    console.error(
      `PORTEIRO_DOIS_HOSTS_SEM_DIST_TEST: rode \`IKCOUS_IDENTITY_MODE=fixture npm run build\` na raiz do repositório antes (dist-test/ não existe em ${DIST_TEST_DIR}).`,
    );
    process.exitCode = 1;
    return;
  }

  const portaEnv = process.env.PORTA;
  const porta =
    portaEnv !== undefined && portaEnv !== "" ? Number(portaEnv) : undefined;
  if (porta !== undefined && !Number.isInteger(porta)) {
    console.error(
      `PORTEIRO_DOIS_HOSTS_PORTA_INVALIDA: "${portaEnv}" não é um inteiro.`,
    );
    process.exitCode = 1;
    return;
  }

  const servidor = await iniciarServidorDoisHosts({ porta });
  console.log(
    `servidor de ensaio dos hosts (porteiro-dois-hosts) de pé em http://127.0.0.1:${servidor.porta}/ — use Host: loja-a.localhost, loja-b.localhost, loja-c.localhost, loja-d.localhost, loja-trocada.localhost ou loja-desconhecida.localhost. Ctrl+C para encerrar.`,
  );

  const encerrar = async (): Promise<void> => {
    console.log("encerrando o servidor de ensaio dos hosts...");
    await servidor.fechar();
    process.exit(0);
  };
  process.on("SIGINT", () => void encerrar());
  process.on("SIGTERM", () => void encerrar());
}

void main();
