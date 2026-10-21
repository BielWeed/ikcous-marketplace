// @vitest-environment jsdom
import { criarCanalDeAbas } from "@/lib/canal-de-abas";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

it("sem window não tenta construir canal", () => {
  const construir = vi.fn();
  vi.stubGlobal("window", undefined);
  vi.stubGlobal("BroadcastChannel", construir);
  expect(criarCanalDeAbas("teste")).toBeNull();
  expect(construir).not.toHaveBeenCalled();
});

it("sem a propriedade BroadcastChannel devolve null", () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  Reflect.deleteProperty(globalThis, "BroadcastChannel");
  expect(criarCanalDeAbas("teste")).toBeNull();
});

it("construtor bloqueado devolve null sem lançar", () => {
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      constructor() {
        throw new DOMException("Canal bloqueado", "SecurityError");
      }
    },
  );
  expect(criarCanalDeAbas("teste")).toBeNull();
});

it("preserva o canal, seu nome, mensagens e fechamento quando há suporte", () => {
  let nomeRecebido = "";
  const mensagens: unknown[] = [];
  let fechado = false;
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      constructor(nome: string) {
        nomeRecebido = nome;
      }
      postMessage(mensagem: unknown) {
        mensagens.push(mensagem);
      }
      close() {
        fechado = true;
      }
    },
  );
  const canal = criarCanalDeAbas("canal-teste");
  expect(canal).not.toBeNull();
  canal!.postMessage({ tipo: "atualizar" });
  canal!.close();
  expect(nomeRecebido).toBe("canal-teste");
  expect(mensagens).toEqual([{ tipo: "atualizar" }]);
  expect(fechado).toBe(true);
});
