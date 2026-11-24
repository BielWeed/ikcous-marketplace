// @vitest-environment jsdom
//
// Tela de pagamento: quando a leitura da config do cartão FALHAVA (internet
// caiu), o hook ficava em `erro` e só o clique da cliente em "Tentar de novo"
// refazia a leitura — mesmo depois que a internet voltava. Agora, estando em
// `erro`, a volta da internet (offline -> online) chama o MESMO caminho do
// `tentarDeNovo`, UMA vez por virada. O botão manual continua.
//
// Fora de escopo de propósito: nada muda no que é ofertado nem na ordem
// PIX/cartão; só a releitura. Sem laço se a leitura continuar falhando (a
// próxima tentativa automática só vem da PRÓXIMA virada), e nada acontece em
// `carregando`, em `pronto`, nem com o cartão desligado/sem Public Key.
//
// O hook e a leitura (`@/lib/config-do-cartao`) são os REAIS; só a borda
// (`supabase`) e a fonte "está offline?" (`useOnlineStatus`, que por dentro é
// uma sonda de latência) são dublês controlados pelo teste.
import { act, useEffect, useSyncExternalStore } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type EstadoDaConfigDoCartao,
  TEMPO_LIMITE_DA_LEITURA_MS,
  useConfigDoCartao,
} from "@/hooks/useConfigDoCartao";
import { esquecerConfigDoCartao } from "@/lib/config-do-cartao";

type RespostaDoBanco = { data: unknown; error: { message: string } | null };

const { banco, rede } = vi.hoisted(() => {
  let offline = false;
  const ouvintes = new Set<() => void>();
  return {
    banco: {
      from: vi.fn(),
      leitura: null as null | (() => Promise<unknown>),
    },
    rede: {
      offline: () => offline,
      definir: (valor: boolean) => {
        offline = valor;
        for (const ouvinte of ouvintes) ouvinte();
      },
      assinar: (ouvinte: () => void) => {
        ouvintes.add(ouvinte);
        return () => {
          ouvintes.delete(ouvinte);
        };
      },
    },
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      banco.from(tabela);
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => banco.leitura?.() }),
        }),
      };
    },
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => useSyncExternalStore(rede.assinar, rede.offline),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CREDITO_6X = { credito: true, debito: false, parcelas_max: 6 };
const PRONTO_COM_CREDITO = {
  estado: "pronto",
  config: { credito: true, debito: false, parcelasMax: 6 },
};
const ERRO_DO_BANCO: RespostaDoBanco = {
  data: null,
  error: { message: "timeout" },
};

function respostaAdiada() {
  let resolver!: (valor: RespostaDoBanco) => void;
  const promessa = new Promise<RespostaDoBanco>((res) => {
    resolver = res;
  });
  return { promessa, resolver };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
let ultimo: EstadoDaConfigDoCartao;

function Sonda({ ativo }: { ativo: boolean }) {
  const estado = useConfigDoCartao(ativo);
  useEffect(() => {
    ultimo = estado;
  });
  return null;
}

async function montar(ativo = true) {
  await act(async () => {
    raiz.render(<Sonda ativo={ativo} />);
  });
}

async function assentar() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const virarRede = async (offline: boolean) => {
  await act(async () => {
    rede.definir(offline);
  });
  await assentar();
};

/** A internet cai e volta: UMA virada offline -> online. */
const quedaEVolta = async () => {
  await virarRede(true);
  await virarRede(false);
};

beforeEach(() => {
  vi.stubEnv("VITE_MP_PUBLIC_KEY", "TEST-000000-0000-0000-0000-000000000000");
  esquecerConfigDoCartao();
  banco.from.mockReset();
  banco.leitura = null;
  rede.definir(false);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("useConfigDoCartao — a volta da internet refaz a leitura que falhou", () => {
  it("em `erro`, a internet cai e volta: refaz a leitura sozinho e chega em `pronto` com o cartão", async () => {
    banco.leitura = vi
      .fn()
      .mockResolvedValueOnce(ERRO_DO_BANCO)
      .mockResolvedValueOnce({ data: CREDITO_6X, error: null });

    await montar();
    await assentar();
    expect(ultimo.estado).toBe("erro");
    expect(banco.from).toHaveBeenCalledTimes(1);

    await quedaEVolta();

    expect(banco.from).toHaveBeenCalledTimes(2);
    expect(ultimo).toEqual(PRONTO_COM_CREDITO);
  });

  it("a releitura passa por `carregando` (o caminho do botão), não pula direto", async () => {
    const segunda = respostaAdiada();
    banco.leitura = vi
      .fn()
      .mockResolvedValueOnce(ERRO_DO_BANCO)
      .mockReturnValueOnce(segunda.promessa);

    await montar();
    await assentar();
    expect(ultimo.estado).toBe("erro");

    await quedaEVolta();
    expect(ultimo).toEqual({ estado: "carregando" });

    await act(async () => {
      segunda.resolver({ data: CREDITO_6X, error: null });
    });
    expect(ultimo).toEqual(PRONTO_COM_CREDITO);
  });

  it("a página abriu já offline, a leitura falhou: a primeira volta da internet refaz", async () => {
    rede.definir(true);
    banco.leitura = vi
      .fn()
      .mockResolvedValueOnce(ERRO_DO_BANCO)
      .mockResolvedValueOnce({ data: CREDITO_6X, error: null });

    await montar();
    await assentar();
    expect(ultimo.estado).toBe("erro");

    await virarRede(false);

    expect(banco.from).toHaveBeenCalledTimes(2);
    expect(ultimo).toEqual(PRONTO_COM_CREDITO);
  });

  it("sem laço: a leitura continua falhando — UMA tentativa por virada; sem virada, nenhuma a mais", async () => {
    banco.leitura = () => Promise.resolve(ERRO_DO_BANCO);

    await montar();
    await assentar();
    expect(banco.from).toHaveBeenCalledTimes(1);

    await quedaEVolta();
    expect(banco.from).toHaveBeenCalledTimes(2);
    expect(ultimo.estado).toBe("erro");

    // Tempo passando e a rede reafirmando "online": nada de tentativa nova.
    await assentar();
    await virarRede(false);
    await assentar();
    expect(banco.from).toHaveBeenCalledTimes(2);

    await quedaEVolta();
    expect(banco.from).toHaveBeenCalledTimes(3);
    expect(ultimo.estado).toBe("erro");
  });

  it("o botão manual continua valendo: `tentarDeNovo` refaz a leitura sem precisar de virada de rede", async () => {
    banco.leitura = vi
      .fn()
      .mockResolvedValueOnce(ERRO_DO_BANCO)
      .mockResolvedValueOnce({ data: CREDITO_6X, error: null });

    await montar();
    await assentar();
    expect(ultimo.estado).toBe("erro");

    await act(async () => {
      (ultimo as { tentarDeNovo: () => void }).tentarDeNovo();
    });
    await assentar();

    expect(banco.from).toHaveBeenCalledTimes(2);
    expect(ultimo).toEqual(PRONTO_COM_CREDITO);
  });

  it("a internet só CAIR (sem voltar) em `erro` não refaz; a volta é que refaz", async () => {
    banco.leitura = vi
      .fn()
      .mockResolvedValueOnce(ERRO_DO_BANCO)
      .mockResolvedValueOnce({ data: CREDITO_6X, error: null });

    await montar();
    await assentar();

    await virarRede(true);
    expect(banco.from).toHaveBeenCalledTimes(1);
    expect(ultimo.estado).toBe("erro");

    await virarRede(false);
    expect(banco.from).toHaveBeenCalledTimes(2);
  });

  it("controle: leitura ainda `carregando` quando a internet cai e volta — não dispara leitura em cima da leitura", async () => {
    const adiada = respostaAdiada();
    banco.leitura = () => adiada.promessa;

    await montar();
    await assentar();
    expect(ultimo).toEqual({ estado: "carregando" });

    await quedaEVolta();

    expect(banco.from).toHaveBeenCalledTimes(1);
    expect(ultimo).toEqual({ estado: "carregando" });
  });

  it("controle: `pronto` (cartão ligado ou desligado) não relê quando a internet cai e volta", async () => {
    banco.leitura = () => Promise.resolve({ data: CREDITO_6X, error: null });

    await montar();
    await assentar();
    expect(ultimo).toEqual(PRONTO_COM_CREDITO);

    await quedaEVolta();
    await quedaEVolta();

    expect(banco.from).toHaveBeenCalledTimes(1);
    expect(ultimo).toEqual(PRONTO_COM_CREDITO);
  });

  it("controle: pagamento pelo app desligado (`ativo` falso) ou sem Public Key nunca vai ao banco, nem na volta da internet", async () => {
    banco.leitura = () => Promise.resolve({ data: CREDITO_6X, error: null });

    await montar(false);
    await quedaEVolta();
    expect(banco.from).not.toHaveBeenCalled();
    expect(ultimo).toEqual({ estado: "pronto", config: null });

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "");
    await montar(true);
    await quedaEVolta();
    expect(banco.from).not.toHaveBeenCalled();
    expect(ultimo).toEqual({ estado: "pronto", config: null });
  });

  it("`erro` por TEMPO LIMITE (leitura pendurada): a volta da internet faz leitura NOVA, não reaproveita a promessa parada", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pendurada = respostaAdiada();
    const nova = respostaAdiada();
    banco.leitura = vi
      .fn()
      .mockReturnValueOnce(pendurada.promessa)
      .mockReturnValueOnce(nova.promessa);

    await montar();
    await act(async () => {
      vi.advanceTimersByTime(TEMPO_LIMITE_DA_LEITURA_MS);
    });
    expect(ultimo.estado).toBe("erro");
    expect(banco.from).toHaveBeenCalledTimes(1);

    await act(async () => {
      rede.definir(true);
    });
    await act(async () => {
      rede.definir(false);
    });
    expect(banco.from).toHaveBeenCalledTimes(2);

    await act(async () => {
      nova.resolver({ data: CREDITO_6X, error: null });
    });
    expect(ultimo).toEqual(PRONTO_COM_CREDITO);
  });

  it("desmontar em `erro` e a internet voltar depois: não lê nada (sem ouvinte vazando)", async () => {
    banco.leitura = () => Promise.resolve(ERRO_DO_BANCO);
    await montar();
    await assentar();
    expect(banco.from).toHaveBeenCalledTimes(1);

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await quedaEVolta();

    expect(banco.from).toHaveBeenCalledTimes(1);
  });
});
