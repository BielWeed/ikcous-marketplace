// @vitest-environment jsdom
//
// Plano docs/superpowers/plans/2026-09-30-cartao-de-credito-e-debito.md, T5.
// O hook que decide quais cartões o Payment Brick oferece. O que erra caro:
// oferecer um cartão que o lojista desligou (o cliente preenche tudo para
// ouvir "esta loja não aceita"), ou um erro de leitura quebrar a tela de
// pagamento em vez de cair no PIX.
import {
  CONFIGURACAO_SO_PIX,
  type EstadoConfiguracaoCartao,
  rotuloPagarAgora,
  useConfiguracaoCartao,
} from "@/hooks/useConfiguracaoCartao";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consulta = vi.hoisted(() => ({
  resposta: { data: null, error: null } as {
    data: { value: string } | null;
    error: unknown;
  },
  lancar: false,
  chamadas: [] as Array<{ tabela: string; coluna: string; valor: string }>,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: (coluna: string, valor: string) => ({
          maybeSingle: async () => {
            consulta.chamadas.push({ tabela, coluna, valor });
            if (consulta.lancar) throw new Error("rede caiu");
            return consulta.resposta;
          },
        }),
      }),
    }),
  },
}));

describe("useConfiguracaoCartao", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let visto: EstadoConfiguracaoCartao | null;

  // O valor sai por callback, não por reatribuição de variável de fora do
  // componente (regra do eslint-plugin-react-hooks).
  function Sonda({
    ativo,
    aoVer,
  }: {
    ativo: boolean;
    aoVer: (e: EstadoConfiguracaoCartao) => void;
  }) {
    aoVer(useConfiguracaoCartao(ativo));
    return null;
  }

  async function montar(ativo: boolean) {
    await act(async () => {
      raiz.render(
        <Sonda
          ativo={ativo}
          aoVer={(e) => {
            visto = e;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    visto = null;
    consulta.resposta = { data: null, error: null };
    consulta.lancar = false;
    consulta.chamadas = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("desativado (sem sessão ou pagamento online desligado) não consulta nada", async () => {
    await montar(false);
    expect(consulta.chamadas).toEqual([]);
    expect(visto).toEqual({ estado: "carregando" });
  });

  it("consulta SÓ a linha 'pagamentos_cartao' de app_settings", async () => {
    await montar(true);
    expect(consulta.chamadas).toEqual([
      { tabela: "app_settings", coluna: "key", valor: "pagamentos_cartao" },
    ]);
  });

  it("linha ausente é o padrão do dono: crédito e débito ligados, sem limite do app", async () => {
    await montar(true);
    expect(visto).toEqual({
      estado: "pronto",
      config: { credito: true, debito: true, parcelasMax: null },
    });
  });

  it("lê o que o painel gravou", async () => {
    consulta.resposta = {
      data: { value: '{"credito":true,"debito":false,"parcelas_max":6}' },
      error: null,
    };
    await montar(true);
    expect(visto).toEqual({
      estado: "pronto",
      config: { credito: true, debito: false, parcelasMax: 6 },
    });
  });

  it("valor ilegível, erro do banco ou exceção viram SÓ PIX — nunca o padrão, nunca erro na tela", async () => {
    for (const preparar of [
      () => {
        consulta.resposta = { data: { value: "{lixo" }, error: null };
      },
      () => {
        consulta.resposta = {
          data: null,
          error: { message: "permission denied" },
        };
      },
      () => {
        consulta.lancar = true;
      },
    ]) {
      consulta.resposta = { data: null, error: null };
      consulta.lancar = false;
      preparar();
      act(() => {
        raiz.unmount();
      });
      raiz = createRoot(hospedeiro);
      await montar(true);
      expect(visto).toEqual({ estado: "pronto", config: CONFIGURACAO_SO_PIX });
    }
  });
});

describe("rotuloPagarAgora", () => {
  it("fala em cartão só quando a configuração foi LIDA e aceita algum cartão", () => {
    expect(
      rotuloPagarAgora({
        estado: "pronto",
        config: { credito: true, debito: false, parcelasMax: null },
      }),
    ).toBe("Pagar agora (PIX ou cartão)");
    expect(
      rotuloPagarAgora({
        estado: "pronto",
        config: { credito: false, debito: true, parcelasMax: null },
      }),
    ).toBe("Pagar agora (PIX ou cartão)");
  });

  it("carregando, falha de leitura ou cartões desligados: só PIX no rótulo", () => {
    expect(rotuloPagarAgora({ estado: "carregando" })).toBe(
      "Pagar agora com PIX",
    );
    expect(
      rotuloPagarAgora({ estado: "pronto", config: CONFIGURACAO_SO_PIX }),
    ).toBe("Pagar agora com PIX");
  });
});
