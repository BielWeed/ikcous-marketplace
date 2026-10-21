// @vitest-environment jsdom
//
// REDESENHO DA TELA DO CARTÃO (16/10/2026) — o que a pessoa vê e o que NUNCA
// pode acontecer com o que ela digitou. Renderiza o `PagamentoComCartao` de
// verdade com o SDK do Mercado Pago dublado em `globalThis` (mesmo andaime de
// pagamento-com-cartao.test.tsx: `act` puro, sem @testing-library).
//
// As regras de dinheiro seguem provadas nos testes antigos; aqui entram as
// decisões D4: o Brick NUNCA desmonta por erro (a pessoa não redigita nada),
// mensagem por categoria, "em análise" sem PIX, prazo do POST e do create().
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  PagamentoComCartao,
  TEMPO_LIMITE_CRIACAO_DO_BRICK_MS,
  TEMPO_LIMITE_ENVIO_DO_CARTAO_MS,
} from "@/components/checkout/PagamentoComCartao";
import { PagamentoOnline } from "@/components/checkout/PagamentoOnline";
import { carregarSdkMercadoPago } from "@/components/checkout/sdk-mercado-pago";
import type { ConfigDoCartao } from "@/lib/config-do-cartao";

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));

const { criarPagamento } = vi.hoisted(() => ({ criarPagamento: vi.fn() }));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento }),
}));

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SO_CREDITO: ConfigDoCartao = {
  credito: true,
  debito: false,
  parcelasMax: 6,
};
const SO_DEBITO: ConfigDoCartao = {
  credito: false,
  debito: true,
  parcelasMax: 6,
};

const FRASE_DADOS = "Confira os dados do cartão e tente de novo.";
const FRASE_LIMITE = "Saldo ou limite insuficiente neste cartão.";
const FRASE_AUTORIZACAO =
  "Seu banco pede autorização: ligue para ele e tente de novo.";
const FRASE_SEGURANCA =
  "Pagamento recusado por segurança. Tente outro cartão ou pague com PIX.";

const TITULO_DADOS = "Confira os dados do cartão";
const TITULO_LIMITE = "O cartão não tem limite para este valor";
const TITULO_AUTORIZACAO =
  "Seu banco precisa autorizar esta compra. Entre em contato com o banco e tente de novo, ou use outro cartão ou PIX.";
const TITULO_GERAL =
  "Não conseguimos concluir este pagamento. Nenhum valor foi cobrado";
const TITULO_CARGA = "Não foi possível carregar o formulário do cartão";

// O relógio de verdade, guardado ANTES de qualquer teste trocar o global por
// um falso: quem espera as microtarefas assentarem não pode ficar preso nele.
const setTimeoutReal = globalThis.setTimeout.bind(globalThis);
function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeoutReal(resolve, 0));
}

function dadosDoBrick(sobrepor: Record<string, unknown> = {}) {
  return {
    token: "tok-secreto-123",
    payment_method_id: "master",
    installments: 3,
    payer: {
      email: "cliente@exemplo.com",
      identification: { type: "CPF", number: "123.456.789-09" },
    },
    ...sobrepor,
  };
}

function instalarSdkFalso() {
  const unmounts: Array<ReturnType<typeof vi.fn>> = [];
  const create = vi.fn(async (_b: string, _c: string, _cfg: any) => {
    const unmount = vi.fn();
    unmounts.push(unmount);
    return { unmount };
  });
  // @ts-expect-error stub do SDK
  globalThis.MercadoPago = vi.fn(function MercadoPagoStub() {
    return { bricks: () => ({ create }) };
  });
  return { create, unmounts };
}

function ultimaConfig(create: ReturnType<typeof instalarSdkFalso>["create"]) {
  const chamada = create.mock.calls.at(-1);
  if (!chamada) throw new Error("O Brick não foi criado.");
  return chamada[2];
}

beforeAll(async () => {
  const promessa = carregarSdkMercadoPago();
  document
    .querySelector("script[data-mp-sdk]")
    ?.dispatchEvent(new Event("load"));
  await promessa;
});

beforeEach(() => {
  vi.stubEnv("VITE_MP_PUBLIC_KEY", "TEST-000000-0000-0000-0000-000000000000");
  criarPagamento.mockReset();
});

afterEach(() => {
  // @ts-expect-error limpando o global entre testes
  globalThis.MercadoPago = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("tela do cartão redesenhada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function render({
    config = SO_CREDITO,
    valor = 150,
    onErro = vi.fn(),
    onPagarComPix = vi.fn(),
    onCobrancaEmDuvida = undefined as undefined | ((p: unknown) => void),
    cobrancaIncerta = false,
  } = {}) {
    await act(async () => {
      raiz.render(
        <PagamentoComCartao
          orderId="ped-12345678"
          valor={valor}
          config={config}
          emailDoPagador="cliente@exemplo.com"
          onErro={onErro}
          onPagarComPix={onPagarComPix}
          onCobrancaEmDuvida={onCobrancaEmDuvida}
          cobrancaIncerta={cobrancaIncerta}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    return { onErro, onPagarComPix, onCobrancaEmDuvida };
  }

  async function ficarPronto(
    create: ReturnType<typeof instalarSdkFalso>["create"],
  ) {
    await act(async () => {
      ultimaConfig(create).callbacks.onReady();
    });
  }

  async function enviar(
    create: ReturnType<typeof instalarSdkFalso>["create"],
    dados = dadosDoBrick(),
  ) {
    await ficarPronto(create);
    let erro: unknown = null;
    await act(async () => {
      try {
        await ultimaConfig(create).callbacks.onSubmit(dados, {
          paymentTypeId: "credit_card",
        });
      } catch (e) {
        erro = e;
      }
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    return erro;
  }

  const botao = (texto: string) =>
    [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === texto,
    );
  const container = (create: ReturnType<typeof instalarSdkFalso>["create"]) =>
    document.getElementById(create.mock.calls[0][1] as string) as HTMLElement;

  function recusa(
    motivoRecusa: string,
    expiraEm = new Date(Date.now() + 20 * 60_000).toISOString(),
  ) {
    criarPagamento.mockResolvedValue({
      paymentId: null,
      statusPagamento: "recusado",
      expiraEm,
      motivoRecusa,
      podeTentarDeNovo: true,
    });
  }

  // ── A ESTRUTURA: uma moldura, título legível, total, juros, confiança ─────
  describe("o que a pessoa vê", () => {
    it("título legível, total em reais, pedido, juros e a faixa de confiança — nesta ordem", async () => {
      instalarSdkFalso();
      await render();

      const titulo = hospedeiro.querySelector("h2")!;
      expect(titulo.textContent).toBe("Pagamento com cartão");
      // Legível: nada de 12 px em caixa alta cinza.
      expect(titulo.className).not.toMatch(/\btext-xs\b|\buppercase\b/);

      const texto = hospedeiro.textContent ?? "";
      expect(texto).toContain("Total");
      expect(texto).toContain("R$ 150,00");
      expect(texto).toContain("Pedido #");
      expect(texto).toContain(
        "No parcelado, o cartão pode cobrar juros a partir de 2x. O valor de cada parcela e o total aparecem na escolha das parcelas.",
      );
      expect(texto).toContain(
        "Pagamento processado pelo Mercado Pago. A loja não vê nem guarda os dados do seu cartão.",
      );
      const ordem = [
        "Pagamento com cartão",
        "Total",
        "No parcelado",
        "Pagamento processado",
      ].map((parte) => texto.indexOf(parte));
      expect(ordem).toEqual([...ordem].sort((a, b) => a - b));
    });

    it("NUNCA escreve 'sem juros' por conta própria", async () => {
      instalarSdkFalso();
      await render();
      expect((hospedeiro.textContent ?? "").toLowerCase()).not.toContain(
        "sem juros",
      );
    });

    it("BORDA: só débito (sempre à vista) não fala de parcelas; valor desconhecido não mostra total", async () => {
      instalarSdkFalso();
      await render({ config: SO_DEBITO, valor: Number.NaN });
      const texto = hospedeiro.textContent ?? "";
      expect(texto).not.toContain("No parcelado");
      expect(texto).not.toContain("Total");
      expect(texto).toContain("Pagamento com cartão");
    });

    it("UMA moldura só: a tela não tem card dentro de card (uma única caixa com borda no formulário)", async () => {
      instalarSdkFalso();
      await render();
      const secao = hospedeiro.querySelector("section")!;
      expect(secao.className).toMatch(/\bborder\b/);
      // Nenhum descendente do formulário desenha outra borda arredondada.
      const emCaixaDentro = [...secao.querySelectorAll("*")].filter(
        (el) =>
          /\brounded-(2xl|3xl)\b/.test(el.getAttribute("class") ?? "") &&
          /\bborder\b/.test(el.getAttribute("class") ?? ""),
      );
      expect(emCaixaDentro).toEqual([]);
    });
  });

  // ── O BRICK: cores da loja, sem chave nova no contrato do SDK ─────────────
  describe("o Brick do Mercado Pago", () => {
    it("recebe só `customization.visual` a mais — initialization e paymentMethods do contrato ficam como estavam", async () => {
      const { create } = instalarSdkFalso();
      await render();
      const cfg = ultimaConfig(create);

      expect(Object.keys(cfg.initialization).sort()).toEqual([
        "amount",
        "payer",
      ]);
      expect(Object.keys(cfg.customization).sort()).toEqual([
        "paymentMethods",
        "visual",
      ]);
      expect(cfg.customization.paymentMethods).toEqual({
        minInstallments: 1,
        maxInstallments: 6,
        types: { included: ["credit_card"] },
      });
      expect(cfg.customization.visual.hideFormTitle).toBe(true);
      const v = cfg.customization.visual.style.customVariables;
      expect(v.fontSizeMedium).toBe("16px");
      expect(v.formPadding).toBe("0px");
    });

    it("usa a cor da loja que está no :root", async () => {
      document.documentElement.style.setProperty("--primary", "0 100% 50%");
      document.documentElement.style.setProperty(
        "--primary-foreground",
        "0 0% 98%",
      );
      try {
        const { create } = instalarSdkFalso();
        await render();
        const v =
          ultimaConfig(create).customization.visual.style.customVariables;
        expect(v.baseColor).toBe("#ff0000");
        expect(v.buttonTextColor).toBe("#fafafa");
      } finally {
        document.documentElement.removeAttribute("style");
      }
    });
  });

  // ── CARREGANDO: altura reservada, spinner dentro da região viva ───────────
  describe("carregando o formulário", () => {
    it("a altura do Brick fica RESERVADA enquanto carrega e é solta quando ele está pronto", async () => {
      const { create } = instalarSdkFalso();
      await render();
      const area = hospedeiro.querySelector(
        '[data-testid="area-do-formulario"]',
      )!;
      expect(area.className).toMatch(/\bmin-h-\[/);

      await ficarPronto(create);
      expect(area.className).not.toMatch(/\bmin-h-\[/);
    });

    it("o aviso de carga está DENTRO de uma região aria-live (antes ficava fora)", async () => {
      instalarSdkFalso();
      await render();
      const aviso = [...hospedeiro.querySelectorAll("*")].find(
        (el) =>
          el.children.length === 0 &&
          (el.textContent ?? "").includes("Carregando o formulário do cartão"),
      )!;
      expect(aviso.closest('[aria-live="polite"]')).not.toBeNull();
    });

    it("o spinner só gira quando a pessoa não pediu menos movimento", async () => {
      instalarSdkFalso();
      await render();
      const giros = [...hospedeiro.querySelectorAll("svg")].filter((s) =>
        /animate-spin/.test(s.getAttribute("class") ?? ""),
      );
      expect(giros.length).toBeGreaterThan(0);
      for (const g of giros) {
        expect(g.getAttribute("class")).toMatch(/motion-safe:animate-spin/);
        expect(g.getAttribute("class")).not.toMatch(/(^|\s)animate-spin/);
      }
    });
  });

  // ── REGRA CENTRAL: erro nunca desmonta o Brick, a pessoa não redigita ─────
  describe("NUNCA desmonta o Brick por erro", () => {
    const CASOS: Array<{
      nome: string;
      motivo: string;
      titulo: string;
      outroCartao: boolean;
    }> = [
      {
        nome: "dado errado",
        motivo: FRASE_DADOS,
        titulo: TITULO_DADOS,
        outroCartao: false,
      },
      {
        nome: "sem limite",
        motivo: FRASE_LIMITE,
        titulo: TITULO_LIMITE,
        outroCartao: true,
      },
      {
        nome: "banco pediu autorização",
        motivo: FRASE_AUTORIZACAO,
        titulo: TITULO_AUTORIZACAO,
        outroCartao: false,
      },
      {
        nome: "parcelamento indisponível",
        motivo: "Esse parcelamento não está disponível para este cartão.",
        titulo:
          "Este parcelamento não está disponível. Escolha menos parcelas ou use outro cartão.",
        outroCartao: true,
      },
      {
        nome: "cartão desabilitado",
        motivo: "Cartão desabilitado. Fale com o seu banco.",
        titulo:
          "Este cartão não aceita compras online; use outro cartão ou PIX",
        outroCartao: true,
      },
      {
        nome: "outra recusa (segurança)",
        motivo: FRASE_SEGURANCA,
        titulo: TITULO_GERAL,
        outroCartao: true,
      },
      {
        nome: "recusa que o servidor não sabe explicar",
        motivo: "texto novo qualquer",
        titulo: TITULO_GERAL,
        outroCartao: true,
      },
    ];

    for (const caso of CASOS) {
      it(`${caso.nome}: a mensagem da categoria aparece, o Brick segue montado e visível, o pai não é avisado`, async () => {
        const { create, unmounts } = instalarSdkFalso();
        recusa(caso.motivo);
        const { onErro } = await render();
        const erro = await enviar(create);

        expect(hospedeiro.textContent).toContain(caso.titulo);
        // O Brick NÃO foi desmontado, o contêiner está no ar e não escondido.
        expect(unmounts[0]).not.toHaveBeenCalled();
        expect(create).toHaveBeenCalledTimes(1);
        const area = container(create);
        expect(document.body.contains(area)).toBe(true);
        expect(area.hidden).toBe(false);
        // O pai (que trocaria a tela inteira) não é chamado.
        expect(onErro).not.toHaveBeenCalled();
        // O Brick recebe a recusa e sai do "processando".
        expect(erro).toBeInstanceOf(Error);
        // O botão "Tentar outro cartão" só onde trocar de cartão faz sentido.
        expect(botao("Tentar outro cartão") !== undefined).toBe(
          caso.outroCartao,
        );
        // Escape sempre à mão, e o cartão morreu: PIX com cartaoAindaVivo=false.
        expect(botao("Pagar com PIX")).toBeDefined();
      });
    }

    it.each([
      [
        "Cartão desabilitado. Fale com o seu banco.",
        "Este cartão não aceita compras online; use outro cartão ou PIX",
      ],
      [
        "Esse parcelamento não está disponível para este cartão.",
        "Este parcelamento não está disponível. Escolha menos parcelas ou use outro cartão.",
      ],
    ])(
      "categoria outra do servidor preserva a ação conhecida: %s",
      async (motivo, titulo) => {
        const { create } = instalarSdkFalso();
        criarPagamento.mockResolvedValue({
          paymentId: null,
          statusPagamento: "recusado",
          motivoRecusa: motivo,
          categoriaDaRecusa: "outra",
          podeTentarDeNovo: true,
        });
        await render();
        await enviar(create);
        expect(hospedeiro.textContent).toContain(titulo);
        expect(botao("Tentar outro cartão")).toBeDefined();
      },
    );

    it("o foco vai para o título do erro quando ele aparece", async () => {
      const { create } = instalarSdkFalso();
      recusa(FRASE_LIMITE);
      await render();
      await enviar(create);

      expect(document.activeElement?.textContent).toBe(TITULO_LIMITE);
    });

    it("a categoria que o servidor mandou vale mais que a frase genérica", async () => {
      const { create } = instalarSdkFalso();
      criarPagamento.mockResolvedValue({
        paymentId: null,
        statusPagamento: "recusado",
        expiraEm: new Date(Date.now() + 20 * 60_000).toISOString(),
        motivoRecusa: "Não foi possível concluir o pagamento.",
        categoriaDaRecusa: "sem_limite",
        podeTentarDeNovo: true,
      });
      await render();
      await enviar(create);

      expect(document.activeElement?.textContent).toBe(TITULO_LIMITE);
    });

    it("categoria desconhecida do servidor cai no mapa por frase", async () => {
      const { create } = instalarSdkFalso();
      criarPagamento.mockResolvedValue({
        paymentId: null,
        statusPagamento: "recusado",
        expiraEm: new Date(Date.now() + 20 * 60_000).toISOString(),
        motivoRecusa: FRASE_LIMITE,
        categoriaDaRecusa: "inventada",
        podeTentarDeNovo: true,
      });
      await render();
      await enviar(create);

      expect(document.activeElement?.textContent).toBe(TITULO_LIMITE);
    });

    it("o painel é anunciado: fica dentro da região aria-live que já existia", async () => {
      const { create } = instalarSdkFalso();
      recusa(FRASE_LIMITE);
      await render();
      await enviar(create);

      const titulo = [...hospedeiro.querySelectorAll("p")].find(
        (p) => p.textContent === TITULO_LIMITE,
      )!;
      expect(titulo.closest('[aria-live="polite"]')).not.toBeNull();
    });

    it("alvos de toque de 44 px e texto de 16 px nos botões do painel", async () => {
      const { create } = instalarSdkFalso();
      recusa(FRASE_LIMITE);
      await render();
      await enviar(create);

      for (const texto of ["Tentar outro cartão", "Pagar com PIX"]) {
        const classes = botao(texto)!.className;
        expect(classes, texto).toMatch(/\bmin-h-11\b/);
        expect(classes, texto).toMatch(/\btext-base\b/);
        expect(classes, texto).toMatch(/focus-visible:ring/);
      }
    });

    it("DADO LOCAL errado (documento fora de CPF/CNPJ): nada vai ao servidor, o Brick fica, e o pai não é avisado", async () => {
      const { create, unmounts } = instalarSdkFalso();
      const { onErro } = await render();
      await enviar(
        create,
        dadosDoBrick({
          payer: { identification: { type: "RG", number: "1" } },
        }),
      );

      expect(criarPagamento).not.toHaveBeenCalled();
      expect(hospedeiro.textContent).toContain(
        "Confira o CPF ou CNPJ do titular do cartão e tente de novo.",
      );
      expect(unmounts[0]).not.toHaveBeenCalled();
      expect(onErro).not.toHaveBeenCalled();
      expect(botao("Pagar com PIX")).toBeDefined();
    });

    it("segundo envio com erro: o painel velho sai e o novo ganha o foco de novo", async () => {
      const { create } = instalarSdkFalso();
      recusa(FRASE_DADOS);
      await render();
      await enviar(create);
      expect(document.activeElement?.textContent).toBe(TITULO_DADOS);

      recusa(FRASE_LIMITE);
      await enviar(create);
      expect(hospedeiro.textContent).not.toContain(TITULO_DADOS);
      expect(document.activeElement?.textContent).toBe(TITULO_LIMITE);
    });

    it("'Tentar outro cartão' é a única hora em que o formulário é refeito: limpa o painel e cria um Brick novo", async () => {
      const { create, unmounts } = instalarSdkFalso();
      recusa(FRASE_LIMITE);
      await render();
      await enviar(create);

      await act(async () => {
        botao("Tentar outro cartão")!.click();
      });
      await act(async () => {
        await esperarMicrotarefas();
      });
      expect(create).toHaveBeenCalledTimes(2);
      expect(unmounts[0]).toHaveBeenCalledTimes(1);
      expect(hospedeiro.textContent).not.toContain(TITULO_LIMITE);
    });

    it("'Pagar com PIX' depois de uma recusa avisa o pai com cartaoAindaVivo=false", async () => {
      const { create } = instalarSdkFalso();
      recusa(FRASE_AUTORIZACAO);
      const { onPagarComPix } = await render();
      await enviar(create);

      await act(async () => {
        botao("Pagar com PIX")!.click();
      });
      expect(onPagarComPix).toHaveBeenCalledWith(false);
    });
  });

  // ── PRIVACIDADE: texto cru do Mercado Pago e antifraude nunca aparecem ────
  describe("nada cru do Mercado Pago", () => {
    it("recusa por segurança não mostra 'segurança', 'antifraude' nem 'high_risk' — só a frase geral", async () => {
      const { create } = instalarSdkFalso();
      recusa(`${FRASE_SEGURANCA} cc_rejected_high_risk antifraude`);
      await render();
      await enviar(create);

      const texto = (hospedeiro.textContent ?? "").toLowerCase();
      expect(texto).toContain(TITULO_GERAL.toLowerCase());
      expect(texto).not.toContain("antifraude");
      expect(texto).not.toContain("high_risk");
      expect(texto).not.toContain("cc_rejected");
      expect(texto).not.toContain("por segurança");
    });

    it("nenhum dado do cartão vai ao console, nem no caminho do erro", async () => {
      const espioes = (["log", "info", "warn", "error", "debug"] as const).map(
        (n) => vi.spyOn(console, n).mockImplementation(() => {}),
      );
      const { create } = instalarSdkFalso();
      recusa(FRASE_LIMITE);
      await render();
      await enviar(create);
      const saida = espioes
        .flatMap((e) => e.mock.calls.flat())
        .map((a) => String(a))
        .join("\n");
      expect(saida).not.toContain("tok-secreto-123");
      expect(saida).not.toContain("123.456.789-09");
    });
  });

  // ── EM ANÁLISE: sem PIX nunca ─────────────────────────────────────────────
  describe("em análise pelo banco", () => {
    it("diz que o banco está analisando, manda não pagar de novo e NUNCA oferece PIX — nem depois de 3 minutos", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      const { create } = instalarSdkFalso();
      criarPagamento.mockResolvedValue({
        paymentId: "pay-1",
        statusPagamento: "aguardando",
        expiraEm: "x",
      });
      await render();
      await enviar(create);

      expect(hospedeiro.textContent).toContain(
        "Seu banco está analisando. Não pague de novo. Avisamos aqui e por notificação",
      );
      expect(botao("Pagar com PIX")).toBeUndefined();

      await act(async () => {
        vi.advanceTimersByTime(10 * 60_000);
      });
      expect(botao("Pagar com PIX")).toBeUndefined();
      // E nem "Tentar outro cartão": a cobrança pode estar viva.
      expect(botao("Tentar outro cartão")).toBeUndefined();
    });
  });

  // ── 3DS: o banco pediu uma confirmação ────────────────────────────────────
  describe("o banco pediu uma confirmação (3DS)", () => {
    it("título curto, iframe do banco com título e credentialless", async () => {
      const { create } = instalarSdkFalso();
      const url =
        "https://www.mercadopago.com.br/auth/card/validation/pages/remedies/abc";
      criarPagamento.mockResolvedValue({
        paymentId: "pay-1",
        statusPagamento: "aguardando",
        expiraEm: "x",
        desafio3ds: { url },
      });
      await render();
      await enviar(create);

      expect(hospedeiro.textContent).toContain(
        "Seu banco pediu uma confirmação",
      );
      const iframe = hospedeiro.querySelector("iframe")!;
      expect(iframe.getAttribute("title")).toBe("Autenticação do seu banco");
      expect(iframe.hasAttribute("credentialless")).toBe(true);
    });
  });

  // ── A6: limites de tempo ──────────────────────────────────────────────────
  describe("limite de tempo do create() do Brick", () => {
    it("create() que nunca volta: depois do prazo, 'Não foi possível carregar o formulário do cartão' com 'Tentar de novo' e 'Pagar com PIX' — sem avisar o pai", async () => {
      vi.useFakeTimers();
      const create = vi.fn(() => new Promise(() => {}));
      // @ts-expect-error stub do SDK
      globalThis.MercadoPago = function MercadoPagoStub() {
        return { bricks: () => ({ create }) };
      };
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { onErro } = await render();
      expect(hospedeiro.textContent).toContain(
        "Carregando o formulário do cartão",
      );
      expect(hospedeiro.textContent).not.toContain(TITULO_CARGA);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          TEMPO_LIMITE_CRIACAO_DO_BRICK_MS + 100,
        );
      });

      expect(hospedeiro.textContent).toContain(TITULO_CARGA);
      expect(hospedeiro.textContent).not.toContain(
        "Carregando o formulário do cartão",
      );
      expect(botao("Tentar de novo")).toBeDefined();
      expect(botao("Pagar com PIX")).toBeDefined();
      expect(onErro).not.toHaveBeenCalled();
      // Sem POST nenhum: nunca houve cobrança.
      expect(criarPagamento).not.toHaveBeenCalled();
    });

    it("'Tentar de novo' remonta o Brick de forma controlada: espera o create() abandonado, que é desmontado ao voltar", async () => {
      vi.useFakeTimers();
      const unmountTardio = vi.fn();
      let soltarPrimeiro!: (v: { unmount: () => void }) => void;
      const create = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              soltarPrimeiro = resolve as typeof soltarPrimeiro;
            }),
        )
        .mockImplementation(async () => ({ unmount: vi.fn() }));
      // @ts-expect-error stub do SDK
      globalThis.MercadoPago = function MercadoPagoStub() {
        return { bricks: () => ({ create }) };
      };
      vi.spyOn(console, "error").mockImplementation(() => {});
      await render();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          TEMPO_LIMITE_CRIACAO_DO_BRICK_MS + 100,
        );
      });
      expect(create).toHaveBeenCalledTimes(1);

      // A pessoa toca em "Tentar de novo" e, logo em seguida, o create()
      // abandonado volta: ele é desmontado ANTES de o novo ser criado.
      await act(async () => {
        botao("Tentar de novo")!.click();
      });
      expect(create).toHaveBeenCalledTimes(1);
      await act(async () => {
        soltarPrimeiro({ unmount: unmountTardio });
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(unmountTardio).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledTimes(2);
      expect(hospedeiro.textContent).not.toContain(TITULO_CARGA);
    });

    it("o Brick abandonado, se voltar e avisar que está pronto, NÃO desfaz o aviso de carga nem esconde a falha", async () => {
      vi.useFakeTimers();
      let config: any;
      const create = vi.fn((_b: string, _c: string, cfg: unknown) => {
        config = cfg;
        return new Promise(() => {});
      });
      // @ts-expect-error stub do SDK
      globalThis.MercadoPago = function MercadoPagoStub() {
        return { bricks: () => ({ create }) };
      };
      vi.spyOn(console, "error").mockImplementation(() => {});
      await render();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          TEMPO_LIMITE_CRIACAO_DO_BRICK_MS + 100,
        );
      });
      expect(hospedeiro.textContent).toContain(TITULO_CARGA);

      await act(async () => {
        config.callbacks.onReady();
        config.callbacks.onError({
          type: "critical",
          cause: "x",
          message: "y",
        });
      });
      expect(hospedeiro.textContent).toContain(TITULO_CARGA);
      expect(botao("Tentar de novo")).toBeDefined();
    });

    it("BORDA: se o create() abandonado nunca voltar, o novo cria depois de uma espera curta — a pessoa não fica presa", async () => {
      vi.useFakeTimers();
      const create = vi
        .fn()
        .mockImplementationOnce(() => new Promise(() => {}))
        .mockImplementation(async () => ({ unmount: vi.fn() }));
      // @ts-expect-error stub do SDK
      globalThis.MercadoPago = function MercadoPagoStub() {
        return { bricks: () => ({ create }) };
      };
      vi.spyOn(console, "error").mockImplementation(() => {});
      await render();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          TEMPO_LIMITE_CRIACAO_DO_BRICK_MS + 100,
        );
      });
      await act(async () => {
        botao("Tentar de novo")!.click();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(create).toHaveBeenCalledTimes(2);
    });

    it("com a cobrança do pedido incerta, a falha de carga NÃO oferece PIX (a guarda que a caixa do pai tinha)", async () => {
      vi.useFakeTimers();
      // @ts-expect-error stub do SDK
      globalThis.MercadoPago = function MercadoPagoStub() {
        return { bricks: () => ({ create: () => new Promise(() => {}) }) };
      };
      vi.spyOn(console, "error").mockImplementation(() => {});
      await render({ cobrancaIncerta: true });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          TEMPO_LIMITE_CRIACAO_DO_BRICK_MS + 100,
        );
      });
      expect(hospedeiro.textContent).toContain(TITULO_CARGA);
      expect(botao("Tentar de novo")).toBeDefined();
      expect(botao("Pagar com PIX")).toBeUndefined();
    });

    it("falha de carga SEM incerteza oferece PIX com cartaoAindaVivo=false (nenhum POST existiu)", async () => {
      vi.useFakeTimers();
      // @ts-expect-error stub do SDK
      globalThis.MercadoPago = function MercadoPagoStub() {
        return { bricks: () => ({ create: () => new Promise(() => {}) }) };
      };
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { onPagarComPix } = await render();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          TEMPO_LIMITE_CRIACAO_DO_BRICK_MS + 100,
        );
      });
      await act(async () => {
        botao("Pagar com PIX")!.click();
      });
      expect(onPagarComPix).toHaveBeenCalledWith(false);
    });
  });

  describe("limite de tempo do envio do cartão (POST)", () => {
    it("POST que nunca responde: vira COBRANÇA INCERTA (verificação), nunca 'nada foi cobrado', e nunca reenvia sozinho", async () => {
      const { create } = instalarSdkFalso();
      criarPagamento.mockImplementation(() => new Promise(() => {}));
      const onCobrancaEmDuvida = vi.fn();
      const { onErro } = await render({ onCobrancaEmDuvida });
      await ficarPronto(create);
      vi.useFakeTimers();

      let resultado: unknown = "pendente";
      await act(async () => {
        ultimaConfig(create)
          .callbacks.onSubmit(dadosDoBrick(), { paymentTypeId: "credit_card" })
          .then(
            () => {
              resultado = "resolvido";
            },
            (e: unknown) => {
              resultado = e;
            },
          );
        await vi.advanceTimersByTimeAsync(
          TEMPO_LIMITE_ENVIO_DO_CARTAO_MS - 1_000,
        );
      });
      // Ainda dentro do prazo: nada decidido.
      expect(resultado).toBe("pendente");
      expect(onCobrancaEmDuvida).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(onCobrancaEmDuvida).toHaveBeenCalledTimes(1);
      expect(onCobrancaEmDuvida).toHaveBeenCalledWith({
        verificacao: "indisponivel",
      });
      expect(resultado).toBeInstanceOf(Error);
      expect(onErro).not.toHaveBeenCalled();
      // A tela NÃO afirma que nada foi cobrado.
      expect(hospedeiro.textContent ?? "").not.toContain(
        "Nenhum valor foi cobrado",
      );

      // O tempo passa (minutos): UM único POST em toda a história.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 60_000);
      });
      expect(criarPagamento).toHaveBeenCalledTimes(1);
    });

    it("sem o callback da verificação (pai antigo): cai no onErro com o sinal 'cartaoEmAnalise' — nunca PIX", async () => {
      const { create } = instalarSdkFalso();
      criarPagamento.mockImplementation(() => new Promise(() => {}));
      const { onErro } = await render();
      await ficarPronto(create);
      vi.useFakeTimers();

      await act(async () => {
        ultimaConfig(create)
          .callbacks.onSubmit(dadosDoBrick(), { paymentTypeId: "credit_card" })
          .catch(() => {});
        await vi.advanceTimersByTimeAsync(
          TEMPO_LIMITE_ENVIO_DO_CARTAO_MS + 100,
        );
      });
      expect(onErro).toHaveBeenCalledTimes(1);
      expect(onErro.mock.calls[0][1]).toBe("recuperavel");
      expect(onErro.mock.calls[0][2]).toBe("cartaoEmAnalise");
    });

    it("POST que responde DENTRO do prazo segue o caminho de sempre (o prazo não muda a resposta boa)", async () => {
      const { create } = instalarSdkFalso();
      criarPagamento.mockResolvedValue({
        paymentId: "pay-1",
        statusPagamento: "pago",
        expiraEm: "x",
      });
      await render();
      await enviar(create);
      expect(hospedeiro.textContent).toContain(
        "Pagamento aprovado! Confirmando seu pedido…",
      );
    });
  });

  // ── O relógio da reserva, como o do PIX ───────────────────────────────────
  describe("prazo da reserva", () => {
    it("sem prazo conhecido (nenhuma resposta ainda), nenhuma linha de prazo é inventada", async () => {
      instalarSdkFalso();
      await render();
      expect(hospedeiro.textContent).not.toContain("Prazo informado");
    });

    it("depois de uma resposta com prazo legível, mostra 'Prazo informado: até HH:MM' (como o PIX)", async () => {
      const { create } = instalarSdkFalso();
      recusa(FRASE_LIMITE);
      await render();
      await enviar(create);
      expect(hospedeiro.textContent).toMatch(
        /Prazo informado: até \d{2}:\d{2}/,
      );
    });

    it("BORDA: prazo ilegível na resposta não vira horário", async () => {
      const { create } = instalarSdkFalso();
      criarPagamento.mockResolvedValue({
        paymentId: null,
        statusPagamento: "recusado",
        expiraEm: "x",
        motivoRecusa: FRASE_LIMITE,
        podeTentarDeNovo: true,
      });
      await render();
      await enviar(create);
      expect(hospedeiro.textContent).not.toContain("Prazo informado");
    });

    it("passado o horário previsto, avisa com prudência (nunca 'expirou'): o servidor é quem decide", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      vi.setSystemTime(new Date("2026-10-16T12:00:00.000Z"));
      const { create } = instalarSdkFalso();
      recusa(FRASE_LIMITE, "2026-10-16T12:30:00.000Z");
      await render();
      await enviar(create);
      expect(hospedeiro.textContent).toContain("Prazo informado: até");

      await act(async () => {
        vi.setSystemTime(new Date("2026-10-16T12:31:00.000Z"));
        vi.advanceTimersByTime(10_000);
      });
      expect(hospedeiro.textContent).toContain(
        "O horário previsto para pagar já passou.",
      );
      expect(hospedeiro.textContent).not.toContain("Prazo informado");
      expect((hospedeiro.textContent ?? "").toLowerCase()).not.toContain(
        "expirou",
      );
    });
  });

  // ── BORDAS do que o Brick faz sozinho ─────────────────────────────────────
  describe("erro do próprio Brick", () => {
    const critico = {
      type: "critical",
      cause: "fields_setup_failed",
      message: "x",
    };

    it("onError CRÍTICO depois de uma recusa NÃO troca a recusa pelo aviso de carga (a doc do Mercado Pago não fixa a ordem)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { create } = instalarSdkFalso();
      recusa(FRASE_LIMITE);
      await render();
      await enviar(create);
      expect(hospedeiro.textContent).toContain(TITULO_LIMITE);

      await act(async () => {
        ultimaConfig(create).callbacks.onError(critico);
      });
      expect(hospedeiro.textContent).toContain(TITULO_LIMITE);
      expect(hospedeiro.textContent).not.toContain(TITULO_CARGA);
      expect(container(create).hidden).toBe(false);
    });

    it("onError CRÍTICO sem aviso nenhum vira a falha de carga (e esconde o Brick quebrado, sem desmontá-lo)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { create, unmounts } = instalarSdkFalso();
      const { onErro } = await render();
      await act(async () => {
        ultimaConfig(create).callbacks.onError(critico);
      });
      expect(hospedeiro.textContent).toContain(TITULO_CARGA);
      expect(container(create).hidden).toBe(true);
      expect(unmounts[0]).not.toHaveBeenCalled();
      expect(onErro).not.toHaveBeenCalled();
    });

    it("onError NÃO crítico (campo incompleto) não mostra aviso nenhum", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { create } = instalarSdkFalso();
      await render();
      await act(async () => {
        ultimaConfig(create).callbacks.onError({
          type: "non_critical",
          cause: "incomplete_fields",
          message: "x",
        });
      });
      expect(hospedeiro.textContent).not.toContain(TITULO_CARGA);
      expect(botao("Tentar de novo")).toBeUndefined();
    });

    it("Brick que fica pronto DEPOIS do aviso de carga tira o aviso (o aviso deixou de ser verdade)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { create } = instalarSdkFalso();
      await render();
      await act(async () => {
        ultimaConfig(create).callbacks.onError(critico);
      });
      expect(hospedeiro.textContent).toContain(TITULO_CARGA);

      await act(async () => {
        ultimaConfig(create).callbacks.onReady();
      });
      expect(hospedeiro.textContent).not.toContain(TITULO_CARGA);
      expect(container(create).hidden).toBe(false);
    });
  });

  describe("o que o pai ainda precisa saber (dinheiro) continua subindo", () => {
    it("recusa TERMINAL (pedido sem nova tentativa) vai ao pai como terminal e não vira painel", async () => {
      const { create } = instalarSdkFalso();
      criarPagamento.mockResolvedValue({
        paymentId: null,
        statusPagamento: "recusado",
        expiraEm: "x",
        motivoRecusa: "Este pedido não aceita mais tentativas.",
        podeTentarDeNovo: false,
      });
      const { onErro } = await render();
      await enviar(create);
      expect(onErro).toHaveBeenCalledWith(
        "Este pedido não aceita mais tentativas.",
        "terminal",
      );
      expect(hospedeiro.textContent).not.toContain(TITULO_GERAL);
    });

    it("erro ambíguo (rede caiu DEPOIS de Pagar) vai ao pai com recuperável e SEM sinal de 'sem cobrança' — nunca vira painel que promete 'nada foi cobrado'", async () => {
      const { create } = instalarSdkFalso();
      criarPagamento.mockRejectedValue(
        new Error("Não foi possível gerar a cobrança."),
      );
      const { onErro } = await render();
      await enviar(create);
      expect(onErro).toHaveBeenCalledWith(
        "Não foi possível gerar a cobrança.",
        "recuperavel",
      );
      expect(hospedeiro.textContent).not.toContain("Nenhum valor foi cobrado");
      expect(botao("Pagar com PIX")).toBeUndefined();
    });

    it("503 'indisponivel' abre a verificação (onCobrancaEmDuvida), sem PIX", async () => {
      const { create } = instalarSdkFalso();
      criarPagamento.mockRejectedValue(
        Object.assign(new Error("Pagamento indisponível."), {
          verificacao: "indisponivel",
          terminal: false,
        }),
      );
      const onCobrancaEmDuvida = vi.fn();
      const { onErro } = await render({ onCobrancaEmDuvida });
      await enviar(create);
      expect(onCobrancaEmDuvida).toHaveBeenCalledWith({
        verificacao: "indisponivel",
      });
      expect(onErro).not.toHaveBeenCalled();
      expect(botao("Pagar com PIX")).toBeUndefined();
    });

    it("RESPOSTA TARDIA: o POST estourou o prazo, a verificação já abriu — se a resposta chegar depois, nada muda na tela nem se reenvia", async () => {
      const { create } = instalarSdkFalso();
      let responder!: (r: unknown) => void;
      criarPagamento.mockImplementation(
        () =>
          new Promise((resolve) => {
            responder = resolve;
          }),
      );
      const onCobrancaEmDuvida = vi.fn();
      await render({ onCobrancaEmDuvida });
      await ficarPronto(create);
      vi.useFakeTimers();
      await act(async () => {
        ultimaConfig(create)
          .callbacks.onSubmit(dadosDoBrick(), { paymentTypeId: "credit_card" })
          .catch(() => {});
        await vi.advanceTimersByTimeAsync(
          TEMPO_LIMITE_ENVIO_DO_CARTAO_MS + 100,
        );
      });
      expect(onCobrancaEmDuvida).toHaveBeenCalledTimes(1);

      await act(async () => {
        responder({
          paymentId: "pay-1",
          statusPagamento: "pago",
          expiraEm: "x",
        });
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(hospedeiro.textContent).not.toContain("Pagamento aprovado");
      expect(onCobrancaEmDuvida).toHaveBeenCalledTimes(1);
      expect(criarPagamento).toHaveBeenCalledTimes(1);
    });
  });
});

// ── Pela PagamentoOnline: a guarda da cobrança incerta chega à tela ─────────
describe("PagamentoOnline repassa a guarda da cobrança incerta à tela do cartão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  for (const incerta of [true, false]) {
    it(`falha de carga com cobrancaIncerta=${incerta}: ${incerta ? "sem" : "com"} 'Pagar com PIX'`, async () => {
      vi.useFakeTimers();
      // @ts-expect-error stub do SDK
      globalThis.MercadoPago = function MercadoPagoStub() {
        return { bricks: () => ({ create: () => new Promise(() => {}) }) };
      };
      vi.spyOn(console, "error").mockImplementation(() => {});
      await act(async () => {
        raiz.render(
          <PagamentoOnline
            orderId="ped-12345678"
            valor={150}
            metodo="cartao"
            configDoCartao={SO_CREDITO}
            cobrancaIncerta={incerta}
            onErro={vi.fn()}
          />,
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          TEMPO_LIMITE_CRIACAO_DO_BRICK_MS + 100,
        );
      });
      const botoes = [...hospedeiro.querySelectorAll("button")].map(
        (b) => b.textContent,
      );
      expect(hospedeiro.textContent).toContain(TITULO_CARGA);
      expect(botoes).toContain("Tentar de novo");
      expect(botoes.includes("Pagar com PIX")).toBe(!incerta);
    });
  }
});
