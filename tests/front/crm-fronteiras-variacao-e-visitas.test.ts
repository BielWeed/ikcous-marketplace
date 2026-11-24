// Duas fronteiras de número que a lojista lê no CRM e no Início e que nenhum
// teste segurava (achadas por mutação em 24/11/2026):
//  - a variação percentual com base NEGATIVA (lucro do mês anterior no
//    vermelho): sem o módulo da base, melhora vira "queda" e queda vira
//    "melhora";
//  - o funil de visitas no dia exato em que o contador começou a contar: o
//    período que COMEÇA nesse dia está inteiro dentro do contador, então não
//    pode mostrar o aviso "Contando desde ...".
import { estadoDasVisitas, variacaoPercentual } from "@/lib/crm";
import type { VisitasDoCrm } from "@/types/crm";
import { describe, expect, it } from "vitest";

describe("fronteiras dos números do CRM", () => {
  it("variação com base negativa (prejuízo): melhora é positiva, piora é negativa, base zero não tem percentual", () => {
    // De −R$ 100 para +R$ 50: melhora de 150%.
    expect(variacaoPercentual(50, -100)).toBe(150);
    // De −R$ 100 para −R$ 150: piora de 50%.
    expect(variacaoPercentual(-150, -100)).toBe(-50);
    // De zero não é +∞%.
    expect(variacaoPercentual(50, 0)).toBeNull();
    expect(variacaoPercentual(-50, 0)).toBeNull();
  });

  it("funil de visitas: contador que começa NO 1º dia do período cobre tudo; um dia depois é parcial", () => {
    const visitas = (contandoDesde: string): VisitasDoCrm => ({
      contandoDesde,
      visitas: 10,
      canais: [],
      previas: 0,
      noTeto: [],
    });
    const periodo = { inicio: "2026-11-10", fim: "2026-11-24" };

    expect(estadoDasVisitas(visitas("2026-11-09"), periodo)).toEqual({
      tipo: "completo",
    });
    expect(estadoDasVisitas(visitas("2026-11-10"), periodo)).toEqual({
      tipo: "completo",
    });
    expect(estadoDasVisitas(visitas("2026-11-11"), periodo)).toEqual({
      tipo: "parcial",
      aviso: "Contando desde 11/11/2026",
    });
  });
});
