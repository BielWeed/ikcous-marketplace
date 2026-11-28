// @vitest-environment jsdom
//
// A peca que volta sem tamanho (20261642000000) na DEVOLUCAO: concluida com
// "voltar ao estoque", a peca SEM variacao de um produto que hoje tem tamanho
// ligado nao vai para o estoque -- espera a lojista escolher o tamanho na tela
// do produto. O mesmo vale para a peca de um tamanho que a lojista DESLIGOU
// (20261653000000). O painel nao pode dizer "voltou ao estoque" nesse caso: nem
// no aviso da conclusao (a RPC devolve 'sem_tamanho'), nem na linha do item da
// ficha, nem no "(ja voltou)" da conferencia. A ficha marca POR ITEM, pelo que
// o banco gravou na conclusao (pecas_sem_tamanho_da_devolucao): outro item do
// mesmo produto, de tamanho ligado, voltou ao estoque de verdade. Ids e nomes
// inventados.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, invoke, toast, respostas, erros } = vi.hoisted(() => ({
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
  erros: new Map<string, { code: string; message: string }>(),
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

// A peca no cantinho, como a lista antiga (pecas_sem_tamanho_pendentes) a devolve: so produto e pedido.
const PECA_DA_DEVOLUCAO = {
  id: "peca-1",
  produto_id: "p-1",
  order_id: "o-1",
  origem: "devolucao",
  criada_em: "2026-11-27T13:00:00Z",
};

// O M desligado (espera) e o P ligado (voltou ao estoque de verdade), do MESMO produto.
const ITEM_M = {
  ...ITEM,
  id: "di-M",
  order_item_id: "oi-M",
  variant_id: "v-M",
  product_name: "Blusa M",
  condicao: "nova",
  reestocar: true,
  reestocado_em: "2026-11-27T13:00:00Z",
};
const ITEM_P = {
  ...ITEM_M,
  id: "di-P",
  order_item_id: "oi-P",
  variant_id: "v-P",
  product_name: "Blusa P",
};

const RPC_AUSENTE = {
  code: "PGRST202",
  message: "Could not find the function public.pecas_sem_tamanho_da_devolucao",
};

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  // A loja tem banco configurado (a leitura das peças nem importa o cliente sem URL e chave).
  vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-de-teste");
  vi.clearAllMocks();
  respostas.clear();
  erros.clear();
  respostas.set("admin_devolucoes_listar", {
    total: 1,
    contagem: { recebida: 1 },
    itens: [LINHA],
  });
  respostas.set("devolucao_detalhe", DETALHE);
  respostas.set("pecas_sem_tamanho_pendentes", []);
  respostas.set("pecas_sem_tamanho_da_devolucao", []);
  rpc.mockImplementation((nome: string) =>
    Promise.resolve(
      erros.has(nome)
        ? { data: null, error: erros.get(nome) }
        : { data: respostas.get(nome) ?? null, error: null },
    ),
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
  return rpc.mock.calls.filter(([nome]) =>
    ["pecas_sem_tamanho_da_devolucao", "pecas_sem_tamanho_pendentes"].includes(
      nome,
    ),
  );
}

function chamadasDaFicha() {
  return rpc.mock.calls.filter(
    ([nome]) => nome === "pecas_sem_tamanho_da_devolucao",
  );
}

/** A linha "1 × R$ … un. · …" de cada item da ficha, na ordem. */
function linhasDosItens(): string[] {
  return Array.from(hospedeiro.querySelectorAll("p"))
    .map((p) => p.textContent ?? "")
    .filter((t) => t.includes("×") && t.includes("un."));
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
      "Devolução concluída. 1 peça ficou esperando você escolher o tamanho dela na tela do produto para ela voltar à venda.",
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
      "Devolução concluída. 1 unidade voltou ao estoque. 2 peças ficaram esperando você escolher o tamanho delas na tela do produto para elas voltarem à venda.",
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
    respostas.set("pecas_sem_tamanho_da_devolucao", [
      { devolucao_item_id: "di-1" },
    ]);
    await abrirFicha();

    expect(hospedeiro.textContent).toContain(
      "voltou sem tamanho: escolha o tamanho na tela do produto",
    );
    expect(hospedeiro.textContent).not.toContain("voltou ao estoque");
    // Pergunta pelo pedido desta devolução, e só pela leitura nova.
    expect(chamadasDaFicha().length).toBeGreaterThan(0);
    for (const [, args] of chamadasDaFicha())
      expect(args).toEqual({ p_order_id: "o-1" });
    expect(
      rpc.mock.calls.filter(([n]) => n === "pecas_sem_tamanho_pendentes"),
    ).toHaveLength(0);
  });

  it("o item do tamanho DESLIGADO (com variação) que voltou e espera não diz 'voltou ao estoque'", async () => {
    respostas.set("devolucao_detalhe", { ...CONCLUIDA, itens: [ITEM_M] });
    respostas.set("pecas_sem_tamanho_da_devolucao", [
      { devolucao_item_id: "di-M" },
    ]);
    await abrirFicha();

    expect(linhasDosItens()).toHaveLength(1);
    expect(linhasDosItens()[0]).toContain(
      "voltou sem tamanho: escolha o tamanho na tela do produto",
    );
    expect(hospedeiro.textContent).not.toContain("voltou ao estoque");
  });

  it("guarda: o item do tamanho LIGADO do mesmo produto, creditado de verdade, continua 'voltou ao estoque'", async () => {
    respostas.set("devolucao_detalhe", {
      ...CONCLUIDA,
      itens: [ITEM_M, ITEM_P],
    });
    respostas.set("pecas_sem_tamanho_da_devolucao", [
      { devolucao_item_id: "di-M" },
    ]);
    await abrirFicha();

    const [m, p] = linhasDosItens();
    expect(m).toContain("voltou sem tamanho");
    expect(m).not.toContain("voltou ao estoque");
    expect(p).toContain("voltou ao estoque");
    expect(p).not.toContain("voltou sem tamanho");
  });

  it("o item de OUTRA devolução que espera não muda os itens desta", async () => {
    respostas.set("devolucao_detalhe", CONCLUIDA);
    respostas.set("pecas_sem_tamanho_da_devolucao", [
      { devolucao_item_id: "di-de-outra-devolucao" },
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

  it("loja sem a leitura nova (PGRST202): a leitura antiga, por produto, só para o item SEM variação", async () => {
    erros.set("pecas_sem_tamanho_da_devolucao", RPC_AUSENTE);
    respostas.set("devolucao_detalhe", {
      ...CONCLUIDA,
      itens: [CONCLUIDA.itens[0], ITEM_P],
    });
    respostas.set("pecas_sem_tamanho_pendentes", [
      PECA_DA_DEVOLUCAO,
      { ...PECA_DA_DEVOLUCAO, id: "x-1", order_id: "o-9" },
      { ...PECA_DA_DEVOLUCAO, id: "x-2", origem: "pedido_desfeito" },
    ]);
    await abrirFicha();

    const [semVariacao, comVariacao] = linhasDosItens();
    expect(semVariacao).toContain("voltou sem tamanho");
    // Sem a 20261653000000 o banco credita a variação: o item com tamanho voltou ao estoque.
    expect(comVariacao).toContain("voltou ao estoque");
  });

  it("loja sem a leitura nova (42883, a função que o Postgres não acha): a mesma leitura antiga do PGRST202", async () => {
    erros.set("pecas_sem_tamanho_da_devolucao", {
      code: "42883",
      message:
        "function public.pecas_sem_tamanho_da_devolucao(uuid) does not exist",
    });
    respostas.set("devolucao_detalhe", {
      ...CONCLUIDA,
      itens: [CONCLUIDA.itens[0], ITEM_P],
    });
    respostas.set("pecas_sem_tamanho_pendentes", [
      PECA_DA_DEVOLUCAO,
      { ...PECA_DA_DEVOLUCAO, id: "x-1", order_id: "o-9" },
      { ...PECA_DA_DEVOLUCAO, id: "x-2", origem: "pedido_desfeito" },
    ]);
    await abrirFicha();

    const [semVariacao, comVariacao] = linhasDosItens();
    expect(semVariacao).toContain("voltou sem tamanho");
    expect(comVariacao).toContain("voltou ao estoque");
  });

  it("loja sem a leitura nova e a peça é de OUTRO pedido ou de pedido desfeito: 'voltou ao estoque'", async () => {
    erros.set("pecas_sem_tamanho_da_devolucao", RPC_AUSENTE);
    respostas.set("devolucao_detalhe", CONCLUIDA);
    respostas.set("pecas_sem_tamanho_pendentes", [
      { ...PECA_DA_DEVOLUCAO, id: "x-1", order_id: "o-9" },
      { ...PECA_DA_DEVOLUCAO, id: "x-2", origem: "pedido_desfeito" },
    ]);
    await abrirFicha();

    expect(hospedeiro.textContent).toContain("voltou ao estoque");
    expect(hospedeiro.textContent).not.toContain("voltou sem tamanho");
  });

  it("outro erro da leitura nova (permissão, rede) não cai na leitura antiga: a ficha diz o de sempre", async () => {
    erros.set("pecas_sem_tamanho_da_devolucao", {
      code: "42501",
      message: "Acesso negado.",
    });
    respostas.set("devolucao_detalhe", CONCLUIDA);
    respostas.set("pecas_sem_tamanho_pendentes", [PECA_DA_DEVOLUCAO]);
    await abrirFicha();

    expect(hospedeiro.textContent).toContain("voltou ao estoque");
    expect(
      rpc.mock.calls.filter(([n]) => n === "pecas_sem_tamanho_pendentes"),
    ).toHaveLength(0);
  });

  it("nenhum item que voltou: nem pergunta ao banco", async () => {
    await abrirFicha();
    expect(chamadasDasPecas()).toHaveLength(0);
  });

  it("conferência: o '(já voltou)' do item do tamanho desligado que espera conta a verdade, e o do ligado diz que já voltou", async () => {
    respostas.set("devolucao_detalhe", {
      ...DETALHE,
      itens: [
        { ...ITEM_M, condicao: null, reestocar: null },
        { ...ITEM_P, condicao: null, reestocar: null },
      ],
    });
    respostas.set("pecas_sem_tamanho_da_devolucao", [
      { devolucao_item_id: "di-M" },
    ]);
    await abrirFicha();
    await clicar(botao("Concluir"));

    const rotulos = Array.from(hospedeiro.querySelectorAll("span"))
      .map((e) => e.textContent?.trim())
      .filter((t) => t?.startsWith("Voltar ao estoque"));
    expect(rotulos).toEqual([
      "Voltar ao estoque (voltou sem tamanho: escolha o tamanho na tela do produto)",
      "Voltar ao estoque (já voltou)",
    ]);
  });
});
