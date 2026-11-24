// @vitest-environment jsdom
import {
  PRAZO_DA_RETENTATIVA_MS,
  type PedidoCongelado,
  lerPedidoSemResposta,
} from "@/lib/pedido-sem-resposta";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Caça por mutação em `lerPedidoSemResposta`. O teste vizinho
// (`pedido-sem-resposta.test.ts`) prova que registro vencido some e que a
// retentativa não renova o prazo, mas só olha o lado "já venceu". Ficavam
// verdes, sem teste nenhum cair:
//   - tirar o TETO da janela (o registro tem de vencer em no máximo 30 min): um
//     registro adulterado ou de relógio adiantado, com validade de um dia,
//     reabria o pedido da convidada muito depois da hora;
//   - o teto cravado em 30 min (aceita até 30 min exatos, recusa 1 ms a mais);
//   - `expiraEm` como TEXTO numérico ("1766…") ser aceito como se fosse número;
//   - registro de uma versão futura (`versao: 2`) ser lido como a versão 1.
// Relógio congelado: nada aqui depende da hora da máquina.

const CHAVE = "ikcous-pedido-sem-resposta-v1";
const AGORA = Date.parse("2026-11-24T15:00:00.000Z");

const pedido: PedidoCongelado = {
  orderData: {
    idempotencyKey: "chave-original",
    items: [{ product_id: "produto-1", quantity: 2 }],
  },
  ehOnline: false,
  metodoOnline: "pix",
  itens: [],
  valor: 200,
  cpfParaRpc: undefined,
  contaEsperada: null,
  semConta: true,
};

const gravar = (expiraEm: unknown, versao: unknown = 1) =>
  sessionStorage.setItem(CHAVE, JSON.stringify({ versao, expiraEm, pedido }));

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
});
afterEach(() => vi.useRealTimers());

describe("lerPedidoSemResposta — a janela vale nos dois lados", () => {
  it("o prazo da retentativa é de 30 minutos", () => {
    expect(PRAZO_DA_RETENTATIVA_MS).toBe(30 * 60_000);
  });

  it("vencendo daqui a 30 min exatos, ainda vale; 1 ms a mais não", () => {
    gravar(AGORA + 30 * 60_000);
    expect(lerPedidoSemResposta()?.orderData.idempotencyKey).toBe(
      "chave-original",
    );

    gravar(AGORA + 30 * 60_000 + 1);
    expect(lerPedidoSemResposta()).toBeNull();
    expect(sessionStorage.getItem(CHAVE)).toBeNull();
  });

  it("validade de um dia (adulterada) é descartada e apagada", () => {
    gravar(AGORA + 24 * 3_600_000);
    expect(lerPedidoSemResposta()).toBeNull();
    expect(sessionStorage.getItem(CHAVE)).toBeNull();
  });

  it("controle: vencendo daqui a 1 ms ainda vale; vencendo agora, não", () => {
    gravar(AGORA + 1);
    expect(lerPedidoSemResposta()).not.toBeNull();

    gravar(AGORA);
    expect(lerPedidoSemResposta()).toBeNull();
  });

  it("validade em texto numérico não vale como número", () => {
    gravar(String(AGORA + 60_000));
    expect(lerPedidoSemResposta()).toBeNull();
    expect(sessionStorage.getItem(CHAVE)).toBeNull();
  });

  it("registro de outra versão é descartado, mesmo com a janela certa", () => {
    gravar(AGORA + 60_000, 2);
    expect(lerPedidoSemResposta()).toBeNull();
    expect(sessionStorage.getItem(CHAVE)).toBeNull();
  });
});
