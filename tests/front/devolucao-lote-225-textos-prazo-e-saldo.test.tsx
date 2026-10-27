// @vitest-environment jsdom
//
// LOTE 225 (caça 10) — a tela de Devoluções do painel não pode dizer o que o
// servidor não faz:
//  - item 2: pagamento com mais de 180 dias NÃO volta pelo Mercado Pago (o
//    servidor grava reembolso manual); os avisos não prometem o contrário nem
//    afirmam que "o pedido não foi pago pelo app" quando foi;
//  - item 5: o prazo (`prazo_ate`) é o limite para o CLIENTE pedir; pedido
//    feito dentro dele nunca aparece como "venceu"/vermelho, e na troca o
//    rótulo não é "Prazo legal" (é a política da loja);
//  - item 6: o app não devolve o frete de volta do envio próprio, e o texto
//    ao cliente não promete que "a loja reembolsa";
//  - item 8: o valor sugerido não passa do saldo que ainda pode ser devolvido
//    e o erro do servidor ("R$ 120.00") sai em real brasileiro.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  desligarDialogoDeConfirmacao,
  ligarDialogoDeConfirmacao,
} from "./duble-dialogo-de-confirmacao";

import { CartaoDaDevolucao } from "@/components/admin/devolucoes/CartaoDaDevolucao";
import {
  explicacaoMetodo,
  instrucaoParaOCliente,
  pedidoDentroDoPrazo,
  reaisComVirgula,
} from "@/lib/devolucao";
import type { LinhaDevolucaoAdmin } from "@/types/devolucao";

const { rpc, invoke, createSignedUrl, toast, respostas } = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  createSignedUrl: vi.fn(),
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
  respostas: new Map<string, unknown>(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    functions: { invoke },
    storage: { from: () => ({ createSignedUrl }) },
  },
}));

vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINHA = {
  id: "d-1",
  protocolo: "DV260926-ABCDE",
  order_id: "o-1",
  cliente_nome: "Maria",
  cliente_whatsapp: "34999999999",
  tipo: "arrependimento",
  motivo: "tamanho_pequeno",
  status: "recebida",
  resolucao_desejada: "reembolso",
  metodo_retorno: "envio_proprio",
  modalidade: "nacional",
  valor_itens: 199.8,
  prazo_ate: "2026-10-01",
  created_at: "2026-09-26T10:00:00Z",
} as const;

const DETALHE = {
  ...LINHA,
  detalhe: "Ficou apertado.",
  resolucao_final: null,
  valor_frete_ida: 20,
  valor_reembolso: null,
  refund_id: null,
  reembolso_manual: false,
  fotos: [],
  codigo_rastreio: "AB123456789BR",
  codigo_postagem: null,
  etiqueta_url: null,
  me_reverse_id: null,
  coleta_em: null,
  mensagem_loja: null,
  observacao_inspecao: null,
  entregue_em: "2026-09-24T15:00:00Z",
  politica: null,
  aprovada_em: "2026-09-26T11:00:00Z",
  postada_em: "2026-09-26T12:00:00Z",
  recebida_em: "2026-09-27T12:00:00Z",
  concluida_em: null,
  encerrada_em: null,
  itens: [
    {
      id: "di-1",
      order_item_id: "oi-1",
      product_id: "p-1",
      variant_id: null,
      product_name: "Tênis",
      image_url: null,
      quantidade: 2,
      valor_unitario: 99.9,
      condicao: null,
      reestocar: null,
      reestocado_em: null,
    },
  ],
  eventos: [],
  pedido: {
    id: "o-1",
    total: 219.8,
    shipping: 20,
    payment_method: "online",
    payment_status: "pago",
    canal: "online",
    customer_name: "Maria",
    whatsapp: "34999999999",
    shipping_label_id: null,
    shipping_option_id: null,
  },
};

const SALDO = (disponivel: number) => ({
  total: 219.8,
  valor_estornado: 219.8 - disponivel,
  em_voo: 0,
  em_duvida: 0,
  manual: 0,
  disponivel,
  reservado_por_fora: 0,
  linhas: [],
});

const onSetDirty = vi.fn();

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  respostas.clear();
  respostas.set("admin_devolucoes_listar", {
    total: 1,
    contagem: { recebida: 1 },
    itens: [LINHA],
  });
  respostas.set("devolucao_detalhe", DETALHE);
  rpc.mockImplementation((nome: string) =>
    Promise.resolve({ data: respostas.get(nome) ?? null, error: null }),
  );
  invoke.mockResolvedValue({ data: { status: "concluido" }, error: null });
  createSignedUrl.mockResolvedValue({ data: { signedUrl: "x" }, error: null });
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  // Lote 230: a pergunta é a janela do app; o dublê lê o texto dela e decide
  // pelo `confirm` deste teste (duble-dialogo-de-confirmacao.ts).
  ligarDialogoDeConfirmacao();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  desligarDialogoDeConfirmacao();
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function drenar() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}

async function montar() {
  const { AdminDevolucoesView } = await import(
    "@/views/admin/AdminDevolucoesView"
  );
  await act(async () => {
    raiz.render(
      <AdminDevolucoesView
        onNavigate={vi.fn()}
        selectedDevolucaoId={null}
        active
        onSetDirty={onSetDirty}
        onSetBackOverride={vi.fn()}
      />,
    );
  });
  await drenar();
}

function botao(texto: string): HTMLButtonElement | undefined {
  return Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );
}

async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.click();
  });
  await drenar();
}

async function abrirFicha() {
  await montar();
  await clicar(hospedeiro.querySelector<HTMLElement>('[data-devolucao="d-1"]'));
}

async function abrirConclusao() {
  await abrirFicha();
  await clicar(botao("Concluir"));
}

function campoDoValor(): HTMLInputElement {
  const el = hospedeiro.querySelector<HTMLInputElement>("#devolucao-valor");
  expect(el).not.toBeNull();
  return el as HTMLInputElement;
}

// ---------------------------------------------------------------------------
// Item 5 — o prazo é o do PEDIDO da devolução, não o de "hoje"
// ---------------------------------------------------------------------------

describe("item 5 — pedido feito dentro do prazo nunca aparece como vencido", () => {
  it("pedidoDentroDoPrazo compara o dia do PEDIDO (calendário da loja) com o prazo", () => {
    // Pedido em 26/09, prazo até 01/10.
    expect(pedidoDentroDoPrazo("2026-09-26T10:00:00Z", "2026-10-01")).toBe(
      true,
    );
    // No último dia, às 23h30 em Brasília (02h30 UTC do dia seguinte): dentro.
    expect(pedidoDentroDoPrazo("2026-10-02T02:30:00Z", "2026-10-01")).toBe(
      true,
    );
    // Um minuto depois da meia-noite de Brasília: fora.
    expect(pedidoDentroDoPrazo("2026-10-02T03:01:00Z", "2026-10-01")).toBe(
      false,
    );
    expect(pedidoDentroDoPrazo("2026-10-05T12:00:00Z", "2026-10-01")).toBe(
      false,
    );
    // Dado ilegível não vira afirmação.
    expect(pedidoDentroDoPrazo("lixo", "2026-10-01")).toBeNull();
    expect(pedidoDentroDoPrazo("2026-09-26T10:00:00Z", "amanhã")).toBeNull();
  });

  it("cartão: hoje já passou do prazo, mas o pedido foi feito dentro dele — neutro, sem 'venceu' e sem vermelho", async () => {
    await act(async () => {
      raiz.render(
        <CartaoDaDevolucao
          linha={{ ...LINHA, status: "solicitada" } as LinhaDevolucaoAdmin}
          selecionada={false}
          agora={new Date(2026, 9, 3, 12, 0)}
          onAbrir={vi.fn()}
        />,
      );
    });
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("dentro do prazo");
    expect(texto).toContain("01/10");
    expect(texto).not.toMatch(/venceu|vence |faltam/i);
    expect(hospedeiro.querySelector(".text-red-300")).toBeNull();
  });

  it("cartão: pedido feito DEPOIS do prazo é dito como tal (sem vermelho de erro)", async () => {
    await act(async () => {
      raiz.render(
        <CartaoDaDevolucao
          linha={
            {
              ...LINHA,
              status: "solicitada",
              created_at: "2026-10-05T12:00:00Z",
            } as LinhaDevolucaoAdmin
          }
          selecionada={false}
          agora={new Date(2026, 9, 6, 12, 0)}
          onAbrir={vi.fn()}
        />,
      );
    });
    expect(hospedeiro.textContent).toContain("depois do prazo");
    expect(hospedeiro.textContent).not.toMatch(/venceu/i);
    expect(hospedeiro.querySelector(".text-red-300")).toBeNull();
  });

  it("ficha de arrependimento: 'Prazo legal' sem contagem de vencimento", async () => {
    await abrirFicha();
    const ficha = hospedeiro.querySelector('[data-testid="detalhe-devolucao"]');
    expect(ficha?.textContent).toContain("Prazo legal");
    expect(ficha?.textContent).toContain("01/10/2026");
    expect(ficha?.textContent).toContain("dentro do prazo");
    expect(ficha?.textContent).not.toMatch(/venceu|vence |faltam/i);
  });

  it("ficha de TROCA: o rótulo é o prazo da política da loja, nunca 'Prazo legal'", async () => {
    respostas.set("devolucao_detalhe", { ...DETALHE, tipo: "troca" });
    await abrirFicha();
    const ficha = hospedeiro.querySelector('[data-testid="detalhe-devolucao"]');
    expect(ficha?.textContent).toContain("Prazo da política da loja");
    expect(ficha?.textContent).not.toContain("Prazo legal");
    expect(ficha?.textContent).not.toMatch(/venceu/i);
  });
});

// ---------------------------------------------------------------------------
// Item 2 — 180 dias: o Mercado Pago não devolve, e o texto diz a verdade
// ---------------------------------------------------------------------------

describe("item 2 — pagamento com mais de 180 dias não volta pelo Mercado Pago", () => {
  it("a confirmação do reembolso avisa dos 180 dias, e não promete só o Mercado Pago", async () => {
    await abrirConclusao();
    await clicar(botao("Nova, sem uso"));
    await clicar(botao("Concluir devolução"));

    const texto = String(
      (globalThis.confirm as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    );
    expect(texto).toContain("pelo Mercado Pago");
    expect(texto).toContain("180 dias");
    expect(texto).toContain("em mãos ou por PIX");
  });

  it("a explicação do campo de valor também conta a regra dos 180 dias", async () => {
    await abrirConclusao();
    const texto = hospedeiro.querySelector(
      "form, [data-testid='form-concluir']",
    )?.textContent;
    expect(texto).toContain("180 dias");
  });

  it("depois de concluir como manual, o aviso não afirma que 'o pedido não foi pago pelo app'", async () => {
    respostas.set("admin_devolucao_concluir", {
      id: "d-1",
      status: "concluida",
      resolucao: "reembolso",
      valor_reembolso: 219.8,
      refund_id: null,
      reembolso_manual: true,
      reestocados: 0,
    });
    await abrirConclusao();
    await clicar(botao("Nova, sem uso"));
    await clicar(botao("Concluir devolução"));

    const [mensagem] = toast.warning.mock.calls[0] as [string];
    expect(mensagem).toContain("em mãos ou por PIX");
    expect(mensagem).not.toContain("180 dias");
    expect(mensagem).not.toContain("este pedido não foi pago pelo app");
  });

  it("ficha concluída como manual de pedido pago pelo app e recente: não afirma motivo (nem 180 dias, nem 'não foi pago pelo app')", async () => {
    respostas.set("devolucao_detalhe", {
      ...DETALHE,
      status: "concluida",
      resolucao_final: "reembolso",
      valor_reembolso: 219.8,
      reembolso_manual: true,
    });
    await abrirFicha();
    const ficha = hospedeiro.querySelector('[data-testid="detalhe-devolucao"]');
    expect(ficha?.textContent).toContain("Reembolso manual de");
    expect(ficha?.textContent).toContain(
      "O reembolso não saiu pelo Mercado Pago",
    );
    expect(ficha?.textContent).not.toContain("180 dias");
    expect(ficha?.textContent).not.toContain("não está registrada no app");
    expect(ficha?.textContent).not.toContain("não foi pago pelo app");
  });

  it("ficha concluída como manual de pedido pago FORA do app: continua dizendo isso (é verdade)", async () => {
    respostas.set("devolucao_detalhe", {
      ...DETALHE,
      status: "concluida",
      resolucao_final: "reembolso",
      valor_reembolso: 219.8,
      reembolso_manual: true,
      pedido: {
        ...DETALHE.pedido,
        payment_method: "cash",
        payment_status: "recebido_na_entrega",
      },
    });
    await abrirFicha();
    const ficha = hospedeiro.querySelector('[data-testid="detalhe-devolucao"]');
    expect(ficha?.textContent).toContain("Este pedido não foi pago pelo app");
  });
});

// ---------------------------------------------------------------------------
// Item 6 — o app não devolve o frete de volta do envio próprio
// ---------------------------------------------------------------------------

describe("item 6 — o texto ao cliente não promete o frete de volta que o app não devolve", () => {
  it("explicação do envio próprio manda combinar com a loja", () => {
    const texto = explicacaoMetodo("envio_proprio");
    expect(texto).not.toMatch(/a loja reembolsa/i);
    expect(texto).toContain("combine com a loja");
  });

  it("instrução ao cliente (envio próprio, arrependimento) manda guardar o comprovante e combinar", () => {
    const texto = instrucaoParaOCliente(
      {
        status: "aprovada",
        tipo: "arrependimento",
        metodo_retorno: "envio_proprio",
        codigo_postagem: null,
        etiqueta_url: null,
        codigo_rastreio: null,
        coleta_em: null,
        resolucao_final: null,
        reembolso_manual: false,
        valor_reembolso: null,
      },
      { endereco: "Rua A, 10" },
    );
    expect(texto).toContain("Guarde o comprovante");
    expect(texto).not.toMatch(/a loja reembolsa/i);
    expect(texto).toContain("combine com a loja");
  });
});

// ---------------------------------------------------------------------------
// Item 8 — a sugestão não passa do saldo, e o erro sai em real brasileiro
// ---------------------------------------------------------------------------

describe("item 8 — valor sugerido limitado ao saldo ainda devolvível", () => {
  it("reaisComVirgula troca o ponto americano por vírgula e deixa o resto", () => {
    const final = reaisComVirgula(
      "O reembolso (R$ 120.00) passa do que ainda pode ser devolvido deste pedido (R$ 90.00).",
    );
    expect(final).not.toContain("120.00");
    expect(final).not.toContain("90.00");
    expect(final).toMatch(/R\$\s120,00\)/);
    expect(final).toMatch(/R\$\s90,00\)\.$/);
    // Milhar: 4 dígitos ganham o ponto de milhar.
    expect(reaisComVirgula("R$ 1200.00")).toMatch(/1\.200,00/);
    // Já formatado e texto sem valor não mudam.
    expect(reaisComVirgula("Faltam R$ 1.234,56 para fechar")).toBe(
      "Faltam R$ 1.234,56 para fechar",
    );
    expect(reaisComVirgula("Item 1.5 do pedido 12.00")).toBe(
      "Item 1.5 do pedido 12.00",
    );
  });

  it("saldo menor que itens + frete: o campo abre com o saldo e a RPC recebe o saldo", async () => {
    respostas.set("pedido_reembolsos_e_saldo", SALDO(189.8));
    respostas.set("admin_devolucao_concluir", {
      id: "d-1",
      status: "concluida",
      resolucao: "reembolso",
      valor_reembolso: 189.8,
      refund_id: null,
      reembolso_manual: true,
      reestocados: 0,
    });
    await abrirConclusao();

    expect(rpc).toHaveBeenCalledWith("pedido_reembolsos_e_saldo", {
      p_order_id: "o-1",
    });
    expect(campoDoValor().value).toMatch(/189,80/);
    const form = hospedeiro.querySelector('[data-testid="form-concluir"]');
    expect(form?.textContent).toContain("ainda pode ser devolvido");

    await clicar(botao("Nova, sem uso"));
    await clicar(botao("Concluir devolução"));
    expect(rpc).toHaveBeenCalledWith(
      "admin_devolucao_concluir",
      expect.objectContaining({ p_valor_reembolso: 189.8 }),
    );
    // A confirmação mostra o valor limitado, em real brasileiro.
    const confirmacao = String(
      (globalThis.confirm as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    );
    expect(confirmacao).toMatch(/189,80/);
  });

  it("o saldo que chega depois NÃO suja o formulário (nada foi digitado) e o valor digitado vence o padrão", async () => {
    respostas.set("pedido_reembolsos_e_saldo", SALDO(189.8));
    respostas.set("admin_devolucao_concluir", {
      id: "d-1",
      status: "concluida",
      resolucao: "reembolso",
      valor_reembolso: 90,
      refund_id: null,
      reembolso_manual: true,
      reestocados: 0,
    });
    await abrirConclusao();
    expect(campoDoValor().value).toMatch(/189,80/);
    expect(onSetDirty).not.toHaveBeenCalledWith(true);

    // A lojista digita 90,00 (a máscara lê os dígitos como centavos).
    const campo = campoDoValor();
    await act(async () => {
      campo.focus();
      const escrever = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      escrever?.call(campo, "9000");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      campo.blur();
    });
    await drenar();
    expect(onSetDirty).toHaveBeenLastCalledWith(true);

    await clicar(botao("Nova, sem uso"));
    await clicar(botao("Concluir devolução"));
    expect(rpc).toHaveBeenCalledWith(
      "admin_devolucao_concluir",
      expect.objectContaining({ p_valor_reembolso: 90 }),
    );
  });

  it("saldo maior que itens + frete: o padrão continua sendo itens + frete", async () => {
    respostas.set("pedido_reembolsos_e_saldo", SALDO(500));
    await abrirConclusao();
    expect(campoDoValor().value).toMatch(/219,80/);
    const form = hospedeiro.querySelector('[data-testid="form-concluir"]');
    expect(form?.textContent).not.toContain("ainda pode ser devolvido deste");
  });

  it("saldo ilegível ou falha na leitura: nada muda (o servidor continua sendo a guarda)", async () => {
    respostas.set("pedido_reembolsos_e_saldo", { lixo: true });
    await abrirConclusao();
    expect(campoDoValor().value).toMatch(/219,80/);
  });

  it("o erro do servidor com número americano chega ao lojista em real brasileiro", async () => {
    respostas.set("pedido_reembolsos_e_saldo", SALDO(500));
    rpc.mockImplementation((nome: string) =>
      nome === "admin_devolucao_concluir"
        ? Promise.resolve({
            data: null,
            error: {
              message:
                "O reembolso (R$ 120.00) passa do que ainda pode ser devolvido deste pedido (R$ 90.00).",
            },
          })
        : Promise.resolve({ data: respostas.get(nome) ?? null, error: null }),
    );
    await abrirConclusao();
    await clicar(botao("Nova, sem uso"));
    await clicar(botao("Concluir devolução"));

    const [mensagem] = toast.error.mock.calls[0] as [string];
    expect(mensagem).not.toContain("120.00");
    expect(mensagem).not.toContain("90.00");
    expect(mensagem).toMatch(/120,00/);
    expect(mensagem).toMatch(/90,00/);
  });
});
