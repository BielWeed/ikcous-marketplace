// @vitest-environment jsdom
//
// `useLocalStorage` com `{ entreAbas: true }` (usado pelos favoritos do
// visitante): grava a partir do DISCO e ouve o evento `storage`. Sem a opção
// o hook continua exatamente como era (as telas do painel guardam filtros e
// página com ele e não devem mudar de comportamento).
//
// O caso que dói aqui é a gravação que FALHA (cota cheia, modo privado de
// navegador antigo): o disco fica para trás da memória. Se a escrita partisse
// sempre do disco, cada toque recomeçaria da lista velha e só caberia UM
// favorito. A memória só cede ao disco quando OUTRA aba mudou o disco.
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function criarStorageFake() {
  const armazem = new Map<string, string>();
  const estado = { falhaAoGravar: false };
  return {
    estado,
    armazem,
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      if (estado.falhaAoGravar) throw new Error("QuotaExceededError");
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
    clear: () => armazem.clear(),
    key: () => null,
    get length() {
      return armazem.size;
    },
  };
}

type Setter = (v: string[] | ((p: string[]) => string[])) => void;

describe("useLocalStorage — entre abas", () => {
  let raiz: Root;
  let alvo: HTMLDivElement;
  let storage: ReturnType<typeof criarStorageFake>;
  let valor: string[] = [];
  let set: Setter = () => {};

  function Sonda({ entreAbas }: { entreAbas: boolean }) {
    const [atual, setAtual] = useLocalStorage<string[]>(
      "lista",
      [],
      entreAbas ? { entreAbas: true } : undefined,
    );
    useEffect(() => {
      valor = atual;
      set = setAtual;
    });
    return null;
  }

  async function montar(entreAbas: boolean) {
    await act(async () => raiz.render(<Sonda entreAbas={entreAbas} />));
  }
  async function avisar(chave: string | null = "lista") {
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: chave }));
    });
  }

  beforeEach(() => {
    storage = criarStorageFake();
    vi.stubGlobal("localStorage", storage);
    valor = [];
    alvo = document.createElement("div");
    document.body.appendChild(alvo);
    raiz = createRoot(alvo);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    alvo.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("grava a partir do disco: o que outra aba gravou no meio não se perde", async () => {
    await montar(true);
    storage.armazem.set("lista", JSON.stringify(["da-outra-aba"]));
    await act(async () => set((p) => [...p, "meu"]));
    expect(JSON.parse(storage.armazem.get("lista") ?? "[]")).toEqual([
      "da-outra-aba",
      "meu",
    ]);
    expect(valor).toEqual(["da-outra-aba", "meu"]);
  });

  it("gravação que falha: a memória segue acumulando (não recomeça da lista velha do disco)", async () => {
    await montar(true);
    storage.estado.falhaAoGravar = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => set((p) => [...p, "a"]));
    await act(async () => set((p) => [...p, "b"]));
    expect(valor).toEqual(["a", "b"]);
  });

  it("gravação que falha numa aba aberta com o disco já cheio: a memória segue à frente", async () => {
    storage.armazem.set("lista", JSON.stringify(["x"]));
    await montar(true);
    storage.estado.falhaAoGravar = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => set((p) => [...p, "a"]));
    await act(async () => set((p) => [...p, "b"]));
    expect(valor).toEqual(["x", "a", "b"]);
  });

  it("gravação que falha DEPOIS de uma que deu certo: a memória segue à frente do disco", async () => {
    await montar(true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => set((p) => [...p, "a"])); // grava no disco
    storage.estado.falhaAoGravar = true;
    await act(async () => set((p) => [...p, "b"])); // só na memória
    await act(async () => set((p) => [...p, "c"]));
    expect(valor).toEqual(["a", "b", "c"]);
  });

  it("gravação que falha DEPOIS de a aba ler o disco por um evento: memória à frente do disco", async () => {
    await montar(true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    storage.armazem.set("lista", JSON.stringify(["x"]));
    await avisar();
    storage.estado.falhaAoGravar = true;
    await act(async () => set((p) => [...p, "a"]));
    await act(async () => set((p) => [...p, "b"]));
    expect(valor).toEqual(["x", "a", "b"]);
  });

  it("disco com texto quebrado na hora de gravar: usa a memória e regrava lista válida", async () => {
    await montar(true);
    storage.armazem.set("lista", "{lixo");
    await act(async () => set((p) => [...p, "a"]));
    expect(valor).toEqual(["a"]);
    expect(JSON.parse(storage.armazem.get("lista") ?? "null")).toEqual(["a"]);
  });

  it("evento storage da chave: a tela passa a mostrar o disco; de outra chave, não muda", async () => {
    await montar(true);
    storage.armazem.set("lista", JSON.stringify(["x"]));
    await avisar("outra");
    expect(valor).toEqual([]);
    await avisar("lista");
    expect(valor).toEqual(["x"]);
    // `localStorage.clear()` em outra aba chega com key null.
    storage.armazem.clear();
    await avisar(null);
    expect(valor).toEqual([]);
  });

  it("evento storage com texto quebrado: mantém o que a tela já tinha", async () => {
    await montar(true);
    await act(async () => set(["a"]));
    storage.armazem.set("lista", "{lixo");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await avisar();
    expect(valor).toEqual(["a"]);
  });

  it("desmontar tira o ouvinte do evento storage", async () => {
    const remover = vi.spyOn(window, "removeEventListener");
    await montar(true);
    act(() => raiz.render(null));
    expect(remover).toHaveBeenCalledWith("storage", expect.any(Function));
  });

  it("SEM a opção o hook é o de sempre: ignora o evento e parte da memória", async () => {
    const adicionar = vi.spyOn(window, "addEventListener");
    await montar(false);
    storage.armazem.set("lista", JSON.stringify(["da-outra-aba"]));
    await avisar();
    expect(valor).toEqual([]);
    await act(async () => set((p) => [...p, "meu"]));
    expect(JSON.parse(storage.armazem.get("lista") ?? "[]")).toEqual(["meu"]);
    expect(adicionar).not.toHaveBeenCalledWith("storage", expect.anything());
  });
});
