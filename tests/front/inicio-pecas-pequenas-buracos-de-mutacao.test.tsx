// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), peças pequenas do Início: data do cabeçalho,
// dois botões grandes, cartão da loja e "Vendas pagas hoje". Defeitos de UMA
// linha que os testes vizinhos deixavam passar:
//  - `DataDeHoje` descartar a classe que a tela passa;
//  - `AtalhosDoInicio` perder a frase de apoio de cada botão, o nome do grupo
//    (leitor de tela) e o `ativa={false}` (a barra some em tela guardada);
//  - `PerfilDaLoja` trocar a inicial de reserva, a junção "cidade / UF", sumir
//    com a trava do "link copiado", o texto do menu de compartilhar, a logo
//    que quebra, o ícone de local/responsável sem texto e o erro de menu sem
//    nome (`null`);
//  - `HojeNaLoja` virar "0 vendas" quando o dia ainda não chegou, perder o
//    título da seção e os rótulos App/Balcão.
// Dados inventados; nada de rede.
import { AtalhosDoInicio } from "@/components/admin/inicio/AtalhosDoInicio";
import { DataDeHoje } from "@/components/admin/inicio/DataDeHoje";
import { HojeNaLoja } from "@/components/admin/inicio/HojeNaLoja";
import { PerfilDaLoja } from "@/components/admin/inicio/PerfilDaLoja";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function montar(ui: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(ui);
  });
  return container;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(window.navigator, "share");
  Reflect.deleteProperty(window.navigator, "clipboard");
});

describe("DataDeHoje: a classe da tela chega ao parágrafo", () => {
  it("className passado vai para o elemento da data", async () => {
    const tela = await montar(<DataDeHoje className="mt-2" />);
    const data = tela.querySelector('[data-testid="inicio-data"]');
    expect(data?.className).toBe("mt-2");
  });
});

describe("AtalhosDoInicio: apoio de cada botão e grupo", () => {
  it("cada botão traz a sua frase de apoio", async () => {
    const tela = await montar(<AtalhosDoInicio onNavigate={() => {}} />);
    expect(tela.textContent).toContain("Clientes e métricas");
    expect(tela.textContent).toContain("Caixa e contas");
  });

  it("o grupo se chama 'Atalhos do painel' para o leitor de tela", async () => {
    const tela = await montar(<AtalhosDoInicio onNavigate={() => {}} />);
    const grupo = tela.querySelector('[role="group"]');
    expect(grupo?.getAttribute("aria-label")).toBe("Atalhos do painel");
  });

  it("tela guardada (ativa=false) não desenha botão nenhum", async () => {
    const tela = await montar(
      <AtalhosDoInicio onNavigate={() => {}} ativa={false} />,
    );
    expect(tela.querySelectorAll("button")).toHaveLength(0);
  });
});

const propsDaLoja = {
  nome: "Loja Inventada",
  logoUrl: null,
  cidade: "Cidade Ficticia",
  uf: "ZZ",
  responsavel: "Dona Ficticia",
};

describe("PerfilDaLoja: o que aparece no cartão", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("nome em branco: a inicial de reserva é 'L'", async () => {
    const tela = await montar(<PerfilDaLoja {...propsDaLoja} nome="   " />);
    const inicial = tela.querySelector('span[aria-hidden="true"]');
    expect(inicial?.textContent).toBe("L");
  });

  it("cidade e UF vêm juntas com ' / '", async () => {
    const tela = await montar(<PerfilDaLoja {...propsDaLoja} />);
    expect(tela.textContent).toContain("Cidade Ficticia / ZZ");
  });

  it("só a UF, ou só a cidade: sem barra sobrando", async () => {
    const soUf = await montar(<PerfilDaLoja {...propsDaLoja} cidade={null} />);
    expect(soUf.textContent).toContain("ZZ");
    expect(soUf.textContent).not.toContain("/");
    act(() => root.unmount());
    soUf.remove();

    const soCidade = await montar(<PerfilDaLoja {...propsDaLoja} uf={null} />);
    expect(soCidade.textContent).toContain("Cidade Ficticia");
    expect(soCidade.textContent).not.toContain("/");
  });

  it("sem cidade, UF e responsável: nenhum ícone de local nem de pessoa", async () => {
    const tela = await montar(
      <PerfilDaLoja
        {...propsDaLoja}
        cidade={null}
        uf={null}
        responsavel={null}
      />,
    );
    expect(tela.querySelector(".lucide-map-pin")).toBeNull();
    expect(tela.querySelector(".lucide-user-round")).toBeNull();
  });

  it("com cidade e responsável os dois ícones aparecem (controle)", async () => {
    const tela = await montar(<PerfilDaLoja {...propsDaLoja} />);
    expect(tela.querySelector(".lucide-map-pin")).not.toBeNull();
    expect(tela.querySelector(".lucide-user-round")).not.toBeNull();
  });

  it("a logo leva o nome da loja no texto alternativo", async () => {
    const tela = await montar(
      <PerfilDaLoja {...propsDaLoja} logoUrl="https://exemplo.invalid/l.png" />,
    );
    const imagem = tela.querySelector("img");
    expect(imagem?.getAttribute("alt")).toBe("Logo da Loja Inventada");
  });

  it("logo que quebra some e a inicial da loja toma o lugar", async () => {
    const tela = await montar(
      <PerfilDaLoja {...propsDaLoja} logoUrl="https://exemplo.invalid/l.png" />,
    );
    const imagem = tela.querySelector("img");
    expect(imagem).not.toBeNull();
    await act(async () => {
      imagem?.dispatchEvent(new Event("error"));
    });
    expect(tela.querySelector("img")).toBeNull();
    expect(tela.querySelector('span[aria-hidden="true"]')?.textContent).toBe(
      "L",
    );
  });
});

describe("PerfilDaLoja: compartilhar o link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("o menu do aparelho recebe a frase de convite com o nome da loja", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "share", {
      value: share,
      configurable: true,
    });
    const tela = await montar(<PerfilDaLoja {...propsDaLoja} />);
    await act(async () => {
      tela.querySelector("button")?.click();
      await Promise.resolve();
    });
    expect(share).toHaveBeenCalledWith({
      title: "Loja Inventada",
      text: "Conheça a Loja Inventada — compre pelo app:",
      url: `${window.location.origin}/`,
    });
  });

  it("depois de copiar, tocar de novo e a cópia falhar esconde o aviso antigo", async () => {
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("bloqueado"));
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const tela = await montar(<PerfilDaLoja {...propsDaLoja} />);
    const botao = tela.querySelector("button");

    await act(async () => {
      botao?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(tela.querySelector('[role="status"]')).not.toBeNull();

    await act(async () => {
      botao?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(toast.error).toHaveBeenCalledWith(
      "Não foi possível compartilhar agora",
    );
    expect(tela.querySelector('[role="status"]')).toBeNull();
  });

  it("menu que falha sem dar nome ao erro (rejeita com null) cai na cópia do link", async () => {
    Object.defineProperty(window.navigator, "share", {
      value: vi.fn().mockRejectedValue(null),
      configurable: true,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const tela = await montar(<PerfilDaLoja {...propsDaLoja} />);
    await act(async () => {
      tela.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/`);
    expect(toast.success).toHaveBeenCalledWith("Link da loja copiado");
  });
});

describe("HojeNaLoja: título, rótulos e dia que ainda não chegou", () => {
  const hoje = {
    receita: 250,
    online: 100,
    presencial: 150,
    pedidos: 3,
    receitaSemanaPassada: 200,
  };

  it("a seção se chama 'Vendas pagas hoje'", async () => {
    const tela = await montar(<HojeNaLoja hoje={hoje} carregando={false} />);
    expect(tela.querySelector("h2")?.textContent).toBe("Vendas pagas hoje");
  });

  it("a divisão por canal se chama App e Balcão", async () => {
    const tela = await montar(<HojeNaLoja hoje={hoje} carregando={false} />);
    const rotulos = Array.from(tela.querySelectorAll("dt")).map((dt) =>
      (dt.textContent ?? "").trim(),
    );
    expect(rotulos).toEqual(["App", "Balcão"]);
  });

  it("sem dado do dia (e sem carregar) a contagem é traço, nunca '0 vendas'", async () => {
    const tela = await montar(<HojeNaLoja hoje={null} carregando={false} />);
    expect(tela.textContent).not.toMatch(/0\s*vendas/);
    expect(tela.textContent).toContain("— vendas");
  });
});
