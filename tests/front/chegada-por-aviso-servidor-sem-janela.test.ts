// @vitest-environment node
// `src/utils/chegada-por-aviso.ts` onde NÃO existe `window` (a renderização no
// servidor / o import de um módulo que só lê o arquivo): as duas funções não
// podem lançar. Os testes de tela rodam sempre em jsdom, então a guarda
// `typeof window === "undefined"` nunca era exercida.
import {
  aoChegarPorAviso,
  limparGuardadosAoChegarPorAviso,
} from "@/utils/chegada-por-aviso";
import { describe, expect, it, vi } from "vitest";

describe("chegada por aviso sem janela do navegador", () => {
  it("o ambiente deste arquivo de fato não tem window (o controle do teste)", () => {
    expect(typeof window).toBe("undefined");
  });

  it("limparGuardadosAoChegarPorAviso não faz nada e não lança", () => {
    expect(() => limparGuardadosAoChegarPorAviso("admin-qa")).not.toThrow();
    expect(() =>
      limparGuardadosAoChegarPorAviso("admin-reviews", { soEmModeracao: true }),
    ).not.toThrow();
  });

  it("aoChegarPorAviso devolve um cancelamento inofensivo e nunca chama a tela", () => {
    const aoChegar = vi.fn();
    const cancelar = aoChegarPorAviso("admin-qa", aoChegar);
    expect(typeof cancelar).toBe("function");
    expect(() => cancelar()).not.toThrow();
    expect(aoChegar).not.toHaveBeenCalled();
  });
});
