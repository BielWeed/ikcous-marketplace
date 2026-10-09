// "Cupom preso" (issues #210 e #116): o limite de usos de um cupom pode estar
// ocupado por um pedido CANCELADO do próprio cliente, cuja vaga só volta
// quando a varredura roda. O checkout diz isso em vez de repetir só "atingiu o
// limite" — mas só quando o banco confirma (RPC vaga_do_cupom_presa); sem a
// confirmação, a frase de sempre continua.
//
// Estas são as funções PURAS dessa decisão. A chamada à RPC mora em
// useCoupons.ts (use-coupons-cupom-preso.test.tsx).
import { describe, expect, it } from "vitest";

import {
  FRASE_DE_LIMITE_DE_USO,
  ehRecusaPorLimiteDeUso,
  mensagemDeVagaPresa,
  minutosDaVagaPresa,
} from "@/lib/cupomPreso";

describe("mensagemDeVagaPresa", () => {
  it("diz minutos quando falta menos de duas horas", () => {
    expect(mensagemDeVagaPresa("PROMO10", 15)).toBe(
      "O cupom PROMO10 está no limite de usos agora. Uma vaga dele está presa num pedido seu que foi cancelado e volta a ficar disponível em até 15 minutos.",
    );
  });

  it("usa o singular com 1 minuto", () => {
    expect(mensagemDeVagaPresa("PROMO10", 1)).toContain("em até 1 minuto.");
  });

  it("a fronteira é 120 minutos: 119 ainda é minuto, 120 já é hora", () => {
    expect(mensagemDeVagaPresa("PROMO10", 119)).toContain(
      "em até 119 minutos.",
    );
    expect(mensagemDeVagaPresa("PROMO10", 120)).toContain("em até 2 horas.");
  });

  it("converte para horas arredondando PARA CIMA (nunca promete mais cedo)", () => {
    expect(mensagemDeVagaPresa("PROMO10", 121)).toContain("em até 3 horas.");
    expect(mensagemDeVagaPresa("PROMO10", 60 * 24)).toContain(
      "em até 24 horas.",
    );
  });

  it("minuto fracionado também arredonda para cima", () => {
    expect(mensagemDeVagaPresa("PROMO10", 14.2)).toContain(
      "em até 15 minutos.",
    );
  });

  it("zero minuto não vira '0 minutos': o piso é 1", () => {
    expect(mensagemDeVagaPresa("PROMO10", 0)).toContain("em até 1 minuto.");
  });
});

describe("ehRecusaPorLimiteDeUso", () => {
  it("reconhece a frase da validate_coupon_secure_v2", () => {
    expect(ehRecusaPorLimiteDeUso(FRASE_DE_LIMITE_DE_USO)).toBe(true);
    expect(ehRecusaPorLimiteDeUso("Cupom atingiu o limite de uso.")).toBe(true);
  });

  it("não confunde com as outras recusas da mesma função", () => {
    for (const outra of [
      "Cupom inválido ou expirado.",
      "Este cupom expirou.",
      "Valor mínimo não atingido.",
      "Os cupons estão desativados nesta loja.",
      "Erro ao validar cupom",
      "Erro na conexão com servidor",
      "",
    ]) {
      expect(ehRecusaPorLimiteDeUso(outra), outra).toBe(false);
    }
  });

  it("não confunde com a frase do ÚLTIMO CLIQUE (v23/v24), que o classificador trata", () => {
    expect(
      ehRecusaPorLimiteDeUso("O cupom PROMO10 já atingiu o limite de usos."),
    ).toBe(false);
  });

  it("ausente ou nulo não é recusa por limite", () => {
    expect(ehRecusaPorLimiteDeUso(undefined)).toBe(false);
    expect(ehRecusaPorLimiteDeUso(null)).toBe(false);
  });
});

describe("minutosDaVagaPresa (contrato da RPC, lido sem confiar nele)", () => {
  it("presa com minutos devolve os minutos", () => {
    expect(minutosDaVagaPresa({ presa: true, volta_em_minutos: 42 })).toBe(42);
    expect(minutosDaVagaPresa({ presa: true, volta_em_minutos: 0 })).toBe(0);
  });

  it("não presa devolve nulo, mesmo com minutos na resposta", () => {
    expect(minutosDaVagaPresa({ presa: false, volta_em_minutos: null })).toBe(
      null,
    );
    expect(minutosDaVagaPresa({ presa: false, volta_em_minutos: 10 })).toBe(
      null,
    );
  });

  it("presa SEM minutos válidos devolve nulo: sem número a frase não se sustenta", () => {
    expect(minutosDaVagaPresa({ presa: true, volta_em_minutos: null })).toBe(
      null,
    );
    expect(minutosDaVagaPresa({ presa: true })).toBe(null);
    expect(minutosDaVagaPresa({ presa: true, volta_em_minutos: "30" })).toBe(
      null,
    );
    expect(
      minutosDaVagaPresa({ presa: true, volta_em_minutos: Number.NaN }),
    ).toBe(null);
    expect(
      minutosDaVagaPresa({
        presa: true,
        volta_em_minutos: Number.POSITIVE_INFINITY,
      }),
    ).toBe(null);
    expect(minutosDaVagaPresa({ presa: true, volta_em_minutos: -5 })).toBe(
      null,
    );
  });

  it("'presa' só vale com booleano true (nada de truthy)", () => {
    expect(minutosDaVagaPresa({ presa: "true", volta_em_minutos: 5 })).toBe(
      null,
    );
    expect(minutosDaVagaPresa({ presa: 1, volta_em_minutos: 5 })).toBe(null);
  });

  it("resposta de outro formato devolve nulo, sem lançar", () => {
    for (const resposta of [
      null,
      undefined,
      "presa",
      7,
      [],
      [{ presa: true }],
    ]) {
      expect(minutosDaVagaPresa(resposta)).toBe(null);
    }
  });
});

// ─── A âncora no SQL ──────────────────────────────────────────────────────────
// Roda no CI, que NÃO tem banco: a âncora é o arquivo de migration em disco
// (mesmo padrão e mesma razão de recusa-do-pedido-ancora-nas-migrations.test.ts:
// `import.meta.glob ?raw`, sem API de Node).
//
// `ehRecusaPorLimiteDeUso` compara com a frase que a validate_coupon_secure_v2
// devolve. Se uma migration futura reescrever essa frase, o checkout deixa de
// reconhecer o limite e a mensagem honesta MORRE CALADA — o cupom continua
// preso e ninguém vê erro nenhum. É este teste que fica vermelho.
const MIGRATIONS = import.meta.glob<string>("/supabase/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

const CABECALHO_DA_VALIDATE =
  /CREATE (?:OR REPLACE )?FUNCTION public\.validate_coupon_secure_v2 ?\(/i;

/**
 * O corpo da validate_coupon_secure_v2 na migration MAIS NOVA que a define.
 * Migration de rollback ("rollback-manual-*") não conta: ela não é o corpo
 * vivo, é o caminho de volta. Comentário que só cita o nome da função
 * também não: o que define é o `CREATE ... FUNCTION` seguido do corpo entre
 * aspas de dólar. O SQL é lido com os espaços em branco colapsados, para um
 * `CREATE  OR REPLACE` com recuo diferente não passar despercebido.
 */
function corpoDaValidateMaisNova(arquivos: Record<string, string>) {
  const definidoras = Object.entries(arquivos)
    .map(([caminho, sql]) => ({
      nome: caminho.split("/").pop() ?? caminho,
      sql: sql.replace(/\s+/g, " "),
    }))
    .filter(({ nome }) => !nome.startsWith("rollback-manual-"))
    .sort((a, b) => a.nome.localeCompare(b.nome))
    .flatMap(({ nome, sql }) => {
      const achado = CABECALHO_DA_VALIDATE.exec(sql);
      if (!achado) return [];
      const corpo = /\bAS (\$[A-Za-z0-9_]*\$)([\s\S]*?)\1/.exec(
        sql.slice(achado.index),
      );
      return [{ nome, corpo: corpo?.[2] ?? "" }];
    });
  return definidoras.at(-1) ?? null;
}

describe("a frase de limite de uso existe na validate_coupon_secure_v2 mais nova", () => {
  it("o glob casou o diretório inteiro de migrations", () => {
    // Piso 20 e não a contagem de hoje, pelo mesmo motivo do teste irmão: o
    // arquivamento das migrations pré-baseline não pode deixar este vermelho.
    expect(Object.keys(MIGRATIONS).length).toBeGreaterThan(20);
  });

  it("a migration mais nova que define a função foi achada e tem corpo", () => {
    const maisNova = corpoDaValidateMaisNova(MIGRATIONS);
    expect(maisNova, "nenhuma migration define a validate").not.toBeNull();
    expect(maisNova?.corpo.length).toBeGreaterThan(200);
  });

  it("o corpo vivo ainda diz exatamente a frase que o front reconhece", () => {
    const maisNova = corpoDaValidateMaisNova(MIGRATIONS);
    expect(
      maisNova?.corpo.includes(FRASE_DE_LIMITE_DE_USO),
      [
        `A frase "${FRASE_DE_LIMITE_DE_USO}" sumiu do corpo de validate_coupon_secure_v2`,
        `(${maisNova?.nome}). Se foi REESCRITA, src/lib/cupomPreso.ts precisa da`,
        "frase nova NA MESMA rodada — senão a mensagem do cupom preso morre calada.",
      ].join(" "),
    ).toBe(true);
  });

  describe("o extrator da âncora (sem ele a âncora poderia passar vazia)", () => {
    const definicao = (frase: string) =>
      `CREATE OR REPLACE FUNCTION public.validate_coupon_secure_v2(p_code text, p_subtotal numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $$
BEGIN
  v_error := '${frase}';
END;
$$;`;

    it("pega a definição mais nova, não a primeira", () => {
      const achada = corpoDaValidateMaisNova({
        "/supabase/migrations/20260806000000_a.sql": definicao("frase antiga"),
        "/supabase/migrations/20261203000000_b.sql": definicao("frase nova"),
      });
      expect(achada?.nome).toBe("20261203000000_b.sql");
      expect(achada?.corpo).toContain("frase nova");
    });

    it("uma migration mais nova que REESCREVE a frase deixa a âncora vermelha", () => {
      const achada = corpoDaValidateMaisNova({
        "/supabase/migrations/20261203000000_b.sql": definicao(
          FRASE_DE_LIMITE_DE_USO,
        ),
        "/supabase/migrations/20261300000000_c.sql":
          definicao("Limite atingido."),
      });
      expect(achada?.corpo.includes(FRASE_DE_LIMITE_DE_USO)).toBe(false);
    });

    it("rollback-manual não conta como definição viva", () => {
      const achada = corpoDaValidateMaisNova({
        "/supabase/migrations/20261203000000_b.sql": definicao(
          FRASE_DE_LIMITE_DE_USO,
        ),
        "/supabase/migrations/rollback-manual-20261300000000_c.sql":
          definicao("outra"),
      });
      expect(achada?.nome).toBe("20261203000000_b.sql");
    });

    it("migration que só CITA a função (comentário, REVOKE) não conta como definição", () => {
      const achada = corpoDaValidateMaisNova({
        "/supabase/migrations/20261203000000_b.sql": definicao(
          FRASE_DE_LIMITE_DE_USO,
        ),
        "/supabase/migrations/20261300000000_c.sql":
          "-- NAO redefine validate_coupon_secure_v2\nREVOKE EXECUTE ON FUNCTION public.validate_coupon_secure_v2(text,numeric) FROM PUBLIC;",
      });
      expect(achada?.nome).toBe("20261203000000_b.sql");
    });

    it("sem nenhuma definição devolve nulo", () => {
      expect(corpoDaValidateMaisNova({})).toBeNull();
    });
  });
});
