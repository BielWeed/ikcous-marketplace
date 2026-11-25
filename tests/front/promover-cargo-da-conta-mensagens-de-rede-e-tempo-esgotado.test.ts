// Caça de provas fracas (24/11/2026), papéis: a tradução dos erros de
// `definirCargo` (tirar ou dar acesso de administrador) tem dois limites que
// o teste vizinho (`promover-cargo-da-conta`) não separa:
//   - "demorou demais" só vale para o 57014 que é TEMPO ESGOTADO. Outro 57014
//     (consulta cancelada a pedido, por exemplo) diz o que o banco disse; se a
//     tela afirmasse "demorou demais" num cancelamento, a pessoa repetiria uma
//     mudança de permissão sem saber se ela foi feita;
//   - "sem internet" vale para as quatro escritas de falha de rede dos
//     navegadores (Chrome, Firefox, Safari, apps antigos), em qualquer caixa —
//     o vizinho só cobre "Failed to fetch".
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => h.rpc(...args),
  },
}));

import { MENSAGEM_SEM_REDE, definirCargo } from "@/lib/cargo-da-conta";

const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.rpc.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("definirCargo — 57014 só é 'demorou demais' quando é tempo esgotado", () => {
  it("57014 de consulta cancelada a pedido: mostra o que o banco disse", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "57014",
        message: "canceling statement due to user request",
      },
    });
    expect(await definirCargo(ID, "admin")).toEqual({
      ok: false,
      codigo: "57014",
      mensagem: "canceling statement due to user request",
    });
  });

  it("57014 com 'statement timeout' em maiúsculas continua sendo tempo esgotado", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "57014",
        message: "CANCELING STATEMENT DUE TO STATEMENT TIMEOUT",
      },
    });
    expect(await definirCargo(ID, "admin")).toMatchObject({
      ok: false,
      codigo: "57014",
      mensagem:
        "A mudança de acesso demorou demais. Tente de novo em instantes.",
    });
  });

  it("'statement timeout' sem o código 57014 NÃO vira 'demorou demais'", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "statement timeout" },
    });
    expect(await definirCargo(ID, "admin")).toMatchObject({
      mensagem: "statement timeout",
    });
  });
});

describe("definirCargo — toda escrita de falha de rede vira 'sem internet'", () => {
  it.each([
    ["Chrome", "TypeError: Failed to fetch"],
    ["Firefox", "NetworkError when attempting to fetch resource."],
    ["apps antigos", "Network request failed"],
    ["Safari", "Load failed"],
    ["caixa alta", "FAILED TO FETCH"],
    ["caixa mista", "networkerror when attempting to fetch resource"],
  ])("%s: %s", async (_navegador, mensagem) => {
    h.rpc.mockResolvedValue({ data: null, error: { message: mensagem } });
    expect(await definirCargo(ID, "customer")).toMatchObject({
      ok: false,
      mensagem: MENSAGEM_SEM_REDE,
    });
  });

  it("erro que só PARECE rede mas é recusa do banco segue como o banco disse", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "42501",
        message: "Acesso negado: só o dono da loja define cargos.",
      },
    });
    expect(await definirCargo(ID, "admin")).toMatchObject({
      mensagem: "Acesso negado: só o dono da loja define cargos.",
    });
  });
});
