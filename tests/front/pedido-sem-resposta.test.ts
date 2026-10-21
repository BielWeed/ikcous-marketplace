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
  expect(lerPedidoSemResposta()?.orderData).toEqual({
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
    expect(lerPedidoSemResposta()).toBeNull();
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
  expect(lerPedidoSemResposta()).toBeNull();
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
  expect(lerPedidoSemResposta()).toBeNull();
  acesso.mockRestore();
});
