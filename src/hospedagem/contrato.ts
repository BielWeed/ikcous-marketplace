// O que o worker de compartilhamento sabe em tempo de execução. É embutido
// no _worker.js pela finalização do build (scripts/hospedagem.mjs) a partir do
// PreparedStoreDelivery — nunca lido de process.env, de Host ou de um fallback.
export type ClasseDeChave = "publishable" | "anon-jwt";

export type ConexaoDaHospedagem =
  | {
      readonly kind: "database";
      readonly origin: string; // https://<ref>.supabase.co, sem barra final
      readonly key: string; // chave PÚBLICA, a mesma do bundle do app
      readonly keyClass: ClasseDeChave;
    }
  | { readonly kind: "none" }; // fixture: o worker nunca consulta

export interface HospedagemConfig {
  readonly versao: 1;
  readonly publicUrl: string; // snapshot.publicUrl (HTTPS, raiz, sem barra)
  readonly storeName: string;
  readonly conexao: ConexaoDaHospedagem;
  readonly hostsDeImagem: readonly string[]; // do img-src do CSP; "*.x" = sufixo
  readonly cabecalhos: Readonly<Record<string, string>>; // bloco "/*" do vercel.json
  readonly deliveryVersion: string;
}

export interface ServicoDeArquivos {
  fetch(request: Request): Promise<Response>;
}

export interface AmbienteDaHospedagem {
  readonly ASSETS: ServicoDeArquivos;
}

export type MotivoOg = "produto" | "sem-produto" | "passa";
