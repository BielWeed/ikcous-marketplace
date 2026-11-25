// @vitest-environment jsdom
//
// Impostos — "Exportar para o contador": mês e ano geram o CSV e baixam o arquivo;
// período sem nada NÃO baixa arquivo vazio (e diz por quê); erro de leitura NÃO baixa
// arquivo parcial e oferece "Tentar de novo". O componente não lê o banco: recebe
// `buscarLinhas` por prop. Fixtures inventadas (nenhum dado de loja).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { ExportarParaContador } from "@/components/admin/financeiro/impostos/ExportarParaContador";

type Linhas = Parameters<typeof ExportarParaContador>[0] extends {
  buscarLinhas: (...args: never[]) => Promise<infer R>;
}
  ? R
  : never;

const AGORA = new Date("2026-10-15T15:00:00Z");

const COM_VENDA: Linhas = {
  extrato: [
    {
      origem: "venda_online",
      tipo: "entrada",
      status: "realizado",
      valor: 150,
      data: "2026-10-05",
      descricao: "Pedido de teste",
    },
  ],
  guias: [],
};
const SEM_NADA: Linhas = { extrato: [], guias: [] };

let container: HTMLDivElement;
let root: Root;
let arquivosCriados: Blob[];
let cliquesNoLink: { download: string; href: string }[];

beforeEach(() => {
  arquivosCriados = [];
  cliquesNoLink = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    arquivosCriados.push(blob);
    return "blob:fake";
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    cliquesNoLink.push({ download: this.download, href: this.href });
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function montar(
  buscarLinhas: (p: { modo: string; referencia: string }) => Promise<Linhas>,
) {
  await act(async () => {
    root.render(
      <ExportarParaContador
        buscarLinhas={buscarLinhas as never}
        agora={AGORA}
      />,
    );
  });
}

async function esperar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function botao(texto: RegExp): HTMLButtonElement {
  const achado = [...container.querySelectorAll("button")].find((b) =>
    texto.test(b.textContent ?? ""),
  );
  if (!achado) throw new Error(`botão não achado: ${texto}`);
  return achado as HTMLButtonElement;
}

async function clicar(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await esperar();
}

async function escolher(rotulo: string, valor: string) {
  const label = [...container.querySelectorAll("label")].find(
    (l) => l.textContent === rotulo,
  );
  const select = document.getElementById(
    label?.htmlFor ?? "",
  ) as HTMLSelectElement | null;
  if (!select) throw new Error(`campo não achado: ${rotulo}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )?.set?.call(select, valor);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function lerBlob(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(new Uint8Array(leitor.result as ArrayBuffer));
    leitor.onerror = () => reject(leitor.error);
    leitor.readAsArrayBuffer(blob);
  });
}

const faixaDoAviso = () =>
  container.querySelector<HTMLElement>("[aria-live]")?.textContent ?? "";

describe("ExportarParaContador", () => {
  it("mês: busca o período mensal e baixa o CSV com o nome do gerador", async () => {
    const buscar = vi.fn(async () => COM_VENDA);
    await montar(buscar);
    await escolher("Mês", "10");
    await escolher("Ano", "2026");

    await clicar(botao(/Exportar mês/));

    expect(buscar).toHaveBeenCalledTimes(1);
    expect(buscar).toHaveBeenCalledWith({
      modo: "mensal",
      referencia: "2026-10",
    });
    expect(cliquesNoLink).toHaveLength(1);
    expect(cliquesNoLink[0].download).toMatch(
      /^impostos-mensal-2026-10-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$/,
    );
    expect(arquivosCriados).toHaveLength(1);
    const bytes = await lerBlob(arquivosCriados[0]);
    // BOM + conteúdo do gerador (separador `;`, vírgula decimal).
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const texto = new TextDecoder().decode(bytes);
    expect(texto).toContain("Tipo;Data;Competência;Vencimento;Valor (R$)");
    expect(texto).toContain("Receita do dia;05/10/2026;;;150,00;");
    expect(faixaDoAviso()).toMatch(/baixado/i);
  });

  it("ano: busca o período anual e baixa o CSV anual", async () => {
    const buscar = vi.fn(async () => COM_VENDA);
    await montar(buscar);
    await escolher("Ano", "2026");

    await clicar(botao(/Exportar ano/));

    expect(buscar).toHaveBeenCalledWith({
      modo: "anual",
      referencia: "2026",
    });
    expect(cliquesNoLink).toHaveLength(1);
    expect(cliquesNoLink[0].download).toMatch(
      /^impostos-anual-2026-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$/,
    );
  });

  it("período sem nada não baixa arquivo e diz por quê", async () => {
    await montar(vi.fn(async () => SEM_NADA));
    await clicar(botao(/Exportar mês/));

    expect(arquivosCriados).toHaveLength(0);
    expect(cliquesNoLink).toHaveLength(0);
    expect(faixaDoAviso()).toMatch(/nenhum arquivo foi baixado/i);
    expect(faixaDoAviso()).toMatch(/vendas, devoluções ou guias/i);
    expect(container.textContent).not.toMatch(/Tentar de novo/);
  });

  it("erro de leitura não baixa arquivo parcial e deixa tentar de novo", async () => {
    const buscar = vi
      .fn<() => Promise<Linhas>>()
      .mockRejectedValueOnce(new Error("rede caiu"))
      .mockResolvedValueOnce(COM_VENDA);
    await montar(buscar);
    await escolher("Mês", "10");
    await clicar(botao(/Exportar mês/));

    expect(arquivosCriados).toHaveLength(0);
    expect(cliquesNoLink).toHaveLength(0);
    expect(faixaDoAviso()).toMatch(/não deu para ler/i);
    expect(faixaDoAviso()).toMatch(/nenhum arquivo foi baixado/i);
    // O foco vai para a saída do erro (o botão que o corrige).
    expect(document.activeElement).toBe(botao(/Tentar de novo/));

    await clicar(botao(/Tentar de novo/));

    expect(buscar).toHaveBeenCalledTimes(2);
    expect(buscar).toHaveBeenLastCalledWith({
      modo: "mensal",
      referencia: "2026-10",
    });
    expect(cliquesNoLink).toHaveLength(1);
    expect(container.textContent).not.toMatch(/Tentar de novo/);
    // Com a saída do erro sumindo, o foco volta ao botão que originou o pedido.
    expect(document.activeElement).toBe(botao(/Exportar mês/));
  });

  it("mostra carregando no botão e ignora o segundo clique enquanto lê", async () => {
    let liberar: (linhas: Linhas) => void = () => {};
    const buscar = vi.fn(
      () =>
        new Promise<Linhas>((resolve) => {
          liberar = resolve;
        }),
    );
    await montar(buscar);
    botao(/Exportar mês/).focus();

    await clicar(botao(/Exportar mês/));

    expect(botao(/Gerando/).getAttribute("aria-busy")).toBe("true");
    expect(botao(/Exportar ano/).getAttribute("aria-disabled")).toBe("true");
    await clicar(botao(/Exportar ano/));
    await clicar(botao(/Gerando/));
    expect(buscar).toHaveBeenCalledTimes(1);
    // O foco não some quando o botão passa a "ocupado".
    expect(document.activeElement).toBe(botao(/Gerando/));

    await act(async () => {
      liberar(COM_VENDA);
    });
    await esperar();

    expect(cliquesNoLink).toHaveLength(1);
    expect(botao(/Exportar mês/).getAttribute("aria-busy")).toBeNull();
  });

  it("tela fechada antes da resposta não baixa nada", async () => {
    let liberar: (linhas: Linhas) => void = () => {};
    const buscar = vi.fn(
      () =>
        new Promise<Linhas>((resolve) => {
          liberar = resolve;
        }),
    );
    await montar(buscar);
    await clicar(botao(/Exportar mês/));

    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);
    await act(async () => {
      liberar(COM_VENDA);
    });
    await esperar();

    expect(cliquesNoLink).toHaveLength(0);
  });

  it("libera o endereço do arquivo depois do download", async () => {
    vi.useFakeTimers();
    try {
      await montar(vi.fn(async () => COM_VENDA));
      await clicar(botao(/Exportar mês/));
      expect(cliquesNoLink).toHaveLength(1);
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a região que o leitor de tela escuta já existe antes de qualquer aviso", async () => {
    await montar(vi.fn(async () => COM_VENDA));
    expect(container.querySelector("[aria-live]")).not.toBeNull();
  });
});
