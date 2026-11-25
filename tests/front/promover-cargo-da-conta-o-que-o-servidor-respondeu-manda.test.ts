// Caça de provas fracas (24/11/2026), papéis: o resultado de `definirCargo`
// reporta o que o SERVIDOR disse, não o que a tela pediu.
//   - se a resposta traz um cargo diferente do pedido (o banco normalizou ou
//     recusou em silêncio), o toast de sucesso tem de falar do cargo REAL:
//     dizer "agora é administrador" quando o banco devolveu "customer" seria
//     afirmar uma permissão que a pessoa não tem;
//   - cargo desconhecido na resposta (lixo) não é aceito como cargo: cai no
//     que foi pedido, como o vizinho já faz para "resposta sem forma conhecida";
//   - texto do banco chega sem espaço sobrando, e sem código vira `null`;
//   - o nome no aviso de sucesso é aparado (só espaços = "Esta pessoa").
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => h.rpc(...args),
  },
}));

import {
  MENSAGEM_DONO_INCOMPLETO,
  definirCargo,
  textoDoSucesso,
} from "@/lib/cargo-da-conta";

const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.rpc.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("definirCargo — o cargo devolvido pelo servidor vale mais que o pedido", () => {
  it("pediu admin, o servidor respondeu customer: o resultado diz customer", async () => {
    h.rpc.mockResolvedValue({
      data: { user_id: ID, de: "customer", para: "customer", mudou: false },
      error: null,
    });
    expect(await definirCargo(ID, "admin")).toEqual({
      ok: true,
      para: "customer",
      mudou: false,
    });
  });

  it("pediu customer, o servidor respondeu admin: o resultado diz admin", async () => {
    h.rpc.mockResolvedValue({
      data: { user_id: ID, de: "admin", para: "admin", mudou: false },
      error: null,
    });
    expect(await definirCargo(ID, "customer")).toEqual({
      ok: true,
      para: "admin",
      mudou: false,
    });
  });

  it("cargo desconhecido na resposta não é aceito: cai no pedido", async () => {
    h.rpc.mockResolvedValue({
      data: { user_id: ID, de: "customer", para: "superuser", mudou: true },
      error: null,
    });
    expect(await definirCargo(ID, "customer")).toEqual({
      ok: true,
      para: "customer",
      mudou: true,
    });
  });
});

describe("definirCargo — texto e código do erro chegam limpos", () => {
  it("mensagem do banco com espaço e quebra de linha sobrando é aparada", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "  Pessoa não encontrada.\n" },
    });
    expect(await definirCargo(ID, "admin")).toEqual({
      ok: false,
      codigo: "P0002",
      mensagem: "Pessoa não encontrada.",
    });
  });

  it("código com espaço sobrando ainda é reconhecido (42501 + 'duas fontes')", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: {
        code: " 42501 ",
        message: "o dono precisa ser administrador nas duas fontes",
      },
    });
    expect(await definirCargo(ID, "admin")).toEqual({
      ok: false,
      codigo: "42501",
      mensagem: MENSAGEM_DONO_INCOMPLETO,
    });
  });

  it("'Duas Fontes' em outra caixa também é o cadastro do dono incompleto", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "Nas Duas Fontes" },
    });
    expect(await definirCargo(ID, "admin")).toMatchObject({
      mensagem: MENSAGEM_DONO_INCOMPLETO,
    });
  });

  it.each([
    ["sem código", { message: "algo deu errado" }],
    ["código vazio", { code: "", message: "algo deu errado" }],
    ["código só de espaços", { code: "   ", message: "algo deu errado" }],
  ])("%s: o código devolvido é null", async (_nome, erro) => {
    h.rpc.mockResolvedValue({ data: null, error: erro });
    expect(await definirCargo(ID, "admin")).toEqual({
      ok: false,
      codigo: null,
      mensagem: "algo deu errado",
    });
  });
});

describe("textoDoSucesso — nome aparado", () => {
  it("nome só com espaços vira 'Esta pessoa'", () => {
    expect(textoDoSucesso("   ", "admin")).toMatch(/^Esta pessoa agora é/);
    expect(textoDoSucesso("\n", "customer")).toMatch(/^Esta pessoa voltou/);
  });

  it("nome com espaço nas pontas sai sem o espaço", () => {
    expect(textoDoSucesso("  Maria  ", "admin")).toMatch(/^Maria agora é/);
  });
});
