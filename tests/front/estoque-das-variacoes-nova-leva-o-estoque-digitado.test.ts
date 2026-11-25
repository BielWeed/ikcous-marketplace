// `variacoesSoComEstoqueMexido` (`src/utils/estoque-das-variacoes.ts`): a
// variação NOVA (id `temp-`) leva sempre o número digitado, e isso não pode
// depender de o id dela não aparecer na lista de abertura. Se um dia a lista
// de abertura passar a trazer um id provisório (rascunho restaurado, recusa por
// conflito), uma variação nova com o mesmo estoque da abertura perderia a chave
// `stockIncrement` e nasceria sem estoque no banco.
import { variacoesSoComEstoqueMexido } from "@/utils/estoque-das-variacoes";
import { describe, expect, it } from "vitest";

interface Variacao {
  id: string;
  active: boolean;
  stockIncrement: number;
}

describe("variacoesSoComEstoqueMexido — id provisório", () => {
  it("nova (temp-) com o mesmo estoque da abertura continua levando o estoque", () => {
    const abertura: Variacao[] = [
      { id: "temp-1", active: true, stockIncrement: 4 },
    ];
    const atuais: Variacao[] = [
      { id: "temp-1", active: true, stockIncrement: 4 },
    ];
    const [nova] = variacoesSoComEstoqueMexido(atuais, abertura);
    expect(nova).toHaveProperty("stockIncrement", 4);
  });

  it("existente com o mesmo estoque da abertura perde a chave; a que mexeu mantém", () => {
    const abertura: Variacao[] = [
      { id: "v1", active: true, stockIncrement: 4 },
      { id: "v2", active: true, stockIncrement: 7 },
    ];
    const atuais: Variacao[] = [
      { id: "v1", active: true, stockIncrement: 4 },
      { id: "v2", active: true, stockIncrement: 9 },
    ];
    const [intocada, mexida] = variacoesSoComEstoqueMexido(atuais, abertura);
    expect(intocada).not.toHaveProperty("stockIncrement");
    expect(mexida).toHaveProperty("stockIncrement", 9);
  });
});
