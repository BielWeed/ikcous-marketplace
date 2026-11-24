// Caça de provas fracas (24/11/2026), tela de e-mail da loja: as BORDAS de
// `falhaQueAindaVale`, a função que decide se o aviso vermelho "Seus e-mails
// pararam em DD/MM" aparece ou some (e, junto, se o selo diz "Com problema").
//
// Errar para um lado esconde um e-mail parado (o cliente deixa de receber o
// pedido e a lojista vê "Funcionando"); errar para o outro mantém um alarme
// falso. As bordas que a suíte antiga não fechava:
//   - falha SEM origem conhecida vale para qualquer remetente de agora;
//   - só o teste do PAINEL apaga a falha (login do Gmail da loja): um teste
//     antigo do painel não limpa a falha de quem envia pelo servidor;
//   - teste e falha no MESMO instante: a falha continua valendo (só um teste
//     estritamente mais novo a apaga).
import { describe, expect, it } from "vitest";

import {
  type StatusDoEmail,
  falhaQueAindaVale,
  seloDoEmail,
  textoDaSaudeDoEnvio,
} from "@/components/admin/settings/email-da-loja-conteudo";

const FALHA_BASE = {
  em: "2026-11-23T12:00:00Z",
  motivo: "senha_errada",
} as const;

function status(extra: Partial<StatusDoEmail>): StatusDoEmail {
  return {
    usuario: "loja@gmail.com",
    senhaGuardada: true,
    ultimoTeste: null,
    origem: "painel",
    cofrePronto: true,
    registroIlegivel: false,
    falha: null,
    ...extra,
  };
}

describe("falhaQueAindaVale: origem da falha", () => {
  it.each(["painel", "ambiente"] as const)(
    "falha SEM origem conhecida vale para o remetente '%s' (não some por ser de 'outra' origem)",
    (origem) => {
      const falha = { ...FALHA_BASE, origem: null };
      const s = status({ origem, falha });
      expect(falhaQueAindaVale(s)).toEqual(falha);
      expect(textoDaSaudeDoEnvio(s)).toContain("Seus e-mails pararam");
      expect(seloDoEmail(s).tipo).toBe("problema");
    },
  );

  it("falha da MESMA origem do remetente de agora vale; de outra origem não", () => {
    const doPainel = { ...FALHA_BASE, origem: "painel" } as const;
    const doAmbiente = { ...FALHA_BASE, origem: "ambiente" } as const;
    expect(
      falhaQueAindaVale(status({ origem: "painel", falha: doPainel })),
    ).toEqual(doPainel);
    expect(
      falhaQueAindaVale(status({ origem: "painel", falha: doAmbiente })),
    ).toBeNull();
    expect(
      falhaQueAindaVale(status({ origem: "ambiente", falha: doAmbiente })),
    ).toEqual(doAmbiente);
    expect(
      falhaQueAindaVale(status({ origem: "ambiente", falha: doPainel })),
    ).toBeNull();
  });
});

describe("falhaQueAindaVale: só o teste aprovado do PAINEL apaga a falha", () => {
  const TESTE_NOVO = {
    ok: true,
    em: "2026-11-24T12:00:00Z",
    motivo: null,
  } as const;

  it("remetente do servidor: um teste do painel mais novo NÃO apaga a falha do servidor", () => {
    const falha = { ...FALHA_BASE, origem: "ambiente" } as const;
    const s = status({
      origem: "ambiente",
      falha,
      ultimoTeste: TESTE_NOVO,
    });
    expect(falhaQueAindaVale(s)).toEqual(falha);
    expect(seloDoEmail(s).tipo).toBe("problema");
  });

  it("remetente do servidor, falha sem origem: o teste do painel também não a apaga", () => {
    const falha = { ...FALHA_BASE, origem: null };
    expect(
      falhaQueAindaVale(
        status({ origem: "ambiente", falha, ultimoTeste: TESTE_NOVO }),
      ),
    ).toEqual(falha);
  });

  it("remetente do painel: teste aprovado ESTRITAMENTE mais novo apaga a falha", () => {
    const falha = { ...FALHA_BASE, origem: "painel" } as const;
    expect(
      falhaQueAindaVale(status({ falha, ultimoTeste: TESTE_NOVO })),
    ).toBeNull();
  });

  it("teste e falha no MESMO instante: a falha continua valendo", () => {
    const falha = { ...FALHA_BASE, origem: "painel" } as const;
    const s = status({
      falha,
      ultimoTeste: { ok: true, em: FALHA_BASE.em, motivo: null },
    });
    expect(falhaQueAindaVale(s)).toEqual(falha);
    expect(seloDoEmail(s).tipo).toBe("problema");
  });

  it("teste REPROVADO, mesmo mais novo, nunca apaga a falha", () => {
    const falha = { ...FALHA_BASE, origem: "painel" } as const;
    expect(
      falhaQueAindaVale(
        status({
          falha,
          ultimoTeste: { ok: false, em: "2026-11-24T12:00:00Z", motivo: null },
        }),
      ),
    ).toEqual(falha);
  });

  it("data ilegível em qualquer lado: não dá para provar que o teste é mais novo, a falha fica", () => {
    const falha = { ...FALHA_BASE, origem: "painel" } as const;
    const semDataDoTeste = status({
      falha,
      ultimoTeste: { ok: true, em: "", motivo: null },
    });
    expect(falhaQueAindaVale(semDataDoTeste)).toEqual(falha);
    const semDataDaFalha = status({
      falha: { ...FALHA_BASE, em: null, origem: "painel" },
      ultimoTeste: TESTE_NOVO,
    });
    expect(falhaQueAindaVale(semDataDaFalha)).not.toBeNull();
  });
});
