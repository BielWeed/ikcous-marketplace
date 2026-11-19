import { BaixarPlanilhaProdutos } from "@/components/admin/products/BaixarPlanilhaProdutos";
// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { exportar, sucesso, erro, aviso } = vi.hoisted(() => ({
  exportar: vi.fn(),
  sucesso: vi.fn(),
  erro: vi.fn(),
  aviso: vi.fn(),
}));
vi.mock("@/lib/exportar-produtos-planilha", () => ({
  exportarProdutosPlanilha: exportar,
}));
vi.mock("sonner", () => ({
  toast: { success: sucesso, error: erro, warning: aviso },
}));

let root: Root;
let host: HTMLDivElement;
let resolver: () => void;
let conta = "conta-teste";
const idDaContaViva = () => conta;

async function montar(permitido = true) {
  await act(async () =>
    root.render(
      <BaixarPlanilhaProdutos
        permitido={permitido}
        nomeLoja="Loja de teste"
        idDaContaViva={idDaContaViva}
      />,
    ),
  );
}
async function clicar() {
  await act(async () => host.querySelector("button")?.click());
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  conta = "conta-teste";
  exportar.mockImplementation(
    () =>
      new Promise<"xlsx">((resolve) => {
        resolver = () => resolve("xlsx");
      }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});

describe("botão de planilha", () => {
  it("some sem a mesma permissão de leitura administrativa", async () => {
    await montar(false);
    expect(host.querySelector("button")).toBeNull();
    expect(exportar).not.toHaveBeenCalled();
  });
  it("mostra nome acessível, catálogo inteiro e estado gerando sem clique duplicado", async () => {
    await montar();
    const botao = host.querySelector("button")!;
    expect(botao.getAttribute("aria-label")).toBe("Baixar planilha");
    expect(botao.title).toContain("catálogo completo");
    expect(exportar).not.toHaveBeenCalled();
    await clicar();
    expect(exportar).toHaveBeenCalledTimes(1);
    expect(exportar.mock.calls[0][0]).toMatchObject({
      conta: "conta-teste",
      nomeLoja: "Loja de teste",
      comCustos: true,
    });
    expect(botao.disabled).toBe(true);
    expect(botao.getAttribute("aria-busy")).toBe("true");
    expect(botao.textContent).toContain("Gerando");
    await clicar();
    expect(exportar).toHaveBeenCalledTimes(1);
    await act(async () => resolver());
    expect(botao.disabled).toBe(false);
    expect(sucesso).toHaveBeenCalledWith(
      "Planilha gerada. Confira os downloads do seu aparelho.",
    );
  });
  it("avisa que não há produtos cadastrados sem anunciar download", async () => {
    exportar.mockResolvedValue("vazio");
    await montar();
    await clicar();
    expect(aviso).toHaveBeenCalledWith(
      "Nenhum produto cadastrado para exportar.",
    );
    expect(sucesso).not.toHaveBeenCalled();
    expect(erro).not.toHaveBeenCalled();
    expect(host.querySelector("button")!.disabled).toBe(false);
  });
  it("avisa que o CSV alternativo não tem formatação, sem anunciar sucesso de XLSX", async () => {
    exportar.mockResolvedValue("csv");
    await montar();
    await clicar();
    expect(aviso).toHaveBeenCalledWith(
      "Planilha gerada em CSV, sem formatação. Confira os downloads do seu aparelho. Para não perder zeros à esquerda em código interno e código de barras, importe essas colunas como Texto.",
    );
    expect(sucesso).not.toHaveBeenCalled();
    expect(erro).not.toHaveBeenCalled();
    expect(host.querySelector("button")!.disabled).toBe(false);
  });
  it("informa erro simples sem exibir o erro cru do servidor", async () => {
    exportar.mockRejectedValue(new Error("resposta privada"));
    await montar();
    await clicar();
    expect(erro).toHaveBeenCalledWith(
      "Não foi possível baixar a planilha. Tente novamente.",
    );
    expect(sucesso).not.toHaveBeenCalled();
    expect(host.querySelector("button")!.disabled).toBe(false);
  });
  it("perder permissão cancela e proíbe baixar a resposta antiga", async () => {
    await montar();
    await clicar();
    const opcoes = exportar.mock.calls[0][0];
    await montar(false);
    expect(opcoes.sinal.aborted).toBe(true);
    expect(opcoes.podeContinuar()).toBe(false);
    await act(async () => resolver());
    expect(sucesso).not.toHaveBeenCalled();
    expect(host.querySelector("button")).toBeNull();
  });
  it("trocar conta impede usar os dados de quem saiu", async () => {
    await montar();
    await clicar();
    const opcoes = exportar.mock.calls[0][0];
    conta = "outra-conta";
    expect(opcoes.podeContinuar()).toBe(false);
    await act(async () => resolver());
    expect(sucesso).not.toHaveBeenCalled();
  });
  it("desmontar cancela a geração em andamento", async () => {
    await montar();
    await clicar();
    const opcoes = exportar.mock.calls[0][0];
    await act(async () => root.unmount());
    expect(opcoes.sinal.aborted).toBe(true);
    root = createRoot(host);
  });
});
