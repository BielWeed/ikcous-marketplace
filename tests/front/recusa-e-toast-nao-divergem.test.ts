/**
 * O painel (`classificarRecusaDoPedido`, `src/lib/recusaDoPedido.ts`) e o
 * toast (`mensagemAmigavelErroPedido`, `src/hooks/useOrders.ts`) aparecem
 * para a MESMA pessoa, na MESMA tela, no MESMO instante — o painel ao lado
 * do toast em `CheckoutView.tsx`. A primeira versão do módulo do painel não
 * tinha os três códigos do PostgREST (`PGRST202`, `PGRST301`, `PGRST302`) e
 * mandava a pessoa "conferir se o pedido apareceu" enquanto o toast, do
 * lado, dizia "tente novamente" — duas instruções opostas para a mesma
 * falha. O conserto entrou, mas a invariante ficou só em prosa: o `Set` dos
 * três códigos está DUPLICADO nos dois arquivos, e nada impedia alguém de
 * acrescentar um quarto código num dos dois sem mexer no outro.
 *
 * Este teste transforma a prosa em portão: percorre um corpus e, para CADA
 * entrada, exige que as duas peças não se contradigam. Ele não sabe qual das
 * duas está certa — só que elas têm de concordar. Quem prova qual delas é a
 * fonte da verdade é `recusa-do-pedido-ancora-nas-migrations.test.ts`.
 *
 * As três invariantes cobradas, por entrada:
 *   1. toast diz "Tente novamente em instantes"  => painel === "tentar_de_novo"
 *   2. toast diz "Verifique se ele já apareceu"   => painel === "conferir_antes"
 *   3. `P0001` COM texto (a RPC escreveu uma frase) => painel NUNCA
 *      "tentar_de_novo" (mandar tentar de novo sobre um pedido que o
 *      próprio banco recusou por nome é o que duplica pedido — estoque
 *      debitado duas vezes, cupom de uso único consumido duas vezes)
 *
 *      🔴 A invariante NÃO vale para `P0001` SEM texto (`message` ausente ou
 *      vazia): aí o código "P0001" bate `FORMATO_SQLSTATE` (5 caracteres
 *      `[0-9A-Z]`) e as DUAS peças caem, de propósito, no ramo genérico —
 *      "tentar_de_novo" nos dois. Medido rodando este teste sem a ressalva:
 *      a entrada "P0001 sem message" reprovava sozinha, porque não há texto
 *      nenhum do banco para preservar. Ver o docstring de
 *      `recusaDoPedido.ts` (Step 3 desta tarefa).
 *
 * Boilerplate de dublês copiado de
 * `erro-de-pedido-nao-mostra-texto-cru-do-banco.test.ts`: `useOrders.ts`
 * importa `@/lib/supabase` (que chama `createClient` com variável de
 * ambiente na importação), `@/hooks/useAuth`, `@/hooks/useLeaderElection` e
 * `sonner` — sem mockar os quatro, importar `mensagemAmigavelErroPedido`
 * quebra antes mesmo do primeiro teste rodar. O mock de `react` desliga
 * hooks que este arquivo não usa (só a função exportada é chamada, nunca o
 * hook `useOrders()`), mas entra do mesmo jeito por ser o padrão desta casa
 * para este import.
 */
vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return {
    ...real,
    useState: (inicial: unknown) => [
      typeof inicial === "function" ? (inicial as () => unknown)() : inicial,
      vi.fn(),
    ],
    useCallback: (fn: unknown) => fn,
    useEffect: () => {},
    useRef: (inicial: unknown) => ({ current: inicial }),
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAdmin: false }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { mensagemAmigavelErroPedido } from "@/hooks/useOrders";
import { classificarRecusaDoPedido } from "@/lib/recusaDoPedido";
import { describe, expect, it, vi } from "vitest";

const p0001 = (message: string) => ({ code: "P0001", message });

const TOAST_TENTAR_DE_NOVO =
  "Não foi possível criar seu pedido agora. Tente novamente em instantes.";
const TOAST_CONFERIR_ANTES =
  "Não conseguimos confirmar se o pedido foi enviado. Verifique se ele já apareceu antes de tentar de novo.";

/**
 * Corpus mínimo pedido pela tarefa: os 3 códigos do PostgREST, P0001 com as
 * 11 frases reais (com acento, tiradas de
 * `supabase/migrations/20260960000000_variacao_obrigatoria_no_servidor.sql`,
 * conferidas por `grep -n "RAISE EXCEPTION"` em 28/08/2026), SQLSTATE
 * genérico, `code` vazio, `code` não-string, `message` ausente, `null`,
 * `undefined`, `{}`, string solta, `new Error()`.
 */
const CORPUS: ReadonlyArray<{ rotulo: string; erro: unknown }> = [
  // Os três códigos que provam que a chamada nem chegou ao Postgres — o
  // achado que bloqueou a primeira versão.
  {
    rotulo: "PGRST202 (função fora do cache de schema)",
    erro: {
      code: "PGRST202",
      message:
        "Could not find the function public.create_marketplace_order_v24",
    },
  },
  {
    rotulo: "PGRST301 (JWT inválido ou expirado)",
    erro: { code: "PGRST301", message: "JWT expired" },
  },
  {
    rotulo: "PGRST302 (papel anônimo desabilitado)",
    erro: { code: "PGRST302", message: "Anonymous access is disabled" },
  },

  // As 11 frases reais de create_marketplace_order_v23/v24 (todas P0001).
  // #10 e #11 da tabela do desenho usam o MESMO texto ("Estoque insuficiente
  // para o produto %" sem número) para causas diferentes (corrida na
  // variação vs. no produto) — um nome de produto distinto por entrada basta
  // para cobrir os dois sem duplicar o mesmo caso.
  {
    rotulo: "1. endereço inválido",
    erro: p0001("Endereço inválido ou não pertence ao usuário."),
  },
  {
    rotulo: "2. quantidade inválida",
    erro: p0001("Quantidade inválida para um dos itens."),
  },
  {
    rotulo: "3. escolha uma variação",
    erro: p0001("Escolha uma variação para o produto Tênis."),
  },
  {
    rotulo: "4. produto não disponível",
    erro: p0001("Produto Caneca Branca não disponível."),
  },
  {
    rotulo: "5. estoque insuficiente, com número",
    erro: p0001(
      "Estoque insuficiente para o produto Camiseta Azul (Disponível: 2, Solicitado: 5)",
    ),
  },
  {
    rotulo: "6. entrega local fora da faixa",
    erro: p0001("Entrega local não disponível para o CEP informado."),
  },
  {
    rotulo: "7. cotação de frete expirada",
    erro: p0001(
      "A cotação de frete expirou. Calcule o frete novamente e refaça o pedido.",
    ),
  },
  {
    rotulo: "8. cupom inválido",
    erro: p0001("Cupom BEMVINDO10 inválido ou expirado."),
  },
  {
    rotulo: "9. os valores do pedido mudaram",
    erro: p0001(
      "Os valores do pedido mudaram. Atualize o carrinho e tente novamente.",
    ),
  },
  {
    rotulo: "10. estoque insuficiente sem número (corrida na variação)",
    erro: p0001("Estoque insuficiente para o produto Camiseta Azul - P"),
  },
  {
    rotulo: "11. estoque insuficiente sem número (corrida no produto)",
    erro: p0001("Estoque insuficiente para o produto Caneca"),
  },

  // SQLSTATE genérico: aborto de transação dentro do Postgres, sem ser P0001.
  {
    rotulo: "SQLSTATE genérico (deadlock 40P01)",
    erro: { code: "40P01", message: "deadlock detected" },
  },
  {
    rotulo: "SQLSTATE genérico (statement_timeout 57014)",
    erro: {
      code: "57014",
      message: "canceling statement due to statement timeout",
    },
  },
  {
    rotulo: "SQLSTATE com formato válido mas não catalogado (XX999)",
    erro: { code: "XX999", message: "erro nunca visto" },
  },

  // code vazio, não-string, ou message ausente.
  { rotulo: "code vazio", erro: { code: "", message: "algo" } },
  {
    rotulo: "code não-string (número)",
    erro: { code: 12345, message: "algo" },
  },
  { rotulo: "P0001 sem message", erro: { code: "P0001" } },
  { rotulo: "SQLSTATE genérico sem message", erro: { code: "40P01" } },

  // Formatos que nem chegam a ser um objeto com `code`.
  { rotulo: "null", erro: null },
  { rotulo: "undefined", erro: undefined },
  { rotulo: "objeto vazio {}", erro: {} },
  { rotulo: "string solta", erro: "erro qualquer" },
  { rotulo: "new Error() sem mensagem", erro: new Error() },
  { rotulo: "new Error() com mensagem", erro: new Error("falha qualquer") },
];

describe("o painel e o toast nunca dão ordens opostas para a mesma recusa", () => {
  it.each(CORPUS)("$rotulo", ({ erro }) => {
    const painel = classificarRecusaDoPedido(erro).acao;
    const toast = mensagemAmigavelErroPedido(erro);

    if (toast === TOAST_TENTAR_DE_NOVO) {
      expect(
        painel,
        `o toast diz "tente novamente" mas o painel oferece "${painel}" -- duas ordens opostas para a mesma falha`,
      ).toBe("tentar_de_novo");
    }

    if (toast === TOAST_CONFERIR_ANTES) {
      expect(
        painel,
        `o toast pede para conferir antes mas o painel oferece "${painel}" -- duas ordens opostas para a mesma falha`,
      ).toBe("conferir_antes");
    }

    const detalhes = (erro ?? {}) as { code?: unknown; message?: unknown };
    const temTextoDoBanco =
      detalhes.code === "P0001" &&
      typeof detalhes.message === "string" &&
      detalhes.message !== "";
    if (temTextoDoBanco) {
      expect(
        painel,
        "P0001 COM texto prova que a RPC escreveu essa frase -- o painel " +
          "nunca pode mandar tentar de novo aqui, sob risco de duplicar o " +
          "pedido",
      ).not.toBe("tentar_de_novo");
    }
  });
});
