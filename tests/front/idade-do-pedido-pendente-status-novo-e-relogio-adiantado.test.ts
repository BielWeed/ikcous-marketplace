import { describe, expect, it } from "vitest";
import {
  fraseDeEsperaDoPedido,
  idadeDoPedidoPendente,
} from "../../src/lib/idade-do-pedido-pendente";

// Caça por mutação em `idadeDoPedidoPendente`. O teste vizinho
// (`idade-do-pedido-pendente.test.ts`) deixava passar duas trocas:
//   - o status "new" (que o CHECK do banco permite e também espera o lojista)
//     sair da lista: o pedido "new" deixava de ter idade e sumia o aviso;
//   - tirar o `Math.max(0, ...)`: com o relógio do aparelho adiantado a data
//     de criação fica no FUTURO e a idade saía NEGATIVA (-1), que alguém
//     poderia exibir como "há -1 dias".
const AGORA = Date.parse("2026-09-01T12:00:00.000Z");
const DIA = 86_400_000;

describe("idadeDoPedidoPendente — status e relógio fora do esperado", () => {
  it("o status 'new' também espera o lojista: tem idade e frase", () => {
    const criadoEm = new Date(AGORA - 5 * DIA).toISOString();
    const idade = idadeDoPedidoPendente(criadoEm, "new", AGORA);

    expect(idade).toBe(5);
    expect(fraseDeEsperaDoPedido(idade)).toBe(
      "Este pedido espera você há 5 dias.",
    );
  });

  it("criado no futuro (relógio adiantado) tem idade 0, nunca negativa", () => {
    const daquiUmaHora = new Date(AGORA + 3_600_000).toISOString();
    const daquiTresDias = new Date(AGORA + 3 * DIA).toISOString();

    expect(idadeDoPedidoPendente(daquiUmaHora, "pending", AGORA)).toBe(0);
    expect(idadeDoPedidoPendente(daquiTresDias, "pending", AGORA)).toBe(0);
    expect(
      fraseDeEsperaDoPedido(
        idadeDoPedidoPendente(daquiTresDias, "pending", AGORA),
      ),
    ).toBeNull();
  });
});
