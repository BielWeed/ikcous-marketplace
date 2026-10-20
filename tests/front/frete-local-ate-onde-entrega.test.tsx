// @vitest-environment jsdom
//
// Tela de Frete, "Entrega na sua cidade": a pergunta "Até onde você entrega?"
// (16/10/2026). O cartão "Sua loja está pronta para vender?" chamava de defeito
// o que a lojista escolheu de propósito (atender só o próprio bairro), e a
// única saída era redigitar os 5 primeiros números do CEP num campo de texto.
//
// Aqui se prova o COMPORTAMENTO: "Só perto da loja" grava exatamente os 5
// números certos pelo MESMO campo do formulário (o Salvar do topo grava);
// "Em mais lugares" responde na hora se um CEP entra ou fica de fora, e
// "Incluir a região deste CEP" acrescenta sem duplicar e sem estragar o que já
// estava escrito. A prova de que gravar o prefixo = alcance vazio nas três
// cópias da regra mora em `alcance-da-entrega-so-perto-da-loja.test.ts`.
import { act, useState } from "react";

import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FreteLocalBloco } from "@/components/admin/shipping/FreteLocalBloco";
import { cepEhLocal } from "@/lib/cep-local";
import { avisoDaFaixaDeCep, estadoDaEntrega } from "@/lib/loja-pronta";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const CEP_DA_LOJA = "38400-100";

type PropsDoBloco = Partial<React.ComponentProps<typeof FreteLocalBloco>>;

describe("FreteLocalBloco: até onde você entrega", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;
  /** Tudo que o bloco mandou para o formulário, na ordem. */
  let gravados: string[];

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    gravados = [];
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  /** O formulário de verdade: guarda o texto e devolve ao bloco. */
  function Formulario({
    inicial,
    ...resto
  }: { readonly inicial: string } & PropsDoBloco) {
    const [faixa, setFaixa] = useState(inicial);
    return (
      <FreteLocalBloco
        valor={10}
        onValor={() => {}}
        faixa={faixa}
        onFaixa={(nova) => {
          gravados.push(nova);
          setFaixa(nova);
        }}
        coverage="national"
        onCoverage={() => {}}
        cidade="Uberlândia"
        uf="MG"
        cepDaLoja={CEP_DA_LOJA}
        {...resto}
      />
    );
  }

  function montar(inicial = "", resto: PropsDoBloco = {}) {
    act(() => {
      raiz.render(<Formulario inicial={inicial} {...resto} />);
    });
  }

  const texto = () => hospedeiro.textContent ?? "";
  const opcao = (titulo: string) =>
    Array.from(
      hospedeiro.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
    ).find((b) => (b.textContent ?? "").includes(titulo));
  const botao = (trecho: string) =>
    Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => (b.textContent ?? "").includes(trecho),
    );

  function clicar(el: HTMLElement | undefined) {
    if (!el) throw new Error("elemento não existe");
    act(() => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  function digitar(el: HTMLInputElement | null, valor: string) {
    if (!el) throw new Error("campo não existe");
    const escrever = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    act(() => {
      escrever?.call(el, valor);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  const campoDeTeste = () =>
    hospedeiro.querySelector<HTMLInputElement>("#cep-de-teste");

  function abrirMaisLugaresEDigitar(cep: string) {
    clicar(opcao("Em mais lugares"));
    digitar(campoDeTeste(), cep);
  }

  it("pergunta até onde entrega, diz o que vale hoje e oferece as duas respostas com o efeito escrito", () => {
    montar("");
    expect(texto()).toContain("Até onde você entrega?");
    expect(texto()).toContain("Hoje: CEPs que começam com 38400.");
    expect(hospedeiro.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(opcao("Só perto da loja")?.textContent).toContain(
      "CEPs que começam com 38400, normalmente um pedaço do seu bairro.",
    );
    expect(opcao("Em mais lugares")).toBeDefined();
    // Não existe mais a linha de texto solta "Alcance por CEP".
    expect(texto()).not.toContain("Alcance por CEP");
    // Vazio = a lojista ainda não confirmou: nenhuma das duas está marcada.
    expect(opcao("Só perto da loja")?.getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(opcao("Em mais lugares")?.getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  describe("'Só perto da loja'", () => {
    it("grava os 5 primeiros números do CEP da loja, pelo campo do formulário, uma vez só", () => {
      montar("");
      clicar(opcao("Só perto da loja"));
      expect(gravados).toEqual(["38400"]);
      expect(opcao("Só perto da loja")?.getAttribute("aria-checked")).toBe(
        "true",
      );
      expect(texto()).toContain("Hoje: CEPs que começam com 38400.");
    });

    it("com o CEP da loja sem hífen também grava só os 5 primeiros", () => {
      montar("", { cepDaLoja: "38400100" });
      clicar(opcao("Só perto da loja"));
      expect(gravados).toEqual(["38400"]);
    });

    it("o que foi gravado dá a MESMA resposta do alcance vazio e FECHA o passo 'entrega' do cartão", () => {
      // Antes: CEP de rua + vazio = pendente. Depois da escolha, pronto.
      expect(
        estadoDaEntrega({ originCep: CEP_DA_LOJA, localCepRange: "" }, false),
      ).toBe("pendente");
      montar("");
      clicar(opcao("Só perto da loja"));
      const gravado = gravados.at(-1) as string;
      expect(
        estadoDaEntrega(
          { originCep: CEP_DA_LOJA, localCepRange: gravado },
          false,
        ),
      ).toBe("feito");
      for (const destino of ["38400-999", "38401-000", "38500-000", "38400"]) {
        expect(cepEhLocal(CEP_DA_LOJA, destino, gravado), destino).toBe(
          cepEhLocal(CEP_DA_LOJA, destino, ""),
        );
      }
      // E o aviso amarelo, que só falava do alcance vazio, sai da tela.
      expect(
        avisoDaFaixaDeCep({ originCep: CEP_DA_LOJA, localCepRange: gravado }),
      ).toBeNull();
      expect(texto()).not.toContain("escolha até onde você entrega");
    });

    it("antes de escolher, o aviso amarelo de alcance vazio continua na tela (a regra do cartão não mudou)", () => {
      montar("");
      expect(texto()).toContain(
        "Sua entrega local só vale para CEPs que começam com 38400",
      );
    });

    it("quem já tinha outro alcance escrito: a opção avisa que TROCA o que estava escrito, e troca", () => {
      montar("38500-000, 38509-999");
      expect(opcao("Só perto da loja")?.textContent).toContain(
        "Troca o que está escrito",
      );
      clicar(opcao("Só perto da loja"));
      expect(gravados).toEqual(["38400"]);
    });

    it("sem 'Troca o que está escrito' quando não havia nada escrito", () => {
      montar("");
      expect(opcao("Só perto da loja")?.textContent).not.toContain(
        "Troca o que está escrito",
      );
    });
  });

  describe("o efeito para o cliente de outro bairro", () => {
    const efeito = () => opcao("Só perto da loja")?.textContent ?? "";

    it("transportadora vende fora e o pagamento pelo app está ligado: compra com transportadora, se tiver conta", () => {
      montar("", {
        nomesLigados: ["Melhor Envio"],
        pagamentoPeloAppLigado: true,
        coverage: "national",
      });
      expect(efeito()).toContain(
        "Cliente de outro bairro: compra com transportadora, se tiver conta.",
      );
    });

    it("transportadora ligada mas SEM pagamento pelo app: não promete a compra (o checkout recusa)", () => {
      montar("", {
        nomesLigados: ["Melhor Envio"],
        pagamentoPeloAppLigado: false,
        coverage: "national",
      });
      expect(efeito()).toContain(
        "Cliente de outro bairro: não consegue comprar",
      );
      expect(efeito()).toContain("pagamento pelo app");
      expect(efeito()).not.toContain("compra com transportadora");
    });

    it("sem transportadora ligada: 'não consegue comprar'", () => {
      montar("", {
        nomesLigados: [],
        pagamentoPeloAppLigado: true,
        coverage: "national",
      });
      expect(efeito()).toContain(
        "Cliente de outro bairro: não consegue comprar.",
      );
    });

    it("'só entregar na cidade' ligado: não consegue comprar, mesmo com transportadora e pagamento", () => {
      montar("", {
        nomesLigados: ["Melhor Envio"],
        pagamentoPeloAppLigado: true,
        coverage: "local",
      });
      expect(efeito()).toContain("não consegue comprar");
      expect(efeito()).not.toContain("compra com transportadora");
    });

    it("leitura das transportadoras falhou, ainda carregando (null) ou ausente: a tela não afirma nada", () => {
      for (const nomesLigados of [null, undefined]) {
        montar("", { nomesLigados, pagamentoPeloAppLigado: true });
        expect(efeito()).not.toContain("Cliente de outro bairro");
        expect(efeito()).toContain("normalmente um pedaço do seu bairro.");
      }
    });

    it("transportadora vende mas não se sabe do pagamento: também não afirma", () => {
      montar("", {
        nomesLigados: ["Melhor Envio"],
        pagamentoPeloAppLigado: null,
        coverage: "national",
      });
      expect(efeito()).not.toContain("Cliente de outro bairro");
    });
  });

  describe("'Em mais lugares': teste o CEP de um cliente", () => {
    it("só aparece depois de escolher 'Em mais lugares'", () => {
      montar("");
      expect(campoDeTeste()).toBeNull();
      clicar(opcao("Em mais lugares"));
      expect(campoDeTeste()).not.toBeNull();
      expect(texto()).toContain("Teste o CEP de um cliente");
      // Escolher "Em mais lugares" não grava nada sozinho.
      expect(gravados).toEqual([]);
    });

    it("CEP da região da loja: 'Entra na sua entrega' com o valor", () => {
      montar("");
      abrirMaisLugaresEDigitar("38400999");
      expect(texto()).toContain("Entra na sua entrega — paga R$ 10");
      expect(texto()).not.toContain("Fica de fora");
      expect(campoDeTeste()?.value).toBe("38400-999");
    });

    it("entrega grátis (valor 0): diz que é grátis, não 'paga R$ 0'", () => {
      montar("", { valor: 0 });
      abrirMaisLugaresEDigitar("38400-999");
      expect(texto()).toContain("Entra na sua entrega — entrega grátis");
      expect(texto()).not.toContain("R$ 0");
    });

    it("valor com centavos usa vírgula", () => {
      montar("", { valor: 7.5 });
      abrirMaisLugaresEDigitar("38400-999");
      expect(texto()).toContain("paga R$ 7,50");
    });

    it("CEP de outra região: 'Fica de fora' e o botão que inclui a região", () => {
      montar("");
      abrirMaisLugaresEDigitar("38500-123");
      expect(texto()).toContain("Fica de fora da sua entrega");
      expect(texto()).not.toContain("Entra na sua entrega");
      expect(botao("Incluir a região deste CEP")).toBeDefined();
    });

    it("CEP incompleto: não responde nada (nem entra, nem fica de fora, nem botão)", () => {
      montar("");
      abrirMaisLugaresEDigitar("3850012");
      expect(texto()).not.toContain("Entra na sua entrega");
      expect(texto()).not.toContain("Fica de fora");
      expect(botao("Incluir a região deste CEP")).toBeUndefined();
    });

    it("lixo digitado vira só números, no máximo 8", () => {
      montar("");
      clicar(opcao("Em mais lugares"));
      digitar(campoDeTeste(), "38a50b0-1239999");
      expect(campoDeTeste()?.value).toBe("38500-123");
    });

    it("'Incluir a região' com alcance vazio: a região da loja CONTINUA dentro, e a nova entra", () => {
      montar("");
      abrirMaisLugaresEDigitar("38500-123");
      clicar(botao("Incluir a região deste CEP"));
      expect(gravados).toEqual(["38400, 38500"]);
      // Agora o mesmo CEP entra, e o botão some (nada para incluir de novo).
      expect(texto()).toContain("Entra na sua entrega — paga R$ 10");
      expect(botao("Incluir a região deste CEP")).toBeUndefined();
      // E a região da loja não foi trocada: CEP dela segue entrando.
      digitar(campoDeTeste(), "38400-100");
      expect(texto()).toContain("Entra na sua entrega");
    });

    it("o campo do teste aceita CEP colado com máscara (sem maxLength cortando)", () => {
      montar("");
      clicar(opcao("Em mais lugares"));
      expect(campoDeTeste()?.hasAttribute("maxlength")).toBe(false);
      digitar(campoDeTeste(), "38.500-123");
      expect(campoDeTeste()?.value).toBe("38500-123");
      expect(texto()).toContain("Fica de fora da sua entrega");
    });

    it("depois de 'Incluir a região' o foco volta ao campo do teste (o botão some) e o 'Hoje' muda", () => {
      montar("");
      expect(texto()).toContain("Hoje: CEPs que começam com 38400.");
      abrirMaisLugaresEDigitar("38500-123");
      clicar(botao("Incluir a região deste CEP"));
      expect(document.activeElement).toBe(campoDeTeste());
      expect(texto()).toContain("Hoje: CEPs que você escolheu.");
      expect(texto()).not.toContain("Hoje: CEPs que começam com 38400.");
    });

    it("texto escrito sem números: o 'Hoje' diz que não há CEP, e incluir não abre a região da loja", () => {
      montar("abc");
      expect(texto()).toContain(
        "Hoje: nenhum CEP: o que está escrito não tem números.",
      );
      digitar(campoDeTeste(), "38400-100");
      expect(texto()).toContain("Fica de fora da sua entrega");
      digitar(campoDeTeste(), "38500-123");
      clicar(botao("Incluir a região deste CEP"));
      expect(gravados).toEqual(["38500"]);
      digitar(campoDeTeste(), "38400-100");
      expect(texto()).toContain("Fica de fora da sua entrega");
    });

    it("incluir não duplica: duas regiões, cada uma uma vez", () => {
      montar("38400");
      abrirMaisLugaresEDigitar("38500-123");
      clicar(botao("Incluir a região deste CEP"));
      digitar(campoDeTeste(), "38500-999");
      // A mesma região já entrou: não há o que incluir.
      expect(botao("Incluir a região deste CEP")).toBeUndefined();
      digitar(campoDeTeste(), "38600-001");
      clicar(botao("Incluir a região deste CEP"));
      expect(gravados).toEqual(["38400, 38500", "38400, 38500, 38600"]);
    });

    it("a faixa que a lojista já tinha (dois CEPs completos) continua sendo a MESMA faixa depois de incluir", () => {
      montar("38500-000, 38509-999");
      // Quem já usa abre em "Em mais lugares" (a opção marcada) e o texto livre aberto.
      expect(opcao("Em mais lugares")?.getAttribute("aria-checked")).toBe(
        "true",
      );
      expect(hospedeiro.querySelector("details")?.hasAttribute("open")).toBe(
        true,
      );
      digitar(campoDeTeste(), "38505-100");
      expect(texto()).toContain("Entra na sua entrega");
      digitar(campoDeTeste(), "38600-001");
      expect(texto()).toContain("Fica de fora da sua entrega");
      clicar(botao("Incluir a região deste CEP"));
      const nova = gravados.at(-1) as string;
      // O meio da faixa continua entrando (a regra do servidor não foi quebrada).
      for (const destino of [
        "38500-000",
        "38505-100",
        "38509-999",
        "38600-777",
      ]) {
        expect(cepEhLocal(CEP_DA_LOJA, destino, nova), destino).toBe(true);
      }
      expect(cepEhLocal(CEP_DA_LOJA, "38510-000", nova)).toBe(false);
    });
  });

  describe("o texto livre continua para quem já o usa", () => {
    it("fica recolhido em 'Escrever faixa de CEP' quando não há nada escrito", () => {
      montar("");
      const detalhes = hospedeiro.querySelector("details");
      expect(detalhes).not.toBeNull();
      expect(detalhes?.hasAttribute("open")).toBe(false);
      expect(detalhes?.querySelector("summary")?.textContent).toContain(
        "Escrever faixa de CEP",
      );
      expect(detalhes?.querySelector("#local-cep-range")).not.toBeNull();
    });

    // O painel era controlado pelo valor digitado: ao chegar em "38400" (os 5
    // números da loja) ele FECHAVA no meio da digitação e a lojista perdia o
    // foco do campo.
    it("digitar a faixa completa, letra por letra, com o painel aberto: ele NÃO fecha em nenhum passo", () => {
      montar("");
      const detalhes = hospedeiro.querySelector(
        "details",
      ) as HTMLDetailsElement;
      clicar(detalhes.querySelector("summary") as HTMLElement);
      act(() => {
        detalhes.open = true;
      });
      const campo = () =>
        hospedeiro.querySelector<HTMLInputElement>("#local-cep-range");
      let digitado = "";
      for (const letra of "38400-000, 38415-999") {
        digitado += letra;
        digitar(campo(), digitado);
        expect(detalhes.open, JSON.stringify(digitado)).toBe(true);
      }
      expect(campo()?.value).toBe("38400-000, 38415-999");
    });

    it("apagar tudo para redigitar também não fecha o painel", () => {
      montar("38500-000, 38509-999");
      const detalhes = hospedeiro.querySelector(
        "details",
      ) as HTMLDetailsElement;
      expect(detalhes.open).toBe(true);
      digitar(hospedeiro.querySelector("#local-cep-range"), "");
      expect(detalhes.open).toBe(true);
      digitar(hospedeiro.querySelector("#local-cep-range"), "38400");
      expect(detalhes.open).toBe(true);
    });

    it("quem fechou o painel de propósito não o vê reabrir quando o texto muda por outro caminho", () => {
      montar("38500-000, 38509-999");
      const detalhes = hospedeiro.querySelector(
        "details",
      ) as HTMLDetailsElement;
      expect(detalhes.open).toBe(true);
      // A lojista fecha (clique no resumo = ação dela).
      clicar(detalhes.querySelector("summary") as HTMLElement);
      act(() => {
        detalhes.open = false;
      });
      clicar(opcao("Só perto da loja"));
      expect(detalhes.open).toBe(false);
      // O texto volta a ser "próprio" (inclui uma região): segue fechado.
      abrirMaisLugaresEDigitar("38500-123");
      clicar(botao("Incluir a região deste CEP"));
      expect(gravados.at(-1)).toBe("38400, 38500");
      expect(detalhes.open).toBe(false);
    });

    it("digitar no campo grava o texto como sempre", () => {
      montar("");
      digitar(
        hospedeiro.querySelector<HTMLInputElement>("#local-cep-range"),
        "38400, 38450",
      );
      expect(gravados).toEqual(["38400, 38450"]);
    });
  });

  describe("sem CEP completo da loja não há 'perto da loja' para escolher", () => {
    it("mostra só o campo de texto, sem as duas respostas", () => {
      for (const cepDaLoja of ["", "384", null, undefined]) {
        montar("", { cepDaLoja });
        expect(hospedeiro.querySelector('[role="radiogroup"]')).toBeNull();
        expect(hospedeiro.querySelector("#local-cep-range")).not.toBeNull();
        expect(texto()).toContain("Escrever faixa de CEP");
      }
    });
  });

  it("a config chega DEPOIS do primeiro desenho: quem já tinha alcance escrito cai em 'Em mais lugares', não em limbo", () => {
    const desenhar = (faixa: string) =>
      act(() => {
        raiz.render(
          <FreteLocalBloco
            valor={10}
            onValor={() => {}}
            faixa={faixa}
            onFaixa={() => {}}
            coverage="national"
            onCoverage={() => {}}
            cepDaLoja={CEP_DA_LOJA}
          />,
        );
      });
    desenhar("");
    expect(opcao("Em mais lugares")?.getAttribute("aria-checked")).toBe(
      "false",
    );
    desenhar("38500-000, 38509-999");
    expect(opcao("Em mais lugares")?.getAttribute("aria-checked")).toBe("true");
    expect(opcao("Só perto da loja")?.getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(campoDeTeste()).not.toBeNull();
  });

  it("offline (desabilitado): as duas respostas e o campo de teste não respondem", () => {
    montar("", { desabilitado: true });
    expect(opcao("Só perto da loja")?.disabled).toBe(true);
    expect(opcao("Em mais lugares")?.disabled).toBe(true);
  });
});
