// @ts-nocheck
/**
 * A checagem da config do cartão em scripts/publicacao/verificar-pagamentos-ikcous.cjs
 * (a prova somente leitura que o publicar-functions.yml roda ANTES de publicar
 * na loja `ikcous-publicada`).
 *
 * Até 03/10/2026 ela exigia o estado EXATO da fase de blindagem — crédito
 * ligado, débito desligado, 1 parcela — e por isso recusou publicar a edge
 * `criar-pagamento` depois que o dono ligou "parcelar em até 2x" no painel
 * (run 37119556162). Com a blindagem no ar, quem escolhe crédito, débito e o
 * teto de parcelas é o dono pelo painel (autorizado por ele em 03/10/2026).
 * A trava passa a conferir só que a config é VÁLIDA: uma linha (id 1),
 * crédito e débito booleanos, parcelas de 1 a 12. Linha ausente, duplicada
 * ou fora de forma continua recusando.
 */
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  avaliar,
} = require("../scripts/publicacao/verificar-pagamentos-ikcous.cjs");

const NOME = "config de cartao valida (uma linha, booleanos, 1 a 12 parcelas)";

function checagemDaConfig(config) {
  const checks = avaliar(
    { funcoes: [], colunas: [], config },
    {
      liberar: "x",
      expirar: "y",
    },
  );
  const achadas = checks.filter((c) => c.checagem === NOME);
  assertEquals(
    achadas.length,
    1,
    "a checagem da config tem de existir uma vez",
  );
  return achadas[0].ok;
}

const linha = (campos) => ({
  id: 1,
  credito: true,
  debito: false,
  parcelas_max: 1,
  ...campos,
});

Deno.test("aceita o estado escolhido pelo dono no painel", () => {
  assert(checagemDaConfig([linha({})]), "crédito 1x");
  assert(checagemDaConfig([linha({ parcelas_max: 2 })]), "crédito até 2x");
  assert(
    checagemDaConfig([linha({ parcelas_max: 12, debito: true })]),
    "12x com débito",
  );
  assert(
    checagemDaConfig([linha({ credito: false, debito: false })]),
    "cartão desligado",
  );
});

Deno.test("recusa config ausente, duplicada ou fora de forma", () => {
  assert(!checagemDaConfig([]), "sem linha");
  assert(!checagemDaConfig([linha({}), linha({})]), "duas linhas");
  assert(!checagemDaConfig([linha({ id: null })]), "id diferente de 1");
  // `verificar` normaliza parcelas fora de 1..12 e booleano inválido para null.
  assert(
    !checagemDaConfig([linha({ parcelas_max: null })]),
    "parcelas inválidas",
  );
  assert(!checagemDaConfig([linha({ credito: null })]), "crédito não booleano");
  assert(!checagemDaConfig([linha({ debito: null })]), "débito não booleano");
  assert(!checagemDaConfig([linha({ parcelas_max: 13 })]), "13 parcelas");
  assert(!checagemDaConfig([linha({ parcelas_max: 0 })]), "0 parcelas");
});

Deno.test("a exigência antiga de 1x/sem débito não existe mais", () => {
  const checks = avaliar(
    { funcoes: [], colunas: [], config: [linha({ parcelas_max: 2 })] },
    {
      liberar: "x",
      expirar: "y",
    },
  );
  assert(
    !checks.some(
      (c) => c.checagem === "credito ligado, debito desligado, 1 parcela",
    ),
    "a checagem da fase de blindagem voltou",
  );
});
