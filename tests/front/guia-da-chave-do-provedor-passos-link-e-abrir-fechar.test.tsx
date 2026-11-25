// @vitest-environment jsdom
//
// "Como pegar a chave" (GuiaDaChaveDoProvedor): o passo a passo de cada
// provedor de frete, o link oficial (abre em outra aba SEM entregar a janela
// de origem ao site de fora), a nota de ambiente (só Melhor Envio e SuperFrete)
// e o abrir/fechar. Caça por mutação (25/11/2026): o teste que existia só
// conferia o nome sugerido para o token; trocar o endereço do link oficial,
// tirar o `noreferrer`, abrir o guia já aberto ou perder um passo passava em
// branco.
//
// Nota de leitura: o guia nasce FECHADO mesmo dentro de um cartão aberto; o
// painel fechado continua montado (só `hidden`), para o leitor de tela e o
// `aria-controls` apontarem para um elemento que existe.
import { GuiaDaChaveDoProvedor } from "@/components/admin/settings/GuiaDaChaveDoProvedor";
import type { ProvedorFrete } from "@/components/admin/settings/TransportadorasCard";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});

afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

function montar(provider: ProvedorFrete) {
  act(() => {
    raiz.render(<GuiaDaChaveDoProvedor provider={provider} />);
  });
}

const cabecalho = () => host.querySelector("button") as HTMLButtonElement;
const corpo = () =>
  document.getElementById(
    cabecalho().getAttribute("aria-controls") ?? "",
  ) as HTMLElement;
const passos = () =>
  [...host.querySelectorAll("ol > li")].map((li) => li.textContent);
const link = () => host.querySelector("a") as HTMLAnchorElement;
const nota = () => host.querySelector("p");

const MELHOR_ENVIO = [
  "Acesse o painel do Melhor Envio e faça login.",
  'No menu à esquerda, clique em "Integrações" e depois em "Permissões de Acesso".',
  'Clique no botão "GERAR NOVO TOKEN".',
  'Marque "Li e concordo com as condições descritas acima" e clique em "Avançar".',
  'Dê um nome para o token (ex.: o nome da sua loja) no campo "Nome".',
  'Clique em "Selecionar todos" — garante que cotação e etiqueta funcionem juntas.',
  'Clique em "GERAR TOKEN".',
  'Clique em "COPIAR TOKEN" e cole aqui embaixo. Ele só aparece nesta tela, uma vez só — se sair sem copiar, precisa gerar outro.',
];

const SUPERFRETE = [
  'Faça login na SuperFrete e abra a página de integrações: "web.superfrete.com/#/integrations" (com o Modo de teste ligado: "sandbox.superfrete.com/#/integrations").',
  'Clique em "Integrar em Desenvolvedores".',
  "Confirme a ação quando a tela pedir.",
  "Copie o token mostrado e cole aqui embaixo.",
];

const FRENET = [
  'No site da Frenet, clique em "ACESSAR MEU PAINEL" e faça login.',
  "No canto superior direito, clique no ícone de usuário.",
  'Selecione "DADOS CADASTRAIS".',
  'Na seção "Chaves de acesso", copie o token do campo "TOKEN".',
  "Cole aqui embaixo.",
];

describe("GuiaDaChaveDoProvedor: o passo a passo de cada provedor", () => {
  it("Melhor Envio: oito passos, na ordem, e a nota do ambiente de teste", () => {
    montar("melhor_envio");
    expect(passos()).toEqual(MELHOR_ENVIO);
    expect(nota()?.textContent).toBe(
      'Com o "Modo de teste" ligado aqui, gere o token no Melhor Envio de testes ("sandbox.melhorenvio.com.br"). Um token do ambiente errado não funciona.',
    );
    expect(link().textContent).toBe("Ver a instrução oficial do Melhor Envio");
    expect(link().getAttribute("href")).toBe(
      "https://centraldeajuda.melhorenvio.com.br/hc/pt-br/articles/31220417726228-Integra%C3%A7%C3%A3o-Magento-1-Inser%C3%A7%C3%A3o-do-Token",
    );
  });

  it("SuperFrete: quatro passos com os dois endereços (produção e teste) e a nota dos tokens diferentes", () => {
    montar("superfrete");
    expect(passos()).toEqual(SUPERFRETE);
    expect(nota()?.textContent).toBe(
      'Produção e modo de teste usam tokens DIFERENTES — gere o token no mesmo ambiente que está marcado em "Modo de teste" acima. Um token do ambiente errado não cota.',
    );
    expect(link().textContent).toBe("Ver a documentação oficial da SuperFrete");
    expect(link().getAttribute("href")).toBe(
      "https://superfrete.readme.io/reference/primeiros-passos",
    );
  });

  it("Frenet: cinco passos, SEM nota, e o link da Central de Ajuda", () => {
    montar("frenet");
    expect(passos()).toEqual(FRENET);
    expect(nota()).toBeNull();
    expect(link().textContent).toBe("Ver a instrução oficial da Frenet");
    expect(link().getAttribute("href")).toBe(
      "https://ajuda.frenet.com.br/knowledge-base/api-frenet",
    );
  });

  it("cada provedor desenha um guia (nenhum cai no 'nada')", () => {
    for (const provedor of ["melhor_envio", "superfrete", "frenet"] as const) {
      montar(provedor);
      expect(host.querySelector("button")).not.toBeNull();
      expect(host.textContent).toContain("Como pegar a chave");
    }
  });

  it("provedor sem guia não desenha nada (nem o botão)", () => {
    montar("provedor_que_nao_existe" as unknown as ProvedorFrete);
    expect(host.innerHTML).toBe("");
  });
});

describe("GuiaDaChaveDoProvedor: o link oficial", () => {
  it("abre em outra aba e NÃO entrega a janela de origem ao site de fora", () => {
    montar("frenet");
    expect(link().getAttribute("target")).toBe("_blank");
    const rel = (link().getAttribute("rel") ?? "").split(/\s+/);
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
  });
});

describe("GuiaDaChaveDoProvedor: abrir e fechar", () => {
  it("nasce FECHADO: aria-expanded falso, corpo escondido, seta para baixo", () => {
    montar("frenet");
    expect(cabecalho().getAttribute("aria-expanded")).toBe("false");
    expect(corpo().hidden).toBe(true);
    expect(
      cabecalho().querySelector("svg:last-child")?.getAttribute("class"),
    ).not.toContain("rotate-180");
  });

  it("o cabeçalho é um botão de verdade que aponta (aria-controls) para o corpo, e o corpo guarda os passos", () => {
    montar("frenet");
    expect(cabecalho().type).toBe("button");
    expect(corpo()).toBeTruthy();
    expect(corpo().contains(link())).toBe(true);
    expect(corpo().querySelectorAll("li")).toHaveLength(FRENET.length);
    expect(cabecalho().textContent).toContain("Como pegar a chave");
  });

  it("um clique abre; o segundo fecha de novo", () => {
    montar("frenet");
    act(() => cabecalho().click());
    expect(cabecalho().getAttribute("aria-expanded")).toBe("true");
    expect(corpo().hidden).toBe(false);
    expect(
      cabecalho().querySelector("svg:last-child")?.getAttribute("class"),
    ).toContain("rotate-180");
    act(() => cabecalho().click());
    expect(cabecalho().getAttribute("aria-expanded")).toBe("false");
    expect(corpo().hidden).toBe(true);
  });

  it("cada instância tem o SEU corpo: dois guias abertos não se confundem", () => {
    act(() => {
      raiz.render(
        <>
          <GuiaDaChaveDoProvedor provider="frenet" />
          <GuiaDaChaveDoProvedor provider="superfrete" />
        </>,
      );
    });
    const [a, b] = [...host.querySelectorAll("button")];
    const idA = a.getAttribute("aria-controls");
    const idB = b.getAttribute("aria-controls");
    expect(idA).toBeTruthy();
    expect(idA).not.toBe(idB);
    act(() => a.click());
    expect(a.getAttribute("aria-expanded")).toBe("true");
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(idA ?? "")?.hidden).toBe(false);
    expect(document.getElementById(idB ?? "")?.hidden).toBe(true);
  });
});
