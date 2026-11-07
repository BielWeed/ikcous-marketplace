// Achado 26 da reauditoria de 22/08: o formulário de cupom gravava a data
// escolhida como 00:00 UTC, e a RPC do pedido recusa `valid_until < NOW()` —
// em Brasília um cupom "vale até 25/08" morria às 21:00 de 24/08, ~21h antes
// do fim do dia prometido, e o card da listagem (que usa fuso local) mostrava
// um dia a menos que o formulário (que mostrava a fatia UTC). Estas provas
// seguram as duas conversões novas do `validade-do-cupom.ts` em QUALQUER fuso
// da máquina que rodar: as asserções são relativas ao fuso local, não a
// strings fixas de UTC.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  dataEscolhidaParaValidade,
  validadeParaDataDoInput,
} from "@/utils/validade-do-cupom";

// As provas abaixo trocam o fuso do processo (`process.env.TZ`, que o Node
// relê na hora) e afirmam INSTANTES LITERAIS em UTC. As de cima só comparam o
// resultado com os getters locais da mesma máquina e por isso não distinguem
// "fim do dia local" de "fim do dia UTC" quando o runner já é UTC (o CI é): lá,
// gravar 23:59:59.999Z ou fatiar `toISOString()` passava verde. O fuso volta ao
// que era depois de cada teste, para não vazar para os arquivos vizinhos.
// No Windows, apagar `TZ` não devolve o fuso da máquina (o Node continua no último
// fuso escolhido); por isso, sem `TZ` de origem, o fuso real é lido uma vez e regravado.
const fusoDaMaquina =
  process.env.TZ ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;
afterEach(() => {
  process.env.TZ = fusoDaMaquina;
});

describe.each([
  {
    fuso: "America/Sao_Paulo",
    // Brasília, UTC-3 (sem horário de verão): o dia 10 acaba às 02:59:59.999Z do dia 11.
    fimDoDia10: "2030-03-11T02:59:59.999Z",
    // Meia-noite UTC do dia 10 ainda é noite do dia 9 em Brasília.
    legadoUtc00: "2030-03-10T00:00:00.000Z",
    diaDoLegadoUtc00: "2030-03-09",
    // Meio-dia UTC do dia 10 já é dia 10 em Brasília.
    legadoUtc12: "2030-03-10T12:00:00.000Z",
    diaDoLegadoUtc12: "2030-03-10",
  },
  {
    fuso: "Pacific/Auckland",
    // Nova Zelândia, UTC+13 em março (horário de verão): o dia 10 acaba às 10:59:59.999Z do próprio dia 10.
    fimDoDia10: "2030-03-10T10:59:59.999Z",
    legadoUtc00: "2030-03-10T00:00:00.000Z",
    diaDoLegadoUtc00: "2030-03-10",
    // Meio-dia UTC do dia 10 já é madrugada do dia 11 em Auckland.
    legadoUtc12: "2030-03-10T12:00:00.000Z",
    diaDoLegadoUtc12: "2030-03-11",
  },
])(
  "validade do cupom em $fuso — valores literais",
  ({
    fuso,
    fimDoDia10,
    legadoUtc00,
    diaDoLegadoUtc00,
    legadoUtc12,
    diaDoLegadoUtc12,
  }) => {
    beforeEach(() => {
      process.env.TZ = fuso;
    });

    it("o dia escolhido vale até o último milissegundo do dia NESTE fuso", () => {
      expect(dataEscolhidaParaValidade("2030-03-10")).toBe(fimDoDia10);
    });

    it("o input mostra o calendário deste fuso, não a fatia UTC", () => {
      expect(validadeParaDataDoInput(legadoUtc00)).toBe(diaDoLegadoUtc00);
      expect(validadeParaDataDoInput(legadoUtc12)).toBe(diaDoLegadoUtc12);
    });

    it("gravar e reexibir não muda o dia", () => {
      expect(
        validadeParaDataDoInput(dataEscolhidaParaValidade("2030-03-10")),
      ).toBe("2030-03-10");
    });
  },
);

describe("dataEscolhidaParaValidade — o dia vale até o último milissegundo local", () => {
  it("o instante gravado é 23:59:59.999 do dia escolhido, no fuso local", () => {
    const ts = new Date(dataEscolhidaParaValidade("2030-03-10")!).getTime();
    const d = new Date(ts);
    expect(d.getFullYear()).toBe(2030);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(10);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
    expect(d.getMilliseconds()).toBe(999);
  });

  it("às 21:00 da noite do dia escolhido o cupom ainda vale (o horário em que o defeito o matava)", () => {
    // O bug antigo gravava 00:00 UTC: às 21:00 de Brasília do dia D o cupom
    // "vale até D" já estava morto. Agora o último instante do dia D local tem
    // de ser DEPOIS das 21:00 do dia D local.
    const gravado = dataEscolhidaParaValidade("2030-03-10")!;
    const noiteDoMesmoDia = new Date(2030, 2, 10, 21, 0, 0).getTime();
    expect(new Date(gravado).getTime()).toBeGreaterThan(noiteDoMesmoDia);
  });

  it("entrada vazia ou avulsa devolve undefined — sem validade", () => {
    expect(dataEscolhidaParaValidade("")).toBeUndefined();
    expect(dataEscolhidaParaValidade("amanhã")).toBeUndefined();
    expect(dataEscolhidaParaValidade("2030-13-99")).toBeUndefined();
  });
});

describe("validadeParaDataDoInput — a ida e volta devolve a mesma data", () => {
  it("gravar e reexibir a mesma escolha não muda o dia (qualquer fuso)", () => {
    const gravado = dataEscolhidaParaValidade("2030-03-10")!;
    expect(validadeParaDataDoInput(gravado)).toBe("2030-03-10");
  });

  it("mostra a data LOCAL do instante gravado — o mesmo calendário do card, não a fatia UTC", () => {
    // O defeito antigo exibia `toISOString().split("T")[0]` (fatia UTC),
    // enquanto o card usa `toLocaleDateString("pt-BR")` (local). A fonte
    // única agora é o calendário local da mesma Date que o card renderiza.
    const legado = "2030-03-10T00:00:00.000Z";
    const esperado = new Date(legado);
    const dataLocal = `${esperado.getFullYear()}-${String(
      esperado.getMonth() + 1,
    ).padStart(2, "0")}-${String(esperado.getDate()).padStart(2, "0")}`;
    expect(validadeParaDataDoInput(legado)).toBe(dataLocal);
  });

  it("sem validade, o input fica vazio", () => {
    expect(validadeParaDataDoInput(undefined)).toBe("");
    expect(validadeParaDataDoInput(null)).toBe("");
    expect(validadeParaDataDoInput("não é uma data")).toBe("");
  });
});
