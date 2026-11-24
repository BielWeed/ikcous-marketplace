// @vitest-environment jsdom
//
// Caça de provas fracas (24/11/2026), tela "Mercado Pago" de Ajustes: bordas do
// ESTADO do recebimento pelo app (a porta do dinheiro) e do teste de conexão.
// Chaves e respostas FALSAS; a edge é um dublê.
//   P1  edge ANTIGA (a resposta do teste não traz `pix_ligado`): o teste de
//       conexão NÃO mexe no estado do recebimento nem avisa o painel com um
//       "desligado" inventado;
//   P2  "ligado" na ficha vence "pausado" (é o que o cliente vê): estado
//       inconsistente mostra "Pausar", não "Retomar";
//   P3  falha ao LER as chaves: a camada "Suas chaves" não abre sozinha (não há
//       o que afirmar) e o bloco do recebimento some;
//   P4  "Testar conexão" fica travado sem internet e sem chave salva;
//   P6  o aviso "a ficha da loja ainda não carrega esta chave pública" só
//       aparece com o recebimento LIGADO (é o caso em que o cliente não vê o
//       Pix); desligado, ele seria alarme falso;
//   P7  o aviso "pausar derruba as vendas por transportadora" some se a loja
//       deixa de ter transportadora enquanto ele está aberto;
//   P5  enquanto as chaves ainda estão sendo LIDAS, os três campos e o Salvar
//       ficam travados (nada digitado nessa hora seria sobrescrito pela leitura).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PUBLICA = "APP_USR-11111111-1111-4111-8111-111111111111";

const { invokeFalso, offlineFalso, cenario } = vi.hoisted(() => ({
  invokeFalso: vi.fn(),
  offlineFalso: { valor: false },
  cenario: {
    ler: {} as Record<string, unknown>,
    lerErro: null as unknown,
    testar: {} as Record<string, unknown>,
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeFalso } },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => offlineFalso.valor,
}));
vi.mock("@/hooks/useDonoDaLoja", () => ({
  useDonoDaLoja: () => ({
    souODono: true,
    carregando: false,
    donoId: "uid-do-dono-ficticio",
    leituraFalhou: false,
  }),
}));
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { MercadoPagoSection } from "@/components/admin/settings/MercadoPagoSection";

const LIGADO = {
  configurado: true,
  public_key: PUBLICA,
  mascara_token: "••••0000",
  mascara_webhook: "••••1111",
  ultimo_teste: {
    quando: "2026-11-24T10:00:00.000Z",
    conectado: true,
    mensagem: "Conectado",
    ambiente: "producao",
    conta: "Loja",
  },
  pix_ligado: true,
  public_key_na_loja: true,
  pausado: false,
  faltando: [],
};

let raiz: Root;
let hospedeiro: HTMLDivElement;
const onPixAlternado =
  vi.fn<(ligado: boolean, chaveNaLoja?: boolean) => void>();

const assentar = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

async function montar(gatilho = 1) {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(
      <MercadoPagoSection
        abrirChavesGatilho={gatilho}
        onPixAlternado={onPixAlternado}
      />,
    );
  });
  await assentar();
}

const botao = (rotulo: string) =>
  [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(rotulo),
  );
const estadoDoRecebimento = () =>
  document
    .querySelector("[data-estado-recebimento]")
    ?.getAttribute("data-estado-recebimento");

beforeEach(() => {
  vi.clearAllMocks();
  offlineFalso.valor = false;
  cenario.ler = LIGADO;
  cenario.lerErro = null;
  cenario.testar = { conectado: true, mensagem: "Conexão com a conta OK." };
  invokeFalso.mockImplementation(async (_nome: string, { body }: any) => {
    if (body?.acao === "ler") {
      return cenario.lerErro
        ? { data: null, error: cenario.lerErro }
        : { data: cenario.ler, error: null };
    }
    if (body?.acao === "testar") return { data: cenario.testar, error: null };
    return { data: null, error: null };
  });
});
afterEach(async () => {
  await act(async () => {
    raiz.unmount();
  });
  hospedeiro.remove();
});

describe("teste de conexão com a edge ANTIGA", () => {
  it("P1 resposta do teste sem `pix_ligado` não muda o estado nem avisa o painel com um 'desligado' inventado", async () => {
    await montar();
    expect(estadoDoRecebimento()).toBe("recebendo");
    expect(onPixAlternado).toHaveBeenCalledTimes(1); // só o eco do `ler`
    expect(onPixAlternado).toHaveBeenLastCalledWith(true, true);

    await act(async () => {
      botao("Testar conexão")?.click();
    });
    await assentar();
    expect(invokeFalso.mock.calls.map(([, o]) => o.body.acao)).toContain(
      "testar",
    );
    expect(estadoDoRecebimento()).toBe("recebendo");
    expect(onPixAlternado).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("Pronto. A mudança vale");
  });

  it("P1b com `pix_ligado` na resposta o teste ATUALIZA o estado e avisa o painel", async () => {
    cenario.ler = { ...LIGADO, pix_ligado: false, faltando: ["teste"] };
    cenario.testar = {
      conectado: true,
      mensagem: "Conexão com a conta OK.",
      pix_ligado: true,
      public_key_na_loja: true,
      faltando: [],
    };
    await montar();
    expect(estadoDoRecebimento()).toBe("faltando");

    await act(async () => {
      botao("Testar conexão")?.click();
    });
    await assentar();
    expect(estadoDoRecebimento()).toBe("recebendo");
    expect(onPixAlternado).toHaveBeenLastCalledWith(true, true);
  });
});

describe("estado inconsistente: ligado e pausado ao mesmo tempo", () => {
  it("P2 'ligado' na ficha vence 'pausado': mostra Pausar, não Retomar", async () => {
    cenario.ler = { ...LIGADO, pix_ligado: true, pausado: true };
    await montar();
    expect(estadoDoRecebimento()).toBe("recebendo");
    expect(botao("Pausar")).toBeDefined();
    expect(botao("Retomar")).toBeUndefined();
  });

  it("P2b pausado e desligado: mostra Retomar e a frase 'Pausado por você'", async () => {
    cenario.ler = { ...LIGADO, pix_ligado: false, pausado: true };
    await montar();
    expect(estadoDoRecebimento()).toBe("pausado");
    expect(botao("Retomar")).toBeDefined();
    expect(botao("Pausar")).toBeUndefined();
    expect(document.body.textContent).toContain("Pausado por você");
  });
});

describe("falha ao LER as chaves", () => {
  it("P3 a camada 'Suas chaves' não abre sozinha e o bloco do recebimento some", async () => {
    cenario.lerErro = {
      name: "FunctionsHttpError",
      message: "Edge Function returned a non-2xx status code",
      context: new Response("{}", { status: 500 }),
    };
    await montar(0);
    expect(document.body.textContent).toContain(
      "Não consegui ler as chaves salvas agora.",
    );
    const camada = [
      ...document.body.querySelectorAll("button[aria-expanded]"),
    ].find((b) => b.textContent?.includes("Suas chaves"));
    expect(camada?.getAttribute("aria-expanded")).toBe("false");
    expect(estadoDoRecebimento()).toBeUndefined();
  });

  it("P3b sem falha de leitura e com chave por testar, a camada abre sozinha (o conserto mora lá dentro)", async () => {
    cenario.ler = { ...LIGADO, pix_ligado: false, faltando: ["teste"] };
    await montar(0);
    const camada = [
      ...document.body.querySelectorAll("button[aria-expanded]"),
    ].find((b) => b.textContent?.includes("Suas chaves"));
    expect(camada?.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("'Testar conexão' travado", () => {
  it("P4 sem internet: travado (e o Salvar também)", async () => {
    offlineFalso.valor = true;
    await montar();
    expect(botao("Testar conexão")?.disabled).toBe(true);
    expect(botao("Salvar chaves")?.disabled).toBe(true);
  });

  it("P4b loja sem chave salva: travado mesmo com internet e nada digitado", async () => {
    cenario.ler = { configurado: false, faltando: [], pausado: false };
    await montar();
    expect(botao("Testar conexão")?.disabled).toBe(true);
  });

  it("P4c loja com chave, online, nada digitado: liberado", async () => {
    await montar();
    expect(botao("Testar conexão")?.disabled).toBe(false);
  });
});

describe("enquanto as chaves ainda estão sendo lidas", () => {
  it("P5 os três campos e o Salvar ficam travados até a leitura terminar", async () => {
    let terminarLeitura!: () => void;
    invokeFalso.mockImplementation(async (_nome: string, { body }: any) => {
      if (body?.acao === "ler") {
        await new Promise<void>((resolve) => {
          terminarLeitura = resolve;
        });
        return { data: LIGADO, error: null };
      }
      return { data: null, error: null };
    });
    await montar();
    const campos = ["mp-public-key", "mp-access-token", "mp-webhook-secret"];
    for (const id of campos) {
      expect((document.getElementById(id) as HTMLInputElement).disabled).toBe(
        true,
      );
    }
    expect(botao("Salvar chaves")?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Lendo as chaves salvas");

    await act(async () => {
      terminarLeitura();
    });
    await assentar();
    for (const id of campos) {
      expect((document.getElementById(id) as HTMLInputElement).disabled).toBe(
        false,
      );
    }
    expect(botao("Salvar chaves")?.disabled).toBe(false);
  });
});

describe("aviso de chave pública que a ficha da loja ainda não carrega", () => {
  const AVISO = "A ficha da loja ainda não carrega esta chave pública";

  it("P6 ligado e sem a chave publicada: o aviso aparece", async () => {
    cenario.ler = { ...LIGADO, pix_ligado: true, public_key_na_loja: false };
    await montar();
    expect(document.body.textContent).toContain(AVISO);
  });

  it("P6b desligado (ou pausado) e sem a chave publicada: NENHUM alarme; ligado e publicada: também nenhum", async () => {
    cenario.ler = { ...LIGADO, pix_ligado: false, public_key_na_loja: false };
    await montar();
    expect(document.body.textContent).not.toContain(AVISO);
    act(() => raiz.unmount());
    hospedeiro.remove();

    cenario.ler = { ...LIGADO, pix_ligado: true, public_key_na_loja: true };
    await montar();
    expect(document.body.textContent).not.toContain(AVISO);
  });
});

describe("aviso de pausar com transportadora", () => {
  it("P7 aberto pelo clique em Pausar; se a loja deixa de ter transportadora, o aviso some sem pausar nada", async () => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<MercadoPagoSection transportadoraVende />);
    });
    await assentar();
    await act(async () => {
      botao("Pausar")?.click();
    });
    expect(document.body.textContent).toContain("Pausar mesmo assim");
    expect(
      invokeFalso.mock.calls.filter(([, o]) => o.body.acao === "desligar_pix"),
    ).toHaveLength(0);

    await act(async () => {
      raiz.render(<MercadoPagoSection transportadoraVende={false} />);
    });
    await assentar();
    expect(document.body.textContent).not.toContain("Pausar mesmo assim");
    expect(
      invokeFalso.mock.calls.filter(([, o]) => o.body.acao === "desligar_pix"),
    ).toHaveLength(0);
  });
});
