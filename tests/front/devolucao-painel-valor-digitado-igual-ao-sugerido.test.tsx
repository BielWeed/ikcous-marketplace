// @vitest-environment jsdom
import { AcoesDaDevolucao } from "@/components/admin/devolucoes/AcoesDaDevolucao";
import { useDevolucaoAdmin } from "@/hooks/useDevolucoesAdmin";
import type { DevolucaoDetalhe } from "@/types/devolucao";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const detalhe = {
  id: "d-1",
  protocolo: "DV261103-AAAAA",
  order_id: "o-1",
  tipo: "arrependimento",
  motivo: "tamanho_pequeno",
  detalhe: null,
  resolucao_desejada: "reembolso",
  resolucao_final: null,
  modalidade: "nacional",
  metodo_retorno: "envio_proprio",
  status: "recebida",
  valor_itens: 90,
  valor_frete_ida: 10,
  valor_reembolso: null,
  refund_id: null,
  reembolso_manual: false,
  fotos: [],
  codigo_rastreio: null,
  codigo_postagem: null,
  me_reverse_id: null,
  etiqueta_url: null,
  coleta_em: null,
  mensagem_loja: null,
  observacao_inspecao: null,
  entregue_em: "2026-11-01T15:00:00Z",
  prazo_ate: "2026-11-08",
  politica: null,
  created_at: "2026-11-02T10:00:00Z",
  aprovada_em: "2026-11-02T11:00:00Z",
  postada_em: "2026-11-02T12:00:00Z",
  recebida_em: "2026-11-03T12:00:00Z",
  concluida_em: null,
  encerrada_em: null,
  itens: [
    {
      id: "di-1",
      order_item_id: "oi-1",
      product_id: "p-1",
      variant_id: null,
      product_name: "Camiseta de teste",
      image_url: null,
      quantidade: 1,
      valor_unitario: 90,
      condicao: null,
      reestocar: null,
      reestocado_em: null,
    },
  ],
  eventos: [],
  pedido: {
    id: "o-1",
    total: 100,
    shipping: 10,
    payment_method: "online",
    payment_status: "pago",
    canal: "online",
    customer_name: "Cliente Fictício",
    whatsapp: null,
    shipping_label_id: null,
    shipping_option_id: null,
  },
} satisfies DevolucaoDetalhe;

const saldo = {
  total: 100,
  valor_estornado: 0,
  em_voo: 0,
  em_duvida: 0,
  manual: 0,
  disponivel: 100,
  reservado_por_fora: 0,
  linhas: [],
};

const onSujoMudou = vi.fn();

function Painel() {
  const ficha = useDevolucaoAdmin(detalhe.id);
  return ficha.detalhe ? (
    <AcoesDaDevolucao
      ficha={ficha}
      detalhe={ficha.detalhe}
      onSujoMudou={onSujoMudou}
    />
  ) : null;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  rpc.mockImplementation((nome: string, args?: { p_valor_reembolso: number }) =>
    Promise.resolve({
      data:
        nome === "devolucao_detalhe"
          ? detalhe
          : nome === "pedido_reembolsos_e_saldo"
            ? saldo
            : nome === "admin_devolucao_concluir"
              ? {
                  id: detalhe.id,
                  status: "concluida",
                  resolucao: "reembolso",
                  valor_reembolso: args?.p_valor_reembolso,
                  refund_id: null,
                  reembolso_manual: true,
                  reestocados: 0,
                }
              : null,
      error: null,
    }),
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

async function clicarBotao(texto: string) {
  const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );
  expect(botao).toBeDefined();
  await act(async () => botao?.click());
}

async function abrirConclusao() {
  await act(async () => raiz.render(<Painel />));
  await clicarBotao("Concluir");
  const campo = hospedeiro.querySelector<HTMLInputElement>("#devolucao-valor");
  if (!campo) throw new Error("Campo de valor do reembolso não encontrado");
  expect(campo.value).toBe("90,00");
  return campo;
}

it("preserva os R$ 90 digitados mesmo quando eram iguais à sugestão", async () => {
  const campo = await abrirConclusao();
  await act(async () => {
    campo.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, "9000");
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => campo.blur());
  await clicarBotao("Nova, sem uso");

  expect(campo.value).toBe("90,00");
  expect(hospedeiro.textContent).not.toContain("+ frete de ida");
  await clicarBotao("Concluir devolução");
  expect(globalThis.confirm).toHaveBeenCalledWith(
    expect.stringMatching(/^Devolver R\$\s90,00 ao cliente/),
  );
  expect(rpc).toHaveBeenCalledWith(
    "admin_devolucao_concluir",
    expect.objectContaining({ p_valor_reembolso: 90 }),
  );
});

it("segue a sugestão de R$ 100 se a lojista só entrar e sair do campo", async () => {
  const campo = await abrirConclusao();
  await act(async () => campo.focus());
  await act(async () => campo.blur());
  await clicarBotao("Nova, sem uso");

  expect(campo.value).toBe("100,00");
  expect(hospedeiro.textContent).toContain("+ frete de ida");
  await clicarBotao("Concluir devolução");
  expect(globalThis.confirm).toHaveBeenCalledWith(
    expect.stringMatching(/^Devolver R\$\s100,00 ao cliente/),
  );
  expect(rpc).toHaveBeenCalledWith(
    "admin_devolucao_concluir",
    expect.objectContaining({ p_valor_reembolso: 100 }),
  );
});
