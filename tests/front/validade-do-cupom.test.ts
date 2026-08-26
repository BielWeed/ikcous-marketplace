// Achado 26 da reauditoria de 22/08: o formulário de cupom gravava a data
// escolhida como 00:00 UTC, e a RPC do pedido recusa `valid_until < NOW()` —
// em Brasília um cupom "vale até 25/08" morria às 21:00 de 24/08, ~21h antes
// do fim do dia prometido, e o card da listagem (que usa fuso local) mostrava
// um dia a menos que o formulário (que mostrava a fatia UTC). Estas provas
// seguram as duas conversões novas do `validade-do-cupom.ts` em QUALQUER fuso
// da máquina que rodar: as asserções são relativas ao fuso local, não a
// strings fixas de UTC.
import { describe, expect, it } from "vitest";

import {
  dataEscolhidaParaValidade,
  validadeParaDataDoInput,
} from "@/utils/validade-do-cupom";

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
