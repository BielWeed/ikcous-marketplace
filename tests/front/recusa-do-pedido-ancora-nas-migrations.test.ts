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
  "Escolha uma variação para o produto %.",
  "Produto % não disponível.",
  "Estoque insuficiente para o produto % (Disponível: %, Solicitado: %)",
  "Entrega local não disponível para o CEP informado.",
  "A cotação de frete expirou. Calcule o frete novamente e refaça o pedido.",
  // REVISÃO A8 (frete v2, 03/09): os três RAISE novos do portão de entrega da
  // RPC emendada (20261081000000) — as regras irmãs em recusaDoPedido.ts
  // (trocar_entrega ×2, recotar_frete) morrem caladas se alguma frase sumir
  // ou for reescrita no SQL.
  "Escolha uma opção de entrega antes de finalizar o pedido.",
  "Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.",
  "Opção de entrega não reconhecida. Volte ao carrinho, calcule o frete e finalize de novo.",
  "Cupom % inválido ou expirado.",
  // Item 16 do laudo de 29/08 (migration 20261025000000): a recusa final do
  // cupom diz o MOTIVO. Os cinco literais são os RAISE novos das funções
  // create_marketplace_order_v23 e v24 — se algum sumir do SQL, a regra
  // irmã em recusaDoPedido.ts vira morta e a recusa cai no caso genérico.
  "O cupom % não existe. Confira o código.",
  "O cupom % está desativado pela loja.",
  "O cupom % expirou em %.",
  "O cupom % já atingiu o limite de usos.",
  "O cupom % exige uma compra mínima de R$ %.",
  "Os valores do pedido mudaram. Atualize o carrinho e tente novamente.",
  "Estoque insuficiente para o produto %",
  // ITEM 3c (12/09/2026): a porta da entrega (20261039000000 em diante) e a
  // chave de idempotência (20261038000000) — as regras irmãs em
  // recusaDoPedido.ts (entrar_na_conta ×2, trocar_endereco ×2,
  // reconferir_carrinho, recotar_frete) morrem caladas se alguma frase
  // sumir ou for reescrita no SQL.
  "A loja ainda está configurando a entrega. Fale com a loja.",
  "Compra sem conta é só com entrega na cidade da loja. Entre na sua conta para receber em outro endereço.",
  "Esta loja só faz entrega na cidade dela. Confira o CEP de entrega.",
  "Informe o CEP de entrega.",
  "Não foi possível criar o pedido. Atualize a página e tente de novo.",
  "O frete foi cotado para outro CEP. Volte ao carrinho, calcule o frete para o CEP de entrega e finalize de novo.",
  // REGRA FRETE × PAGAMENTO (dono, 21/09/2026 — migration
  // 20261168000000): a recusa da transportadora sem pagamento antecipado
  // vem NAS DUAS RPCs (v23 sempre; v24 com pix/card/cash). Frase da
  // revisão da supervisão: manda pagar o PIX no app, NÃO "escolher
  // entrega local" (impossível para quem recebe em outra cidade). A regra
  // irmã em recusaDoPedido.ts (trocar_entrega) morre calada se a frase
  // sumir ou for reescrita no SQL.
  "Envio por transportadora exige pagamento antecipado. Pague com PIX no app para finalizar este envio.",
  // FORMAS DE PAGAMENTO POR LOJA (25/09/2026 — migration 20261174000000): a
  // regra irmã em recusaDoPedido.ts (trocar_entrega) morre calada se a
  // frase sumir ou for reescrita no SQL.
  "Esta forma de pagamento não está disponível nesta loja. Escolha outra.",
  // CUPONS DESLIGADOS (08/10/2026 — migration 20261203000000, issue #645): a
  // regra irmã em recusaDoPedido.ts (remover_cupom) morre calada se a frase
  // sumir ou for reescrita no SQL (gatilho de marketplace_orders).
  "Os cupons estão desativados nesta loja.",
  // A COMPRA QUE DÁ R$ 0,00 NÃO SE PAGA PELO APP (14/10/2026 — migration
  // 20261236000000, a v24 recusa o total zero pelo app antes de reservar
  // estoque e cupom): a regra irmã em recusaDoPedido.ts (trocar_pagamento)
  // morre calada se a frase sumir ou for reescrita no SQL.
  "Este pedido não tem valor a pagar pelo app. Escolha pagar na retirada ou na entrega, ou fale com a loja.",
  // O FREIO DO PEDIDO DE VISITANTE NA ENTREGA (27/10/2026 — migration
  // 20261394000000, nas duas RPCs): as duas regras irmãs em recusaDoPedido.ts
  // (entrar_na_conta ×2) morrem caladas se alguma frase sumir ou for
  // reescrita no SQL.
  "Sem entrar na conta, o pedido aceita até 10 unidades. Entre na conta para comprar mais.",
  "Estamos com muitos pedidos aguardando agora. Entre na conta para finalizar o seu.",
  // A V23 RECUSA O PAGAMENTO PELO APP (27/10/2026 — migration 20261394200000, so a v23): a regra irma em
  // recusaDoPedido.ts (trocar_pagamento) morre calada se a frase sumir ou for reescrita no SQL.
  "O pagamento pelo app é feito em outra etapa. Para este pedido, escolha pagar na retirada ou na entrega.",
];

// Preserva literais SQL (inclusive apóstrofo escapado), mas não deixa uma
// frase antiga em comentário mascarar a retirada de um RAISE vigente.
function semComentarios(sql: string) {
  return sql.replace(/'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\//g, (trecho) =>
    trecho.startsWith("'") ? trecho : " ",
  );
}

function corpoMaisNovo(arquivos: Record<string, string>, funcao: string) {
  const definicoes = Object.entries(arquivos)
    .map(([caminho, sql]) => ({
      nome: caminho.split("/").pop() ?? caminho,
      sql: semComentarios(sql),
    }))
    .filter(({ nome }) => !nome.startsWith("rollback-manual-"))
    .sort((a, b) => a.nome.localeCompare(b.nome))
    .flatMap(({ nome, sql }) => {
      const cabecalho =
        /\b(?:CREATE\s+FUNCTION|CREATE\s+OR\s+REPLACE\s+FUNCTION)\s+public\.([a-z0-9_]+)\s*\(/gi;
      return [...sql.matchAll(cabecalho)]
        .filter((achado) => achado[1].toLowerCase() === funcao)
        .map((achado) => ({
          nome,
          corpo:
            /\bAS\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\1/i.exec(
              sql.slice(achado.index),
            )?.[2] ?? "",
        }));
    });
  return definicoes.at(-1) ?? null;
}

function frasesDeRecusa(corpo: string) {
  return [
    ...semComentarios(corpo).matchAll(
      /\bRAISE\s+EXCEPTION\s+'((?:''|[^'])*)'/gi,
    ),
  ].map((achado) => achado[1].replace(/''/g, "'"));
}

const SOMENTE_V23 =
  "O pagamento pelo app é feito em outra etapa. Para este pedido, escolha pagar na retirada ou na entrega.";
const SOMENTE_V24 =
  "Este pedido não tem valor a pagar pelo app. Escolha pagar na retirada ou na entrega, ou fale com a loja.";
const DO_GATILHO = "Os cupons estão desativados nesta loja.";
const COMUNS = FRASES_DO_BANCO.filter(
  (frase) => ![SOMENTE_V23, SOMENTE_V24, DO_GATILHO].includes(frase),
);

describe("extração do corpo vigente, não do histórico", () => {
  it("uma reescrita não pode ser escondida pela frase antiga nem pelo rollback", () => {
    const antiga =
      "CREATE FUNCTION public.exemplo() RETURNS void AS $$ BEGIN RAISE EXCEPTION 'Estoque antigo'; END; $$ LANGUAGE plpgsql;";
    const nova =
      "CREATE OR REPLACE FUNCTION public.exemplo() RETURNS void AS $corpo$ BEGIN RAISE EXCEPTION 'Sem estoque suficiente'; END; $corpo$ LANGUAGE plpgsql;";
    const atual = corpoMaisNovo(
      {
        "/20260101.sql": antiga,
        "/20260102.sql": nova,
        "/rollback-manual-20260102.sql": antiga,
      },
      "exemplo",
    );
    expect(atual?.nome).toBe("20260102.sql");
    expect(atual?.corpo).toContain("Sem estoque suficiente");
    expect(atual?.corpo).not.toContain("Estoque antigo");
  });
});

describe("as recusas continuam no corpo mais novo de cada função", () => {
  it("o glob casou o diretório, não apenas uma migration antiga", () => {
    expect(Object.keys(MIGRATIONS).length).toBeGreaterThan(20);
  });

  for (const [funcao, frases] of [
    ["create_marketplace_order_v23", [...COMUNS, SOMENTE_V23]],
    ["create_marketplace_order_v24", [...COMUNS, SOMENTE_V24]],
    ["pedido_com_cupom_exige_a_chave_ligada", [DO_GATILHO]],
  ] as const) {
    const atual = corpoMaisNovo(MIGRATIONS, funcao);
    it(`${funcao}: a definição vigente foi encontrada e tem corpo`, () => {
      expect(atual).not.toBeNull();
      expect(atual?.corpo.length).toBeGreaterThan(100);
      expect(frasesDeRecusa(atual?.corpo ?? "").length).toBeGreaterThan(0);
    });

    for (const frase of frases) {
      it(`${funcao}: ainda recusa com "${frase}"`, () => {
        expect(
          frasesDeRecusa(atual?.corpo ?? ""),
          `${atual?.nome}: frase reescrita exige atualizar recusaDoPedido.ts na mesma rodada.`,
        ).toContain(frase);
      });
    }
  }

  it("comentário e outra função não contam como recusa; aspas e acentos são preservados", () => {
    const atual = corpoMaisNovo(
      {
        "/20260101.sql": `
        -- CREATE FUNCTION public.exemplo() AS $$ falso $$;
        CREATE OR REPLACE FUNCTION public.exemplo() RETURNS void AS $fn$
        BEGIN
          -- RAISE EXCEPTION 'antiga';
          /* RAISE EXCEPTION 'também antiga'; */
          RAISE EXCEPTION 'Não há estoque d''água';
        END; $fn$ LANGUAGE plpgsql;
        CREATE FUNCTION public.outra() RETURNS void AS $$ BEGIN RAISE EXCEPTION 'antiga'; END; $$ LANGUAGE plpgsql;
      `,
      },
      "exemplo",
    );
    expect(frasesDeRecusa(atual?.corpo ?? "")).toEqual([
      "Não há estoque d'água",
    ]);
    expect(corpoMaisNovo({}, "exemplo")).toBeNull();
  });
});
