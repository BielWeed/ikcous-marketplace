// @vitest-environment jsdom
//
// Rodada 5, achados 5 e 6 do caixa de balcão (`useVendaPresencial`):
//
// 5) A resposta de um bipe vem de uma ida ao servidor sem prazo. Se ela chega
//    depois que a balconista saiu do cupom, ou com o envio já em andamento, a
//    máquina descarta a peça (de propósito, ver
//    `venda-presencial-bipe-atrasado-e-erro-antigo.test.ts`). O leitor, porém,
//    já apitou. Descartar em SILÊNCIO deixava a peça fora da venda sem a
//    balconista saber: agora ela recebe um aviso claro.
// 6) A chave da venda era gerada com `crypto.randomUUID()` direto; em aparelho
//    sem ele, abrir "Vender" lançava TypeError. Agora usa `gerarUuidV4()`, que
//    tem o plano B por `getRandomValues`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AcaoDaVenda,
  type OpcoesDoVendaPresencial,
  type RespostaDoCodigo,
  type VendaPresencialEmUso,
  chaveDoItemDoCupom,
  estadoInicialDaVenda,
  useVendaPresencial,
} from "@/hooks/useVendaPresencial";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Sonda({
  aoAtualizar,
  opcoes = { gerarChave: () => "chave-do-teste" },
}: {
  readonly aoAtualizar: (venda: VendaPresencialEmUso) => void;
  readonly opcoes?: OpcoesDoVendaPresencial;
}) {
  // Sem `userId` o hook não lê nem grava rascunho: o teste não toca em disco.
  const venda = useVendaPresencial(opcoes);
  aoAtualizar(venda);
  return null;
}

const respostaDeProdutoSimples: RespostaDoCodigo = {
  encontrado: true,
  origem: "produto",
  codigo: "789111",
  produto: {
    id: "prod-caneca",
    nome: "Caneca",
    ativo: true,
    preco_venda: 30,
    estoque: 5,
    imagem: "img-caneca.jpg",
    codigo_barras: "789111",
    tem_variantes: false,
  },
  variante: null,
  preco: 30,
  estoque: 5,
  variacoes: [],
};

const bipe = (codigo = "789111"): AcaoDaVenda => ({
  tipo: "codigo_resolvido",
  codigo,
  resposta: respostaDeProdutoSimples,
  em: 0,
});

const itemDaCaneca = {
  chave: chaveDoItemDoCupom("prod-caneca", null),
  productId: "prod-caneca",
  variantId: null,
  nome: "Caneca",
  variacao: null,
  preco: 30,
  quantidade: 1,
  estoque: 5,
  imagem: "",
};

describe("achado 5 — bipe que chega tarde não some em silêncio", () => {
  let raiz: Root;
  let recipiente: HTMLDivElement;
  let ultima: VendaPresencialEmUso;

  beforeEach(() => {
    toastError.mockClear();
    recipiente = document.createElement("div");
    document.body.appendChild(recipiente);
    raiz = createRoot(recipiente);
    act(() => {
      raiz.render(
        <Sonda
          aoAtualizar={(v) => {
            ultima = v;
          }}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => raiz.unmount());
    recipiente.remove();
  });

  function despachar(acao: AcaoDaVenda) {
    act(() => ultima.despachar(acao));
  }

  function comUmaCanecaNoCupom() {
    despachar({
      tipo: "item_adicionado_manualmente",
      item: itemDaCaneca,
      em: 0,
    });
  }

  it("fora do cupom (fechamento): a peça não entra E a balconista é avisada com o código", () => {
    comUmaCanecaNoCupom();
    despachar({ tipo: "etapa_pedida", etapa: "fechamento" });
    expect(ultima.estado.etapa).toBe("fechamento");

    despachar(bipe("789111"));

    expect(ultima.estado.itens).toHaveLength(1);
    expect(ultima.estado.itens[0].quantidade).toBe(1);
    expect(toastError).toHaveBeenCalledTimes(1);
    const mensagem = String(toastError.mock.calls[0][0]);
    expect(mensagem).toContain("789111");
    expect(mensagem).toMatch(/não foi adicionada/i);
  });

  it("com o envio em andamento: a peça não entra E a balconista é avisada", () => {
    comUmaCanecaNoCupom();
    despachar({ tipo: "envio_iniciado" });
    expect(ultima.estado.enviando).toBe(true);

    despachar(bipe("789111"));

    expect(ultima.estado.itens[0].quantidade).toBe(1);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0][0])).toContain("789111");
  });

  it("dois bipes tardios seguidos geram dois avisos (cada peça perdida é dita)", () => {
    comUmaCanecaNoCupom();
    despachar({ tipo: "etapa_pedida", etapa: "fechamento" });
    despachar(bipe("789111"));
    despachar(bipe("789222"));
    expect(toastError).toHaveBeenCalledTimes(2);
    expect(String(toastError.mock.calls[1][0])).toContain("789222");
  });

  it("controle: no cupom, com o envio parado, o bipe entra e NÃO há aviso de descarte", () => {
    despachar(bipe("789111"));
    expect(ultima.estado.itens).toHaveLength(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("outras ações fora do cupom (ex.: voltar ao cupom) não disparam o aviso", () => {
    comUmaCanecaNoCupom();
    despachar({ tipo: "etapa_pedida", etapa: "fechamento" });
    despachar({ tipo: "etapa_pedida", etapa: "cupom" });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("a identidade de `despachar` continua estável entre renders", () => {
    const antes = ultima.despachar;
    comUmaCanecaNoCupom();
    expect(ultima.despachar).toBe(antes);
  });
});

describe("achado 6 — a chave da venda nasce até sem crypto.randomUUID", () => {
  const original = globalThis.crypto.randomUUID;

  afterEach(() => {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  function semRandomUuid() {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  }

  it("`estadoInicialDaVenda()` sem argumento gera um UUID v4 válido", () => {
    semRandomUuid();
    const estado = estadoInicialDaVenda();
    expect(estado.chaveDeIdempotencia).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("o hook monta e limpa o cupom (chave nova) sem `gerarChave` injetada e sem randomUUID", () => {
    semRandomUuid();
    let venda!: VendaPresencialEmUso;
    const recipiente = document.createElement("div");
    document.body.appendChild(recipiente);
    const raiz = createRoot(recipiente);
    act(() =>
      raiz.render(
        <Sonda
          opcoes={{}}
          aoAtualizar={(v) => {
            venda = v;
          }}
        />,
      ),
    );
    const primeira = venda.estado.chaveDeIdempotencia;
    act(() => venda.limparCupom());
    expect(venda.estado.chaveDeIdempotencia).not.toBe(primeira);
    expect(venda.estado.chaveDeIdempotencia).toMatch(/^[0-9a-f-]{36}$/);
    act(() => raiz.unmount());
    recipiente.remove();
  });
});
