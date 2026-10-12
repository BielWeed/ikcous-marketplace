// @vitest-environment jsdom
//
// A URL que `descartarFotosDoProduto` recebe NÃO é fabricada aqui: ela sai do
// caminho REAL do envio. `uploadProductImages` (useProducts) roda de verdade,
// com o cliente `supabase` real de `@/lib/supabase` (criado com a URL que
// `lerSupabaseUrl()` lê do ambiente, a mesma que a função de descarte usa), e
// o `getPublicUrl` real do storage-js monta o endereço. Só duas coisas são
// dublês: o `upload` do storage (devolve sucesso, sem rede) e o `remove` (para
// observar o que seria apagado).
//
// POR QUE ESTE ARQUIVO EXISTE: os testes de `descartar-fotos-do-produto` e do
// formulário escrevem a URL à mão, já no formato que a regra aceita --
// circular. Se um dia `getPublicUrl` ou o nome gerado em `uploadProductImages`
// mudarem, aqueles continuam verdes e a barreira passa a recusar TUDO: a
// correção morre calada ("letra morta"). Aqui, qualquer mudança incompatível
// no formato do nome ou na leitura do host deixa estes casos vermelhos.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { arquivoDaImagemRecortada } from "@/lib/arquivo-da-imagem-recortada";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type ApiProdutos = {
  uploadProductImages: (files: File[]) => Promise<string[]>;
};

function Sonda({ aoPronto }: { aoPronto: (api: ApiProdutos) => void }) {
  // O módulo é importado depois do `vi.resetModules()` de cada caso (a URL do
  // Supabase é lida na avaliação do módulo do cliente).
  const { useProducts } = moduloUseProducts;
  const api = useProducts({ autoFetch: false });
  useEffect(() => {
    aoPronto(api);
  });
  return null;
}

let moduloUseProducts: typeof import("@/hooks/useProducts");

/** Nome com que o envio gravaria o objeto, para o caso do recorte. */
const arquivoDoRecorte = () =>
  arquivoDaImagemRecortada(
    new Blob(["recorte"], { type: "image/webp" }),
    "product-image-",
  );

const ORIGENS = [
  ["origem normal", "https://abcd1234efgh.supabase.co"],
  ["origem com barra no fim", "https://abcd1234efgh.supabase.co/"],
  ["domínio próprio", "https://api.minhaloja.com.br"],
  ["Supabase local com porta", "http://127.0.0.1:54321"],
] as const;

const ARQUIVOS: Array<[string, () => File]> = [
  [
    "IMG_1.JPG (câmera, extensão maiúscula)",
    () => new File(["x"], "IMG_1.JPG", { type: "image/jpeg" }),
  ],
  ["foto.jpeg", () => new File(["x"], "foto.jpeg", { type: "image/jpeg" })],
  ["recorte .webp (ImageAdjuster)", arquivoDoRecorte],
  [
    "nome com pontos e espaço (minha foto.v2.png)",
    () => new File(["x"], "minha foto.v2.png", { type: "image/png" }),
  ],
];

describe("descartarFotosDoProduto com a URL gerada de verdade pelo envio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    // O cliente usa `realtime.worker: true`; o jsdom não tem Worker.
    vi.stubGlobal(
      "Worker",
      class {
        onmessage = null;
        onerror = null;
        postMessage() {}
        terminate() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    vi.stubEnv(
      "VITE_SUPABASE_PUBLISHABLE_KEY",
      "sb_publishable_chave_de_teste",
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe.each(ORIGENS)("%s", (_nome, origem) => {
    it.each(ARQUIVOS)(
      "%s: o objeto que o envio gravou é exatamente o que o descarte apaga (1 chamada)",
      async (_arquivo, criarArquivo) => {
        vi.stubEnv("VITE_SUPABASE_URL", origem);
        moduloUseProducts = await import("@/hooks/useProducts");
        const { supabase } = await import("@/lib/supabase");
        const { descartarFotosDoProduto } = await import(
          "@/lib/descartar-fotos-do-produto"
        );

        // Só `upload` e `remove` são trocados; `getPublicUrl` fica o REAL.
        const gravados: string[] = [];
        const apagados: string[][] = [];
        const abrirBucket = supabase.storage.from.bind(supabase.storage);
        vi.spyOn(supabase.storage, "from").mockImplementation((bucket) => {
          const api = abrirBucket(bucket);
          api.upload = (async (caminho: string) => {
            expect(bucket).toBe("products");
            gravados.push(caminho);
            return { data: { path: caminho }, error: null };
          }) as unknown as typeof api.upload;
          api.remove = (async (caminhos: string[]) => {
            expect(bucket).toBe("products");
            apagados.push(caminhos);
            return { data: [], error: null };
          }) as unknown as typeof api.remove;
          return api;
        });

        let api: ApiProdutos | undefined;
        await act(async () => {
          raiz.render(<Sonda aoPronto={(a) => (api = a)} />);
        });
        if (!api) throw new Error("useProducts não montou.");

        // O envio de verdade: nome gerado por `uploadProductImages`, URL
        // montada pelo `getPublicUrl` do storage-js.
        const urls = await api.uploadProductImages([criarArquivo()]);
        expect(urls).toHaveLength(1);
        expect(gravados).toHaveLength(1);
        // Prova de que a URL é a que o storage-js montou: o caminho público
        // termina no nome que o envio gravou.
        expect(new URL(urls[0]).pathname).toBe(
          `/storage/v1/object/public/products/${gravados[0]}`,
        );

        await descartarFotosDoProduto(urls);

        expect(apagados).toEqual([[gravados[0]]]);
        supabase.auth.stopAutoRefresh();
      },
    );
  });
});
