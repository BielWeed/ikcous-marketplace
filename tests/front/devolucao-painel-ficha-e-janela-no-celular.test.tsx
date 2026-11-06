// @vitest-environment jsdom
//
// A ficha da devolução no painel, em tela estreita (< 1024 px), cobre a tela
// inteira. Antes ela era só uma div: sem Esc, sem foco dentro, e o teclado ou
// o leitor de tela escapavam para a lista escondida por baixo. Agora, SÓ em
// tela estreita, é uma janela de verdade: role="dialog", aria-modal, nome, o
// foco entra no botão de fechar e volta ao cartão, a lista de trás fica inerte
// e o Esc fecha respeitando o "descartar". No computador (>= 1024 px) o painel
// lateral continua exatamente como era. Molde: devolucao-painel-confirma-
// etiqueta-e-recebida.test.tsx.
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
const onNavigate = vi.fn();

function tela(larga: boolean) {
  vi.stubGlobal("matchMedia", (consulta: string) => ({
    matches: larga && consulta.includes("1024px"),
    media: consulta,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
}

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

const cartao = () =>
  hospedeiro.querySelector<HTMLElement>('[data-devolucao="d-1"]');
const janela = () => hospedeiro.querySelector<HTMLElement>('[role="dialog"]');
const ficha = () =>
  hospedeiro.querySelector<HTMLElement>('[data-testid="detalhe-devolucao"]');
const lista = () =>
  hospedeiro.querySelector<HTMLElement>('[data-testid="lista-devolucoes"]');
const botao = (texto: string) =>
  Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) =>
      b.textContent?.trim() === texto || b.getAttribute("aria-label") === texto,
  );

async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.click();
  });
  await drenar();
}

async function montar(ativa = true, idDaUrl?: string) {
  const { AdminDevolucoesView } = await import(
    "@/views/admin/AdminDevolucoesView"
  );
  await act(async () => {
    raiz.render(
      <AdminDevolucoesView
        onNavigate={onNavigate}
        active={ativa}
        selectedDevolucaoId={idDaUrl}
        onSetDirty={vi.fn()}
        onSetBackOverride={vi.fn()}
      />,
    );
  });
  await drenar();
}

async function abrirFicha() {
  await montar();
  const alvo = cartao();
  // Como o teclado: o foco está no cartão quando o lojista aperta Enter.
  alvo?.focus();
  await clicar(alvo);
  expect(ficha()).not.toBeNull();
}

async function esc() {
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await drenar();
}

describe("Ficha da devolução — tela estreita vira janela de verdade", () => {
  it("tem papel de janela, é modal e tem nome", async () => {
    tela(false);
    await abrirFicha();

    const j = janela();
    expect(j).not.toBeNull();
    expect(j?.getAttribute("aria-modal")).toBe("true");
    expect(j?.getAttribute("aria-label")).toBe("Detalhe da devolução");
    expect(j?.contains(ficha())).toBe(true);
  });

  it("o foco entra no botão de fechar e a lista de trás fica inerte", async () => {
    tela(false);
    await abrirFicha();

    expect(document.activeElement).toBe(botao("Fechar devolução"));
    expect(lista()?.hasAttribute("inert")).toBe(true);
    // O campo de busca e os filtros também ficam escondidos do teclado.
    expect(
      hospedeiro
        .querySelector("#busca-devolucoes")
        ?.closest("[inert]")
        ?.hasAttribute("inert"),
    ).toBe(true);
    expect(
      hospedeiro.querySelector('[role="group"]')?.hasAttribute("inert"),
    ).toBe(true);
  });

  it("Esc fecha a ficha e o foco volta ao cartão que a abriu", async () => {
    tela(false);
    await abrirFicha();

    await esc();

    expect(ficha()).toBeNull();
    expect(janela()).toBeNull();
    expect(onNavigate).toHaveBeenLastCalledWith(
      "admin-devolucoes",
      undefined,
      true,
    );
    expect(lista()?.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(cartao());
  });

  it("Esc com a ficha suja respeita o 'descartar': cancelando, a ficha fica", async () => {
    tela(false);
    const confirmar = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmar);
    await abrirFicha();
    await clicar(botao("Concluir"));
    await clicar(botao("Nova, sem uso"));
    expect(botao("Nova, sem uso")?.getAttribute("aria-pressed")).toBe("true");

    await esc();

    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(ficha()).not.toBeNull();
    expect(janela()).not.toBeNull();
    expect(botao("Nova, sem uso")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("Esc que outra camada já tratou (preventDefault) não fecha a ficha", async () => {
    tela(false);
    await abrirFicha();

    await act(async () => {
      const evento = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      evento.preventDefault();
      document.activeElement?.dispatchEvent(evento);
    });

    expect(ficha()).not.toBeNull();
  });

  it("com a tela em segundo plano (active=false), o Esc não navega nem fecha", async () => {
    tela(false);
    await abrirFicha();
    await montar(false);
    onNavigate.mockClear();

    await esc();

    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("Ficha da devolução — computador (>= 1024 px) não muda", () => {
  it("segue painel ao lado: sem papel de janela, sem inert, sem roubar o foco", async () => {
    tela(true);
    await abrirFicha();

    expect(janela()).toBeNull();
    expect(lista()?.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).not.toBe(botao("Fechar devolução"));
  });

  it("Esc não fecha o painel lateral", async () => {
    tela(true);
    await abrirFicha();

    await esc();

    expect(ficha()).not.toBeNull();
  });
});

// Cópia fiel do que o AdminLayout faz a cada troca de tela: um Escape
// sintético, 50 ms depois, para o elemento ativo, o document e a window.
async function escapeSinteticoDoLayout() {
  const { marcarEscapeSintetico } = await import("@/lib/escape-sintetico");
  await act(async () => {
    for (const alvo of [document.activeElement, document, window]) {
      const evento = new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
      });
      marcarEscapeSintetico(evento);
      alvo?.dispatchEvent(evento);
    }
  });
  await drenar();
}

describe("Ficha da devolução — Escape sintético do AdminLayout não é do lojista", () => {
  it("ficha aberta já na montagem (Ver devolução num pedido): o Escape do layout não a fecha", async () => {
    tela(false);
    await montar(true, "d-1");
    await drenar();
    expect(janela()).not.toBeNull();

    await escapeSinteticoDoLayout();

    expect(janela()).not.toBeNull();
    expect(ficha()).not.toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("e o Esc de verdade do lojista, na mesma ficha, ainda fecha", async () => {
    tela(false);
    await montar(true, "d-1");
    await drenar();
    await escapeSinteticoDoLayout();

    await esc();

    expect(ficha()).toBeNull();
    expect(onNavigate).toHaveBeenLastCalledWith(
      "admin-devolucoes",
      undefined,
      true,
    );
  });

  it("Esc do lojista com a ficha suja: confirmando o 'Descartar?', fecha", async () => {
    tela(false);
    const confirmar = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmar);
    await montar(true, "d-1");
    await drenar();
    await clicar(botao("Concluir"));
    await clicar(botao("Nova, sem uso"));

    await escapeSinteticoDoLayout();
    expect(confirmar).not.toHaveBeenCalled();
    expect(ficha()).not.toBeNull();

    await esc();

    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(ficha()).toBeNull();
  });
});
