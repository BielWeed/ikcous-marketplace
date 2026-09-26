#!/usr/bin/env node
/**
 * PROVA (não roda no CI — exige um Postgres local à mão, e não é o banco da
 * loja): o guard `BEGIN READ ONLY;` que `scripts/publicacao/conferir-banco.cjs`
 * põe na frente de toda consulta de conferência é read-only "por construção",
 * não só porque a Management API documenta um parâmetro `read_only`.
 *
 * O QUE ISTO PROVA, contra um Postgres de verdade, pelo MESMO protocolo
 * SIMPLES que a Management API usa (uma string com vários statements
 * separados por `;`, mandada de uma vez para `client.query(string)`, sem
 * `values` — é isso que ativa o protocolo simples no `pg`):
 *
 *   (a) `BEGIN READ ONLY;\nSELECT ...;` devolve a linha do SELECT — a
 *       consulta em si não é afetada pelo guard.
 *   (b) `BEGIN READ ONLY;\nCREATE TABLE ...;` FALHA na mesma requisição
 *       ("cannot execute CREATE TABLE in a read-only transaction"), e a
 *       tabela realmente não existe depois — nada vazou da transação aberta
 *       e nunca comitada.
 *   (d) o mesmo vale para um INSERT numa tabela que já existe: falha, e a
 *       tabela continua vazia.
 *
 * E O QUE ISTO NÃO PROVA — limite medido na rodada 2 da revisão de risco:
 *   (e) `BEGIN READ ONLY;\nSELECT 1; COMMIT; INSERT ...;` GRAVA. O COMMIT
 *       fecha a transação read-only, e o INSERT seguinte roda numa
 *       transação NOVA, implícita, read-write por padrão. O guard sozinho
 *       não é hermético contra um corpo que embute controle de transação —
 *       é exatamente por isso que `scripts/publicacao/conferir-banco.cjs`
 *       não usa mais este guard como barreira principal: a barreira real é
 *       o papel `supabase_read_only_user` do endpoint dedicado
 *       `POST /database/query/read-only`, que não tem grant de escrita
 *       para desfazer com COMMIT nenhum. Este caso (e) é IMPRESSO como
 *       limite conhecido, não tratado como falha do script de prova.
 *
 * Também mede um detalhe do `pg` que motiva o design de
 * `conferir-banco.cjs`: `client.query()` com um texto de MAIS DE UM
 * statement devolve um ARRAY de `Result` (um por statement) — só o ÚLTIMO
 * interessa. É o mesmo motivo pelo qual todo arquivo de
 * `scripts/publicacao/consultas/` tem de ser exatamente UM SELECT: com o
 * guard, o corpo mandado é sempre `BEGIN READ ONLY;` + um único SELECT, e o
 * SELECT é garantidamente o ÚLTIMO elemento.
 *
 * USO (requer um Postgres local rodando, PG17 deste ambiente: socket /tmp,
 * porta 5432, usuário postgres; `createdb`/`dropdb` em
 * /usr/lib/postgresql/16/bin):
 *
 *   createdb -h /tmp -p 5432 -U postgres conferebanco_prova
 *   node scripts/publicacao/prova-readonly.cjs
 *   dropdb -h /tmp -p 5432 -U postgres conferebanco_prova
 */
const { Client } = require("pg");

const NOME_DO_BANCO = process.env.PROVA_DB || "conferebanco_prova";
const CONEXAO = {
  host: process.env.PROVA_HOST || "/tmp",
  port: Number(process.env.PROVA_PORT || 5432),
  user: process.env.PROVA_USER || "postgres",
  database: NOME_DO_BANCO,
};

async function main() {
  let falhou = false;

  // (a) SELECT depois do guard: tem de devolver a linha.
  {
    const client = new Client(CONEXAO);
    await client.connect();
    try {
      const bruto = await client.query(
        "BEGIN READ ONLY;\nSELECT 1 AS um, 'ok' AS rotulo;",
      );
      const ultimo = Array.isArray(bruto) ? bruto[bruto.length - 1] : bruto;
      console.log(
        "(a) SELECT após BEGIN READ ONLY:",
        JSON.stringify(ultimo.rows),
      );
      if (ultimo.rows.length !== 1 || ultimo.rows[0].um !== 1) {
        throw new Error("esperava [{um:1, rotulo:'ok'}]");
      }
      console.log("(a) OK — o guard não muda o resultado de um SELECT.");
    } catch (e) {
      console.error("(a) FALHOU:", e.message);
      falhou = true;
    } finally {
      await client.end();
    }
  }

  // (b) DDL depois do guard: tem de FALHAR, na MESMA requisição, e nada pode
  // ter sido gravado.
  {
    const client = new Client(CONEXAO);
    await client.connect();
    try {
      await client.query(
        "BEGIN READ ONLY;\nCREATE TABLE nao_deveria_existir (id int);",
      );
      console.error("(b) FALHOU: o CREATE TABLE não foi barrado pelo guard!");
      falhou = true;
    } catch (e) {
      const bateuComOEsperado = /read-only transaction/i.test(e.message);
      console.log(
        `(b) ${bateuComOEsperado ? "OK" : "AVISO"} — guard barrou o CREATE TABLE ->`,
        e.message,
      );
      if (!bateuComOEsperado) falhou = true;
    } finally {
      await client.end();
    }
  }
  {
    const client = new Client(CONEXAO);
    await client.connect();
    try {
      const r = await client.query(
        "SELECT to_regclass('public.nao_deveria_existir') AS existe;",
      );
      console.log(
        "(c) tabela existe depois da tentativa barrada?",
        r.rows[0].existe,
      );
      if (r.rows[0].existe !== null) {
        console.error(
          "(c) FALHOU: o CREATE TABLE vazou para fora da transação!",
        );
        falhou = true;
      } else {
        console.log("(c) OK — nada foi gravado.");
      }
    } finally {
      await client.end();
    }
  }

  // (d) mesmo teste com um INSERT (não DDL) numa tabela que já existe.
  {
    const client = new Client(CONEXAO);
    await client.connect();
    await client.query("CREATE TABLE IF NOT EXISTS alvo (id int)");
    try {
      await client.query("BEGIN READ ONLY;\nINSERT INTO alvo (id) VALUES (1);");
      console.error("(d) FALHOU: o INSERT não foi barrado pelo guard!");
      falhou = true;
    } catch (e) {
      console.log("(d) OK — guard barrou o INSERT ->", e.message);
    } finally {
      // A transação do BEGIN READ ONLY fica aberta e ABORTADA no servidor —
      // nem commit nem rollback foram enviados, de propósito (o design é
      // "sem COMMIT"). Fecha a conexão para a checagem seguinte não herdar
      // esse estado (erro 25P02, "current transaction is aborted").
      await client.end();
    }
  }
  {
    const client = new Client(CONEXAO);
    await client.connect();
    try {
      const r = await client.query("SELECT count(*)::int AS n FROM alvo;");
      console.log(
        "(d) linhas em alvo depois da tentativa barrada:",
        r.rows[0].n,
      );
      if (r.rows[0].n !== 0) {
        console.error("(d) FALHOU: o INSERT vazou!");
        falhou = true;
      }
    } finally {
      await client.end();
    }
  }

  // (e) LIMITE CONHECIDO (rodada 2): um corpo que embute COMMIT desfaz o
  // guard para o statement seguinte. Isto é ESPERADO — não conta como falha
  // do guard nos casos (a)-(d), que são o que ele promete (barrar escrita
  // ISOLADA depois de BEGIN READ ONLY). É por isso que o caminho quente do
  // script usa o papel `supabase_read_only_user`, não este guard.
  {
    const client = new Client(CONEXAO);
    await client.connect();
    await client.query("CREATE TABLE IF NOT EXISTS alvo_commit (id int)");
    try {
      const r = await client.query(
        "BEGIN READ ONLY;\nSELECT 1; COMMIT; INSERT INTO alvo_commit (id) VALUES (1);",
      );
      const linhas = (
        await client.query("SELECT count(*)::int AS n FROM alvo_commit;")
      ).rows[0].n;
      console.log(
        `(e) LIMITE CONHECIDO: guard + COMMIT embutido -> ${Array.isArray(r) ? "executou" : "executou"}; linhas em alvo_commit: ${linhas} (esperado: 1, prova de que o guard SOZINHO não é hermético)`,
      );
      if (linhas !== 1) {
        console.log(
          "(e) AVISO: esperava que este caso adversarial GRAVASSE (para documentar o limite) e não gravou — revisite este comentário, o comportamento do Postgres pode ter mudado.",
        );
      }
    } catch (e) {
      console.log(
        "(e) o Postgres local recusou o caso adversarial (não reproduziu o limite):",
        e.message,
      );
    } finally {
      await client.end();
    }
  }

  if (falhou) {
    console.error("\nPROVA FALHOU.");
    process.exit(1);
  }
  console.log(
    "\nPROVA COMPLETA: o guard barra escrita ISOLADA (a-d); (e) documenta por que ele não é a barreira principal do script.",
  );
}

main().catch((e) => {
  console.error("ERRO GERAL:", e);
  process.exit(1);
});
