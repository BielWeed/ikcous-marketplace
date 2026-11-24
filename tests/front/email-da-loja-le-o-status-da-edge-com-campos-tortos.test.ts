// Caça de provas fracas (24/11/2026), tela de e-mail da loja: o que
// `lerStatusDoEmail` faz com a resposta TORTA da edge `credenciais-email`.
//
// A tela decide o selo ("Funcionando"), o aviso de falha e o passo a passo
// só pelo que esta função devolve. Cada campo aqui é estrito DE PROPÓSITO:
//   - "senha guardada" e "cofre pronto" só valem com `true` de verdade (um
//     "sim" ou um 1 não podem acender o selo nem esconder o aviso de cofre);
//   - o teste só conta se `ok` for booleano (resposta torta não vira
//     "o teste passou");
//   - texto vazio e tipo errado viram `null`, nunca um "" que parece dado;
//   - motivo e origem fora da lista fechada da edge nunca chegam à tela.
// Mutantes que afrouxavam qualquer um destes sobreviviam à suíte antiga.
import { describe, expect, it } from "vitest";

import { lerStatusDoEmail } from "@/components/admin/settings/email-da-loja-conteudo";

const lido = (dados: unknown) => {
  const status = lerStatusDoEmail(dados);
  if (!status) throw new Error("A resposta devia virar um status.");
  return status;
};

describe("lerStatusDoEmail: resposta que não é um objeto", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["texto", "ok"],
    ["número", 42],
    ["falso", false],
  ])("%s não vira status", (_nome, dados) => {
    expect(lerStatusDoEmail(dados)).toBeNull();
  });

  it("objeto vazio vira o status mais cauteloso possível", () => {
    expect(lido({})).toEqual({
      usuario: null,
      senhaGuardada: false,
      ultimoTeste: null,
      origem: "nenhuma",
      cofrePronto: false,
      registroIlegivel: false,
      falha: null,
    });
  });
});

describe("lerStatusDoEmail: campos de texto", () => {
  it("usuario vazio ou de tipo errado vira null (nunca um '' que parece dado)", () => {
    expect(lido({ usuario: "" }).usuario).toBeNull();
    expect(lido({ usuario: 123 }).usuario).toBeNull();
    expect(lido({ usuario: "loja@gmail.com" }).usuario).toBe("loja@gmail.com");
  });
});

describe("lerStatusDoEmail: só `true` de verdade vale", () => {
  it.each([["sim"], [1], ["true"], [{}]])(
    "senha_guardada=%j NÃO conta como senha guardada",
    (valor) => {
      expect(lido({ senha_guardada: valor }).senhaGuardada).toBe(false);
    },
  );

  it.each([["sim"], [1], ["true"]])(
    "cofre_pronto=%j NÃO conta como cofre pronto",
    (valor) => {
      expect(lido({ cofre_pronto: valor }).cofrePronto).toBe(false);
    },
  );

  it("com `true` de verdade os dois valem", () => {
    const status = lido({ senha_guardada: true, cofre_pronto: true });
    expect(status.senhaGuardada).toBe(true);
    expect(status.cofrePronto).toBe(true);
  });

  it("problema: só 'registro_ilegivel' acende o aviso de registro ilegível", () => {
    expect(lido({ problema: "registro_ilegivel" }).registroIlegivel).toBe(true);
    expect(lido({ problema: "outra_coisa" }).registroIlegivel).toBe(false);
    expect(lido({ problema: true }).registroIlegivel).toBe(false);
    expect(lido({}).registroIlegivel).toBe(false);
  });
});

describe("lerStatusDoEmail: último teste", () => {
  it.each([["true"], [1], [null], [undefined]])(
    "ok=%j (não booleano): não existe teste gravado",
    (ok) => {
      expect(
        lido({ ultimo_teste: { ok, em: "2026-11-24T10:00:00Z" } }).ultimoTeste,
      ).toBeNull();
    },
  );

  it("ok=false é um teste válido (falhou), e ok=true também", () => {
    expect(
      lido({ ultimo_teste: { ok: false, em: "2026-11-24T10:00:00Z" } })
        .ultimoTeste,
    ).toEqual({ ok: false, em: "2026-11-24T10:00:00Z", motivo: null });
    expect(
      lido({
        ultimo_teste: {
          ok: false,
          em: "2026-11-24T10:00:00Z",
          motivo: "senha_errada",
        },
      }).ultimoTeste?.motivo,
    ).toBe("senha_errada");
  });

  it("data ausente, vazia ou de tipo errado vira '' (a tela segue sem data)", () => {
    for (const em of [undefined, "", 7, null]) {
      expect(lido({ ultimo_teste: { ok: true, em } }).ultimoTeste?.em).toBe("");
    }
  });

  it("motivo fora da lista fechada da edge vira null", () => {
    expect(
      lido({
        ultimo_teste: { ok: false, em: "x", motivo: "texto-livre-do-servidor" },
      }).ultimoTeste?.motivo,
    ).toBeNull();
  });
});

describe("lerStatusDoEmail: origem do remetente", () => {
  it("só 'painel' e 'ambiente' passam; qualquer outra coisa é 'nenhuma'", () => {
    expect(lido({ origem: "painel" }).origem).toBe("painel");
    expect(lido({ origem: "ambiente" }).origem).toBe("ambiente");
    expect(lido({ origem: "servidor" }).origem).toBe("nenhuma");
    expect(lido({ origem: 1 }).origem).toBe("nenhuma");
  });
});

describe("lerStatusDoEmail: falha mais recente do envio", () => {
  it("sem código de falha conhecido não há falha (texto solto do servidor não vira aviso)", () => {
    expect(lido({ saude: { codigo_falha: "explodiu" } }).falha).toBeNull();
    expect(lido({ saude: { codigo_falha: null } }).falha).toBeNull();
    expect(lido({ saude: {} }).falha).toBeNull();
  });

  it("origem da falha fora de 'painel'/'ambiente' vira null, não passa adiante", () => {
    const falha = lido({
      saude: {
        codigo_falha: "senha_errada",
        ultima_falha_em: "2026-11-23T10:00:00Z",
        ultima_falha_origem: "servidor",
      },
    }).falha;
    expect(falha).toEqual({
      em: "2026-11-23T10:00:00Z",
      motivo: "senha_errada",
      origem: null,
    });
  });

  it("origem 'painel' e 'ambiente' da falha são mantidas; data vazia vira null", () => {
    for (const origem of ["painel", "ambiente"] as const) {
      const falha = lido({
        saude: {
          codigo_falha: "limite_diario",
          ultima_falha_em: "",
          ultima_falha_origem: origem,
        },
      }).falha;
      expect(falha).toEqual({ em: null, motivo: "limite_diario", origem });
    }
  });
});
