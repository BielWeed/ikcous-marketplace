// O prazo do PIX que a cliente vê ("Prazo informado: até 15:30" × "O horário
// previsto para pagar já passou"). Teste de MUTAÇÃO (24/11/2026): trocar o
// `>=` por `>` em `prazoDoPixPassou` não derrubava nenhum teste, porque a
// tela só era provada bem antes ou bem depois do horário, nunca NO instante.
import { lerPrazoDoPixEmMs, prazoDoPixPassou } from "@/lib/prazo-do-pix";
import { describe, expect, it } from "vitest";

describe("prazo do PIX — as fronteiras", () => {
  it("um milissegundo antes ainda não passou; no instante exato e depois, passou; prazo ilegível (NaN) nunca vence", () => {
    const vencimento = Date.parse("2026-09-24T15:30:00.000Z");
    expect(prazoDoPixPassou(vencimento, vencimento - 1)).toBe(false);
    expect(prazoDoPixPassou(vencimento, vencimento)).toBe(true);
    expect(prazoDoPixPassou(vencimento, vencimento + 1)).toBe(true);

    expect(prazoDoPixPassou(Number.NaN, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it("prazo ausente, vazio ou lixo vira NaN — nunca 0 (1970), que a tela leria como 'já passou'", () => {
    for (const ruim of [undefined, null, "", "não é data"]) {
      const ms = lerPrazoDoPixEmMs(ruim);
      expect(Number.isNaN(ms)).toBe(true);
      expect(prazoDoPixPassou(ms, Date.now())).toBe(false);
    }
  });
});
