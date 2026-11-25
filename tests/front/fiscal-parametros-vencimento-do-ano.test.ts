// Gestão Fiscal, caça por mutação: o vencimento sugerido do DAS mês a mês (2026, 2027 e
// o ano bissexto de 2028) e a leitura de "ano" que não é um ano.
//
// O que cada teste protege (em português simples):
//   - o DAS vence no dia 20 do mês SEGUINTE à competência; se o dia 20 cair em sábado ou
//     domingo, a sugestão vai para a segunda-feira (22 ou 21);
//   - dezembro vence em janeiro do ano seguinte, e o ano bissexto não bagunça nada;
//   - pedir os parâmetros de um "ano" que não é um ano inteiro conferido (2026,5, NaN,
//     texto) nunca devolve número de conta.
//
// DIAS DA SEMANA do dia 20 (conferidos num calendário, independentes do código):
//   2026: jan ter, fev sex, mar sex, abr seg, mai qua, jun SÁB, jul seg, ago qui, set DOM,
//         out ter, nov sex, dez DOM.
//   2027: jan qua, fev SÁB, mar SÁB, abr ter, mai qui, jun DOM, jul ter, ago sex, set seg,
//         out qua, nov SÁB, dez seg.
//   2028: jan qui, fev DOM, mar seg.
//
// Fixtures INVENTADAS: o repositório é público.
import { describe, expect, it } from "vitest";

import {
  parametrosDoAno,
  vencimentoDoDas,
} from "@/lib/fiscal/parametros-da-lei";

describe("vencimentoDoDas: as 12 competências de 2026", () => {
  it.each([
    ["2026-01", "2026-02-20"], // sexta
    ["2026-02", "2026-03-20"], // sexta
    ["2026-03", "2026-04-20"], // segunda
    ["2026-04", "2026-05-20"], // quarta
    ["2026-05", "2026-06-22"], // dia 20 é sábado
    ["2026-06", "2026-07-20"], // segunda
    ["2026-07", "2026-08-20"], // quinta
    ["2026-08", "2026-09-21"], // dia 20 é domingo
    ["2026-09", "2026-10-20"], // terça
    ["2026-10", "2026-11-20"], // sexta
    ["2026-11", "2026-12-21"], // dia 20 é domingo
    ["2026-12", "2027-01-20"], // quarta, no ano seguinte
  ])("competência %s vence em %s", (competencia, vencimento) => {
    expect(vencimentoDoDas(competencia)).toBe(vencimento);
  });
});

describe("vencimentoDoDas: 2027 e 2028 (regra de calendário, vale para qualquer ano)", () => {
  it.each([
    ["2027-01", "2027-02-22"], // dia 20 é sábado
    ["2027-02", "2027-03-22"], // dia 20 é sábado
    ["2027-03", "2027-04-20"],
    ["2027-05", "2027-06-21"], // dia 20 é domingo
    ["2027-10", "2027-11-22"], // dia 20 é sábado
    ["2027-11", "2027-12-20"], // segunda
    ["2027-12", "2028-01-20"], // quinta
    ["2028-01", "2028-02-21"], // 20/02/2028 é domingo (ano bissexto)
    ["2028-02", "2028-03-20"], // segunda
  ])("competência %s vence em %s", (competencia, vencimento) => {
    expect(vencimentoDoDas(competencia)).toBe(vencimento);
  });

  it("o resultado é sempre um texto aaaa-mm-dd com zeros à esquerda", () => {
    for (const competencia of ["2026-01", "2026-09", "2027-03"]) {
      expect(vencimentoDoDas(competencia)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("nunca devolve sábado nem domingo, em nenhum mês de 2026 a 2028", () => {
    for (const ano of [2026, 2027, 2028]) {
      for (let mes = 1; mes <= 12; mes += 1) {
        const competencia = `${ano}-${String(mes).padStart(2, "0")}`;
        const vencimento = vencimentoDoDas(competencia);
        if (vencimento === null)
          throw new Error(`sem vencimento: ${competencia}`);
        const diaDaSemana = new Date(`${vencimento}T12:00:00Z`).getUTCDay();
        expect([0, 6]).not.toContain(diaDaSemana);
        // E nunca antes do dia 20 do mês seguinte, nem depois do dia 22.
        const dia = Number(vencimento.slice(8, 10));
        expect(dia).toBeGreaterThanOrEqual(20);
        expect(dia).toBeLessThanOrEqual(22);
      }
    }
  });
});

describe("vencimentoDoDas: competência que não é mês de verdade", () => {
  it.each([
    ["2026-00"],
    ["2026-13"],
    ["2026-1"],
    ["2026-001"],
    ["26-05"],
    ["202605"],
    ["2026-05-01"],
    [" 2026-05"],
    ["2026-05 "],
    ["2026/05"],
    [""],
  ])("%j devolve null", (competencia) => {
    expect(vencimentoDoDas(competencia)).toBeNull();
  });
});

describe("parametrosDoAno: o que não é um ano conferido nunca devolve número", () => {
  const SEM_CONTA = { conferido: false, ultimoAnoConferido: 2026 };

  it.each([
    [2026.5],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [Number.NEGATIVE_INFINITY],
    [20_260],
    [202],
  ])("o ano %f: sem conta, só o aviso do último ano conferido", (ano) => {
    expect(parametrosDoAno(ano)).toEqual(SEM_CONTA);
  });

  it("o ano escrito como texto não é o ano 2026: sem conta (nada de coerção em silêncio)", () => {
    expect(parametrosDoAno("2026" as unknown as number)).toEqual(SEM_CONTA);
  });

  it("2026 continua com conta", () => {
    expect(parametrosDoAno(2026)).toMatchObject({ conferido: true, ano: 2026 });
  });
});
