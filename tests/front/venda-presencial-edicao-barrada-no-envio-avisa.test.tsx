// @vitest-environment jsdom
//
// Balcão (PDV): com a venda em "Registrando…" (`estado.enviando`) o botão
// "Voltar à venda" ainda leva ao cupom, onde a busca manual e a escolha de
// cliente seguem clicáveis. A máquina (de propósito) devolve o estado intacto
// para toda edição nesse momento — a venda em envio é intocável. Só o bipe
// avisava; busca manual, cliente e desconto sumiam em SILÊNCIO. Agora qualquer
// edição barrada pelo envio recebe o MESMO aviso do bipe.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AcaoDaVenda,
  type OpcoesDoVendaPresencial,
  type VendaPresencialEmUso,
  chaveDoItemDoCupom,
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
  const venda = useVendaPresencial(opcoes);
  aoAtualizar(venda);
  return null;
}

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

const itemDoPrato = {
  ...itemDaCaneca,
  chave: chaveDoItemDoCupom("prod-prato", null),
  productId: "prod-prato",
  nome: "Prato",
};

const AVISO = "Aguarde: a venda está sendo registrada.";

describe("edição barrada pelo envio em andamento avisa a balconista", () => {
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
    despachar({
      tipo: "item_adicionado_manualmente",
      item: itemDaCaneca,
      em: 0,
    });
  });

  afterEach(() => {
    act(() => raiz.unmount());
    recipiente.remove();
  });

  function despachar(acao: AcaoDaVenda) {
    act(() => ultima.despachar(acao));
  }

  function enviandoDeVoltaNoCupom() {
    despachar({ tipo: "etapa_pedida", etapa: "fechamento" });
    despachar({ tipo: "envio_iniciado" });
    // O "Voltar à venda" não tem trava: passa mesmo com o envio pendente.
    despachar({ tipo: "etapa_pedida", etapa: "cupom" });
    expect(ultima.estado.enviando).toBe(true);
    expect(ultima.estado.etapa).toBe("cupom");
    expect(toastError).not.toHaveBeenCalled();
  }

  it("busca manual: o produto não entra E aparece o aviso", () => {
    enviandoDeVoltaNoCupom();

    despachar({
      tipo: "item_adicionado_manualmente",
      item: itemDoPrato,
      em: 1,
    });

    expect(ultima.estado.itens).toHaveLength(1);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0][0])).toBe(AVISO);
  });

  it("escolha de cliente: o cliente não muda E aparece o aviso", () => {
    enviandoDeVoltaNoCupom();
    const antes = ultima.estado.cliente;

    despachar({
      tipo: "cliente_definido",
      cliente: {
        tipo: "cadastrado",
        userId: "c1",
        nome: "Maria",
        whatsapp: null,
      },
    });

    expect(ultima.estado.cliente).toEqual(antes);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0][0])).toBe(AVISO);
  });

  it("desconto: o valor não muda E aparece o aviso", () => {
    enviandoDeVoltaNoCupom();
    const antes = ultima.estado.desconto;

    despachar({ tipo: "desconto_alterado", valor: 5, motivo: "amiga" });

    expect(ultima.estado.desconto).toBe(antes);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0][0])).toBe(AVISO);
  });

  it("controle: fora do envio a busca manual continua adicionando, sem aviso", () => {
    despachar({
      tipo: "item_adicionado_manualmente",
      item: itemDoPrato,
      em: 1,
    });

    expect(ultima.estado.itens).toHaveLength(2);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("controle: durante o envio, ações que não editam a venda não avisam", () => {
    enviandoDeVoltaNoCupom();

    despachar({ tipo: "etapa_pedida", etapa: "cliente" });
    despachar({ tipo: "etapa_pedida", etapa: "cupom" });

    expect(toastError).not.toHaveBeenCalled();
  });
});
