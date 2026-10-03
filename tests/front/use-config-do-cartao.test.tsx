// @vitest-environment jsdom
//
// `useConfigDoCartao` devolve um ESTADO, não mais `config | null`. O `null`
// misturava quatro coisas diferentes — ainda carregando, leitura que falhou,
// cartão desligado de verdade e loja sem Public Key — e o checkout tratava as
// quatro como "sem cartão" (bug do teste real da 1.5.14/1.5.15: na retomada, a
// lista parcial aparecia como se fosse final; erro de leitura parecia cartão
// desligado).
//
// Aqui o hook e a leitura (`@/lib/config-do-cartao`) são os REAIS; só a borda
// (`supabase`) é dublê, controlada por promessa para segurar a resposta no
// ar. Mesmo padrão de sonda (react-dom/client + jsdom) de
// economia-do-frete-cotacao-hook.test.tsx.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type EstadoDaConfigDoCartao,
  TEMPO_LIMITE_DA_LEITURA_MS,
  useConfigDoCartao,
} from "@/hooks/useConfigDoCartao";
import { esquecerConfigDoCartao } from "@/lib/config-do-cartao";

type RespostaDoBanco = { data: unknown; error: { message: string } | null };

const { banco } = vi.hoisted(() => ({
  banco: {
    from: vi.fn(),
    leitura: null as null | (() => Promise<unknown>),
  },
}));

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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CREDITO_6X = { credito: true, debito: false, parcelas_max: 6 };

/** Uma resposta que o teste segura no ar e solta quando quiser. */
function respostaAdiada() {
  let resolver!: (valor: RespostaDoBanco) => void;
  let rejeitar!: (motivo: unknown) => void;
  const promessa = new Promise<RespostaDoBanco>((res, rej) => {
    resolver = res;
    rejeitar = rej;
  });
  return { promessa, resolver, rejeitar };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
let ultimo: EstadoDaConfigDoCartao;
let renders: EstadoDaConfigDoCartao[];

function Sonda({ ativo }: { ativo: boolean }) {
  const estado = useConfigDoCartao(ativo);
  // Registra o que cada render COMMITADO viu — fora do render, para não
  // reatribuir variável de módulo durante ele.
  useEffect(() => {
    ultimo = estado;
    renders.push(estado);
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

beforeEach(() => {
  vi.stubEnv("VITE_MP_PUBLIC_KEY", "TEST-000000-0000-0000-0000-000000000000");
  esquecerConfigDoCartao();
  banco.from.mockReset();
  banco.leitura = null;
  renders = [];
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

describe("useConfigDoCartao — o estado nomeia o que o null misturava", () => {
  it("leitura atrasada: 'carregando' — e só depois 'pronto' com a config ligada", async () => {
    const adiada = respostaAdiada();
    banco.leitura = () => adiada.promessa;

    await montar();
    await assentar();
    expect(ultimo).toEqual({ estado: "carregando" });

    await act(async () => {
      adiada.resolver({ data: CREDITO_6X, error: null });
    });
    expect(ultimo).toEqual({
      estado: "pronto",
      config: { credito: true, debito: false, parcelasMax: 6 },
    });
  });

  it.each([
    [
      "erro do banco",
      () =>
        Promise.resolve({
          data: null,
          error: { message: "permission denied" },
        }),
    ],
    [
      "promessa que rejeita (rede caiu)",
      () => Promise.reject(new TypeError("Failed to fetch")),
    ],
  ])(
    "%s: 'erro' — NUNCA 'pronto' com null (não vira 'cartão desligado')",
    async (_nome, leitura) => {
      banco.leitura = leitura;

      await montar();
      await assentar();

      expect(ultimo.estado).toBe("erro");
      expect(ultimo).not.toHaveProperty("config");
      expect(typeof (ultimo as { tentarDeNovo: unknown }).tentarDeNovo).toBe(
        "function",
      );
    },
  );

  it("tentarDeNovo após o erro: volta a 'carregando', refaz a leitura e chega em 'pronto' (erro não ficou em cache)", async () => {
    const primeira = respostaAdiada();
    const segunda = respostaAdiada();
    banco.leitura = vi
      .fn()
      .mockReturnValueOnce(primeira.promessa)
      .mockReturnValueOnce(segunda.promessa);

    await montar();
    await act(async () => {
      primeira.resolver({ data: null, error: { message: "timeout" } });
    });
    expect(ultimo.estado).toBe("erro");
    expect(banco.from).toHaveBeenCalledTimes(1);

    await act(async () => {
      (ultimo as { tentarDeNovo: () => void }).tentarDeNovo();
    });
    expect(ultimo).toEqual({ estado: "carregando" });
    expect(banco.from).toHaveBeenCalledTimes(2);

    await act(async () => {
      segunda.resolver({ data: CREDITO_6X, error: null });
    });
    expect(ultimo).toEqual({
      estado: "pronto",
      config: { credito: true, debito: false, parcelasMax: 6 },
    });
  });

  it("tentarDeNovo que falha de novo continua 'erro' (e dá para tentar mais uma vez)", async () => {
    banco.leitura = () =>
      Promise.resolve({ data: null, error: { message: "ainda fora" } });

    await montar();
    await assentar();
    expect(ultimo.estado).toBe("erro");

    await act(async () => {
      (ultimo as { tentarDeNovo: () => void }).tentarDeNovo();
    });
    await assentar();

    expect(ultimo.estado).toBe("erro");
    expect(banco.from).toHaveBeenCalledTimes(2);
  });

  it("cartão desligado DE VERDADE é 'pronto' com null: linha ausente, ou crédito e débito off", async () => {
    banco.leitura = () => Promise.resolve({ data: null, error: null });
    await montar();
    await assentar();
    expect(ultimo).toEqual({ estado: "pronto", config: null });

    esquecerConfigDoCartao();
    banco.leitura = () =>
      Promise.resolve({
        data: { credito: false, debito: false, parcelas_max: 3 },
        error: null,
      });
    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await montar();
    await assentar();
    expect(ultimo).toEqual({ estado: "pronto", config: null });
  });

  it("ativo=false: 'pronto' com null JÁ no primeiro render e nunca vai ao banco", async () => {
    banco.leitura = () => Promise.resolve({ data: CREDITO_6X, error: null });

    await montar(false);
    await assentar();

    expect(renders[0]).toEqual({ estado: "pronto", config: null });
    expect(renders.every((r) => r.estado === "pronto")).toBe(true);
    expect(banco.from).not.toHaveBeenCalled();
  });

  it("loja sem Public Key: 'pronto' com null JÁ no primeiro render, mesmo com o cartão ligado no banco", async () => {
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "");
    banco.leitura = () => Promise.resolve({ data: CREDITO_6X, error: null });

    await montar();
    await assentar();

    expect(renders[0]).toEqual({ estado: "pronto", config: null });
    expect(ultimo).toEqual({ estado: "pronto", config: null });
  });

  it("o cache de 60 s do sucesso continua valendo: a segunda montagem não volta ao banco", async () => {
    banco.leitura = () => Promise.resolve({ data: CREDITO_6X, error: null });
    await montar();
    await assentar();
    expect(banco.from).toHaveBeenCalledTimes(1);

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await montar();
    await assentar();

    expect(banco.from).toHaveBeenCalledTimes(1);
    expect(ultimo.estado).toBe("pronto");
  });

  it("identidade estável: re-render sem mudança devolve o MESMO objeto (consumidor com efeito/memo não entra em laço)", async () => {
    banco.leitura = () => Promise.resolve({ data: CREDITO_6X, error: null });
    await montar();
    await assentar();
    const pronto = ultimo;

    await montar();
    expect(ultimo).toBe(pronto);

    // O mesmo vale para 'erro' e para o `tentarDeNovo` dentro dele.
    esquecerConfigDoCartao();
    banco.leitura = () =>
      Promise.resolve({ data: null, error: { message: "x" } });
    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await montar();
    await assentar();
    const erro = ultimo;
    expect(erro.estado).toBe("erro");
    await montar();
    expect(ultimo).toBe(erro);
  });

  it("desmontar com a leitura no ar não estoura quando a resposta chega depois", async () => {
    const adiada = respostaAdiada();
    banco.leitura = () => adiada.promessa;
    await montar();

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);

    await act(async () => {
      adiada.resolver({ data: CREDITO_6X, error: null });
    });
    expect(banco.from).toHaveBeenCalledTimes(1);
  });
});

describe("useConfigDoCartao — leitura pendurada não deixa o cliente sem saída", () => {
  it("passado o tempo limite sem resposta, 'carregando' vira 'erro' (com 'tentarDeNovo'); se a resposta chegar depois, vira 'pronto'", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const adiada = respostaAdiada();
    banco.leitura = () => adiada.promessa;

    await montar();
    expect(ultimo.estado).toBe("carregando");

    await act(async () => {
      vi.advanceTimersByTime(TEMPO_LIMITE_DA_LEITURA_MS - 1);
    });
    expect(ultimo.estado).toBe("carregando");

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(ultimo.estado).toBe("erro");

    await act(async () => {
      adiada.resolver({ data: CREDITO_6X, error: null });
    });
    expect(ultimo).toEqual({
      estado: "pronto",
      config: { credito: true, debito: false, parcelasMax: 6 },
    });
  });

  it("'tentarDeNovo' depois do tempo limite faz uma leitura NOVA — não reaproveita a promessa que ficou pendurada no cache", async () => {
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
      (ultimo as { tentarDeNovo: () => void }).tentarDeNovo();
    });
    expect(ultimo).toEqual({ estado: "carregando" });
    expect(banco.from).toHaveBeenCalledTimes(2);

    await act(async () => {
      nova.resolver({ data: CREDITO_6X, error: null });
    });
    expect(ultimo.estado).toBe("pronto");

    // A resposta da leitura ANTIGA, chegando agora, não desfaz a nova.
    await act(async () => {
      pendurada.resolver({ data: null, error: null });
    });
    expect(ultimo).toEqual({
      estado: "pronto",
      config: { credito: true, debito: false, parcelasMax: 6 },
    });
  });

  it("controle: COM Public Key e leitura no ar, o relógio de 15 s fica armado e o loader é chamado (sem isto o teste abaixo seria vácuo)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    banco.leitura = () => respostaAdiada().promessa;

    await montar();

    expect(banco.from).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it.each([
    ["vazia", ""],
    ["ausente (undefined)", undefined],
  ])(
    "Public Key %s com `ativo` ligado: o effect sai cedo — loader chamado 0 vezes, nenhum timer pendente, 'pronto' com null",
    async (_nome, valor) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      vi.stubEnv("VITE_MP_PUBLIC_KEY", valor);
      banco.leitura = () => respostaAdiada().promessa;

      await montar(true);
      await act(async () => {
        vi.advanceTimersByTime(TEMPO_LIMITE_DA_LEITURA_MS * 2);
      });

      expect(banco.from).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(renders.every((r) => r === renders[0])).toBe(true);
      expect(ultimo).toEqual({ estado: "pronto", config: null });
    },
  );

  it("resposta a tempo cancela o relógio: nada vira 'erro' depois de 'pronto'", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const adiada = respostaAdiada();
    banco.leitura = () => adiada.promessa;

    await montar();
    await act(async () => {
      adiada.resolver({ data: CREDITO_6X, error: null });
    });
    expect(ultimo.estado).toBe("pronto");

    await act(async () => {
      vi.advanceTimersByTime(TEMPO_LIMITE_DA_LEITURA_MS * 2);
    });
    expect(ultimo.estado).toBe("pronto");
  });
});
