// @vitest-environment jsdom
//
// Devoluções: busca sem resultado dizia só "Nada encontrado" e repetia o texto
// de "quando um cliente pedir uma devolução", sem lembrar que o chip de status
// ativo também limita a busca. Agora a frase nomeia o que foi buscado e o
// status, e o botão "Limpar busca e filtros" volta à lista inteira.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc, functions: { invoke: vi.fn() }, storage: { from: vi.fn() } },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const vazia = {
  data: { total: 0, contagem: { solicitada: 1 }, itens: [] },
  error: null,
};

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue(vazia);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

async function drenar() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}

async function montar() {
  const { AdminDevolucoesView } = await import(
    "@/views/admin/AdminDevolucoesView"
  );
  await act(async () => {
    raiz.render(<AdminDevolucoesView onNavigate={vi.fn()} active />);
  });
  await drenar();
}

async function escolherChip(rotulo: string) {
  const grupo = hospedeiro.querySelector('[role="group"]')!;
  const alvo = Array.from(grupo.querySelectorAll("button")).find((b) =>
    b.textContent?.startsWith(rotulo),
  );
  await act(async () => {
    alvo?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await drenar();
}

async function buscar(texto: string) {
  vi.useFakeTimers();
  const campo =
    hospedeiro.querySelector<HTMLInputElement>("#busca-devolucoes")!;
  const atribuir = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    atribuir?.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  vi.useRealTimers();
  await drenar();
}

const tela = () => (hospedeiro.textContent ?? "").replace(/\s+/g, " ");

describe("Devoluções — busca sem resultado", () => {
  it("com status ativo, diz o que foi buscado e em qual status, e não repete o texto de lista vazia", async () => {
    await montar();
    await escolherChip("Solicitadas");
    await buscar("maria");

    expect(tela()).toContain("Nada para “maria” em solicitadas");
    expect(tela()).toContain("A busca está limitada a esse status");
    expect(tela()).not.toContain("Nada encontrado");
    expect(tela()).not.toContain("Quando um cliente pedir");
  });

  it("'Limpar busca e filtros' zera a busca e o status e consulta a lista inteira", async () => {
    await montar();
    await escolherChip("Solicitadas");
    await buscar("maria");

    const limpar = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Limpar busca e filtros",
    );
    expect(limpar).toBeTruthy();
    await act(async () => {
      limpar!.click();
    });
    await drenar();

    const ultima = rpc.mock.calls.at(-1)![1] as {
      p_status: string | null;
      p_busca: string | null;
    };
    expect(ultima.p_status).toBeNull();
    expect(ultima.p_busca).toBeNull();
    expect(
      hospedeiro.querySelector<HTMLInputElement>("#busca-devolucoes")!.value,
    ).toBe("");
  });

  it("sem status ativo, só nomeia a busca", async () => {
    await montar();
    await buscar("maria");

    expect(tela()).toContain("Nada para “maria”");
    expect(tela()).not.toContain("A busca está limitada");
    expect(tela()).not.toContain("Quando um cliente pedir");
  });

  it.each([
    ["Solicitadas", "solicitada"],
    ["Aprovadas", "aprovada"],
    ["Recusadas", "recusada"],
    ["Canceladas", "cancelada"],
    ["A caminho", "a caminho"],
    ["Recebidas", "recebida"],
    ["Concluídas", "concluída"],
    ["Reprovadas", "reprovada"],
  ])("sem busca, %s concorda com nenhuma devolução", async (chip, singular) => {
    await montar();
    await escolherChip(chip);
    const titulo = hospedeiro.querySelector("p.text-sm.font-black");
    expect(titulo?.textContent).toBe(`Nenhuma devolução ${singular}`);
  });

  it("sem busca, a lista vazia continua explicando quando aparece a primeira devolução (controle)", async () => {
    await montar();
    expect(tela()).toContain("Nenhuma devolução ainda");
    expect(tela()).toContain("Quando um cliente pedir");
  });
});
