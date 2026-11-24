// A virada do dia nos números do painel (Hoje / 7 dias / Mês, "próxima
// cobrança", horas do extrato) é a de BRASÍLIA, qualquer que seja o fuso do
// aparelho de quem abre. Achado por mutação (24/11/2026): tirar o fuso da loja
// de `diaEmSaoPaulo` (CRM) e de `formatarHora` (Financeiro) não derrubava
// nenhum teste, porque a máquina de desenvolvimento JÁ está em Brasília — o
// defeito só apareceria no celular de quem viaja, ou no servidor do CI em UTC.
//
// Os formatadores desses módulos são criados quando o módulo carrega, então o
// fuso do processo (`process.env.TZ`, que o Node relê na hora) é trocado ANTES
// de importar o módulo de novo, e volta ao que era depois de cada teste.
import { afterEach, describe, expect, it, vi } from "vitest";

const fusoDaMaquina =
  process.env.TZ ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;

/** 23:59:59 de 23/11/2026 em Brasília (UTC−3). */
const UM_SEGUNDO_ANTES = "2026-11-24T02:59:59Z";
/** 00:00:00 de 24/11/2026 em Brasília. */
const MEIA_NOITE = "2026-11-24T03:00:00Z";
/** 23:59:59 de 30/11/2026 e 00:00:00 de 01/12/2026 em Brasília. */
const FIM_DO_MES = "2026-12-01T02:59:59Z";
const COMECO_DO_MES = "2026-12-01T03:00:00Z";

// Dois lados do mundo, um deles com o dia JÁ virado e outro ainda no anterior
// quando em Brasília ainda é 23:59.
const FUSOS_DO_APARELHO = [
  "UTC",
  "Pacific/Auckland",
  "America/Los_Angeles",
  "Asia/Tokyo",
] as const;

async function carregar(fuso: string) {
  process.env.TZ = fuso;
  vi.resetModules();
  const crm = await import("@/lib/crm");
  const financeiro = await import("@/lib/financeiro");
  return { crm, financeiro };
}

afterEach(() => {
  process.env.TZ = fusoDaMaquina;
  vi.useRealTimers();
  vi.resetModules();
});

describe.each(FUSOS_DO_APARELHO)("aparelho em %s", (fuso) => {
  it("o dia de hoje e os períodos Hoje / 7 dias / Mês viram à meia-noite de Brasília, não à do aparelho", async () => {
    const { crm, financeiro } = await carregar(fuso);

    expect(crm.diaEmSaoPaulo(new Date(UM_SEGUNDO_ANTES))).toBe("2026-11-23");
    expect(crm.diaEmSaoPaulo(new Date(MEIA_NOITE))).toBe("2026-11-24");
    expect(financeiro.hojeEmSaoPaulo(new Date(UM_SEGUNDO_ANTES))).toBe(
      "2026-11-23",
    );
    expect(financeiro.hojeEmSaoPaulo(new Date(MEIA_NOITE))).toBe("2026-11-24");

    // Sem argumento, "hoje" lê o relógio (fixo) e respeita a mesma virada.
    vi.useFakeTimers();

    vi.setSystemTime(new Date(UM_SEGUNDO_ANTES));
    expect(financeiro.hojeEmSaoPaulo()).toBe("2026-11-23");
    vi.setSystemTime(new Date(MEIA_NOITE));
    expect(financeiro.hojeEmSaoPaulo()).toBe("2026-11-24");
    vi.useRealTimers();

    expect(crm.intervaloDoPeriodo("hoje", new Date(UM_SEGUNDO_ANTES))).toEqual({
      inicio: "2026-11-23",
      fim: "2026-11-23",
    });
    expect(crm.intervaloDoPeriodo("hoje", new Date(MEIA_NOITE))).toEqual({
      inicio: "2026-11-24",
      fim: "2026-11-24",
    });
    expect(crm.intervaloDoPeriodo("7d", new Date(UM_SEGUNDO_ANTES))).toEqual({
      inicio: "2026-11-17",
      fim: "2026-11-23",
    });
    expect(crm.intervaloDoPeriodo("mes", new Date(FIM_DO_MES))).toEqual({
      inicio: "2026-11-01",
      fim: "2026-11-30",
    });
    expect(crm.intervaloDoPeriodo("mes", new Date(COMECO_DO_MES))).toEqual({
      inicio: "2026-12-01",
      fim: "2026-12-01",
    });
  });

  it("a hora e a data de um instante, e a 'próxima cobrança' de ontem, seguem Brasília (23:59 e 00:00)", async () => {
    const { crm, financeiro } = await carregar(fuso);

    expect(financeiro.formatarHora(UM_SEGUNDO_ANTES)).toBe("23:59");
    expect(financeiro.formatarHora(MEIA_NOITE)).toBe("00:00");
    expect(financeiro.formatarDataHora(UM_SEGUNDO_ANTES)).toBe("23/11, 23:59");
    expect(financeiro.formatarDataHora(MEIA_NOITE)).toBe("24/11, 00:00");
    expect(crm.formatarData(UM_SEGUNDO_ANTES)).toBe("23/11/2026");
    expect(crm.formatarData(MEIA_NOITE)).toBe("24/11/2026");

    // "Próxima cobrança" de ontem some só quando Brasília vira o dia.
    const assinatura = {
      status: "ativa",
      proximaCobrancaEm: "2026-11-23",
      testeAte: null,
      inicioEm: null,
    } as const;

    expect(
      crm.linhasDeDatasDaAssinatura(assinatura, new Date(UM_SEGUNDO_ANTES)),
    ).toEqual([{ rotulo: "Próxima cobrança", data: "2026-11-23" }]);
    expect(
      crm.linhasDeDatasDaAssinatura(assinatura, new Date(MEIA_NOITE)),
    ).toEqual([]);
  });
});
