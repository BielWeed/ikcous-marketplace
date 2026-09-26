// @vitest-environment jsdom
//
// Achado 1 (revisão de risco pré-publicação, rodada 5/6a — scratchpad
// rev79/): um `me_reverse_id` REAL pode ficar preso sem código de postagem
// (edge que morreu no meio do caminho, liberação automática que falhou nas
// duas tentativas, ou Sandbox do Melhor Envio, que nunca gera o código da
// reversa). O cliente tenta cancelar e esbarra no guard de
// `cancelar_devolucao` ("fale com a loja"); até a rodada 6b o lojista só
// tinha o `curl` manual do runbook (§7.6) para destravar — sem UI nenhuma no
// painel. Este arquivo prova a ação nova em `AcoesDaDevolucao`: aparece só
// na condição certa, exige a confirmação explícita ANTES de habilitar o
// botão, chama a RPC com `p_conferi_no_melhor_envio: true` (nunca por baixo
// dos panos) e mostra a mensagem de recusa da RPC (22023 — confirmado,
// indeterminado ou sem registro nenhum) sem esconder o motivo.
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
  }),
  respostas: new Map<string, unknown>(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    functions: { invoke },
    storage: { from: () => ({ createSignedUrl: vi.fn() }) },
  },
}));

vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINHA = {
  id: "d-preso",
  protocolo: "DV260926-PRESO",
  order_id: "o-preso",
  cliente_nome: "João",
  cliente_whatsapp: "34999998888",
  tipo: "arrependimento",
  motivo: "tamanho_pequeno",
  status: "aprovada",
  resolucao_desejada: "reembolso",
  metodo_retorno: "etiqueta_reversa",
  modalidade: "nacional",
  valor_itens: 159.8,
  prazo_ate: "2026-10-01",
  created_at: "2026-09-26T10:00:00Z",
};

function detalheDe(over: Record<string, unknown> = {}) {
  return {
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
    me_reverse_id: "me-rev-preso-1",
    coleta_em: null,
    mensagem_loja: null,
    observacao_inspecao: null,
    entregue_em: "2026-09-20T15:00:00Z",
    politica: null,
    aprovada_em: "2026-09-26T11:00:00Z",
    postada_em: null,
    recebida_em: null,
    concluida_em: null,
    encerrada_em: null,
    itens: [],
    eventos: [],
    pedido: {
      id: "o-preso",
      total: 159.8,
      shipping: 0,
      payment_method: "online",
      payment_status: "pago",
      canal: "online",
      customer_name: "João",
      whatsapp: "34999998888",
      shipping_label_id: "lbl-me-1",
      shipping_option_id: "melhor-envio-2",
    },
    ...over,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  respostas.clear();
  respostas.set("admin_devolucoes_listar", {
    total: 1,
    contagem: { aprovada: 1 },
    itens: [LINHA],
  });
  respostas.set("devolucao_detalhe", detalheDe());
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
        active
        onSetDirty={vi.fn()}
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
  await clicar(
    hospedeiro.querySelector<HTMLElement>('[data-devolucao="d-preso"]'),
  );
  expect(
    hospedeiro.querySelector('[data-testid="detalhe-devolucao"]'),
  ).not.toBeNull();
}

const NOME_BOTAO = "Liberar vínculo preso";
const NOME_CHECKBOX = /Conferi em Meus envios/i;

function checkboxConferi(): HTMLInputElement | undefined {
  return (
    Array.from(hospedeiro.querySelectorAll("label"))
      .find((l) => NOME_CHECKBOX.test(l.textContent ?? ""))
      ?.querySelector<HTMLInputElement>("input[type=checkbox]") ?? undefined
  );
}

describe("painel de devoluções — liberar vínculo reverso preso (achado 1, rodada 6b)", () => {
  it("aparece só com aprovada + etiqueta reversa + link REAL + sem código", async () => {
    await abrirFicha();
    expect(botao(NOME_BOTAO)).toBeTruthy();
    // Mostra o id para o lojista achar o envio em "Meus envios".
    expect(hospedeiro.textContent).toContain("me-rev-preso-1");
  });

  it("some quando o vínculo é uma RESERVA (nunca precisa de ação manual)", async () => {
    respostas.set(
      "devolucao_detalhe",
      detalheDe({ me_reverse_id: "reservando:1234567890:abc" }),
    );
    await abrirFicha();
    expect(botao(NOME_BOTAO)).toBeFalsy();
  });

  it("some quando não há vínculo nenhum", async () => {
    respostas.set("devolucao_detalhe", detalheDe({ me_reverse_id: null }));
    await abrirFicha();
    expect(botao(NOME_BOTAO)).toBeFalsy();
  });

  it("some quando o código de postagem já saiu (nada para destravar)", async () => {
    respostas.set(
      "devolucao_detalhe",
      detalheDe({ codigo_postagem: "PX999BR" }),
    );
    await abrirFicha();
    expect(botao(NOME_BOTAO)).toBeFalsy();
  });

  it("some fora de 'aprovada'", async () => {
    respostas.set("devolucao_detalhe", detalheDe({ status: "recebida" }));
    await abrirFicha();
    expect(botao(NOME_BOTAO)).toBeFalsy();
  });

  it("some fora de etiqueta reversa", async () => {
    respostas.set(
      "devolucao_detalhe",
      detalheDe({ metodo_retorno: "envio_proprio" }),
    );
    await abrirFicha();
    expect(botao(NOME_BOTAO)).toBeFalsy();
  });

  it("o botão só habilita DEPOIS de marcar a confirmação, e chama a RPC com p_conferi_no_melhor_envio: true", async () => {
    respostas.set("admin_devolucao_liberar_vinculo_reverso", {
      id: "d-preso",
      me_reverse_id_liberado: "me-rev-preso-1",
    });
    await abrirFicha();

    const btn = botao(NOME_BOTAO);
    expect(btn).toBeTruthy();
    expect(btn?.disabled).toBe(true);

    const chk = checkboxConferi();
    expect(chk).toBeTruthy();
    await act(async () => {
      chk?.click();
    });
    await drenar();

    expect(botao(NOME_BOTAO)?.disabled).toBe(false);

    await clicar(botao(NOME_BOTAO));

    expect(rpc).toHaveBeenCalledWith(
      "admin_devolucao_liberar_vinculo_reverso",
      { p_id: "d-preso", p_conferi_no_melhor_envio: true },
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it("marcador CONFIRMADO: a RPC recusa (22023) e o toast mostra o motivo, sem esconder", async () => {
    rpc.mockImplementation((nome: string) => {
      if (nome === "admin_devolucao_liberar_vinculo_reverso") {
        return Promise.resolve({
          data: null,
          error: {
            code: "22023",
            message:
              "O Melhor Envio já confirmou o pagamento deste envio reverso — aguarde o código de postagem chegar ou cancele o envio direto no Melhor Envio antes de liberar o vínculo aqui.",
          },
        });
      }
      return Promise.resolve({
        data: respostas.get(nome) ?? null,
        error: null,
      });
    });
    await abrirFicha();
    await act(async () => {
      checkboxConferi()?.click();
    });
    await drenar();
    await clicar(botao(NOME_BOTAO));

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("já confirmou o pagamento"),
    );
  });

  it("sem registro de pagamento nenhum: a RPC recusa (22023) e o toast mostra o motivo", async () => {
    rpc.mockImplementation((nome: string) => {
      if (nome === "admin_devolucao_liberar_vinculo_reverso") {
        return Promise.resolve({
          data: null,
          error: {
            code: "22023",
            message:
              'Não há nenhum registro de pagamento para este envio reverso no banco — confira "Meus envios" na conta do Melhor Envio antes de liberar; chame de novo com p_conferi_no_melhor_envio = true depois de conferir que não foi pago.',
          },
        });
      }
      return Promise.resolve({
        data: respostas.get(nome) ?? null,
        error: null,
      });
    });
    await abrirFicha();
    await act(async () => {
      checkboxConferi()?.click();
    });
    await drenar();
    await clicar(botao(NOME_BOTAO));

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Não há nenhum registro de pagamento"),
    );
  });

  it("marcador INDETERMINADO: a RPC recusa (22023) e o toast mostra o motivo", async () => {
    rpc.mockImplementation((nome: string) => {
      if (nome === "admin_devolucao_liberar_vinculo_reverso") {
        return Promise.resolve({
          data: null,
          error: {
            code: "22023",
            message:
              'Há registro de pagamento indeterminado para este envio reverso no Melhor Envio — confira "Meus envios" na conta do Melhor Envio antes de liberar; chame de novo com p_conferi_no_melhor_envio = true depois de conferir que não foi pago.',
          },
        });
      }
      return Promise.resolve({
        data: respostas.get(nome) ?? null,
        error: null,
      });
    });
    await abrirFicha();
    await act(async () => {
      checkboxConferi()?.click();
    });
    await drenar();
    await clicar(botao(NOME_BOTAO));

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Há registro de pagamento indeterminado"),
    );
  });

  it("sucesso: toast avisa, a ficha relê e a ação some (vínculo já não está mais preso)", async () => {
    respostas.set("admin_devolucao_liberar_vinculo_reverso", {
      id: "d-preso",
      me_reverse_id_liberado: "me-rev-preso-1",
    });
    rpc.mockImplementation((nome: string) => {
      if (nome === "admin_devolucao_liberar_vinculo_reverso") {
        // A releitura seguinte já reflete o vínculo solto.
        respostas.set("devolucao_detalhe", detalheDe({ me_reverse_id: null }));
        return Promise.resolve({
          data: respostas.get(nome),
          error: null,
        });
      }
      return Promise.resolve({
        data: respostas.get(nome) ?? null,
        error: null,
      });
    });
    await abrirFicha();
    await act(async () => {
      checkboxConferi()?.click();
    });
    await drenar();
    await clicar(botao(NOME_BOTAO));

    expect(toast.success).toHaveBeenCalled();
    expect(botao(NOME_BOTAO)).toBeFalsy();
  });
});
