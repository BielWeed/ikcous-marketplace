import { lerSupabaseUrl } from "@/lib/env-valores";

const PREFIXO_PUBLICO = "/storage/v1/object/public/products/";

// O nome que `uploadProductImages` (useProducts) dá ao objeto:
// `${crypto.randomUUID()}.${nomeDoArquivo.split(".").pop()}`. O UUID sai em
// minúsculas; a extensão é a do arquivo do aparelho (jpg, jpeg, png, webp,
// heic... e MAIÚSCULA se a câmera assim a nomeou, ex. IMG_1.JPG), por isso
// letras dos dois tamanhos. De 2 a 5 caracteres cobre todas as reais; uma
// extensão fora disso (arquivo sem ponto no nome, por exemplo) não casa e o
// objeto fica órfão como antes -- recusar é o lado seguro.
const NOME_DO_ENVIO =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]{2,5}$/;

/**
 * Nome do objeto (na raiz do bucket `products`) que a URL aponta, ou `null` se
 * a URL não é, sem sombra de dúvida, uma foto que um envio da tela criou.
 *
 * Duas barreiras, ambas fechadas (na dúvida, `null`):
 *  1. O ENDEREÇO: tem de ser o do Supabase desta loja (mesma origem -- esquema,
 *     host e porta -- do cliente, lida por `lerSupabaseUrl`), no caminho
 *     público do bucket `products` ANCORADO no começo, sem query nem
 *     fragmento. URL de outro host, de outro bucket, `render/` ou `sign/` não
 *     passa.
 *  2. O NOME: o que sobra depois do bucket, tal como está escrito (sem
 *     decodificar nada), tem de ser exatamente `<uuid>.<ext>`. Subpasta,
 *     `backup/`, `..`, curinga, barra invertida, byte nulo e nome que não é
 *     UUID não casam.
 */
function nomeDaFotoEnviada(url: string): string | null {
  try {
    const alvo = new URL(url);
    const loja = new URL(lerSupabaseUrl());
    if (alvo.origin === "null" || alvo.origin !== loja.origin) return null;
    if (alvo.search !== "" || alvo.hash !== "") return null;
    if (!alvo.pathname.startsWith(PREFIXO_PUBLICO)) return null;
    const nome = alvo.pathname.slice(PREFIXO_PUBLICO.length);
    return NOME_DO_ENVIO.test(nome) ? nome : null;
  } catch {
    return null;
  }
}

/**
 * Apaga do armazenamento as fotos que um envio criou DEPOIS de a tela já tê-lo
 * dado por falha (prazo estourado): sem isto o arquivo fica órfão -- gravado,
 * pago, sem nenhum produto apontando para ele -- e cada "Tentar de novo" cria
 * mais um.
 *
 * Só chame com as URLs devolvidas pelo PRÓPRIO envio que falhou, nunca com
 * foto aceita (ex.: `formData.images`). Por garantia, a função só apaga o que
 * tem a cara exata de um objeto criado por um envio (ver `nomeDaFotoEnviada`);
 * o resto é recusado e logado, nunca apagado. Best-effort: falha ao apagar é
 * logada e engolida (nunca lança), porque a tela já tratou o envio como falha
 * e não há o que desfazer.
 */
export async function descartarFotosDoProduto(urls: string[]): Promise<void> {
  try {
    const nomes: string[] = [];
    for (const url of urls) {
      const nome = nomeDaFotoEnviada(url);
      if (nome) {
        nomes.push(nome);
      } else {
        console.warn(
          "[descartarFotosDoProduto] URL recusada, não apagada:",
          url,
        );
      }
    }
    if (nomes.length === 0) return;
    // Import sob demanda: o cliente só é necessário neste caminho raro, e o
    // import estático faria toda tela que importa este módulo exigir as
    // variáveis do Supabase já ao carregar (EnvGuard).
    const { supabase } = await import("@/lib/supabase");
    const { error } = await supabase.storage.from("products").remove(nomes);
    if (error) {
      console.error(
        "[descartarFotosDoProduto] não foi possível apagar:",
        nomes,
        error,
      );
    }
  } catch (erro) {
    console.error("[descartarFotosDoProduto] falha ao apagar:", urls, erro);
  }
}
