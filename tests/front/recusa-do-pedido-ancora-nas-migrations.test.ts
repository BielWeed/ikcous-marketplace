// Roda no CI, que NAO tem banco: a ancora e' o arquivo de migration em disco,
// nunca `pg_get_functiondef`.
//
// 🔴 CORRIGIDO em 28/08/2026, depois de a revisao devolver BLOQUEIA. A primeira
// versao usava `node:fs`/`node:path`/`process`, e isso reprovava DOIS portoes:
//
//   1. `npm run typecheck`: `tsconfig.app.json` cobre `tests/front` com
//      `"types": ["vite/client"]` -- SEM `"node"`. Sem isso, `node:fs`,
//      `node:path` e o global `process` nao existem para o compilador. Este era
//      o PRIMEIRO arquivo de `tests/front` a importar API de Node, entao a
//      lacuna nunca tinha aparecido.
//   2. `npm run lint:ratchet`: `readdirSync`/`readFileSync` com caminho de
//      variavel disparam `security/detect-non-literal-fs-filename`. Sao 2
//      warnings NOVOS, e o teto do `.lint-baseline.json` esta em 550 SEM FOLGA
//      -- warning novo reprova igual a erro novo.
//
// `import.meta.glob` com `?raw` le os arquivos em tempo de build do vitest, sem
// API de Node nenhuma: os dois portoes passam e nao se mexe em config
// compartilhada com frentes ativas. O padrao ja existe nesta casa --
// `tests/front/guarda-de-cor-sai-junto-com-a-escrita.test.ts` faz o mesmo, pelo
// mesmo motivo, e o comentario de la' diz isso com todas as letras.
import { describe, expect, it } from "vitest";

const MIGRATIONS = import.meta.glob<string>("/supabase/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

// As frases, copiadas do corpo VIVO de create_marketplace_order_v24
// (pg_get_functiondef, 28/08/2026). O `%` do RAISE e' literal no SQL.
const FRASES_DO_BANCO = [
  "Endereço inválido ou não pertence ao usuário.",
  "Quantidade inválida para um dos itens.",
  "Escolha uma variação para o produto %",
  "Produto % não disponível.",
  "Estoque insuficiente para o produto % (Disponível: %, Solicitado: %)",
  "Entrega local não disponível para o CEP informado.",
  "A cotação de frete expirou. Calcule o frete novamente e refaça o pedido.",
  "Cupom % inválido ou expirado.",
  "Os valores do pedido mudaram. Atualize o carrinho e tente novamente.",
  "Estoque insuficiente para o produto %",
];

const sql = Object.values(MIGRATIONS).join("\n");

describe("as mensagens que o classificador reconhece continuam existindo no SQL", () => {
  // As DUAS travas de vacuidade. So' o tamanho nao basta: um glob que casasse
  // UM arquivo grande passaria no piso de caracteres e ainda assim estaria
  // lendo quase nada.
  it("o glob casou o diretorio inteiro de migrations", () => {
    // 🔴 O piso e' 20, e NAO a contagem de hoje (142), de proposito. O ADR
    // `docs/decisoes/0002-baseline-do-ledger-de-migrations.md` deixou em aberto,
    // amarrado a issue #131, arquivar as 98 migrations pre-baseline. Se isso for
    // feito, sobram ~44 arquivos -- e um piso colado em 100 deixaria ESTE teste
    // vermelho sem nada de errado ter acontecido, mandando quem fez o
    // arquivamento caçar um defeito que nao existe.
    //
    // 20 continua pegando a falha que esta trava existe para pegar: glob
    // quebrado, que casa ZERO ou UM arquivo. E o piso de tamanho abaixo NAO
    // cobre esse caso sozinho -- o baseline tem ~200 KB e passaria em
    // `sql.length > 100000` sozinho, lendo um arquivo so'.
    expect(Object.keys(MIGRATIONS).length).toBeGreaterThan(20);
  });

  it("o corpus lido nao esta vazio -- senao tudo abaixo passa por vacuidade", () => {
    expect(sql.length).toBeGreaterThan(100000);
  });

  for (const frase of FRASES_DO_BANCO) {
    it(`ainda existe em alguma migration: ${frase.slice(0, 45)}`, () => {
      expect(
        sql.includes(frase),
        "A frase acima sumiu das migrations. Se ela foi REESCRITA, " +
          "src/lib/recusaDoPedido.ts precisa da regra nova NA MESMA rodada -- senao a " +
          "recusa cai no caso generico e a pessoa volta a ficar sem acao no ultimo clique.",
      ).toBe(true);
    });
  }
});
