// @vitest-environment jsdom
//
// Ficha da devolução suja (a lojista mexeu num campo) + toque em "Pedido #…":
// a tela pergunta "descartar?" UMA vez. Antes, depois do "OK" ela chamava
// `onNavigate("admin-orders", id)` sem o 3º argumento, e o App (que ainda via
// a tela suja, porque o `setSujo(false)` só chega ao ref dele num efeito
// depois) abria SEGUNDA pergunta; escolhendo "Permanecer" a ficha ficava, mas
// a proteção já estava desligada e sair depois perdia o texto sem aviso.
// O `onNavigate` abaixo é cópia fiel do contrato do App (`handleNavigate`):
// com o ref de sujo ligado e sem `bypassDirtyCheck`, ele NÃO navega e abre o
// diálogo de descarte do App. Molde: devolucao-painel-ficha-e-janela-no-
// celular.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, invoke, respostas } = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  respostas: new Map<string, unknown>(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    functions: { invoke },
    storage: { from: () => ({ createSignedUrl: vi.fn() }) },
  },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

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
};

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

let raiz: Root;
let hospedeiro: HTMLDivElement;

// Espelho do App: `isAdminDirtyRef` só muda num efeito (depois do render),
// nunca no mesmo tick do clique; `handleNavigate` barra se sujo e sem bypass.
let sujoNoApp = false;
const navegou = vi.fn();
const segundaPerguntaDoApp = vi.fn();
const onNavigate = vi.fn(
  (view: string, id?: string, bypassDirtyCheck = false) => {
    if (sujoNoApp && !bypassDirtyCheck) {
      segundaPerguntaDoApp(view, id);
      return;
    }
    navegou(view, id);
  },
);
const onSetDirty = vi.fn((sujo: boolean) => {
  sujoNoApp = sujo;
});

beforeEach(() => {
  vi.clearAllMocks();
  sujoNoApp = false;
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
  vi.stubGlobal("matchMedia", (consulta: string) => ({
    matches: consulta.includes("1024px"),
    media: consulta,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
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

const botao = (texto: string) =>
  Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) =>
      b.textContent?.trim() === texto || b.getAttribute("aria-label") === texto,
  );
const botaoDoPedido = () =>
  Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    b.textContent?.trim().startsWith("Pedido #"),
  );

async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.click();
  });
  await drenar();
}

async function abrirFicha() {
  const { AdminDevolucoesView } = await import(
    "@/views/admin/AdminDevolucoesView"
  );
  await act(async () => {
    raiz.render(
      <AdminDevolucoesView
        onNavigate={onNavigate}
        active
        onSetDirty={onSetDirty}
        onSetBackOverride={vi.fn()}
      />,
    );
  });
  await drenar();
  await clicar(hospedeiro.querySelector<HTMLElement>('[data-devolucao="d-1"]'));
  expect(
    hospedeiro.querySelector('[data-testid="detalhe-devolucao"]'),
  ).not.toBeNull();
}

async function sujarAFicha() {
  await clicar(botao("Concluir"));
  await clicar(botao("Nova, sem uso"));
  expect(botao("Nova, sem uso")?.getAttribute("aria-pressed")).toBe("true");
  expect(sujoNoApp).toBe(true);
}

describe("Ficha da devolução — Pedido #… com a ficha suja", () => {
  it("confirmou o descarte: navega ao pedido sem segunda pergunta do App", async () => {
    const confirmar = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmar);
    await abrirFicha();
    await sujarAFicha();
    navegou.mockClear();
    onNavigate.mockClear();

    await clicar(botaoDoPedido());

    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(segundaPerguntaDoApp).not.toHaveBeenCalled();
    expect(navegou).toHaveBeenCalledTimes(1);
    expect(navegou).toHaveBeenCalledWith("admin-orders", "o-1");
    // O descarte já foi confirmado aqui: o 3º argumento avisa o App.
    expect(onNavigate).toHaveBeenCalledWith("admin-orders", "o-1", true);
  });

  it("controle: ficha limpa navega direto, sem perguntar nada", async () => {
    const confirmar = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmar);
    await abrirFicha();
    onNavigate.mockClear();

    await clicar(botaoDoPedido());

    expect(confirmar).not.toHaveBeenCalled();
    expect(segundaPerguntaDoApp).not.toHaveBeenCalled();
    expect(navegou).toHaveBeenCalledWith("admin-orders", "o-1");
  });

  it("cancelou o descarte: não navega e a ficha segue protegida", async () => {
    const confirmar = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmar);
    await abrirFicha();
    await sujarAFicha();
    navegou.mockClear();
    onNavigate.mockClear();

    await clicar(botaoDoPedido());

    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(navegou).not.toHaveBeenCalled();
    expect(botao("Nova, sem uso")?.getAttribute("aria-pressed")).toBe("true");
    // Continua suja para o App: sair depois ainda pergunta.
    expect(sujoNoApp).toBe(true);
  });
});
