// @vitest-environment jsdom
//
// "Sua loja está pronta para vender?" (Início) — o passo "Como você entrega"
// NÃO fica pronto enquanto o alcance da entrega local é curto demais para a
// cidade da lojista (15/10/2026).
//
// O defeito medido por leitura: a lojista digitava um CEP de rua de verdade
// (cidade com vários prefixos de CEP), o cartão mostrava "6 de 6" e sumia. Mas
// com o "Alcance por CEP" vazio a entrega local só vale para quem tem os mesmos
// 5 primeiros números do CEP da loja (um pedaço de bairro): a cliente de outro
// bairro, sem conta, via "Entrega fora da cidade é só com conta" e ia embora.
//
// A regra do passo é a MESMA função que gera o aviso amarelo da tela de Frete
// (`avisoDaFaixaDeCep`): cartão, Ajustes e Frete nunca divergem. Aqui NÃO se
// toca na regra do servidor (`is_local_cep`/`cepEhLocal`), nem no aviso.
import { act } from "react";

import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LojaProntaEEstoqueBaixo } from "@/components/admin/dashboard/LojaProntaEEstoqueBaixo";
import { subtitulosDosGrupos } from "@/components/admin/settings/grupos-de-ajustes";
import { FreteLocalBloco } from "@/components/admin/shipping/FreteLocalBloco";
import { montarEnderecoDaLoja } from "@/lib/endereco-da-loja";
import {
  type ConfigDosSeisPassos,
  avisoDaFaixaDeCep,
  entradaDosSeisPassos,
  estadoDaEntrega,
  seisPassosDaLojaPronta,
} from "@/lib/loja-pronta";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// CEP de RUA de uma cidade com vários prefixos (Belo Horizonte: 30110 a 31999).
const CEP_DE_RUA = "30130-010";
// Alcance que cobre a cidade, no formato que o servidor entende (dois CEPs
// completos separados por vírgula).
const ALCANCE_DA_CIDADE = "30000-000, 31999-999";
// CEP geral de cidade pequena (Monte Carmelo): um CEP só, termina em "000".
const CEP_GERAL_DE_CIDADE = "38500-000";

describe("estadoDaEntrega: o alcance entra na conta", () => {
  it("CEP de rua + alcance vazio -> pendente (cliente de outro bairro ficaria de fora)", () => {
    for (const localCepRange of ["", "   ", null, undefined]) {
      expect(
        estadoDaEntrega({ originCep: CEP_DE_RUA, localCepRange }, false),
        `alcance ${JSON.stringify(localCepRange)}`,
      ).toBe("pendente");
    }
    // Sem a propriedade nenhuma (config que ainda não trouxe o campo).
    expect(estadoDaEntrega({ originCep: CEP_DE_RUA }, false)).toBe("pendente");
  });

  it("mesmo CEP de rua + alcance que cobre a cidade -> feito", () => {
    expect(
      estadoDaEntrega(
        { originCep: CEP_DE_RUA, localCepRange: ALCANCE_DA_CIDADE },
        false,
      ),
    ).toBe("feito");
    // Bloco longo (início-fim) também é formato que o servidor entende.
    expect(
      estadoDaEntrega(
        { originCep: CEP_DE_RUA, localCepRange: "30000000-31999999" },
        false,
      ),
    ).toBe("feito");
  });

  it("CEP geral de cidade pequena (termina em 000) + alcance vazio -> feito: o aviso já é calado de propósito, o cartão continua pronto", () => {
    for (const originCep of [CEP_GERAL_DE_CIDADE, "38500000"]) {
      expect(estadoDaEntrega({ originCep, localCepRange: "" }, false)).toBe(
        "feito",
      );
    }
    expect(estadoDaEntrega({ originCep: CEP_GERAL_DE_CIDADE }, false)).toBe(
      "feito",
    );
  });

  it("alcance escrito num formato que o servidor não entende (nem o CEP da loja entra) -> pendente, como o aviso da tela de Frete", () => {
    expect(
      estadoDaEntrega(
        { originCep: CEP_DE_RUA, localCepRange: "30000-000 a 31999-999" },
        false,
      ),
    ).toBe("pendente");
  });

  it("sem CEP completo continua pendente, com ou sem alcance; carregando continua carregando", () => {
    expect(estadoDaEntrega({ originCep: "", localCepRange: "" }, false)).toBe(
      "pendente",
    );
    expect(
      estadoDaEntrega(
        { originCep: "3013", localCepRange: ALCANCE_DA_CIDADE },
        false,
      ),
    ).toBe("pendente");
    expect(
      estadoDaEntrega({ originCep: CEP_DE_RUA, localCepRange: "" }, true),
    ).toBe("carregando");
  });

  it("é a MESMA função do aviso da tela de Frete: o passo só está feito quando avisoDaFaixaDeCep devolve null", () => {
    const configs = [
      { originCep: CEP_DE_RUA, localCepRange: "" },
      { originCep: CEP_DE_RUA, localCepRange: ALCANCE_DA_CIDADE },
      { originCep: CEP_DE_RUA, localCepRange: "30000-000 a 31999-999" },
      { originCep: CEP_GERAL_DE_CIDADE, localCepRange: "" },
      { originCep: CEP_GERAL_DE_CIDADE, localCepRange: "38500-000, 38509-999" },
      { originCep: "01310100", localCepRange: undefined },
      { originCep: "01310100", localCepRange: "01310-000, 01310-999" },
    ];
    for (const config of configs) {
      expect(estadoDaEntrega(config, false), JSON.stringify(config)).toBe(
        avisoDaFaixaDeCep(config) === null ? "feito" : "pendente",
      );
    }
  });
});

describe("o passo 'Como você entrega' diz o motivo com palavras de lojista", () => {
  function passoDeEntrega(config: ConfigDosSeisPassos) {
    const passos = seisPassosDaLojaPronta(
      entradaDosSeisPassos(config, {
        pixOk: true,
        formasNaEntrega: [],
        produtos: [{ isActive: true }],
        configCarregando: false,
        produtosCarregando: false,
        entrega: estadoDaEntrega(config, false),
      }),
    );
    const passo = passos.find((p) => p.chave === "entrega");
    if (!passo) throw new Error("passo entrega não existe");
    return passo;
  }

  it("alcance curto: pede para ampliar o alcance e explica que clientes de outros bairros podem não conseguir comprar; leva ao Frete", () => {
    const passo = passoDeEntrega({ originCep: CEP_DE_RUA, localCepRange: "" });
    expect(passo.estado).toBe("pendente");
    expect(passo.rotuloPendente).toBe("Ampliar o alcance da entrega");
    expect(passo.explicacaoPendente).toMatch(/outros bairros/i);
    expect(passo.explicacaoPendente).toMatch(/n[ãa]o conseguir comprar/i);
    expect(passo.destino).toBe("admin-shipping");
  });

  it("sem CEP: o texto antigo, sem explicação de alcance", () => {
    const passo = passoDeEntrega({ originCep: "", localCepRange: "" });
    expect(passo.estado).toBe("pendente");
    expect(passo.rotuloPendente).toBe("Configurar a entrega");
    expect(passo.explicacaoPendente).toBeUndefined();
  });

  it("entrega pronta: nenhuma explicação", () => {
    const passo = passoDeEntrega({
      originCep: CEP_DE_RUA,
      localCepRange: ALCANCE_DA_CIDADE,
    });
    expect(passo.estado).toBe("feito");
    expect(passo.explicacaoPendente).toBeUndefined();
  });
});

describe("o cartão do Início", () => {
  type Props = React.ComponentProps<typeof LojaProntaEEstoqueBaixo>;

  const ENDERECO = montarEnderecoDaLoja({
    cep: "30130010",
    rua: "Rua de Teste",
    numero: "100",
    complemento: "",
    bairro: "Centro",
    cidade: "Belo Horizonte",
    uf: "MG",
  });

  /** Loja com os outros cinco passos prontos: só a entrega está em jogo. */
  function config(parcial: Partial<ConfigDosSeisPassos> = {}) {
    return {
      storeName: "Ateliê da Serra",
      logoUrl: "https://exemplo.test/logo.png",
      originCep: ENDERECO.originCep,
      storeAddress: ENDERECO.storeAddress,
      whatsappNumber: "(31) 99999-9999",
      localCepRange: "",
      ...parcial,
    } satisfies ConfigDosSeisPassos;
  }

  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montar(parcial: Partial<Props> = {}) {
    await act(async () => {
      raiz.render(
        <LojaProntaEEstoqueBaixo
          stats={{ inventoryAlerts: 0 }}
          config={config()}
          ligado={true}
          chaveOk={true}
          formasNaEntrega={[]}
          produtos={[{ isActive: true }]}
          configCarregando={false}
          produtosCarregando={false}
          onNavigate={vi.fn()}
          onTentarDeNovo={vi.fn()}
          {...parcial}
        />,
      );
    });
  }

  function botaoComTexto(trecho: string) {
    return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(trecho),
    );
  }

  it("CEP de rua + alcance vazio: '5 de 6 prontos', sem 'Loja pronta para vender', e o 'Próximo passo' leva ao Frete", async () => {
    const onNavigate = vi.fn();
    await montar({ onNavigate });

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("5 de 6 prontos");
    expect(texto).not.toContain("Loja pronta para vender");
    expect(texto).toMatch(/outros bairros/i);

    const proximo = botaoComTexto(
      "Próximo passo: Ampliar o alcance da entrega",
    );
    expect(proximo).toBeTruthy();
    await act(async () => {
      proximo!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onNavigate).toHaveBeenCalledWith("admin-shipping");
  });

  it("mesmo CEP + alcance que cobre a cidade: 'Loja pronta para vender', sem aviso", async () => {
    await montar({ config: config({ localCepRange: ALCANCE_DA_CIDADE }) });
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Loja pronta para vender");
    expect(texto).not.toContain("de 6 prontos");
    expect(texto).not.toMatch(/outros bairros/i);
    expect(texto).not.toContain("só vale para CEPs que começam com");
  });

  it("CEP geral da cidade (000) + alcance vazio: comportamento de antes, 'Loja pronta para vender'", async () => {
    const cep = montarEnderecoDaLoja({
      cep: "38500000",
      rua: "Rua de Teste",
      numero: "100",
      complemento: "",
      bairro: "Centro",
      cidade: "Monte Carmelo",
      uf: "MG",
    });
    await montar({
      config: config({
        originCep: cep.originCep,
        storeAddress: cep.storeAddress,
        localCepRange: "",
      }),
    });
    expect(hospedeiro.textContent).toContain("Loja pronta para vender");
  });

  it("config ainda carregando: 'Conferindo', nunca 'pendente' por alcance", async () => {
    await montar({ configCarregando: true });
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toMatch(/conferindo/i);
    expect(texto).not.toContain("Próximo passo");
    expect(texto).not.toMatch(/outros bairros/i);
  });

  it("cartão e tela de Frete mostram o MESMO aviso (a mesma função)", async () => {
    const cfg = config();
    const aviso = avisoDaFaixaDeCep(cfg);
    expect(aviso).not.toBeNull();

    await montar({ config: cfg });
    expect(hospedeiro.textContent).toContain(aviso as string);

    // A tela de Frete, desenhada com o mesmo CEP e o mesmo alcance.
    const hospedeiroDoFrete = document.createElement("div");
    document.body.appendChild(hospedeiroDoFrete);
    const raizDoFrete = createRoot(hospedeiroDoFrete);
    await act(async () => {
      raizDoFrete.render(
        <FreteLocalBloco
          valor={0}
          onValor={() => {}}
          faixa={cfg.localCepRange ?? ""}
          onFaixa={() => {}}
          coverage="national"
          onCoverage={() => {}}
          cidade="Belo Horizonte"
          uf="MG"
          cepDaLoja={cfg.originCep}
        />,
      );
    });
    expect(hospedeiroDoFrete.textContent).toContain(aviso as string);
    await act(async () => raizDoFrete.unmount());
    hospedeiroDoFrete.remove();
  });
});

describe("Ajustes: o subtítulo do grupo 'Entrega e frete' fala a mesma regra", () => {
  type Entrada = Parameters<typeof subtitulosDosGrupos>[0];

  function subtituloDaEntrega(parcial: Record<string, unknown>) {
    const entrada = {
      config: {
        storeName: "Ateliê da Serra",
        logoUrl: "https://exemplo.test/logo.png",
        whatsappNumber: "(31) 99999-9999",
        freeShippingMin: 0,
        localDeliveryFee: 10,
        shippingCoverage: "local",
        storeCity: "Belo Horizonte",
        storeState: "MG",
        nationalShippingStrategy: "desligado",
        nationalShippingMin: 0,
        nationalDiscountType: null,
        nationalDiscountValue: 0,
        nationalBenefitScope: "mais_barata",
        ...parcial,
      },
      formasNaEntrega: ["cash"],
      nivelDoPix: "ok",
      nomesLigados: [],
    } as unknown as Entrada;
    return subtitulosDosGrupos(entrada).get("entrega");
  }

  it("CEP de rua + alcance vazio: 'Falta: alcance da entrega' (e não o resumo de antes)", () => {
    expect(
      subtituloDaEntrega({ originCep: CEP_DE_RUA, localCepRange: "" }),
    ).toBe("Falta: alcance da entrega");
  });

  it("CEP de rua + alcance que cobre a cidade: o resumo da entrega, como antes", () => {
    expect(
      subtituloDaEntrega({
        originCep: CEP_DE_RUA,
        localCepRange: ALCANCE_DA_CIDADE,
      }),
    ).toBe("R$ 10 por entrega · Só na sua cidade");
  });

  it("sem CEP: 'Falta: CEP da loja', como antes", () => {
    expect(subtituloDaEntrega({ originCep: "", localCepRange: "" })).toBe(
      "Falta: CEP da loja",
    );
  });

  it("CEP geral (000) + alcance vazio: o resumo de antes", () => {
    expect(
      subtituloDaEntrega({ originCep: CEP_GERAL_DE_CIDADE, localCepRange: "" }),
    ).toBe("R$ 10 por entrega · Só na sua cidade");
  });
});
