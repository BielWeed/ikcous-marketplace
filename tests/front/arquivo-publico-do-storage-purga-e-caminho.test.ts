// @vitest-environment node
//
// Caça de provas fracas (mutação) em `arquivo-publico-do-storage`, 24/11/2026.
// Os testes do service worker só olham a gaveta de imagens; o PEDIDO DE PURGA
// que a página manda no logout (`pedirAoSwPurgarArquivosPrivados`) não tinha
// teste direto, e quatro trocas sobreviviam: não avisar o SW que controla a
// aba, esquecer o SW que espera ativação, mandar duas vezes ao mesmo SW e
// aceitar o prefixo público no MEIO do caminho.
//
// O que protege: no logout o aparelho não pode ficar com foto de bucket
// privado (devolução, por exemplo) guardada no Cache Storage para o próximo
// usuário. Cada destinatário recebe UMA mensagem, e a falha de um não impede o
// próximo nem trava o "Sair".
import {
  TIPO_PURGAR_ARQUIVOS_PRIVADOS,
  ehArquivoPublicoDoStorage,
  pedirAoSwPurgarArquivosPrivados,
} from "@/lib/arquivo-publico-do-storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SUPA = "https://xyzcompany.supabase.co";

describe("ehArquivoPublicoDoStorage — o prefixo público é do COMEÇO do caminho", () => {
  it("arquivo e transformação públicos entram", () => {
    expect(
      ehArquivoPublicoDoStorage(
        new URL(`${SUPA}/storage/v1/object/public/products/a.png`),
      ),
    ).toBe(true);
    expect(
      ehArquivoPublicoDoStorage(
        new URL(
          `${SUPA}/storage/v1/render/image/public/products/a.png?width=340`,
        ),
      ),
    ).toBe(true);
  });

  it("objeto de bucket privado cujo NOME contém o trecho público não entra", () => {
    // `/object/authenticated/<bucket>/<nome>`: o nome do arquivo é livre e pode
    // imitar o prefixo público. Só o começo do caminho decide.
    const falsoPublico = [
      `${SUPA}/storage/v1/object/authenticated/devolucoes/storage/v1/object/public/a.png`,
      `${SUPA}/outro/storage/v1/object/public/products/a.png`,
      `${SUPA}/storage/v1/object/sign/devolucoes/storage/v1/render/image/public/a.png`,
    ];
    for (const endereco of falsoPublico) {
      expect(ehArquivoPublicoDoStorage(new URL(endereco))).toBe(false);
    }
  });
});

describe("pedirAoSwPurgarArquivosPrivados — quem recebe o pedido", () => {
  const MENSAGEM = { type: TIPO_PURGAR_ARQUIVOS_PRIVADOS };
  let aviso: ReturnType<typeof vi.spyOn>;

  const destinatario = () => ({ postMessage: vi.fn() });

  /** Espera as promessas pendentes do pedido (a busca do registro). */
  const esperarRegistro = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("avisa o SW que controla a aba NA HORA, antes de qualquer promessa resolver", () => {
    const controller = destinatario();
    vi.stubGlobal("navigator", {
      serviceWorker: {
        controller,
        getRegistration: () => new Promise(() => {}),
      },
    });

    pedirAoSwPurgarArquivosPrivados();

    expect(controller.postMessage).toHaveBeenCalledTimes(1);
    expect(controller.postMessage).toHaveBeenCalledWith(MENSAGEM);
  });

  it("alcança também o SW ativo e o que espera ativação, quando a aba não é controlada", async () => {
    const ativo = destinatario();
    const esperando = destinatario();
    vi.stubGlobal("navigator", {
      serviceWorker: {
        controller: null,
        getRegistration: async () => ({ active: ativo, waiting: esperando }),
      },
    });

    pedirAoSwPurgarArquivosPrivados();
    await esperarRegistro();

    expect(ativo.postMessage).toHaveBeenCalledWith(MENSAGEM);
    expect(esperando.postMessage).toHaveBeenCalledWith(MENSAGEM);
  });

  it("quem já recebeu como controller não recebe de novo como ativo", async () => {
    const mesmo = destinatario();
    const esperando = destinatario();
    vi.stubGlobal("navigator", {
      serviceWorker: {
        controller: mesmo,
        getRegistration: async () => ({ active: mesmo, waiting: esperando }),
      },
    });

    pedirAoSwPurgarArquivosPrivados();
    await esperarRegistro();

    expect(mesmo.postMessage).toHaveBeenCalledTimes(1);
    expect(esperando.postMessage).toHaveBeenCalledTimes(1);
  });

  it("o mesmo SW achado como ativo e como esperando recebe uma vez só", async () => {
    const unico = destinatario();
    vi.stubGlobal("navigator", {
      serviceWorker: {
        controller: null,
        getRegistration: async () => ({ active: unico, waiting: unico }),
      },
    });

    pedirAoSwPurgarArquivosPrivados();
    await esperarRegistro();

    expect(unico.postMessage).toHaveBeenCalledTimes(1);
  });

  it("controller que lança no postMessage não impede o SW ativo de receber (e o logout não quebra)", async () => {
    const quebrado = {
      postMessage: vi.fn(() => {
        throw new Error("canal fechado");
      }),
    };
    const ativo = destinatario();
    vi.stubGlobal("navigator", {
      serviceWorker: {
        controller: quebrado,
        getRegistration: async () => ({ active: ativo, waiting: null }),
      },
    });

    expect(() => pedirAoSwPurgarArquivosPrivados()).not.toThrow();
    await esperarRegistro();

    expect(ativo.postMessage).toHaveBeenCalledWith(MENSAGEM);
    expect(aviso).toHaveBeenCalled();
  });

  it("registro que falha ao ser lido: avisa no console e não lança nem deixa rejeição solta", async () => {
    const controller = destinatario();
    vi.stubGlobal("navigator", {
      serviceWorker: {
        controller,
        getRegistration: () => Promise.reject(new Error("sem registro")),
      },
    });

    expect(() => pedirAoSwPurgarArquivosPrivados()).not.toThrow();
    await esperarRegistro();

    expect(controller.postMessage).toHaveBeenCalledTimes(1);
    expect(aviso).toHaveBeenCalled();
  });

  it("aparelho sem service worker (ou sem navigator): não lança e não manda nada", async () => {
    vi.stubGlobal("navigator", {});
    expect(() => pedirAoSwPurgarArquivosPrivados()).not.toThrow();

    vi.stubGlobal("navigator", undefined);
    expect(() => pedirAoSwPurgarArquivosPrivados()).not.toThrow();
    await esperarRegistro();

    expect(aviso).not.toHaveBeenCalled();
  });
});
