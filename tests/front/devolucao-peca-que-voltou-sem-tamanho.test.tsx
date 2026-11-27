// @vitest-environment jsdom
//
// A peca que volta sem tamanho (20261642000000) na DEVOLUCAO: concluida com
// "voltar ao estoque", a peca SEM variacao de um produto que hoje tem tamanho
// ligado nao vai para o estoque -- espera a lojista escolher o tamanho na tela
// do produto. O painel nao pode dizer "voltou ao estoque" nesse caso: nem no
// aviso da conclusao (a RPC devolve 'sem_tamanho'), nem na linha do item da
// ficha, nem no "(ja voltou)" da conferencia. Ids e nomes inventados.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, invoke, toast, respostas } = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  }),
  respostas: new Map<string, unknown>(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "lojista-1" } } },
      }),
    },
    functions: { invoke },
    storage: { from: () => ({ createSignedUrl: vi.fn() }) },
  },
}));

vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINHA = {
  id: "d-1",
  protocolo: "DV261127-ABCDE",
  order_id: "o-1",
  cliente_nome: "Maria",
  cliente_whatsapp: "34999999999",
  tipo: "arrependimento",
  motivo: "tamanho_pequeno",
  status: "recebida",
  resolucao_desejada: "troca",
  metodo_retorno: "envio_proprio",
  modalidade: "nacional",
  valor_itens: 99.9,
  prazo_ate: "2026-12-01",
  created_at: "2026-11-26T10:00:00Z",
};

const ITEM = {
  id: "di-1",
  order_item_id: "oi-1",
  product_id: "p-1",
  variant_id: null,
  product_name: "Blusa",
  image_url: null,
  quantidade: 1,
  valor_unitario: 99.9,
  condicao: null,
  reestocar: null,
  reestocado_em: null,
};

const DETALHE = {
  ...LINHA,
  detalhe: null,
  resolucao_final: null,
  valor_frete_ida: 0,
  valor_reembolso: null,
  refund_id: null,
  reembolso_manual: false,
  fotos: [],
  codigo_rastreio: null,
  codigo_postagem: null,
  etiqueta_url: null,
  me_reverse_id: null,
  coleta_em: null,
  mensagem_loja: null,
  observacao_inspecao: null,
  entregue_em: "2026-11-24T15:00:00Z",
  politica: null,
  aprovada_em: "2026-11-26T11:00:00Z",
  postada_em: "2026-11-26T12:00:00Z",
  recebida_em: "2026-11-27T12:00:00Z",
  concluida_em: null,
  encerrada_em: null,
  itens: [ITEM],
  eventos: [],
  pedido: {
    id: "o-1",
    total: 99.9,
    shipping: 0,
    payment_method: "online",
    payment_status: "pago",
    canal: "online",
    customer_name: "Maria",
    whatsapp: "34999999999",
    shipping_label_id: null,
    shipping_option_id: null,
  },
};

const CONCLUIDA = {
  ...DETALHE,
  status: "concluida",
  resolucao_final: "troca",
  concluida_em: "2026-11-27T13:00:00Z",
  itens: [
    {
      ...ITEM,
      condicao: "nova",
      reestocar: true,
      reestocado_em: "2026-11-27T13:00:00Z",
    },
  ],
};

const PECA_DA_DEVOLUCAO = {
  id: "peca-1",
  produto_id: "p-1",
  order_id: "o-1",
  origem: "devolucao",
  criada_em: "2026-11-27T13:00:00Z",
};

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  // A loja tem banco configurado (a leitura das peças nem importa o cliente sem URL e chave).
  vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-de-teste");
  vi.clearAllMocks();
  respostas.clear();
  respostas.set("admin_devolucoes_listar", {
    total: 1,
    contagem: { recebida: 1 },
    itens: [LINHA],
  });
  respostas.set("devolucao_detalhe", DETALHE);
  respostas.set("pecas_sem_tamanho_pendentes", []);
  rpc.mockImplementation((nome: string) =>
    Promise.resolve({ data: respostas.get(nome) ?? null, error: null }),
  );
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
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
  vi.unstubAllEnvs();
});

async function drenar() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
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
  const { AdminDevolucoesView } = await import(
    "@/views/admin/AdminDevolucoesView"
  );
  await act(async () => {
    raiz.render(
      <AdminDevolucoesView
        onNavigate={vi.fn()}
        active
        onSetDirty={vi.fn()}
        onSetBackOverride={vi.fn()}
      />,
    );
  });
  await drenar();
  await clicar(hospedeiro.querySelector<HTMLElement>('[data-devolucao="d-1"]'));
}

function chamadasDasPecas() {
  return rpc.mock.calls.filter(
    ([nome]) => nome === "pecas_sem_tamanho_pendentes",
  );
}

describe("devolução: a peça que voltou sem tamanho", () => {
  it("o aviso da conclusão conta a peça que espera o tamanho, não diz que voltou ao estoque", async () => {
    respostas.set("admin_devolucao_concluir", {
      id: "d-1",
      status: "concluida",
      resolucao: "troca",
      valor_reembolso: null,
      refund_id: null,
      reembolso_manual: false,
      reestocados: 0,
      sem_tamanho: 1,
    });
    await abrirFicha();
    await clicar(botao("Concluir"));
    await clicar(botao("Nova, sem uso"));
    await clicar(botao("Concluir devolução"));

    expect(toast.success).toHaveBeenCalledWith(
      "Devolução concluída. 1 peça voltou sem tamanho: escolha o tamanho dela na tela do produto para ela voltar à venda.",
    );
    const todos = [toast.success, toast.info, toast.warning].flatMap((t) =>
      t.mock.calls.map((c) => String(c[0])),
    );
    expect(todos.join("\n")).not.toContain("ao estoque");
  });

  it("plural, junto com o que voltou ao estoque de verdade", async () => {
    respostas.set("admin_devolucao_concluir", {
      id: "d-1",
      status: "concluida",
      resolucao: "troca",
      valor_reembolso: null,
      refund_id: null,
      reembolso_manual: false,
      reestocados: 1,
      sem_tamanho: 2,
    });
    await abrirFicha();
    await clicar(botao("Concluir"));
    await clicar(botao("Nova, sem uso"));
    await clicar(botao("Concluir devolução"));

    expect(toast.success).toHaveBeenCalledWith(
      "Devolução concluída. 1 unidade voltou ao estoque. 2 peças voltaram sem tamanho: escolha o tamanho delas na tela do produto para elas voltarem à venda.",
    );
  });

  it("banco sem a chave nova (loja sem a migration): o aviso de sempre", async () => {
    respostas.set("admin_devolucao_concluir", {
      id: "d-1",
      status: "concluida",
      resolucao: "troca",
      valor_reembolso: null,
      refund_id: null,
      reembolso_manual: false,
      reestocados: 1,
    });
    await abrirFicha();
    await clicar(botao("Concluir"));
    await clicar(botao("Nova, sem uso"));
    await clicar(botao("Concluir devolução"));

    expect(toast.success).toHaveBeenCalledWith(
      "Devolução concluída. 1 unidade voltou ao estoque.",
    );
  });

  it("ficha concluída: o item que espera o tamanho diz isso e aponta para o produto", async () => {
    respostas.set("devolucao_detalhe", CONCLUIDA);
    respostas.set("pecas_sem_tamanho_pendentes", [PECA_DA_DEVOLUCAO]);
    await abrirFicha();

    expect(hospedeiro.textContent).toContain(
      "voltou sem tamanho: escolha o tamanho na tela do produto",
    );
    expect(hospedeiro.textContent).not.toContain("voltou ao estoque");
    expect(chamadasDasPecas().length).toBeGreaterThan(0);
  });

  it("a peça pendente de OUTRO pedido ou de pedido desfeito não muda o item desta devolução", async () => {
    respostas.set("devolucao_detalhe", CONCLUIDA);
    respostas.set("pecas_sem_tamanho_pendentes", [
      { ...PECA_DA_DEVOLUCAO, id: "x-1", order_id: "o-9" },
      { ...PECA_DA_DEVOLUCAO, id: "x-2", origem: "pedido_desfeito" },
    ]);
    await abrirFicha();

    expect(hospedeiro.textContent).toContain("voltou ao estoque");
    expect(hospedeiro.textContent).not.toContain("voltou sem tamanho");
  });

  it("sem peça esperando (produto sem grade, ou já decidida): continua 'voltou ao estoque'", async () => {
    respostas.set("devolucao_detalhe", CONCLUIDA);
    await abrirFicha();

    expect(hospedeiro.textContent).toContain("voltou ao estoque");
    expect(hospedeiro.textContent).not.toContain("voltou sem tamanho");
  });

  it("nenhum item que possa esperar tamanho: nem pergunta ao banco", async () => {
    await abrirFicha();
    expect(chamadasDasPecas()).toHaveLength(0);
  });

  it("conferência: o '(já voltou)' do item que espera o tamanho conta a verdade", async () => {
    respostas.set("devolucao_detalhe", {
      ...DETALHE,
      itens: [{ ...ITEM, reestocado_em: "2026-11-27T13:00:00Z" }],
    });
    respostas.set("pecas_sem_tamanho_pendentes", [PECA_DA_DEVOLUCAO]);
    await abrirFicha();
    await clicar(botao("Concluir"));

    const rotulos = Array.from(hospedeiro.querySelectorAll("span"))
      .map((e) => e.textContent?.trim())
      .filter((t) => t?.startsWith("Voltar ao estoque"));
    expect(rotulos).toEqual([
      "Voltar ao estoque (voltou sem tamanho: escolha o tamanho na tela do produto)",
    ]);
  });
});
