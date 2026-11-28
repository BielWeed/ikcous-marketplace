// @vitest-environment jsdom
import {
  type PedidoCongelado,
  guardarPedidoSemResposta,
  lerPedidoSemResposta,
} from "@/lib/pedido-sem-resposta";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const CHAVE = "ikcous-pedido-sem-resposta-v1";
const pedido: PedidoCongelado = {
  orderData: {
    idempotencyKey: "chave-original",
    items: [{ product_id: "produto-1", quantity: 2 }],
    customer: { name: "Cliente Teste", cpf: "12345678909" },
    addressData: { street: "Rua de Teste", cpf: "12345678909" },
  },
  ehOnline: false,
  metodoOnline: "pix",
  itens: [],
  valor: 200,
  cpfParaRpc: "12345678909",
  contaEsperada: null,
  semConta: true,
};

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

it("guarda chave e conteúdo sem CPF em nenhum nível", () => {
  guardarPedidoSemResposta(pedido);
  const cru = sessionStorage.getItem(CHAVE)!;
  expect(cru).not.toContain("12345678909");
  expect(cru).not.toContain("cpf");
  expect(lerPedidoSemResposta(null)?.orderData).toEqual({
    idempotencyKey: "chave-original",
    items: [{ product_id: "produto-1", quantity: 2 }],
    customer: { name: "Cliente Teste" },
    addressData: { street: "Rua de Teste" },
  });
});

it.each(["{", "null", '{"versao":9}', '{"versao":1,"expiraEm":"amanhã"}'])(
  "descarta registro ilegível: %s",
  (cru) => {
    sessionStorage.setItem(CHAVE, cru);
    expect(lerPedidoSemResposta(null)).toBeNull();
    expect(sessionStorage.getItem(CHAVE)).toBeNull();
  },
);

it("retentativas não renovam os 30 minutos", () => {
  const agora = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(agora);
  guardarPedidoSemResposta(pedido);
  vi.mocked(Date.now).mockReturnValue(agora + 20 * 60_000);
  guardarPedidoSemResposta(pedido);
  vi.mocked(Date.now).mockReturnValue(agora + 30 * 60_000);
  expect(lerPedidoSemResposta(null)).toBeNull();
  expect(sessionStorage.getItem(CHAVE)).toBeNull();
});

it("não guarda compra de conta ou pagamento online", () => {
  guardarPedidoSemResposta({ ...pedido, semConta: false });
  guardarPedidoSemResposta({ ...pedido, ehOnline: true });
  expect(sessionStorage.getItem(CHAVE)).toBeNull();
});

it("storage indisponível não lança nem impede abrir a tela", () => {
  const acesso = vi
    .spyOn(globalThis, "sessionStorage", "get")
    .mockImplementation(() => {
      throw new Error("Bloqueado");
    });
  expect(() => guardarPedidoSemResposta(pedido)).not.toThrow();
  expect(lerPedidoSemResposta(null)).toBeNull();
  acesso.mockRestore();
});

// TROCA DE CONTA NA MESMA ABA (caça 27/11/2026): o registro é da visitante que
// enviou (`contaEsperada: null`). Quem abre o checkout depois com uma conta é
// outra pessoa para este fim — nunca vê o nome, o WhatsApp nem o endereço dela,
// e o registro sai do aparelho na mesma leitura.
it("a conta que entra depois na mesma aba NÃO lê o pedido da visitante, e ele é apagado", () => {
  guardarPedidoSemResposta(pedido);
  expect(lerPedidoSemResposta("user-b")).toBeNull();
  expect(sessionStorage.getItem(CHAVE)).toBeNull();
  // E a própria visitante também não o reencontra depois: já saiu.
  expect(lerPedidoSemResposta(null)).toBeNull();
});

it("controle: a visitante que continua sem conta lê o próprio pedido", () => {
  guardarPedidoSemResposta(pedido);
  expect(lerPedidoSemResposta(null)?.orderData.idempotencyKey).toBe(
    "chave-original",
  );
  expect(sessionStorage.getItem(CHAVE)).not.toBeNull();
});
