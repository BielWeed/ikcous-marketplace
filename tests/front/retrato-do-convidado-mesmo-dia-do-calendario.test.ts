import { textoDoRetrato } from "@/lib/retrato-do-convidado";
import { describe, expect, it } from "vitest";

// "Status de 09:07" (só a hora) só é verdade se a consulta foi HOJE. O teste
// vizinho (`retrato-do-convidado.test.ts`) compara dias diferentes do MESMO
// mês e ano; sem estes casos, ignorar o mês ou o ano na régua do "mesmo dia"
// faria uma consulta de 05/10 passar por "de hoje" em 05/11 (ou do ano
// passado, em 05/11 do ano seguinte) — o retrato de outro dia parecendo atual,
// justamente o que o aviso existe para impedir. Datas locais, como a tela.
describe("textoDoRetrato — o 'mesmo dia' é do calendário inteiro", () => {
  it("mesmo dia do mês, mês diferente: diz o dia e o mês", () => {
    const consulta = new Date(2026, 9, 5, 9, 7).getTime();
    expect(textoDoRetrato(consulta, new Date(2026, 10, 5, 9, 30))).toBe(
      "Status de 05/10 às 09:07 — pode ter mudado",
    );
  });

  it("mesmo dia e mês, ano diferente: não passa por 'de hoje'", () => {
    const consulta = new Date(2025, 10, 5, 9, 7).getTime();
    expect(textoDoRetrato(consulta, new Date(2026, 10, 5, 9, 30))).toBe(
      "Status de 05/11 às 09:07 — pode ter mudado",
    );
  });

  it("virada da meia-noite: 23:59 de ontem não é 'de hoje' à 00:01", () => {
    const consulta = new Date(2026, 10, 4, 23, 59).getTime();
    expect(textoDoRetrato(consulta, new Date(2026, 10, 5, 0, 1))).toBe(
      "Status de 04/11 às 23:59 — pode ter mudado",
    );
  });

  it("o mesmo minuto é de hoje; o dia inteiro conta (00:00 e 23:59)", () => {
    const agora = new Date(2026, 10, 5, 23, 59);
    expect(textoDoRetrato(new Date(2026, 10, 5, 0, 0).getTime(), agora)).toBe(
      "Status de 00:00 — pode ter mudado",
    );
    expect(textoDoRetrato(agora.getTime(), agora)).toBe(
      "Status de 23:59 — pode ter mudado",
    );
  });

  it("dezembro vira '12' e janeiro '01' (mês começa em zero no JavaScript)", () => {
    expect(
      textoDoRetrato(
        new Date(2026, 11, 31, 22, 0).getTime(),
        new Date(2027, 0, 1, 8, 0),
      ),
    ).toBe("Status de 31/12 às 22:00 — pode ter mudado");
    expect(
      textoDoRetrato(
        new Date(2027, 0, 1, 7, 5).getTime(),
        new Date(2027, 0, 2, 8, 0),
      ),
    ).toBe("Status de 01/01 às 07:05 — pode ter mudado");
  });
});
