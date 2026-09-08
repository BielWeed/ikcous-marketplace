// @vitest-environment jsdom
//
// O MOTOR DE TEMPO REAL TEM DE LIGAR QUANDO O COFRE FICA PRONTO DEPOIS.
//
// O efeito que liga o `RealtimeSyncEngine` desistia quando `vaultRef.current`
// ainda era nulo — e `vaultRef` é um `useRef`: mudar `.current` NÃO redispara
// efeito nenhum. As dependências declaradas eram só `isLoaded`, `isLeader` e
// `isAdmin`, e `isLoaded` pode virar verdadeiro ANTES de o cofre existir,
// porque quem o liga também é o `finally` do `fetchConfig` — isto é, a
// resposta da rede, que não sabe nada do cofre.
//
// Numa aba onde o IndexedDB demora (primeira visita, banco travado por upgrade
// de outra aba, disco ocupado) e a rede responde primeiro, o efeito rodava com
// `isLoaded === true` e cofre nulo, desistia, e nunca mais era reavaliado:
// aquela aba passava a sessão inteira sem atualização ao vivo — preço que a
// lojista mudou não chega, produto esgotado continua comprável na tela.
//
// A invariante que estes testes trancam: a ligação do motor reage ao COFRE
// FICAR PRONTO, e não a um `ref` que não redispara efeito. Quando o cofre
// nunca fica pronto (o `DataVault.init()` falhou de verdade), continua sem
// ligar — o motor precisa do cofre.
//
// POR QUE DOIS PORTÕES (promessas seguradas pelo teste):
// o defeito é de ORDEM entre dois caminhos independentes (o cofre e a rede).
// Um portão para cada um deixa o teste ESCOLHER quem responde primeiro, e
// afirmar a ordem no meio do caminho — sem isso, um verde não diria se o motor
// ligou por causa do cofre ou porque o cofre chegou antes por sorte.
//
// POR QUE RENDER DE VERDADE DO StoreProvider (react-dom/client + jsdom):
// mesmo padrão dos testes irmãos desta pasta — o que se afirma é a chamada
// observável de `RealtimeSyncEngine.start` e o estado que o contexto entrega
// (`isLoaded`), nunca um detalhe interno de `useState`.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, useStore } from "@/contexts/StoreContext";

const controle = vi.hoisted(() => {
  const criarPortao = () => {
    let liberar!: () => void;
    const promessa = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    return { promessa, liberar };
  };
  return {
    criarPortao,
    portaoDoCofre: criarPortao(),
    portaoDaRede: criarPortao(),
    cofreFalha: false,
    cofre: null as unknown,
    desligar: vi.fn(),
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: false, loading: false, user: null }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

// O cofre só nasce quando o teste abre o portão — e pode não nascer.
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn(async () => {
      await controle.portaoDoCofre.promessa;
      if (controle.cofreFalha) {
        throw new Error("IndexedDB indisponivel");
      }
      return controle.cofre;
    }),
  },
}));

vi.mock("@/lib/realtimeSyncEngine", () => ({
  RealtimeSyncEngine: {
    start: vi.fn(() => controle.desligar),
    onSync: vi.fn(() => () => {}),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));

// Construtor encadeável e "thenable" — mesmo padrão dos testes irmãos: cobre
// `.from().select().single()` (fetchConfig) e
// `.from().select().is().limit().order()` (fetchProducts) sem replicar
// assinatura. Recebe uma FUNÇÃO porque a resposta de cada tabela é decidida no
// momento do `await` (e pode ficar presa num portão).
function construtorEncadeavel(
  obterResultado: () => Promise<{ data: unknown; error: unknown }>,
): any {
  const alvo: any = () => construtorEncadeavel(obterResultado);
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (
          resolve: (v: unknown) => void,
          rejeitar: (e: unknown) => void,
        ) => obterResultado().then(resolve, rejeitar);
      }
      return () => construtorEncadeavel(obterResultado);
    },
    apply() {
      return construtorEncadeavel(obterResultado);
    },
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (nome: string) => {
      // A config é o único caminho que liga `isLoaded` aqui (o cache do cofre
      // devolve `null` no `getById`, então quem chama `setIsLoaded` é o
      // `finally` do fetchConfig). E ele fica preso no portão da rede.
      if (nome === "v_store_config" || nome === "store_config") {
        return construtorEncadeavel(async () => {
          await controle.portaoDaRede.promessa;
          return { data: null, error: null };
        });
      }
      // Catálogo: resposta de verdade e vazia, para não interferir no que está
      // sendo medido.
      if (nome === "vw_produtos_public") {
        return construtorEncadeavel(async () => ({ data: [], error: null }));
      }
      return construtorEncadeavel(async () => ({ data: null, error: null }));
    },
    rpc: () => construtorEncadeavel(async () => ({ data: null, error: null })),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const alvo: { isLoaded: boolean } = { isLoaded: false };

function Capturador() {
  const { isLoaded } = useStore();
  useEffect(() => {
    alvo.isLoaded = isLoaded;
  }, [isLoaded]);
  return null;
}

function cofreFalso() {
  return {
    getById: vi.fn().mockResolvedValue(null),
    getAll: vi.fn().mockResolvedValue([]),
    put: vi.fn().mockResolvedValue(undefined),
    replaceAll: vi.fn().mockResolvedValue(undefined),
    setLastSync: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  };
}

describe("StoreContext — o motor de tempo real liga quando o cofre chega tarde", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let motor: { start: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    controle.portaoDoCofre = controle.criarPortao();
    controle.portaoDaRede = controle.criarPortao();
    controle.cofreFalha = false;
    controle.cofre = cofreFalso();
    alvo.isLoaded = false;
    motor = (await import("@/lib/realtimeSyncEngine"))
      .RealtimeSyncEngine as any;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    // Solta os portões para não deixar promessa pendurada entre testes.
    controle.portaoDoCofre.liberar();
    controle.portaoDaRede.liberar();
  });

  async function assentar() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function montar() {
    await act(async () => {
      raiz.render(
        <StoreProvider>
          <Capturador />
        </StoreProvider>,
      );
    });
    await assentar();
  }

  async function deixarARedeResponder() {
    await act(async () => {
      controle.portaoDaRede.liberar();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await assentar();
  }

  async function deixarOCofreFicarPronto() {
    await act(async () => {
      controle.portaoDoCofre.liberar();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await assentar();
  }

  it("(a) O DEFEITO — a rede responde antes de o cofre existir: quando o cofre fica pronto, o motor liga", async () => {
    await montar();

    // ORDEM, afirmada dentro do próprio teste: a rede respondeu, `isLoaded` já
    // é verdadeiro, e o cofre AINDA NÃO EXISTE. É exatamente o estado em que o
    // efeito antigo desistia para sempre.
    await deixarARedeResponder();
    expect(alvo.isLoaded).toBe(true);
    expect(motor.start).not.toHaveBeenCalled();

    await deixarOCofreFicarPronto();

    expect(motor.start).toHaveBeenCalledTimes(1);
    expect(motor.start).toHaveBeenCalledWith(controle.cofre, false, false);
  });

  it("(b) O CONTROLE — cofre pronto antes de `isLoaded`: o motor liga exatamente uma vez", async () => {
    await montar();

    // Ordem invertida: o cofre chega primeiro, e `isLoaded` ainda é falso.
    await deixarOCofreFicarPronto();
    expect(alvo.isLoaded).toBe(false);
    expect(motor.start).not.toHaveBeenCalled();

    await deixarARedeResponder();

    // Uma vez, não duas: reexecutar o efeito sem soltar a assinatura anterior
    // deixaria canal órfão no Supabase.
    expect(motor.start).toHaveBeenCalledTimes(1);
    expect(motor.start).toHaveBeenCalledWith(controle.cofre, false, false);
    expect(controle.desligar).not.toHaveBeenCalled();
  });

  it("(c) O CONTROLE — o cofre nunca fica pronto: o motor não liga, e a tela não trava", async () => {
    controle.cofreFalha = true;
    // O caminho de erro loga a causa; aqui o log só atrapalharia a leitura da
    // saída do teste.
    const espiaDeErro = vi.spyOn(console, "error").mockImplementation(() => {});

    await montar();
    await deixarARedeResponder();
    await deixarOCofreFicarPronto();

    expect(motor.start).not.toHaveBeenCalled();
    // Sem cofre o app ainda carrega pela rede — a tela não pode ficar presa no
    // loader por causa do IndexedDB.
    expect(alvo.isLoaded).toBe(true);

    espiaDeErro.mockRestore();
  });
});
