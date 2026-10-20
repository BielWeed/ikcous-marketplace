// @vitest-environment jsdom
//
// Venda de balcão em wifi fraco: a sonda de rede estourava o prazo, declarava
// "sem internet" e o botão "Registrar venda" ficava desabilitado com o
// cliente na frente do balcão — a rede só estava LENTA. Aqui o hook
// `useOnlineStatus` é o de VERDADE (sem dublê): o que se prova é o conjunto
// sonda + botão. Lento = botão habilitado (o registro tem o prazo próprio);
// falha de rede real = continua desabilitado, com a frase de sempre.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { FechamentoDaVenda } from "@/components/admin/pdv/FechamentoDaVenda";
import type { ItemDoCupom } from "@/hooks/useVendaPresencial";
import { useVendaPresencial } from "@/hooks/useVendaPresencial";
import { useEffect, useRef } from "react";

const ITEM: ItemDoCupom = {
  chave: "produto-1::",
  productId: "produto-1",
  variantId: null,
  nome: "Camiseta Lisa",
  variacao: null,
  preco: 39.9,
  quantidade: 2,
  estoque: 10,
  imagem: "",
};

function criarArmazenamentoEmMemoria() {
  const dados = new Map<string, string>();
  return {
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      dados.set(chave, valor);
    },
    removeItem: (chave: string) => {
      dados.delete(chave);
    },
  };
}

function Hospedeiro({
  aoRegistrarVenda,
}: {
  aoRegistrarVenda: () => Promise<void>;
}) {
  const { estado, despachar, limparCupom } = useVendaPresencial({
    armazenamento: criarArmazenamentoEmMemoria(),
  });
  const semeadoRef = useRef(false);
  useEffect(() => {
    if (semeadoRef.current) return;
    semeadoRef.current = true;
    despachar({ tipo: "item_adicionado_manualmente", item: ITEM, em: 0 });
    despachar({ tipo: "pagamento_escolhido", pagamento: "cash" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- semeadura roda só na montagem.
  }, []);
  return (
    <FechamentoDaVenda
      estado={estado}
      despachar={despachar}
      aoRegistrarVenda={aoRegistrarVenda}
      limparCupom={limparCupom}
    />
  );
}

/** Rede lenta: pendente até o prazo da sonda abortar (como o `fetch` real). */
function fetchPendenteAteAbortar() {
  return vi.fn(
    (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }),
  );
}

describe("FechamentoDaVenda — rede lenta não tranca a venda de balcão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-de-teste");
    vi.useFakeTimers();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function botaoRegistrar(): HTMLButtonElement {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Registrar venda"),
    ) as HTMLButtonElement;
  }

  async function montarEEsperarAsDuasSondas() {
    await act(async () => {
      raiz.render(
        <Hospedeiro aoRegistrarVenda={vi.fn().mockResolvedValue(undefined)} />,
      );
    });
    // 1ª sonda (3,5 s) + espera da re-sonda (1,5 s) + 2ª sonda (3,5 s).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500 + 1500 + 3500);
    });
  }

  it("sonda estourou o prazo nas duas tentativas: o botão fica HABILITADO e não diz 'sem internet'", async () => {
    vi.stubGlobal("fetch", fetchPendenteAteAbortar());

    await montarEEsperarAsDuasSondas();

    expect(hospedeiro.textContent).not.toContain("Sem internet agora");
    expect(botaoRegistrar().disabled).toBe(false);
  });

  it("controle: a requisição rejeita por erro de rede nas duas tentativas — botão desabilitado e a frase de sempre", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    await act(async () => {
      raiz.render(
        <Hospedeiro aoRegistrarVenda={vi.fn().mockResolvedValue(undefined)} />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(hospedeiro.textContent).toContain("Sem internet agora");
    expect(botaoRegistrar().disabled).toBe(true);
  });
});
