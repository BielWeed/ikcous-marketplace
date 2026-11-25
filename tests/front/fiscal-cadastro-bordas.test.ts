// Gestão Fiscal, caça por mutação: o cadastro fiscal lido de uma linha de banco que já
// existia (dado antigo, vazio, torto) e o formulário nas bordas de data.
//
// O que cada teste protege (em português simples):
//   - o app nunca chuta o regime: linha que ele não entende vira "sem cadastro" COM aviso,
//     e linha ausente vira "sem cadastro" SEM aviso;
//   - metadado vazio ("") vindo do banco vira "não informado" (null), nunca um texto
//     vazio que a tela mostraria como "atualizado em ";
//   - o mês em que a loja começou a vender vale no mês de hoje, mas não no mês seguinte,
//     inclusive na virada de ano;
//   - o formulário recusa vários campos de uma vez e então NÃO entrega corpo nenhum.
//
// Fixtures INVENTADAS: o repositório é público, nada de loja real.
import { describe, expect, it } from "vitest";

import {
  type FormularioDoCadastroFiscal,
  montarPayloadDoCadastro,
  parseCadastroFiscal,
  quemTemConta,
} from "@/lib/fiscal/cadastro";

const AVISO =
  "Não deu para entender o cadastro fiscal guardado. Configure o regime da sua empresa de novo.";

const linha = (
  trocas: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: true,
  regime: "mei",
  atividade: "comercio",
  aberta_em: "2024-05-02",
  vende_no_app_desde: "2025-02-01",
  atualizado_em: "2026-05-01T12:00:00+00:00",
  atualizado_por: "11111111-2222-4333-8444-555555555555",
  ...trocas,
});

describe("parseCadastroFiscal: dado que já existia no banco", () => {
  it("metadado vazio ('') vira null, e o cadastro continua valendo", () => {
    expect(
      parseCadastroFiscal(linha({ atualizado_em: "", atualizado_por: "" })),
    ).toStrictEqual({
      estado: "com_cadastro",
      cadastro: {
        regime: "mei",
        atividade: "comercio",
        abertaEm: "2024-05-02",
        vendeNoAppDesde: "2025-02-01",
        atualizadoEm: null,
        atualizadoPor: null,
      },
    });
  });

  it("metadado que não é texto (número, objeto) vira null", () => {
    const leitura = parseCadastroFiscal(
      linha({ atualizado_em: 12345, atualizado_por: {} }),
    );
    expect(leitura).toMatchObject({
      estado: "com_cadastro",
      cadastro: { atualizadoEm: null, atualizadoPor: null },
    });
  });

  it("datas ausentes ou que não existem viram null, sem derrubar o regime", () => {
    const leitura = parseCadastroFiscal(
      linha({ aberta_em: null, vende_no_app_desde: "2025-02-30" }),
    );
    expect(leitura).toMatchObject({
      estado: "com_cadastro",
      cadastro: { regime: "mei", abertaEm: null, vendeNoAppDesde: null },
    });
  });

  it("campos que o app não conhece são ignorados", () => {
    const leitura = parseCadastroFiscal(
      linha({ coluna_nova: "x", outra: 1, id: false }),
    );
    expect(leitura.estado).toBe("com_cadastro");
  });

  it("lista com duas linhas: vale a primeira", () => {
    const leitura = parseCadastroFiscal([
      linha({ regime: "simples" }),
      linha({ regime: "real" }),
    ]);
    expect(leitura).toMatchObject({
      estado: "com_cadastro",
      cadastro: { regime: "simples" },
    });
  });

  it("lista com null na frente: loja sem cadastro, sem aviso", () => {
    expect(parseCadastroFiscal([null])).toStrictEqual({
      estado: "sem_cadastro",
    });
    expect(parseCadastroFiscal([undefined, linha()])).toStrictEqual({
      estado: "sem_cadastro",
    });
  });

  it("não altera o objeto que recebeu", () => {
    const original = linha();
    const copia = JSON.parse(JSON.stringify(original));
    parseCadastroFiscal(original);
    expect(original).toEqual(copia);
  });
});

describe("parseCadastroFiscal: o que o app não entende NUNCA vira regime", () => {
  it.each([
    ["regime desconhecido", linha({ regime: "lucro_arbitrado" })],
    ["regime em maiúsculas", linha({ regime: "MEI" })],
    ["regime com espaço", linha({ regime: " mei " })],
    ["regime vazio", linha({ regime: "" })],
    ["regime ausente", linha({ regime: undefined })],
    ["regime nulo", linha({ regime: null })],
    ["regime número", linha({ regime: 1 })],
    ["atividade desconhecida", linha({ atividade: "so_servico" })],
    ["atividade ausente", linha({ atividade: undefined })],
    ["atividade nula", linha({ atividade: null })],
  ])("%s: sem cadastro, com aviso", (_nome, entrada) => {
    expect(parseCadastroFiscal(entrada)).toStrictEqual({
      estado: "sem_cadastro",
      aviso: AVISO,
    });
  });

  it.each([["texto solto"], [0], [42], [true], [[["dentro de lista"]]]])(
    "linha que nem é um objeto (%j): sem cadastro, com aviso",
    (entrada) => {
      expect(parseCadastroFiscal(entrada)).toStrictEqual({
        estado: "sem_cadastro",
        aviso: AVISO,
      });
    },
  );
});

describe("montarPayloadDoCadastro: bordas de data, inclusive a virada do ano", () => {
  const form = (
    trocas: Partial<FormularioDoCadastroFiscal> = {},
  ): FormularioDoCadastroFiscal => ({
    regime: "simples",
    atividade: "comercio",
    abertaEm: "2020-03-10",
    vendeNoAppDesde: "2025-02-01",
    ...trocas,
  });

  it("espaços em volta do regime e da atividade são tirados", () => {
    const r = montarPayloadDoCadastro(
      form({ regime: "  mei ", atividade: " com_servico " }),
      "2026-06-15",
    );
    expect(r).toEqual({
      ok: true,
      payload: {
        regime: "mei",
        atividade: "com_servico",
        aberta_em: "2020-03-10",
        vende_no_app_desde: "2025-02-01",
      },
    });
  });

  it("datas em branco viram null no corpo, e espaços em branco também", () => {
    const r = montarPayloadDoCadastro(
      form({ abertaEm: "", vendeNoAppDesde: "   " }),
      "2026-06-15",
    );
    expect(r).toMatchObject({
      ok: true,
      payload: { aberta_em: null, vende_no_app_desde: null },
    });
  });

  it.each([
    ["2026-06-15", "2026-06-01", true], // o mês de hoje já começou
    ["2026-06-01", "2026-06-01", true], // hoje é dia 1
    ["2026-06-30", "2026-07-01", false], // o mês seguinte ainda não
    ["2027-01-01", "2026-12-01", true], // virada: dezembro do ano passado
    ["2027-01-01", "2027-01-01", true],
    ["2027-01-01", "2027-02-01", false],
    ["2026-12-31", "2027-01-01", false], // virada: janeiro do ano que vem
  ])("hoje %s, começou a vender em %s: aceita = %s", (hoje, vende, aceita) => {
    const r = montarPayloadDoCadastro(
      form({ abertaEm: "", vendeNoAppDesde: vende }),
      hoje,
    );
    expect(r.ok).toBe(aceita);
    if (!r.ok) expect(Object.keys(r.erros)).toEqual(["vendeNoAppDesde"]);
  });

  it.each([
    ["2025-03-31", "2025-03-01", true], // o mês da abertura vale (o que conta é o mês)
    ["2025-03-01", "2025-03-01", true],
    ["2025-03-01", "2025-02-01", false], // antes da abertura
    ["2025-01-01", "2024-12-01", false], // virada
  ])(
    "aberta em %s, começou a vender em %s: aceita = %s",
    (aberta, vende, aceita) => {
      const r = montarPayloadDoCadastro(
        form({ abertaEm: aberta, vendeNoAppDesde: vende }),
        "2026-06-15",
      );
      expect(r.ok).toBe(aceita);
    },
  );

  it("29 de fevereiro existe em 2024 e não em 2025", () => {
    expect(
      montarPayloadDoCadastro(
        form({ abertaEm: "2024-02-29", vendeNoAppDesde: "" }),
        "2026-06-15",
      ).ok,
    ).toBe(true);
    const r = montarPayloadDoCadastro(
      form({ abertaEm: "2025-02-29", vendeNoAppDesde: "" }),
      "2026-06-15",
    );
    expect(r.ok).toBe(false);
  });

  it("abertura inválida não gera também um erro falso no mês das vendas", () => {
    const r = montarPayloadDoCadastro(
      form({ abertaEm: "2025-02-29", vendeNoAppDesde: "2025-02-01" }),
      "2026-06-15",
    );
    if (r.ok) throw new Error("devia recusar");
    expect(Object.keys(r.erros)).toEqual(["abertaEm"]);
  });

  it("vários campos errados de uma vez: todos recusados e NENHUM corpo", () => {
    const r = montarPayloadDoCadastro(
      {
        regime: "lucro_arbitrado",
        atividade: "",
        abertaEm: "2099-01-01",
        vendeNoAppDesde: "2025-02-15",
      },
      "2026-06-15",
    );
    if (r.ok) throw new Error("devia recusar");
    expect(Object.keys(r.erros).sort()).toEqual([
      "abertaEm",
      "atividade",
      "regime",
      "vendeNoAppDesde",
    ]);
    expect("payload" in r).toBe(false);
  });
});

describe("quemTemConta: só MEI e Simples de só comércio têm conta", () => {
  it.each([
    ["mei", "comercio", { tipo: "mei" }],
    ["mei", "com_servico", { tipo: "mei" }],
    ["simples", "comercio", { tipo: "simples_comercio" }],
    [
      "simples",
      "com_servico",
      { tipo: "nenhuma", motivo: "simples_com_servico" },
    ],
    ["presumido", "comercio", { tipo: "nenhuma", motivo: "presumido" }],
    ["presumido", "com_servico", { tipo: "nenhuma", motivo: "presumido" }],
    ["real", "comercio", { tipo: "nenhuma", motivo: "real" }],
    ["real", "com_servico", { tipo: "nenhuma", motivo: "real" }],
    ["nao_sei", "comercio", { tipo: "nenhuma", motivo: "nao_sei" }],
    ["nao_sei", "com_servico", { tipo: "nenhuma", motivo: "nao_sei" }],
  ] as const)("%s + %s", (regime, atividade, esperado) => {
    expect(quemTemConta({ regime, atividade })).toEqual(esperado);
  });
});
