// @vitest-environment jsdom
//
// Balcão — bipar um produto com a rede PENDURADA (conectada, mas sem
// responder). Antes: o aparelho apitava, o cupom não mudava, nada na tela
// dizia que a consulta estava no ar e ela nunca desistia — quem usa pistola
// bipava de novo e, quando a rede voltava, cada bip virava uma unidade.
// Agora a consulta tem prazo, a tela mostra "Consultando…" enquanto espera e
// a resposta que chega depois do prazo é descartada (quem bipou de novo não
// leva a peça em dobro).
//
// Molde de montagem: balcao-leitura-atrasada-nao-entra-na-venda-nova.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, codigoBipadoRef } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  codigoBipadoRef: { atual: "" },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock, functions: { invoke: vi.fn() } },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));
vi.mock("@/components/admin/pdv/LeitorDeCodigo", () => ({
  LeitorDeCodigo: ({
    aberto,
    aoLer,
  }: {
    aberto: boolean;
    aoLer: (leitura: {
      codigo: string;
      formato: string;
      deTeclado?: boolean;
    }) => void;
  }) =>
    aberto ? (
      <button
        type="button"
        onClick={() =>
          aoLer({
            codigo: codigoBipadoRef.atual,
            formato: "ean_13",
            deTeclado: true,
          })
        }
      >
        bipar
      </button>
    ) : null,
}));

import { toast } from "sonner";

import { AdminPdvView } from "@/views/admin/AdminPdvView";

const FRASE_LENTA = "A conexão está lenta, bipe de novo.";
const PRAZO_ESTOURADO_MS = 12_000;

function produto(codigo: string, nome: string) {
  return {
    encontrado: true,
    origem: "produto" as const,
    codigo,
    produto: {
      id: `id-${codigo}`,
      nome,
      ativo: true,
      preco_venda: 39.9,
      estoque: 10,
      imagem: null,
      codigo_barras: codigo,
      tem_variantes: false,
    },
    variante: null,
    preco: 39.9,
    estoque: 10,
    variacoes: [],
  };
}

function botao(raizDom: ParentNode, texto: string) {
  return [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

async function avancar(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("Balcão — bipar com a rede pendurada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
      },
    });
    vi.useFakeTimers();
    rpcMock.mockReset();
    vi.mocked(toast.error).mockReset();
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
    vi.unstubAllGlobals();
  });

  async function clicar(texto: string): Promise<void> {
    const alvo = botao(hospedeiro, texto);
    expect(alvo, `botão "${texto}" ausente`).toBeTruthy();
    await act(async () => {
      alvo!.click();
    });
    await avancar();
  }

  async function montar(): Promise<void> {
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} />);
    });
    await avancar();
  }

  function consultando(): boolean {
    return (hospedeiro.textContent ?? "").includes("Consultando");
  }

  it("consulta que não responde: mostra 'Consultando…', depois do prazo avisa a rede lenta e solta a tela", async () => {
    rpcMock.mockImplementation(() => new Promise(() => {}));
    await montar();
    expect(consultando()).toBe(false);

    codigoBipadoRef.atual = "111";
    await clicar("bipar");

    // No ar: a lojista vê que a consulta está acontecendo (texto VISÍVEL, não
    // só para leitor de tela) e nenhum erro aparece ainda.
    expect(consultando()).toBe(true);
    const aviso = [...hospedeiro.querySelectorAll("p")].find((p) =>
      p.textContent?.includes("Consultando"),
    );
    expect(aviso?.className ?? "").not.toContain("sr-only");
    expect(toast.error).not.toHaveBeenCalled();

    await avancar(PRAZO_ESTOURADO_MS);

    // Prazo estourado: frase em português simples, "Consultando…" some, e o
    // cupom segue vazio (nada entrou).
    expect(toast.error).toHaveBeenCalledWith(FRASE_LENTA);
    expect(consultando()).toBe(false);
    expect(hospedeiro.textContent).toContain("Bipe o primeiro produto");
  });

  it("a resposta que chega DEPOIS do prazo é descartada: o rebip não vira unidade em dobro", async () => {
    const respostasPendentes: Array<(v: unknown) => void> = [];
    rpcMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          respostasPendentes.push(resolve);
        }),
    );
    await montar();

    // Bip 1 pendurado; a lojista espera, não vê nada além de "Consultando…",
    // e bipa de novo (bip 2), também pendurado.
    codigoBipadoRef.atual = "111";
    await clicar("bipar");
    await avancar(5_000);
    await clicar("bipar");
    expect(rpcMock).toHaveBeenCalledTimes(2);

    // Passa o prazo do bip 1: avisa. O bip 2 ainda está dentro do prazo, então
    // "Consultando…" continua na tela (conta quantas há no ar, não só uma).
    await avancar(PRAZO_ESTOURADO_MS - 5_000);
    expect(toast.error).toHaveBeenCalledWith(FRASE_LENTA);
    expect(consultando()).toBe(true);

    // A rede volta: as duas respostas chegam juntas. A do bip 1 (já desistida)
    // não entra; a do bip 2 (ainda no prazo) entra UMA vez.
    await act(async () => {
      respostasPendentes[0]({
        data: produto("111", "Camiseta Lisa"),
        error: null,
      });
      respostasPendentes[1]({
        data: produto("111", "Camiseta Lisa"),
        error: null,
      });
    });
    await avancar();
    expect(hospedeiro.textContent).toContain("Camiseta Lisa");
    const linhaDaQuantidade = hospedeiro.textContent ?? "";
    expect(linhaDaQuantidade).toMatch(/Camiseta Lisa/);
    expect(consultando()).toBe(false);
    // R$ 39,90 uma vez só (duas unidades seriam R$ 79,80).
    expect(linhaDaQuantidade).not.toContain("79,80");
  });

  it("depois do prazo, bipar de novo funciona normalmente (a falha não trava o caixa)", async () => {
    rpcMock
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({
        data: produto("111", "Camiseta Lisa"),
        error: null,
      });
    await montar();
    codigoBipadoRef.atual = "111";
    await clicar("bipar");
    await avancar(PRAZO_ESTOURADO_MS);
    expect(toast.error).toHaveBeenCalledWith(FRASE_LENTA);

    await clicar("bipar");
    expect(hospedeiro.textContent).toContain("Camiseta Lisa");
    expect(consultando()).toBe(false);
  });

  it("consulta rápida: 'Consultando…' não fica na tela depois da resposta", async () => {
    rpcMock.mockResolvedValue({
      data: produto("111", "Camiseta Lisa"),
      error: null,
    });
    await montar();
    codigoBipadoRef.atual = "111";
    await clicar("bipar");
    expect(hospedeiro.textContent).toContain("Camiseta Lisa");
    expect(consultando()).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("recusa do servidor (não é lentidão) mantém a frase de antes e também tira o 'Consultando…'", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "Código de barras inválido" },
    });
    await montar();
    codigoBipadoRef.atual = "111";
    await clicar("bipar");
    expect(toast.error).toHaveBeenCalledWith(
      "Esse código não parece válido. Confira a etiqueta.",
    );
    expect(consultando()).toBe(false);
  });
});
