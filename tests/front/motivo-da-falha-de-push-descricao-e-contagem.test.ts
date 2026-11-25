// A mensagem que o painel mostra depois de um envio de push com falha: o que
// foi recusado (e por quê), o que falhou sem motivo claro e quantos envios
// ficaram SEM CONFIRMAÇÃO (o aviso pode ter chegado). O teste vizinho
// (`motivo-da-falha-de-push.test.ts`) cobre a tradução de um motivo; aqui ficam
// as bordas da descrição e da contagem: cada código HTTP de recusa, quantidade
// inválida, texto em maiúscula, frase de demora que não está no começo.
import { describe, expect, it } from "vitest";

import {
  AVISO_PUSH_PODE_CHEGAR,
  contarPushSemConfirmacao,
  descricaoDePushSemConfirmacao,
  falhaDePushSemConfirmacao,
  motivoDaFalhaEmPortugues,
} from "@/lib/motivo-da-falha-de-push";

const DEMORA =
  "Sem resposta do serviço de push dentro do prazo; o aviso pode ter chegado ao aparelho mesmo assim";
// `sem()` = um envio sem confirmação; `sem(undefined)` = sem o campo de contagem.
const sem = (...quantidade: unknown[]) => ({
  status: null,
  motivo: DEMORA,
  quantidade: quantidade.length ? quantidade[0] : 1,
});
const base = `${AVISO_PUSH_PODE_CHEGAR}.`;

describe("falhaDePushSemConfirmacao — só a frase de demora, no COMEÇO do motivo", () => {
  it("a frase de demora completa vale", () => {
    expect(falhaDePushSemConfirmacao({ motivo: DEMORA })).toBe(true);
  });

  it("a mesma frase no MEIO de outro motivo não é demora", () => {
    expect(
      falhaDePushSemConfirmacao({
        motivo: `erro_interno: ${DEMORA}`,
      }),
    ).toBe(false);
  });

  it("a frase sem o ponto e vírgula do fim do prefixo não é demora", () => {
    expect(
      falhaDePushSemConfirmacao({
        motivo: "Sem resposta do serviço de push dentro do prazo",
      }),
    ).toBe(false);
  });

  it.each([[undefined], [null], [123], [{}]])(
    "motivo que não é texto (%j) não é demora e não lança",
    (motivo) => {
      expect(falhaDePushSemConfirmacao({ motivo })).toBe(false);
    },
  );
});

describe("motivoDaFalhaEmPortugues — bordas do código", () => {
  it("o texto técnico em maiúscula também é lido", () => {
    expect(
      motivoDaFalhaEmPortugues({ motivo: "Push Service respondeu 410 Gone" }),
    ).toBe("esse aparelho não recebe mais avisos (a inscrição venceu)");
  });

  it("status nulo (sem código numérico) cai no código do texto", () => {
    expect(
      motivoDaFalhaEmPortugues({
        status: null,
        motivo: "push service respondeu 429 Too Many Requests",
      }),
    ).toBe("muitos envios, tente daqui a pouco");
  });

  it("o código numérico vale mais que o do texto", () => {
    expect(
      motivoDaFalhaEmPortugues({
        status: 429,
        motivo: "push service respondeu 410 Gone",
      }),
    ).toBe("muitos envios, tente daqui a pouco");
  });

  it("duas inscrições vencidas: plural; exatamente duas já é plural", () => {
    expect(motivoDaFalhaEmPortugues({ status: 410, quantidade: 2 })).toBe(
      "esses aparelhos não recebem mais avisos (as inscrições venceram)",
    );
  });

  it("sem quantidade (ou 1, 0) o texto fica no singular", () => {
    for (const quantidade of [undefined, 1, 0]) {
      expect(motivoDaFalhaEmPortugues({ status: 404, quantidade })).toBe(
        "esse aparelho não recebe mais avisos (a inscrição venceu)",
      );
    }
  });

  it.each([500, 502, 599])("o código %i é 'fora do ar'", (status) => {
    expect(motivoDaFalhaEmPortugues({ status })).toBe(
      "o serviço de avisos está fora do ar agora",
    );
  });

  it.each([400, 499, 412, 428])(
    "o código %i, que não tem tradução própria, é 'não identificado'",
    (status) => {
      expect(motivoDaFalhaEmPortugues({ status })).toBe(
        "motivo não identificado",
      );
    },
  );
});

describe("descricaoDePushSemConfirmacao — recusas, outras falhas e o aviso", () => {
  it.each([
    [401, "o serviço de avisos recusou o envio"],
    [403, "o serviço de avisos recusou o envio"],
    [404, "esses aparelhos não recebem mais avisos (as inscrições venceram)"],
    [410, "esses aparelhos não recebem mais avisos (as inscrições venceram)"],
    [413, "mensagem grande demais"],
    [429, "muitos envios, tente daqui a pouco"],
  ])(
    "o código %i entra como RECUSA CONFIRMADA, com a quantidade na frente",
    (status, texto) => {
      expect(
        descricaoDePushSemConfirmacao([
          sem(),
          { status, motivo: "x", quantidade: 2 },
        ]),
      ).toBe(`${base} Recusas confirmadas: 2x ${texto}.`);
    },
  );

  it("várias recusas se separam por ponto e vírgula, na ordem em que vieram", () => {
    expect(
      descricaoDePushSemConfirmacao([
        { status: 413, quantidade: 1 },
        { status: 429, quantidade: 3 },
      ]),
    ).toBe(
      `${base} Recusas confirmadas: 1x mensagem grande demais; 3x muitos envios, tente daqui a pouco.`,
    );
  });

  it("só recusas: não aparece nenhuma frase de 'outras falhas'", () => {
    const texto = descricaoDePushSemConfirmacao([
      { status: 413, quantidade: 1 },
    ]);
    expect(texto).not.toContain("Outras falhas");
    expect(texto).not.toContain("outras falhas");
  });

  it("só demora e nada mais: é só o aviso, sem recusas nem outras falhas", () => {
    expect(descricaoDePushSemConfirmacao([sem(2), sem(1)])).toBe(base);
    expect(descricaoDePushSemConfirmacao([])).toBe(base);
  });

  it("o 500 NÃO é recusa confirmada: conta como outra falha", () => {
    expect(
      descricaoDePushSemConfirmacao([{ status: 500, quantidade: 2 }]),
    ).toBe(`${base} Outras falhas: 2 aparelhos.`);
  });

  it("outras falhas somam as quantidades; 1 é singular, mais de 1 é plural", () => {
    expect(
      descricaoDePushSemConfirmacao([
        { status: 500, quantidade: 1 },
        { status: 400, quantidade: 1 },
      ]),
    ).toBe(`${base} Outras falhas: 2 aparelhos.`);
    expect(
      descricaoDePushSemConfirmacao([{ status: 500, quantidade: 3 }]),
    ).toBe(`${base} Outras falhas: 3 aparelhos.`);
    expect(
      descricaoDePushSemConfirmacao([{ status: 500, quantidade: 1 }]),
    ).toBe(`${base} Outras falhas: 1 aparelho.`);
  });

  it.each([
    ["sem quantidade", undefined],
    ["quantidade zero", 0],
    ["quantidade negativa", -2],
    ["quantidade fracionária", 1.5],
    ["quantidade em texto", "3"],
    ["quantidade infinita", Number.POSITIVE_INFINITY],
    ["quantidade NaN", Number.NaN],
  ])(
    "outra falha com %s: não se inventa número, diz só que houve outras falhas",
    (_nome, quantidade) => {
      expect(descricaoDePushSemConfirmacao([{ status: 500, quantidade }])).toBe(
        `${base} Também houve outras falhas de envio.`,
      );
    },
  );

  it("uma falha sem contagem apaga o número das outras: vale a frase genérica", () => {
    expect(
      descricaoDePushSemConfirmacao([
        { status: 500, quantidade: 4 },
        { status: 500 },
      ]),
    ).toBe(`${base} Também houve outras falhas de envio.`);
  });

  it("recusas e outras falhas juntas: primeiro as recusas, depois as outras", () => {
    expect(
      descricaoDePushSemConfirmacao([
        sem(),
        { status: 410, quantidade: 1 },
        { status: 500, quantidade: 2 },
      ]),
    ).toBe(
      `${base} Recusas confirmadas: 1x esse aparelho não recebe mais avisos (a inscrição venceu). Outras falhas: 2 aparelhos.`,
    );
  });

  it("o aviso de abertura pode ser trocado por quem chama", () => {
    expect(
      descricaoDePushSemConfirmacao(
        [{ status: 413, quantidade: 1 }],
        "Aviso X",
      ),
    ).toBe("Aviso X. Recusas confirmadas: 1x mensagem grande demais.");
  });
});

describe("contarPushSemConfirmacao — só a demora, só quantidade inteira positiva", () => {
  it("soma as quantidades das falhas de demora", () => {
    expect(contarPushSemConfirmacao([sem(3), sem(2)])).toBe(5);
  });

  it("falha que NÃO é demora não entra na conta", () => {
    expect(
      contarPushSemConfirmacao([
        sem(2),
        { status: 500, quantidade: 7 },
        { status: 410, quantidade: 1 },
      ]),
    ).toBe(2);
  });

  it.each([
    ["sem quantidade", undefined],
    ["zero", 0],
    ["negativa", -1],
    ["fracionária", 1.5],
    ["texto", "3"],
    ["infinita", Number.POSITIVE_INFINITY],
    ["NaN", Number.NaN],
  ])("demora com quantidade %s não soma nada", (_nome, quantidade) => {
    expect(contarPushSemConfirmacao([sem(quantidade)])).toBe(0);
    expect(contarPushSemConfirmacao([sem(2), sem(quantidade)])).toBe(2);
  });

  it("lista vazia ou ausente: zero", () => {
    expect(contarPushSemConfirmacao([])).toBe(0);
    expect(contarPushSemConfirmacao()).toBe(0);
  });
});
