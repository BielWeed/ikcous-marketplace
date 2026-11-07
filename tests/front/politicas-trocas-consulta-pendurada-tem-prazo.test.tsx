// @vitest-environment jsdom
//
// "Trocas e devoluções" com rede pendurada (conecta e não responde). Antes, a
// tela ficava em "Carregando as regras da loja…" para sempre: sem prazo, sem
// erro, sem botão, e as seções (nem o mínimo da lei) nunca apareciam. Agora a
// consulta tem prazo; ao estourar, a tela mostra o mínimo da lei, diz que não
// conseguiu ler as regras da loja e oferece "Tentar de novo".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRAZO_DA_CONSULTA_DO_CHECKOUT_MS } from "@/lib/prazo-da-requisicao";

const { leitura } = vi.hoisted(() => ({
  leitura: {
    // Cada chamada a `maybeSingle` consome uma resposta; sem resposta = pendura.
    respostas: [] as Array<unknown>,
    chamadas: 0,
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja da Ana" } }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const cadeia = {
        select: () => cadeia,
        eq: () => cadeia,
        maybeSingle: () => {
          const resposta = leitura.respostas[leitura.chamadas++];
          return resposta === undefined
            ? new Promise(() => {})
            : Promise.resolve(resposta);
        },
      };
      return cadeia;
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const POLITICA_DA_LOJA = {
  prazo_arrependimento_dias: 10,
  prazo_troca_dias: 45,
  prazo_vicio_dias: 120,
  aceita_troca: true,
  aceita_vale: false,
  exige_fotos_vicio: true,
  metodos_locais: ["entrega_na_loja"],
  metodos_nacionais: ["envio_proprio"],
  reembolso_momento: "ao_receber",
  frete_troca_pago_por: "loja",
  categorias_sem_troca: [],
  texto_politica: null,
  endereco_devolucao: null,
  updated_at: null,
};

describe("Trocas e devoluções: consulta pendurada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    leitura.respostas = [];
    leitura.chamadas = 0;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
  });

  async function montar() {
    const { ConteudoDaPolitica } = await import(
      "@/components/politicas/ConteudoDaPolitica"
    );
    await act(async () => {
      raiz.render(<ConteudoDaPolitica tipo="trocas" />);
    });
  }

  function botaoTentarDeNovo(): HTMLButtonElement | undefined {
    return Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Tentar de novo",
    );
  }

  async function passarOPrazo() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_DA_CONSULTA_DO_CHECKOUT_MS + 100);
    });
  }

  it("antes do prazo ainda carrega; depois mostra o mínimo da lei e o botão", async () => {
    await montar();
    expect(hospedeiro.textContent).toContain("Carregando as regras da loja");
    expect(botaoTentarDeNovo()).toBeUndefined();

    await passarOPrazo();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toContain("Carregando as regras da loja");
    expect(texto).toContain("7 dias");
    expect(texto).toContain("Não conseguimos carregar as regras desta loja");
    expect(botaoTentarDeNovo()).toBeDefined();
  });

  it("Tentar de novo lê outra vez e, com resposta, mostra as regras da loja", async () => {
    leitura.respostas = [undefined, { data: POLITICA_DA_LOJA, error: null }];
    await montar();
    await passarOPrazo();
    expect(leitura.chamadas).toBe(1);

    await act(async () => {
      botaoTentarDeNovo()?.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(leitura.chamadas).toBe(2);
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("45 dias");
    expect(texto).not.toContain(
      "Não conseguimos carregar as regras desta loja",
    );
    expect(botaoTentarDeNovo()).toBeUndefined();
  });
});
