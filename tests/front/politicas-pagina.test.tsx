// @vitest-environment jsdom
//
// As três páginas de política (Termos de uso, Privacidade, Trocas e
// devoluções) montadas de verdade. O que se mede é o que a cliente enxerga:
// o título, o texto, o contato da loja (ou o aviso honesto de que não há) e
// — nas trocas — os prazos que a lojista gravou em `politica_devolucao`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { View } from "@/types";

const { configAtual, leitura } = vi.hoisted(() => ({
  configAtual: { valor: {} as Record<string, unknown> },
  leitura: {
    resultado: null as unknown,
    pendente: false,
    consultas: [] as string[],
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configAtual.valor }),
}));

vi.mock("@/hooks/useDocumentMeta", () => ({
  useDocumentMeta: () => ({}),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      leitura.consultas.push(tabela);
      const cadeia = {
        select: () => cadeia,
        eq: () => cadeia,
        maybeSingle: () =>
          leitura.pendente
            ? new Promise(() => {})
            : Promise.resolve(leitura.resultado),
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
  categorias_sem_troca: ["Calcinhas"],
  texto_politica: "Peça com etiqueta e sem cheiro de perfume.",
  endereco_devolucao: "Rua das Flores, 10",
  updated_at: null,
};

function esperar(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe("páginas de política", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    configAtual.valor = { storeName: "Loja da Ana" };
    leitura.resultado = { data: POLITICA_DA_LOJA, error: null };
    leitura.pendente = false;
    leitura.consultas = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montar(
    tipo: "termos" | "privacidade" | "trocas",
    onNavigate: (v: View) => void = vi.fn(),
  ) {
    const { PoliticaDaLojaView } = await import(
      "@/views/customer/PoliticaDaLojaView"
    );
    await act(async () => {
      raiz.render(<PoliticaDaLojaView tipo={tipo} onNavigate={onNavigate} />);
    });
    await act(async () => {
      await esperar();
    });
  }

  it("Termos de uso: título, texto com o nome da loja e SEM consultar o banco", async () => {
    await montar("termos");
    expect(hospedeiro.querySelector("h1")?.textContent).toBe("Termos de uso");
    expect(hospedeiro.textContent).toContain("Loja da Ana");
    expect(hospedeiro.textContent).toContain("Mercado Pago");
    expect(leitura.consultas).toEqual([]);
  });

  it("Privacidade: lista os dados e o direito de pedir exclusão", async () => {
    await montar("privacidade");
    expect(hospedeiro.querySelector("h1")?.textContent).toBe(
      "Política de Privacidade",
    );
    expect(hospedeiro.textContent).toContain("CPF");
    expect(hospedeiro.textContent).toMatch(/exclusão/);
    expect(leitura.consultas).toEqual([]);
  });

  it("Trocas: mostra os prazos que a lojista gravou e o texto dela", async () => {
    await montar("trocas");
    const texto = hospedeiro.textContent ?? "";
    expect(hospedeiro.querySelector("h1")?.textContent).toBe(
      "Trocas e devoluções",
    );
    expect(leitura.consultas).toEqual(["politica_devolucao"]);
    expect(texto).toContain("10 dias");
    expect(texto).toContain("45 dias");
    expect(texto).toContain("120 dias");
    expect(texto).toContain("Peça com etiqueta e sem cheiro de perfume.");
    expect(texto).toContain("Calcinhas");
    expect(texto).toContain("Rua das Flores, 10");
  });

  it("Trocas: enquanto lê, não mostra prazo nenhum (nada de 7 dias que vira 10)", async () => {
    leitura.pendente = true;
    await montar("trocas");
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Carregando as regras da loja");
    expect(texto).not.toMatch(/\d+ dias/);
  });

  it("Trocas: banco falhou — só o mínimo da lei e o aviso para falar com a loja", async () => {
    leitura.resultado = { data: null, error: { message: "permission denied" } };
    await montar("trocas");
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("7 dias");
    expect(texto).toMatch(/fale com a loja/i);
    expect(texto).not.toMatch(/\b(10|30|45|90|120) dias\b/);
  });

  it("contato: WhatsApp e endereço da loja quando cadastrados", async () => {
    configAtual.valor = {
      storeName: "Loja da Ana",
      whatsappNumber: "34999998888",
      storeAddress: "Av. Brasil, 500",
    };
    await montar("termos");
    expect(hospedeiro.textContent).toContain("(34) 99999-8888");
    expect(hospedeiro.textContent).toContain("Av. Brasil, 500");
  });

  it("contato: loja sem nada cadastrado diz isso, não aponta canal inventado", async () => {
    await montar("termos");
    expect(hospedeiro.textContent).toContain(
      "A loja ainda não cadastrou um contato neste app",
    );
    expect(hospedeiro.textContent).not.toMatch(/undefined|null/);
  });

  it("os atalhos levam às OUTRAS duas páginas, e só a elas", async () => {
    const onNavigate = vi.fn();
    await montar("termos", onNavigate);
    const botoes = [
      ...hospedeiro.querySelectorAll<HTMLButtonElement>(
        'nav[aria-label="Outras páginas da loja"] button',
      ),
    ];
    expect(botoes.map((b) => b.textContent)).toEqual([
      "Política de Privacidade",
      "Trocas e devoluções",
    ]);
    act(() => botoes[1].click());
    expect(onNavigate).toHaveBeenCalledWith("returns-policy");
  });
});
