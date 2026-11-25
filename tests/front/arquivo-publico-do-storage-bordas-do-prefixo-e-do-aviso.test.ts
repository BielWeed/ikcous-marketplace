// @vitest-environment node
//
// Bordas de `arquivo-publico-do-storage` que o teste vizinho
// (`arquivo-publico-do-storage-purga-e-caminho.test.ts`) deixa sem prova:
//  - o prefixo público é o DIRETÓRIO inteiro (com a barra final) nas duas
//    rotas, e qualquer `token` na query — até vazio — tira o arquivo da gaveta;
//  - o pedido de purga do logout só AVISA o console quando algo falha de
//    verdade: SW sem controlador, SW sem `getRegistration` e registro sem SW
//    ativo ou em espera são situações normais e ficam em silêncio;
//  - falha ao ler o controlador, ou `getRegistration` que lança na hora, é
//    avisada UMA vez, nunca lança e não impede os outros destinatários.
import {
  TIPO_PURGAR_ARQUIVOS_PRIVADOS,
  ehArquivoPublicoDoStorage,
  pedirAoSwPurgarArquivosPrivados,
} from "@/lib/arquivo-publico-do-storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SUPA = "https://xyzcompany.supabase.co";
const MENSAGEM = { type: TIPO_PURGAR_ARQUIVOS_PRIVADOS };

describe("ehArquivoPublicoDoStorage — bordas do prefixo e do token", () => {
  it.each([
    [`${SUPA}/storage/v1/render/image/publico-nao/a.png`],
    [`${SUPA}/storage/v1/render/image/public`],
    [`${SUPA}/storage/v1/object/publicidade/a.png`],
    [`${SUPA}/storage/v1/object/public`],
  ])("%s: não é o diretório público, fica fora da gaveta", (endereco) => {
    expect(ehArquivoPublicoDoStorage(new URL(endereco))).toBe(false);
  });

  it.each([
    [`${SUPA}/storage/v1/object/public/products/a.png?token=`],
    [`${SUPA}/storage/v1/object/public/products/a.png?token`],
    [`${SUPA}/storage/v1/object/public/products/a.png?v=1&token=abc`],
    [`${SUPA}/storage/v1/render/image/public/products/a.png?width=340&token=`],
  ])("%s: qualquer token na query, até vazio, tira da gaveta", (endereco) => {
    expect(ehArquivoPublicoDoStorage(new URL(endereco))).toBe(false);
  });

  it("parâmetros que NÃO são token não atrapalham", () => {
    expect(
      ehArquivoPublicoDoStorage(
        new URL(`${SUPA}/storage/v1/object/public/products/a.png?v=2&tokens=x`),
      ),
    ).toBe(true);
  });
});

describe("pedirAoSwPurgarArquivosPrivados — o que é falha e o que é normal", () => {
  let aviso: ReturnType<typeof vi.spyOn>;
  const esperarRegistro = () => new Promise((r) => setTimeout(r, 0));
  const destinatario = () => ({ postMessage: vi.fn() });

  beforeEach(() => {
    aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("aba sem controlador (recarga forçada): o SW ativo recebe e NADA é avisado como falha", async () => {
    const ativo = destinatario();
    vi.stubGlobal("navigator", {
      serviceWorker: {
        controller: null,
        getRegistration: async () => ({ active: ativo, waiting: null }),
      },
    });

    pedirAoSwPurgarArquivosPrivados();
    await esperarRegistro();

    expect(ativo.postMessage).toHaveBeenCalledWith(MENSAGEM);
    expect(aviso).not.toHaveBeenCalled();
  });

  it("registro sem SW ativo nem em espera: nada a enviar, nada avisado", async () => {
    const controller = destinatario();
    vi.stubGlobal("navigator", {
      serviceWorker: {
        controller,
        getRegistration: async () => ({ active: null, waiting: undefined }),
      },
    });

    pedirAoSwPurgarArquivosPrivados();
    await esperarRegistro();

    expect(controller.postMessage).toHaveBeenCalledTimes(1);
    expect(aviso).not.toHaveBeenCalled();
  });

  it("nenhum registro (getRegistration devolve undefined): silêncio", async () => {
    const controller = destinatario();
    vi.stubGlobal("navigator", {
      serviceWorker: { controller, getRegistration: async () => undefined },
    });

    pedirAoSwPurgarArquivosPrivados();
    await esperarRegistro();

    expect(controller.postMessage).toHaveBeenCalledTimes(1);
    expect(aviso).not.toHaveBeenCalled();
  });

  it("SW sem getRegistration (navegador antigo): o controlador recebe e não há falha", async () => {
    const controller = destinatario();
    vi.stubGlobal("navigator", { serviceWorker: { controller } });

    expect(() => pedirAoSwPurgarArquivosPrivados()).not.toThrow();
    await esperarRegistro();

    expect(controller.postMessage).toHaveBeenCalledWith(MENSAGEM);
    expect(aviso).not.toHaveBeenCalled();
  });

  it("ler o controlador lança: avisa UMA vez, não lança e o SW ativo ainda recebe", async () => {
    const ativo = destinatario();
    const erro = new Error("controller indisponível");
    const container = {
      get controller(): never {
        throw erro;
      },
      getRegistration: async () => ({ active: ativo, waiting: null }),
    };
    vi.stubGlobal("navigator", { serviceWorker: container });

    expect(() => pedirAoSwPurgarArquivosPrivados()).not.toThrow();
    await esperarRegistro();

    expect(aviso).toHaveBeenCalledTimes(1);
    expect(aviso).toHaveBeenCalledWith(
      "[SW] Pedido de purga no logout não chegou:",
      erro,
    );
    expect(ativo.postMessage).toHaveBeenCalledWith(MENSAGEM);
  });

  it("getRegistration que LANÇA na hora (não rejeita): avisa UMA vez e o logout não quebra", async () => {
    const controller = destinatario();
    const erro = new Error("lançou direto");
    vi.stubGlobal("navigator", {
      serviceWorker: {
        controller,
        getRegistration: () => {
          throw erro;
        },
      },
    });

    expect(() => pedirAoSwPurgarArquivosPrivados()).not.toThrow();
    await esperarRegistro();

    expect(controller.postMessage).toHaveBeenCalledWith(MENSAGEM);
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(aviso).toHaveBeenCalledWith(
      "[SW] Pedido de purga no logout não chegou:",
      erro,
    );
  });

  it("ler `navigator.serviceWorker` lança: avisa UMA vez e não lança", () => {
    const erro = new Error("política do navegador");
    vi.stubGlobal("navigator", {
      get serviceWorker(): never {
        throw erro;
      },
    });

    expect(() => pedirAoSwPurgarArquivosPrivados()).not.toThrow();

    expect(aviso).toHaveBeenCalledTimes(1);
    expect(aviso).toHaveBeenCalledWith(
      "[SW] Pedido de purga no logout não chegou:",
      erro,
    );
  });
});
