// @vitest-environment jsdom
//
// Balcão, tela de fechar a venda: quando o registro falha de um jeito que não
// adianta repetir (sessão vencida, sem permissão, chave já usada), a tela
// oferece "Começar uma venda nova". Esse botão chamava `limparCupom` direto —
// um toque acidental apagava itens, cliente, pagamento, desconto e o rascunho
// salvo, sem desfazer. Agora o toque abre a pergunta do painel dizendo o que se
// perde; só o botão da pergunta apaga. Voltar, Esc e fechar não apagam nada.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FechamentoDaVenda } from "@/components/admin/pdv/FechamentoDaVenda";
import { useVendaPresencial } from "@/hooks/useVendaPresencial";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

const armazenamento = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const aoLimpar = vi.fn<() => void>();

function Venda({
  registrar,
}: {
  registrar: () => Promise<void>;
}) {
  const { estado, despachar, limparCupom } = useVendaPresencial({
    armazenamento,
  });
  useEffect(() => {
    despachar({
      tipo: "item_adicionado_manualmente",
      em: 1000,
      item: {
        chave: "produto-teste::",
        productId: "produto-teste",
        variantId: null,
        nome: "Camiseta de teste",
        variacao: null,
        preco: 10,
        quantidade: 2,
        estoque: 5,
        imagem: "",
      },
    });
    despachar({
      tipo: "item_adicionado_manualmente",
      em: 1001,
      item: {
        chave: "produto-dois::",
        productId: "produto-dois",
        variantId: null,
        nome: "Boné de teste",
        variacao: null,
        preco: 5,
        quantidade: 2,
        estoque: 5,
        imagem: "",
      },
    });
    despachar({ tipo: "pagamento_escolhido", pagamento: "cash" });
  }, [despachar]);
  return (
    <FechamentoDaVenda
      estado={estado}
      despachar={despachar}
      limparCupom={() => {
        aoLimpar();
        limparCupom();
      }}
      aoRegistrarVenda={registrar}
    />
  );
}

const esperar = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

describe("FechamentoDaVenda — 'Começar uma venda nova' pede confirmação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    aoLimpar.mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  const botaoDaTela = (rotulo: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(rotulo),
    );

  const janela = () =>
    document.querySelector<HTMLElement>('[data-testid="confirmar-acao"]');

  const botaoDaJanela = (rotulo: string) =>
    [...(janela()?.querySelectorAll("button") ?? [])].find((b) =>
      b.textContent?.includes(rotulo),
    );

  async function falharORegistro(codigo: string, mensagem: string) {
    const registrar = vi.fn<() => Promise<void>>(() =>
      Promise.reject({ code: codigo, message: mensagem }),
    );
    await act(async () => {
      raiz.render(<Venda registrar={registrar} />);
    });
    await act(async () => {
      botaoDaTela("Registrar venda")?.click();
    });
    await act(async () => {
      await esperar(20);
    });
  }

  it("sessão vencida: o toque abre a pergunta com o que se perde e NADA é apagado ainda", async () => {
    await falharORegistro("PGRST301", "JWT expired");

    expect(botaoDaTela("Começar uma venda nova")).toBeTruthy();
    await act(async () => {
      botaoDaTela("Começar uma venda nova")?.click();
    });
    await act(async () => {
      await esperar(20);
    });

    expect(janela()).not.toBeNull();
    const texto = janela()?.textContent ?? "";
    expect(texto).toContain("apaga a venda em andamento");
    expect(texto).toContain("2 itens");
    expect(texto).toContain("R$ 30,00");
    expect(aoLimpar).not.toHaveBeenCalled();
  });

  it("Cancelar na pergunta não apaga nada, e a venda continua na tela", async () => {
    await falharORegistro("42501", "Acesso negado");

    await act(async () => {
      botaoDaTela("Começar uma venda nova")?.click();
    });
    await act(async () => {
      await esperar(20);
    });
    await act(async () => {
      botaoDaJanela("Cancelar")?.click();
    });
    await act(async () => {
      await esperar(20);
    });

    expect(aoLimpar).not.toHaveBeenCalled();
    expect(janela()).toBeNull();
    expect(hospedeiro.textContent).toContain("2 itens");
  });

  it("confirmar apaga UMA vez", async () => {
    await falharORegistro("42501", "Acesso negado");

    await act(async () => {
      botaoDaTela("Começar uma venda nova")?.click();
    });
    await act(async () => {
      await esperar(20);
    });
    await act(async () => {
      botaoDaJanela("Apagar e começar outra")?.click();
    });
    await act(async () => {
      await esperar(20);
    });

    expect(aoLimpar).toHaveBeenCalledTimes(1);
  });
});
