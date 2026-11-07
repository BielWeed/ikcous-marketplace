// @vitest-environment jsdom
//
// Balcão — o cupom que ficou aberto de ontem. A lojista abre Vender no dia
// seguinte e a tela já vinha com os itens, o cliente e, conforme a etapa, a
// tela de Fechar venda da venda antiga, sem nenhum aviso: um bipe novo por
// cima saía na conta da cliente de ontem. Agora o cupom que não é de hoje volta
// NO CUPOM, com um aviso que diz desde quando está aberto e deixa a lojista
// escolher "Continuar esta venda" ou "Descartar e começar nova". Nada é
// apagado nem registrado sozinho.
//
// Molde de montagem: balcao-cancelar-venda-limpa-o-cupom.test.tsx (AdminPdvView
// real, máquina de estados real, leitor de câmera trocado por um botão).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, invokeMock, codigoBipadoRef } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  invokeMock: vi.fn(),
  codigoBipadoRef: { atual: "" },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock, functions: { invoke: invokeMock } },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));

vi.mock("@/components/admin/pdv/LeitorDeCodigo", () => ({
  LeitorDeCodigo: ({
    aberto,
    aoLer,
  }: {
    aberto: boolean;
    aoLer: (leitura: { codigo: string; formato: string }) => void;
  }) =>
    aberto ? (
      <button
        type="button"
        onClick={() =>
          aoLer({ codigo: codigoBipadoRef.atual, formato: "ean_13" })
        }
      >
        bipar
      </button>
    ) : null,
}));

import { quandoFoiAberta } from "@/components/admin/pdv/AvisoDeVendaAntiga";
import {
  type EstadoDaVenda,
  estadoInicialDaVenda,
  serializarRascunho,
} from "@/hooks/useVendaPresencial";
import { AdminPdvView } from "@/views/admin/AdminPdvView";

const CHAVE_DO_RASCUNHO = "admin_pdv_venda_draft:lojista-1";

/** São Paulo é UTC−3: 15:00Z = 12:00 em SP, quinta 06/11/2026. */
const AGORA = Date.parse("2026-11-06T15:00:00Z");
const HORA = 3_600_000;

const PRODUTO_SIMPLES = {
  encontrado: true,
  origem: "produto" as const,
  codigo: "78912345",
  produto: {
    id: "produto-2",
    nome: "Camiseta Lisa",
    ativo: true,
    preco_venda: 39.9,
    estoque: 10,
    imagem: null,
    codigo_barras: "78912345",
    tem_variantes: false,
  },
  variante: null,
  preco: 39.9,
  estoque: 10,
  variacoes: [],
};

function vendaDeOntem(): EstadoDaVenda {
  return {
    ...estadoInicialDaVenda(() => "chave-de-ontem"),
    etapa: "fechamento",
    itens: [
      {
        chave: "prod-1::",
        productId: "prod-1",
        variantId: null,
        nome: "Caneca da Maria",
        variacao: null,
        preco: 10,
        quantidade: 1,
        estoque: 5,
        imagem: "",
      },
    ],
    cliente: { tipo: "avulso", nome: "Maria Antiga", whatsapp: "34999990000" },
    pagamento: "cash",
  };
}

function botao(
  raizDom: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
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

describe("Balcão — cupom de outro dia volta com aviso e a lojista decide", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
    rpcMock.mockReset();
    rpcMock.mockImplementation(async (nome: string) => {
      if (nome === "buscar_por_codigo_barras") {
        return { data: PRODUTO_SIMPLES, error: null };
      }
      throw new Error(`RPC inesperada: ${nome}`);
    });
    invokeMock.mockReset();
    codigoBipadoRef.atual = PRODUTO_SIMPLES.codigo;

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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function montar(): Promise<void> {
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} />);
    });
    await avancar();
  }

  async function clicar(texto: string): Promise<void> {
    const alvo = botao(hospedeiro, texto);
    expect(alvo, `botão "${texto}" ausente`).toBeTruthy();
    await act(async () => {
      alvo!.click();
    });
    await avancar();
  }

  const etapaNaTela = () =>
    hospedeiro.querySelector(".pdv")?.getAttribute("data-etapa");
  const aviso = () =>
    hospedeiro.querySelector('[aria-label="Venda antiga no caixa"]');

  it("cupom de ontem: abre no CUPOM (não no Fechar venda), com o aviso, os itens e o cliente", async () => {
    armazem.set(
      CHAVE_DO_RASCUNHO,
      serializarRascunho(vendaDeOntem(), AGORA - 20 * HORA), // 16:00 de ontem
    );

    await montar();

    expect(etapaNaTela()).toBe("cupom");
    expect(aviso(), "o aviso tem de aparecer").toBeTruthy();
    expect(aviso()!.textContent).toContain("desde ontem, às 16:00");
    expect(botao(hospedeiro, "Continuar esta venda")).toBeTruthy();
    expect(botao(hospedeiro, "Descartar e começar nova")).toBeTruthy();
    // A lojista vê o que está decidindo: o item e o cliente de ontem.
    expect(hospedeiro.textContent).toContain("Caneca da Maria");
    expect(hospedeiro.textContent).toContain("Maria Antiga");
  });

  it("cupom de hoje (2 h): volta como sempre voltou, na etapa em que estava, sem aviso", async () => {
    armazem.set(
      CHAVE_DO_RASCUNHO,
      serializarRascunho(vendaDeOntem(), AGORA - 2 * HORA),
    );

    await montar();

    expect(aviso()).toBeNull();
    expect(etapaNaTela()).toBe("fechamento");
  });

  it("cupom gravado antes do carimbo existir: aviso com 'data que o app não sabe dizer', e nada some", async () => {
    const { salvoEm: _carimbo, ...semCarimbo } = JSON.parse(
      serializarRascunho(vendaDeOntem(), AGORA),
    );
    armazem.set(CHAVE_DO_RASCUNHO, JSON.stringify(semCarimbo));

    await montar();

    expect(aviso()!.textContent).toContain(
      "de uma data que o app não sabe dizer",
    );
    expect(hospedeiro.textContent).toContain("Caneca da Maria");
    expect(armazem.has(CHAVE_DO_RASCUNHO)).toBe(true);
  });

  it("continuar: o aviso some, o cupom (itens e cliente) fica, o carimbo vira de hoje e NADA é registrado", async () => {
    armazem.set(
      CHAVE_DO_RASCUNHO,
      serializarRascunho(vendaDeOntem(), AGORA - 20 * HORA),
    );
    await montar();

    await clicar("Continuar esta venda");
    await avancar(500);

    expect(aviso()).toBeNull();
    expect(hospedeiro.textContent).toContain("Caneca da Maria");
    expect(hospedeiro.textContent).toContain("Maria Antiga");
    expect(
      rpcMock.mock.calls.filter((c) => c[0] === "registrar_venda_presencial"),
    ).toEqual([]);
    const gravado = JSON.parse(armazem.get(CHAVE_DO_RASCUNHO)!);
    expect(Date.parse(gravado.salvoEm)).toBeGreaterThanOrEqual(AGORA);
  });

  it("descartar: o caixa volta ao zero, o rascunho é apagado e o aviso some", async () => {
    armazem.set(
      CHAVE_DO_RASCUNHO,
      serializarRascunho(vendaDeOntem(), AGORA - 20 * HORA),
    );
    await montar();

    await clicar("Descartar e começar nova");
    await avancar(500);

    expect(aviso()).toBeNull();
    expect(hospedeiro.textContent).not.toContain("Caneca da Maria");
    expect(hospedeiro.textContent).not.toContain("Maria Antiga");
    expect(armazem.has(CHAVE_DO_RASCUNHO)).toBe(false);
  });

  it("bipar uma peça nova por cima NÃO dispensa o aviso sozinho (a decisão continua pendente)", async () => {
    armazem.set(
      CHAVE_DO_RASCUNHO,
      serializarRascunho(vendaDeOntem(), AGORA - 20 * HORA),
    );
    await montar();

    await clicar("bipar");

    expect(hospedeiro.textContent).toContain("Camiseta Lisa");
    expect(aviso(), "o aviso segue na tela").toBeTruthy();
    // E o carimbo de ontem continua valendo no disco: um F5 agora pergunta de novo.
    const gravado = JSON.parse(armazem.get(CHAVE_DO_RASCUNHO)!);
    expect(Date.parse(gravado.salvoEm)).toBe(AGORA - 20 * HORA);
  });
});

describe("Balcão — a frase de 'desde quando' do aviso (calendário de São Paulo)", () => {
  it("diz hoje, ontem, a data e a falta de data, sempre na hora de São Paulo", () => {
    // AGORA = 06/11 12:00 em SP.
    const em = (iso: string) => Date.parse(iso);
    expect(quandoFoiAberta(em("2026-11-06T13:05:00Z"), AGORA)).toBe(
      "desde hoje, às 10:05",
    );
    expect(quandoFoiAberta(em("2026-11-05T20:42:00Z"), AGORA)).toBe(
      "desde ontem, às 17:42",
    );
    expect(quandoFoiAberta(em("2026-11-02T20:42:00Z"), AGORA)).toBe(
      "desde 02/11, às 17:42",
    );
    expect(quandoFoiAberta(null, AGORA)).toBe(
      "de uma data que o app não sabe dizer",
    );
  });

  it("23:30 de ontem em SP já é 02:30 UTC de hoje: segue sendo 'ontem'", () => {
    expect(quandoFoiAberta(Date.parse("2026-11-06T02:30:00Z"), AGORA)).toBe(
      "desde ontem, às 23:30",
    );
  });
});
