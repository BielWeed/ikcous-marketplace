// @vitest-environment jsdom
//
// A tela de Frete avisa o lojista quando a transportadora está ligada e o
// pagamento pelo app não (14/10/2026).
//
// O defeito medido: a transportadora cota "PAC R$ X" para o cliente de outra
// cidade, ele preenche nome, endereço e CPF, e só no ÚLTIMO passo do checkout
// lê "Esta loja não recebe pagamento pelo app, então o envio por
// transportadora não está disponível". O checkout e o banco estão certos (nenhum
// pedido nasce errado) — mas o LOJISTA nunca soube, e perdia em silêncio toda
// venda para fora da cidade. Esta suíte prende o que o painel passou a dizer.
//
// As portas fechadas (cada uma é um falso alarme que o lojista pagante não
// perdoa):
//   F1  com a combinação: o aviso aparece, com as palavras do lojista;
//   F2  pagamento pelo app LIGADO: sem aviso;
//   F3  sem transportadora ligada: sem aviso (quem só entrega na cidade);
//   F4  loja que atende SÓ a cidade: sem aviso (a transportadora nem é oferecida);
//   F5  leitura das transportadoras falhou: não chuta;
//   F6  transportadora ligada mas INCOMPLETA (SuperFrete sem e-mail): não vende;
//   F7  antes da leitura chegar não pisca aviso;
//   F8  ESTADO DESATUALIZADO: o retrato do boot diz "ligado" mas o lojista
//       pausou em Ajustes — o painel segue o eco do servidor, nos dois sentidos.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cenario, mockConfig } = vi.hoisted(() => ({
  cenario: {
    bootPagamentoLigado: false,
    ligados: ["melhor_envio"] as string[],
    provedores: {
      melhor_envio: { tem_chave: true, sandbox: false, servicos: null },
      superfrete: { tem_chave: false, sandbox: false, servicos: null },
      frenet: { tem_chave: false, sandbox: false, servicos: null },
    } as Record<string, Record<string, unknown>>,
    leituraFalha: false,
    segurarLeitura: null as Promise<void> | null,
  },
  mockConfig: {
    freeShippingMin: 0,
    shippingCoverage: "national" as "local" | "national",
    shippingProvider: "melhor_envio",
    originCep: "38500-000",
    storeAddress: "Rua A, 10",
    localDeliveryEnabled: true,
    enabledShippingMethods: ["sedex", "pac"] as string[],
    localDeliveryFee: 10,
    localCepRange: "",
    nationalShippingStrategy: "desligado",
    nationalShippingMin: 0,
    nationalDiscountType: null,
    nationalDiscountValue: 0,
    nationalBenefitScope: "mais_barata",
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/flags", async (importarOriginal) => ({
  ...(await importarOriginal<typeof import("@/lib/flags")>()),
  pagamentoOnlineLigado: () => cenario.bootPagamentoLigado,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => {
        const consulta = (): any =>
          Object.assign(Promise.resolve({ data: [], error: null }), {
            not: () => consulta(),
            neq: () => consulta(),
          });
        return consulta();
      },
    }),
    functions: {
      invoke: async (_nome: string, opcoes: any) => {
        if (opcoes?.body?.action === "ler_configuracao_frete") {
          if (cenario.segurarLeitura) await cenario.segurarLeitura;
          if (cenario.leituraFalha) {
            return { data: null, error: { message: "network error" } };
          }
          return {
            data: {
              success: true,
              modo: "multi",
              ligados: cenario.ligados,
              provedores: cenario.provedores,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import {
  esquecerEcoDoPagamentoPeloApp,
  publicarPagamentoPeloApp,
} from "@/lib/pagamento-pelo-app-no-painel";

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AdminShippingView — avisa quando a transportadora fica sem pagamento pelo app", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    esquecerEcoDoPagamentoPeloApp();
    cenario.bootPagamentoLigado = false;
    cenario.ligados = ["melhor_envio"];
    cenario.provedores = {
      melhor_envio: { tem_chave: true, sandbox: false, servicos: null },
      superfrete: { tem_chave: false, sandbox: false, servicos: null },
      frenet: { tem_chave: false, sandbox: false, servicos: null },
    };
    cenario.leituraFalha = false;
    cenario.segurarLeitura = null;
    mockConfig.shippingCoverage = "national";
    mockConfig.localDeliveryEnabled = true;
    mockConfig.enabledShippingMethods = ["sedex", "pac"];
    mockConfig.freeShippingMin = 0;
    mockConfig.nationalShippingStrategy = "desligado";
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    esquecerEcoDoPagamentoPeloApp();
    vi.restoreAllMocks();
  });

  async function assentar() {
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  async function abrirTela(ativa = true) {
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(
        <AdminShippingView
          active={ativa}
          onSetDirty={vi.fn()}
          onNavigate={onNavigate}
        />,
      );
    });
    await assentar();
  }

  const aviso = () =>
    hospedeiro.querySelector<HTMLElement>(
      "[data-aviso-transportadora-sem-pagamento]",
    );

  it("F1 — transportadora ligada + pagamento pelo app desligado: o aviso aparece, em português de lojista", async () => {
    await abrirTela();

    expect(aviso()).not.toBeNull();
    expect(aviso()?.textContent).toContain(
      "Transportadora só funciona com pagamento pelo app ligado.",
    );
    expect(aviso()?.textContent).toContain(
      "Hoje seus clientes de fora da sua região não conseguem finalizar a compra.",
    );
  });

  it("F1b — o aviso abre Ajustes direto em Pagamentos", async () => {
    await abrirTela();
    const botao = [...(aviso()?.querySelectorAll("button") ?? [])].find((b) =>
      /pagamento pelo app/i.test(b.textContent ?? ""),
    );
    expect(botao).toBeDefined();
    await act(async () => {
      botao?.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("admin-settings", "pagamentos");
  });

  it("F2 — pagamento pelo app LIGADO: nenhum aviso", async () => {
    cenario.bootPagamentoLigado = true;
    await abrirTela();
    expect(aviso()).toBeNull();
  });

  it("F3 — sem transportadora ligada (só entrega na cidade): nenhum aviso", async () => {
    cenario.ligados = [];
    await abrirTela();
    expect(aviso()).toBeNull();
  });

  const textoDaPromocao =
    "O frete grátis por produto pode aparecer fora da sua região, mas a cliente não consegue finalizar sem pagamento pelo app.";
  const textoDaTela = () => hospedeiro.textContent ?? "";

  it.each([false, true])(
    "entrega local com retirada ligada=%s: a promoção nacional exige pagamento pelo app",
    async (retirada) => {
      if (retirada) mockConfig.enabledShippingMethods.push("store-pickup");
      mockConfig.nationalShippingStrategy = "por_produto";
      cenario.ligados = [];
      await abrirTela();

      expect(textoDaTela()).toContain(textoDaPromocao);
      expect(textoDaTela()).toContain(
        "Ative o pagamento pelo app ou desative a promoção nacional.",
      );
      expect(textoDaTela()).not.toContain(
        "Ninguém de fora da sua região compra",
      );
      expect(textoDaTela()).not.toContain(
        "Nenhuma transportadora ligada: quem é de fora não compra",
      );
      expect(
        hospedeiro.querySelector('[aria-label="Como fica para o cliente"]')
          ?.textContent,
      ).toContain("Não finaliza pelo app");
      expect(aviso()).toBeNull();
    },
  );

  it("a promoção nacional leva direto à seção Pagamentos", async () => {
    mockConfig.nationalShippingStrategy = "por_produto";
    cenario.ligados = [];
    await abrirTela();

    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === "Ver pagamento pelo app",
    );
    expect(botao).toBeDefined();
    await act(async () => botao?.click());
    expect(onNavigate).toHaveBeenCalledWith("admin-settings", "pagamentos");
  });

  it("a promoção nacional explica e abre a configuração de transportadoras", async () => {
    mockConfig.nationalShippingStrategy = "por_produto";
    cenario.ligados = [];
    await abrirTela();

    const painel = hospedeiro.querySelector("#painel-frete-nacional");
    const controle = painel?.querySelector("button[aria-expanded]");
    expect(controle?.getAttribute("aria-expanded")).toBe("false");
    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === "Configurar transportadoras",
    );
    expect(botao).toBeDefined();
    const rolar = vi.fn();
    Object.defineProperty(painel as HTMLElement, "scrollIntoView", {
      value: rolar,
    });
    await act(async () => botao?.click());
    await assentar();

    expect(controle?.getAttribute("aria-expanded")).toBe("true");
    expect(rolar).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(textoDaTela()).toContain(
      "Para entregar fora da sua região pedidos sem nenhum produto com frete grátis, ligue também uma transportadora.",
    );
  });

  it("só retirada com promoção nacional: quem é de fora pode buscar na loja", async () => {
    mockConfig.localDeliveryEnabled = false;
    mockConfig.enabledShippingMethods.push("store-pickup");
    mockConfig.nationalShippingStrategy = "por_produto";
    cenario.ligados = [];
    await abrirTela();

    expect(textoDaTela()).not.toContain(textoDaPromocao);
    expect(textoDaTela()).not.toContain("não finaliza sem pagamento pelo app");
    expect(textoDaTela()).not.toContain("quem é de fora não compra");
    expect(textoDaTela()).not.toContain("Falta 1 coisa");
    expect(textoDaTela()).toContain("Pronta para vender");
    expect(
      hospedeiro.querySelector('[aria-label="Como fica para o cliente"]')
        ?.textContent,
    ).toContain("Só retirada · Grátis");
  });

  it.each([
    "sem promoção",
    "só promoção local",
    "pagamento pelo app ligado",
    "cobertura local",
    "leitura falhou",
  ])("sem o novo aviso: %s", async (caso) => {
    cenario.ligados = [];
    mockConfig.nationalShippingStrategy =
      caso === "sem promoção" || caso === "só promoção local"
        ? "desligado"
        : "por_produto";
    mockConfig.freeShippingMin = caso === "só promoção local" ? -1 : 0;
    cenario.bootPagamentoLigado = caso === "pagamento pelo app ligado";
    if (caso === "cobertura local") mockConfig.shippingCoverage = "local";
    cenario.leituraFalha = caso === "leitura falhou";

    await abrirTela();

    expect(textoDaTela()).not.toContain(textoDaPromocao);
  });

  it("a promoção não dispara o aviso enquanto a leitura está pendente", async () => {
    let soltar: () => void = () => {};
    cenario.ligados = [];
    mockConfig.nationalShippingStrategy = "por_produto";
    cenario.segurarLeitura = new Promise<void>((resolve) => {
      soltar = resolve;
    });

    await abrirTela();
    expect(textoDaTela()).not.toContain(textoDaPromocao);

    await act(async () => {
      soltar();
    });
    await assentar();
    expect(textoDaTela()).toContain(textoDaPromocao);

    cenario.segurarLeitura = new Promise<void>((resolve) => {
      soltar = resolve;
    });
    await abrirTela(false);
    await abrirTela();
    expect(textoDaTela()).not.toContain(textoDaPromocao);

    await act(async () => {
      soltar();
    });
    await assentar();
    expect(textoDaTela()).toContain(textoDaPromocao);
  });

  it("F4 — loja que atende SÓ a cidade: nenhum aviso", async () => {
    mockConfig.shippingCoverage = "local";
    await abrirTela();
    expect(aviso()).toBeNull();
  });

  it("F5 — leitura das transportadoras falhou: não chuta, nenhum aviso", async () => {
    cenario.leituraFalha = true;
    await abrirTela();
    expect(aviso()).toBeNull();
  });

  it("F5b — leitura BOA e depois uma releitura que FALHA: o aviso some (a lista velha não vale mais) e volta quando a leitura volta", async () => {
    // Este é o caso real da guarda `credsErro ? null : nomesLigados`: numa
    // releitura que falha, a tela NÃO apaga a lista de ligadas que já tinha
    // (só marca `credsErro`) — sem a guarda, o aviso seguiria de pé apoiado
    // em dado que a própria tela diz não conseguir confirmar.
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    const renderizar = (ativa: boolean) =>
      act(async () => {
        raiz.render(
          <AdminShippingView
            active={ativa}
            onSetDirty={vi.fn()}
            onNavigate={onNavigate}
          />,
        );
      });
    await renderizar(true);
    await assentar();
    expect(aviso()).not.toBeNull();

    // A tela sai de cena e volta (a aba de Frete fica montada): é uma
    // releitura, e agora o servidor não responde.
    cenario.leituraFalha = true;
    await renderizar(false);
    await renderizar(true);
    await assentar();
    expect(aviso()).toBeNull();

    // O servidor volta: a releitura boa traz o aviso de volta.
    cenario.leituraFalha = false;
    await renderizar(false);
    await renderizar(true);
    await assentar();
    expect(aviso()).not.toBeNull();
  });

  it("F6 — SuperFrete ligada mas sem e-mail de contato (incompleta): não vende, nenhum aviso", async () => {
    cenario.ligados = ["superfrete"];
    cenario.provedores = {
      melhor_envio: { tem_chave: false, sandbox: false, servicos: null },
      superfrete: { tem_chave: true, sandbox: false, servicos: null },
      frenet: { tem_chave: false, sandbox: false, servicos: null },
    };
    await abrirTela();
    expect(aviso()).toBeNull();
  });

  it("F7 — enquanto a leitura não chega, o aviso não pisca", async () => {
    let soltar: () => void = () => {};
    cenario.segurarLeitura = new Promise<void>((resolve) => {
      soltar = resolve;
    });
    await abrirTela();
    expect(aviso()).toBeNull();

    await act(async () => {
      soltar();
    });
    await assentar();
    expect(aviso()).not.toBeNull();
  });

  it("F8 — ESTADO DESATUALIZADO: o boot diz 'ligado', o lojista pausou em Ajustes — o aviso aparece sem recarregar", async () => {
    cenario.bootPagamentoLigado = true;
    await abrirTela();
    expect(aviso()).toBeNull();

    // O eco que a seção Mercado Pago manda (Pausar → servidor devolve desligado).
    await act(async () => {
      publicarPagamentoPeloApp(false);
    });
    expect(aviso()).not.toBeNull();
  });

  it("F8b — o boot diz 'desligado', o lojista religou em Ajustes — o aviso SOME (nada de alarme falso)", async () => {
    cenario.bootPagamentoLigado = false;
    await abrirTela();
    expect(aviso()).not.toBeNull();

    await act(async () => {
      publicarPagamentoPeloApp(true);
    });
    expect(aviso()).toBeNull();
  });

  it("F8c — a tela abre DEPOIS do eco: nasce com o estado do eco, não com o do boot", async () => {
    cenario.bootPagamentoLigado = true;
    publicarPagamentoPeloApp(false);
    await abrirTela();
    expect(aviso()).not.toBeNull();
  });
});
