// @vitest-environment jsdom
//
// Buracos achados por caça de mutação em FreteLocalBloco (os testes antigos
// passavam mesmo com o defeito de uma linha plantado):
//  - o campo do valor da entrega aparece VAZIO quando o valor é zero (a dica
//    diz "vazio = grátis") e com vírgula e duas casas quando há valor;
//  - "dia" no singular só para 1 (0 dias, 2 dias);
//  - voltar a "Eu entrego" nunca é bloqueado por falta de CEP ou endereço
//    (só as respostas de retirada são);
//  - "Eu entrego ou ele retira" sem endereço da loja não vale e explica.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FreteLocalBloco } from "@/components/admin/shipping/FreteLocalBloco";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type PropsDoBloco = Partial<React.ComponentProps<typeof FreteLocalBloco>>;

describe("FreteLocalBloco (buracos de mutação)", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  function montar(props: PropsDoBloco = {}) {
    act(() => {
      raiz.render(
        <FreteLocalBloco
          valor={0}
          onValor={() => {}}
          faixa=""
          onFaixa={() => {}}
          coverage="national"
          cepDaLoja="38400-100"
          {...props}
        />,
      );
    });
  }

  const campoDoValor = () =>
    hospedeiro.querySelector<HTMLInputElement>("#local-delivery-fee");
  const texto = () => hospedeiro.textContent ?? "";
  const opcao = (titulo: string) =>
    Array.from(
      hospedeiro.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
    ).find((b) => (b.textContent ?? "").includes(titulo));
  const clicar = (el: HTMLElement | undefined) => {
    if (!el) throw new Error("elemento não existe");
    act(() => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

  describe("campo do valor da entrega", () => {
    it.each([
      [0, ""],
      [7.5, "7,50"],
      [12, "12,00"],
      [1234.5, "1234,50"],
    ])("valor %s aparece no campo como %j", (valor, esperado) => {
      montar({ valor });
      expect(campoDoValor()?.value).toBe(esperado);
    });
  });

  describe("digitação do valor da entrega", () => {
    const ERRO = "Escreva só números, como 7,50.";
    const DICA = "Valor vazio = entrega grátis.";

    function escrever(campo: HTMLInputElement | null, valor: string) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      act(() => {
        setter?.call(campo, valor);
        campo?.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    const focar = (campo: HTMLInputElement | null) =>
      act(() => {
        campo?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      });
    const sair = (campo: HTMLInputElement | null) =>
      act(() => {
        campo?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });

    it.each(["7,", "7."])(
      "'%s' com o campo em foco ainda não é erro (falta o resto), mas ao sair é",
      (parcial) => {
        const onValor = vi.fn();
        montar({ onValor });
        const campo = campoDoValor();
        focar(campo);
        escrever(campo, parcial);
        expect(texto()).not.toContain(ERRO);
        // O pai já fica sabendo que o valor ainda não é dinheiro (NaN):
        // o Salvar recusa em vez de gravar zero.
        expect(onValor).toHaveBeenLastCalledWith(Number.NaN);
        sair(campo);
        expect(texto()).toContain(ERRO);
        expect(campo?.getAttribute("aria-invalid")).toBe("true");
      },
    );

    it("texto que não é dinheiro acusa na hora, mesmo com o campo em foco", () => {
      montar();
      const campo = campoDoValor();
      focar(campo);
      escrever(campo, "7,5x");
      expect(texto()).toContain(ERRO);
    });

    it("vírgula e ponto valem e chegam ao pai como número", () => {
      const onValor = vi.fn();
      montar({ onValor });
      const campo = campoDoValor();
      escrever(campo, "7,50");
      expect(onValor).toHaveBeenLastCalledWith(7.5);
      escrever(campo, "1.234,50");
      expect(onValor).toHaveBeenLastCalledWith(1234.5);
    });

    it("campo vazio é entrega grátis: chega 0 ao pai e a dica fica no lugar do erro", () => {
      const onValor = vi.fn();
      montar({ valor: 5, onValor });
      const campo = campoDoValor();
      escrever(campo, "");
      expect(onValor).toHaveBeenLastCalledWith(0);
      expect(texto()).toContain(DICA);
      expect(texto()).not.toContain(ERRO);
      expect(campo?.getAttribute("aria-invalid")).toBe("false");
    });

    it("prazo aceito não acende o erro do prazo; prazo recusado acende e some ao sair do campo", () => {
      montar({ dias: "1", onDias: (d: string) => d !== "99" });
      const prazo = hospedeiro.querySelector<HTMLInputElement>(
        "#local-delivery-days",
      );
      escrever(prazo, "5");
      expect(texto()).not.toContain("O prazo vai de 0 a 30 dias.");
      escrever(prazo, "99");
      expect(texto()).toContain("O prazo vai de 0 a 30 dias.");
      expect(prazo?.getAttribute("aria-invalid")).toBe("true");
      act(() => {
        prazo?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });
      expect(texto()).not.toContain("O prazo vai de 0 a 30 dias.");
    });
  });

  describe("prazo da entrega própria", () => {
    it.each([
      ["0", "dias"],
      ["1", "dia"],
      ["2", "dias"],
      ["30", "dias"],
    ])("prazo %s escreve '%s'", (dias, palavra) => {
      montar({ dias, onDias: () => true });
      const rotulo = hospedeiro.querySelector(
        'label[for="local-delivery-days"]',
      );
      expect(rotulo?.textContent?.trim()).toBe(palavra);
    });
  });

  describe("teste de CEP do cliente", () => {
    it("o botão 'Incluir a região' mostra os 5 primeiros números do CEP testado", () => {
      montar({ cepDaLoja: "38400-100", faixa: "" });
      clicar(opcao("Escolher CEPs"));
      const campo = hospedeiro.querySelector<HTMLInputElement>("#cep-de-teste");
      const escrever = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      act(() => {
        escrever?.call(campo, "01310100");
        campo?.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(campo?.value).toBe("01310-100");
      expect(texto()).toContain("Fica de fora da sua entrega");
      const incluir = Array.from(
        hospedeiro.querySelectorAll<HTMLButtonElement>("button"),
      ).find((b) => (b.textContent ?? "").startsWith("Incluir a região"));
      expect(incluir?.textContent).toBe("Incluir a região 01310");
    });
  });

  describe("escolha de como o cliente da região recebe", () => {
    it("voltar a 'Eu entrego' vale mesmo sem CEP da loja e sem endereço", () => {
      const onModo = vi.fn();
      montar({
        modo: "so_retiro",
        onModo,
        cepDaLoja: null,
        enderecoDaLoja: null,
      });
      clicar(opcao("Eu entrego"));
      // O primeiro cartão é "Eu entrego": o segundo se chama "Eu entrego ou ele retira".
      expect(onModo).toHaveBeenCalledWith("entrego");
    });

    it("'Eu entrego' sem endereço da loja grava a escolha", () => {
      const onModo = vi.fn();
      montar({ modo: "entrego_e_retiro", onModo, enderecoDaLoja: "" });
      const cartaoEntrego = Array.from(
        hospedeiro.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
      ).find((b) => b.textContent?.startsWith("Eu entregoVocê leva"));
      clicar(cartaoEntrego);
      expect(onModo).toHaveBeenCalledExactlyOnceWith("entrego");
    });

    it("'Eu entrego ou ele retira' sem endereço da loja NÃO grava e explica o porquê", () => {
      const onModo = vi.fn();
      montar({ modo: "entrego", onModo, enderecoDaLoja: null });
      clicar(opcao("Eu entrego ou ele retira"));
      expect(onModo).not.toHaveBeenCalled();
      expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
        "Para escolher a retirada, cadastre o endereço da loja",
      );
    });

    it("'Eu entrego ou ele retira' com endereço e CEP da loja grava a escolha", () => {
      const onModo = vi.fn();
      montar({
        modo: "entrego",
        onModo,
        enderecoDaLoja: "Rua de Teste, 1",
        cepDaLoja: "38400-100",
      });
      clicar(opcao("Eu entrego ou ele retira"));
      expect(onModo).toHaveBeenCalledExactlyOnceWith("entrego_e_retiro");
    });

    it("'Só retirada' sem CEP da loja NÃO grava e pede o CEP em Minha loja", () => {
      const onModo = vi.fn();
      montar({
        modo: "entrego",
        onModo,
        cepDaLoja: null,
        enderecoDaLoja: "Rua de Teste, 1",
      });
      clicar(opcao("Só retirada"));
      expect(onModo).not.toHaveBeenCalled();
      expect(texto()).toContain(
        "Para vender só com retirada, cadastre o CEP da loja em Minha loja.",
      );
    });
  });
});
