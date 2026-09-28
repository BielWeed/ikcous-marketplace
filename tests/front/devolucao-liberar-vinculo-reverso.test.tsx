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
// dos panos) e mostra a mensagem de recusa da RPC sem esconder o motivo.
//
// Achado 1 (rodada 6c, revisão de risco, DINHEIRO — scratchpad rev79/ta4f/):
// a confirmação (`useState(false)` solto, sem amarra a NADA) sobrevivia a
// uma releitura da MESMA ficha (o `key` do componente é `id:status` — não
// muda quando só `me_reverse_id` troca). Sequência A → B: o lojista marca a
// caixa e libera o vínculo A; "Gerar código de postagem" compra um vínculo B
// NOVO na mesma devolução com o checkout indeterminado (502 com `resgate`,
// a ficha relê sem remontar); o bloco reaparece para B com a caixa JÁ
// marcada e o botão JÁ habilitado — um clique liberaria B sem ninguém ter
// conferido "Meus envios" para ELE. Os testes marcados "(rodada 6c)" abaixo
// provam a amarra ao id e o reset depois de qualquer resultado (sucesso ou
// erro). Achado 3 (rodada 6c, detalhe): os testes de recusa da RPC usam só
// os erros que o PAINEL de fato alcança — ele sempre manda
// `p_conferi_no_melhor_envio: true`, então "indeterminado" e "sem registro"
// (que só acontecem SEM esse parâmetro, pelo `curl` do runbook) não são
// alcançáveis por aqui; as corridas reais são "sem vínculo" e "código já
// emitido" (o estado mudou no banco entre abrir a ficha e clicar), fora
// `42501`/`P0002`.
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

describe("painel de devoluções — liberar vínculo reverso preso (achado 1, rodadas 6b/6c)", () => {
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

  // Achado 3 (rodada 6c): o painel SEMPRE manda `p_conferi_no_melhor_envio:
  // true` — "indeterminado" e "sem registro" (achado 1, rodada 5) só
  // acontecem quando esse parâmetro NÃO é `true`, então não são alcançáveis
  // por aqui (só pelo `curl` do runbook, sem o parâmetro). As recusas reais
  // possíveis pelo painel são: confirmado (acima), sem vínculo e código já
  // emitido (corridas — o estado mudou no banco entre abrir a ficha e
  // clicar), 42501 e P0002.
  it("corrida: o vínculo já foi solto por outro caminho quando a RPC roda (22023 'não está vinculada') — o toast mostra o motivo", async () => {
    rpc.mockImplementation((nome: string) =>
      nome === "admin_devolucao_liberar_vinculo_reverso"
        ? Promise.resolve({
            data: null,
            error: {
              code: "22023",
              message:
                "Esta devolução não está vinculada a nenhum envio reverso no Melhor Envio.",
            },
          })
        : Promise.resolve({ data: respostas.get(nome) ?? null, error: null }),
    );
    await abrirFicha();
    await act(async () => {
      checkboxConferi()?.click();
    });
    await drenar();
    await clicar(botao(NOME_BOTAO));

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("não está vinculada"),
    );
  });

  it("corrida: o código de postagem já saiu por outro caminho quando a RPC roda (22023) — o toast mostra o motivo", async () => {
    rpc.mockImplementation((nome: string) =>
      nome === "admin_devolucao_liberar_vinculo_reverso"
        ? Promise.resolve({
            data: null,
            error: {
              code: "22023",
              message:
                "O código de postagem já foi emitido — não há vínculo preso para liberar; cancele o envio reverso direto no Melhor Envio, se for o caso.",
            },
          })
        : Promise.resolve({ data: respostas.get(nome) ?? null, error: null }),
    );
    await abrirFicha();
    await act(async () => {
      checkboxConferi()?.click();
    });
    await drenar();
    await clicar(botao(NOME_BOTAO));

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("código de postagem já foi emitido"),
    );
  });

  it("42501: sessão perdeu admin no meio do caminho — o toast mostra 'Acesso negado.'", async () => {
    rpc.mockImplementation((nome: string) =>
      nome === "admin_devolucao_liberar_vinculo_reverso"
        ? Promise.resolve({
            data: null,
            error: { code: "42501", message: "Acesso negado." },
          })
        : Promise.resolve({ data: respostas.get(nome) ?? null, error: null }),
    );
    await abrirFicha();
    await act(async () => {
      checkboxConferi()?.click();
    });
    await drenar();
    await clicar(botao(NOME_BOTAO));

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Acesso negado"),
    );
  });

  it("P0002: a devolução sumiu entre abrir a ficha e clicar — o toast mostra o motivo", async () => {
    rpc.mockImplementation((nome: string) =>
      nome === "admin_devolucao_liberar_vinculo_reverso"
        ? Promise.resolve({
            data: null,
            error: { code: "P0002", message: "Devolução não encontrada." },
          })
        : Promise.resolve({ data: respostas.get(nome) ?? null, error: null }),
    );
    await abrirFicha();
    await act(async () => {
      checkboxConferi()?.click();
    });
    await drenar();
    await clicar(botao(NOME_BOTAO));

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Devolução não encontrada"),
    );
  });

  // Achado 1 (rodada 6c, DINHEIRO): a reprodução do revisor
  // (scratchpad rev79/ta4f/tests/front/revisor-6b-checkbox.test.tsx).
  it("achado 1 (rodada 6c): liberar o vínculo A não deixa a confirmação marcada para um vínculo B novo que aparece na MESMA ficha", async () => {
    respostas.set("admin_devolucao_liberar_vinculo_reverso", {
      id: "d-preso",
      me_reverse_id_liberado: "me-rev-preso-1",
    });
    rpc.mockImplementation((nome: string) => {
      if (nome === "admin_devolucao_liberar_vinculo_reverso") {
        // A releitura seguinte já reflete o vínculo A solto.
        respostas.set("devolucao_detalhe", detalheDe({ me_reverse_id: null }));
        return Promise.resolve({ data: respostas.get(nome), error: null });
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
    expect(botao(NOME_BOTAO)).toBeFalsy(); // A liberado: a ação some.

    // O lojista gera de novo; a edge compra um vínculo B NOVO na MESMA
    // devolução e o checkout fica INDETERMINADO (502 com `resgate`) — a
    // ficha relê sem remontar (o `key` do componente é `id:status`, que não
    // muda aqui).
    invoke.mockImplementation(() => {
      respostas.set(
        "devolucao_detalhe",
        detalheDe({ me_reverse_id: "me-rev-NOVO-B" }),
      );
      return Promise.resolve({
        data: null,
        error: {
          context: {
            json: async () => ({
              error:
                "O pagamento do envio reverso (id me-rev-NOVO-B) ficou em estado INDETERMINADO no Melhor Envio — pode ter sido pago ou não.",
              resgate: true,
              me_reverse_id: "me-rev-NOVO-B",
            }),
          },
        },
      });
    });
    await clicar(botao("Gerar código de postagem"));

    // O bloco reaparece para B...
    expect(hospedeiro.textContent).toContain("me-rev-NOVO-B");
    // ...mas SEM a confirmação de A sobrevivendo: caixa desmarcada, botão
    // desabilitado — precisa conferir "Meus envios" de novo, para B.
    expect(checkboxConferi()?.checked).toBe(false);
    expect(botao(NOME_BOTAO)?.disabled).toBe(true);
  });

  it("achado 1 (rodada 6c): depois de uma recusa da RPC, a confirmação reseta — precisa marcar de novo antes de tentar outra vez", async () => {
    rpc.mockImplementation((nome: string) =>
      nome === "admin_devolucao_liberar_vinculo_reverso"
        ? Promise.resolve({
            data: null,
            error: {
              code: "22023",
              message:
                "O Melhor Envio já confirmou o pagamento deste envio reverso — aguarde o código de postagem chegar ou cancele o envio direto no Melhor Envio antes de liberar o vínculo aqui.",
            },
          })
        : Promise.resolve({ data: respostas.get(nome) ?? null, error: null }),
    );
    await abrirFicha();
    await act(async () => {
      checkboxConferi()?.click();
    });
    await drenar();
    await clicar(botao(NOME_BOTAO));

    expect(toast.error).toHaveBeenCalled();
    expect(checkboxConferi()?.checked).toBe(false);
    expect(botao(NOME_BOTAO)?.disabled).toBe(true);
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
