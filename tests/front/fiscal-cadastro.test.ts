// Cadastro fiscal da loja (src/lib/fiscal/cadastro.ts): leitura defensiva da
// linha do banco, validação do formulário e a pergunta "esta loja tem conta?".
// Lógica pura: sem rede, sem React. Todas as fixtures são inventadas; o
// repositório é público e o regime de uma loja é sempre o que o banco dela diz.
import { describe, expect, it } from "vitest";

import {
  type AtividadeFiscal,
  type FormularioDoCadastroFiscal,
  type LinhaDoCadastroFiscal,
  type MotivoSemConta,
  type RegimeFiscal,
  montarPayloadDoCadastro,
  parseCadastroFiscal,
  quemTemConta,
} from "@/lib/fiscal/cadastro";

// "Hoje" entra por parâmetro (data de São Paulo): nada aqui lê o relógio.
const HOJE = "2026-06-15";

const LINHA: LinhaDoCadastroFiscal = {
  id: true,
  regime: "simples",
  atividade: "comercio",
  aberta_em: "2020-03-10",
  vende_no_app_desde: "2025-02-01",
  atualizado_em: "2026-05-01T12:00:00+00:00",
  atualizado_por: "11111111-2222-4333-8444-555555555555",
};

const FORMULARIO: FormularioDoCadastroFiscal = {
  regime: "simples",
  atividade: "comercio",
  abertaEm: "2020-03-10",
  vendeNoAppDesde: "2025-02-01",
};

/** Os campos que o formulário recusou, em ordem alfabética (ou `null` se aceitou). */
function camposRecusados(
  form: FormularioDoCadastroFiscal,
  hoje: string = HOJE,
): string[] | null {
  const r = montarPayloadDoCadastro(form, hoje);
  return r.ok ? null : Object.keys(r.erros).sort();
}

describe("parseCadastroFiscal: sem cadastro nunca vira regime padrão", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["lista vazia", []],
  ])("%s é loja sem cadastro, sem aviso", (_nome, entrada) => {
    expect(parseCadastroFiscal(entrada)).toStrictEqual({
      estado: "sem_cadastro",
    });
  });

  it("linha válida vira o cadastro, com os nomes do app", () => {
    expect(parseCadastroFiscal(LINHA)).toStrictEqual({
      estado: "com_cadastro",
      cadastro: {
        regime: "simples",
        atividade: "comercio",
        abertaEm: "2020-03-10",
        vendeNoAppDesde: "2025-02-01",
        atualizadoEm: "2026-05-01T12:00:00+00:00",
        atualizadoPor: "11111111-2222-4333-8444-555555555555",
      },
    });
  });

  it("aceita a linha dentro de uma lista de um item (select sem single)", () => {
    expect(parseCadastroFiscal([LINHA]).estado).toBe("com_cadastro");
  });

  it("datas opcionais ausentes ou ilegíveis viram null, sem derrubar o cadastro", () => {
    const lida = parseCadastroFiscal({
      ...LINHA,
      aberta_em: null,
      vende_no_app_desde: "ontem",
      atualizado_em: undefined,
      atualizado_por: null,
    });
    expect(lida).toStrictEqual({
      estado: "com_cadastro",
      cadastro: {
        regime: "simples",
        atividade: "comercio",
        abertaEm: null,
        vendeNoAppDesde: null,
        atualizadoEm: null,
        atualizadoPor: null,
      },
    });
  });

  it("regime desconhecido = sem cadastro COM aviso (não chuta regime)", () => {
    const lida = parseCadastroFiscal({ ...LINHA, regime: "lucro_magico" });
    expect(lida.estado).toBe("sem_cadastro");
    expect("aviso" in lida && lida.aviso).toMatch(/cadastro fiscal/i);
  });

  it("atividade desconhecida = sem cadastro COM aviso", () => {
    const lida = parseCadastroFiscal({ ...LINHA, atividade: "industria" });
    expect(lida.estado).toBe("sem_cadastro");
    expect("aviso" in lida && lida.aviso).toMatch(/cadastro fiscal/i);
  });

  it.each([
    ["sem regime", { ...LINHA, regime: undefined }],
    ["regime nulo", { ...LINHA, regime: null }],
    ["sem atividade", { ...LINHA, atividade: undefined }],
    ["texto solto", "mei"],
    ["número", 7],
    ["objeto vazio", {}],
  ])("linha ilegível (%s) não vira regime nenhum", (_nome, entrada) => {
    const lida = parseCadastroFiscal(entrada);
    expect(lida.estado).toBe("sem_cadastro");
    expect("aviso" in lida && typeof lida.aviso).toBe("string");
  });
});

describe("montarPayloadDoCadastro: só monta o corpo se tudo for válido", () => {
  it("formulário completo monta as chaves de fiscal_cadastro_salvar", () => {
    expect(montarPayloadDoCadastro(FORMULARIO, HOJE)).toStrictEqual({
      ok: true,
      payload: {
        regime: "simples",
        atividade: "comercio",
        aberta_em: "2020-03-10",
        vende_no_app_desde: "2025-02-01",
      },
    });
  });

  it("opcionais em branco viram null (e espaço sozinho conta como branco)", () => {
    const r = montarPayloadDoCadastro(
      { ...FORMULARIO, abertaEm: "", vendeNoAppDesde: "   " },
      HOJE,
    );
    expect(r).toStrictEqual({
      ok: true,
      payload: {
        regime: "simples",
        atividade: "comercio",
        aberta_em: null,
        vende_no_app_desde: null,
      },
    });
  });

  it.each(["mei", "simples", "presumido", "real", "nao_sei"] as const)(
    "regime %s é aceito",
    (regime: RegimeFiscal) => {
      expect(camposRecusados({ ...FORMULARIO, regime })).toBeNull();
    },
  );

  it.each(["comercio", "com_servico"] as const)(
    "atividade %s é aceita",
    (atividade: AtividadeFiscal) => {
      expect(camposRecusados({ ...FORMULARIO, atividade })).toBeNull();
    },
  );

  it("sem regime: recusa e diz o campo", () => {
    expect(camposRecusados({ ...FORMULARIO, regime: "" })).toStrictEqual([
      "regime",
    ]);
  });

  it("regime fora da lista: recusa (o banco recusaria com 22023)", () => {
    expect(camposRecusados({ ...FORMULARIO, regime: "x" })).toStrictEqual([
      "regime",
    ]);
  });

  it("sem atividade: recusa e diz o campo", () => {
    expect(camposRecusados({ ...FORMULARIO, atividade: "" })).toStrictEqual([
      "atividade",
    ]);
  });

  it("abertura no futuro recusa; abrir hoje é permitido", () => {
    expect(
      camposRecusados({ ...FORMULARIO, abertaEm: "2026-06-16" }),
    ).toStrictEqual(["abertaEm"]);
    expect(camposRecusados({ ...FORMULARIO, abertaEm: HOJE })).toBeNull();
  });

  it.each(["10/03/2020", "2020-3-10", "2020-02-30", "abc"])(
    "data de abertura em formato inválido (%s) recusa",
    (abertaEm) => {
      expect(camposRecusados({ ...FORMULARIO, abertaEm })).toStrictEqual([
        "abertaEm",
      ]);
    },
  );

  it("vende_no_app_desde só aceita o dia 1 (o banco tem CHECK de dia 1)", () => {
    expect(
      camposRecusados({ ...FORMULARIO, vendeNoAppDesde: "2025-02-02" }),
    ).toStrictEqual(["vendeNoAppDesde"]);
    expect(
      camposRecusados({ ...FORMULARIO, vendeNoAppDesde: "2025-02-28" }),
    ).toStrictEqual(["vendeNoAppDesde"]);
    expect(
      camposRecusados({ ...FORMULARIO, vendeNoAppDesde: "2025-03-01" }),
    ).toBeNull();
  });

  it("vende_no_app_desde em formato inválido recusa", () => {
    expect(
      camposRecusados({ ...FORMULARIO, vendeNoAppDesde: "fev/2025" }),
    ).toStrictEqual(["vendeNoAppDesde"]);
  });

  it("vários erros aparecem todos juntos, e nenhum payload sai", () => {
    const r = montarPayloadDoCadastro(
      {
        regime: "",
        atividade: "",
        abertaEm: "2099-01-01",
        vendeNoAppDesde: "2025-02-15",
      },
      HOJE,
    );
    expect(r.ok).toBe(false);
    expect("payload" in r).toBe(false);
    expect(
      camposRecusados({
        regime: "",
        atividade: "",
        abertaEm: "2099-01-01",
        vendeNoAppDesde: "2025-02-15",
      }),
    ).toStrictEqual(["abertaEm", "atividade", "regime", "vendeNoAppDesde"]);
  });
});

describe("quemTemConta: só MEI e Simples de só comércio têm conta", () => {
  it("MEI tem conta, de comércio ou de serviço", () => {
    expect(
      quemTemConta({ regime: "mei", atividade: "comercio" }),
    ).toStrictEqual({ tipo: "mei" });
    expect(
      quemTemConta({ regime: "mei", atividade: "com_servico" }),
    ).toStrictEqual({ tipo: "mei" });
  });

  it("Simples só comércio tem conta", () => {
    expect(
      quemTemConta({ regime: "simples", atividade: "comercio" }),
    ).toStrictEqual({ tipo: "simples_comercio" });
  });

  it("Simples com serviço fica sem conta, com motivo próprio", () => {
    expect(
      quemTemConta({ regime: "simples", atividade: "com_servico" }),
    ).toStrictEqual({ tipo: "nenhuma", motivo: "simples_com_servico" });
  });

  it.each([
    ["presumido", "presumido"],
    ["real", "real"],
    ["nao_sei", "nao_sei"],
  ] as const)(
    "%s fica sem conta (motivo %s), com qualquer atividade",
    (regime: RegimeFiscal, motivo: MotivoSemConta) => {
      for (const atividade of ["comercio", "com_servico"] as const) {
        expect(quemTemConta({ regime, atividade })).toStrictEqual({
          tipo: "nenhuma",
          motivo,
        });
      }
    },
  );
});
