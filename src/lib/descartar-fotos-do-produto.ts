const PREFIXO_PUBLICO = "/storage/v1/object/public/products/";

/**
 * Caminho (dentro do bucket `products`) de uma foto que o envio da tela criou,
 * ou `null` se a URL não é de um objeto desse tipo.
 *
 * O envio (`uploadProductImages`) grava na RAIZ do bucket, com nome
 * `<uuid>.<ext>`. Por isso só entra o que tem exatamente esse formato: URL de
 * outro bucket, de subpasta (`backup/…`), placeholder ou qualquer coisa que
 * este envio não poderia ter criado fica de fora -- apagar é irreversível.
 */
function caminhoDaFotoEnviada(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    const posicao = pathname.indexOf(PREFIXO_PUBLICO);
    if (posicao === -1) return null;
    const caminho = decodeURIComponent(
      pathname.slice(posicao + PREFIXO_PUBLICO.length),
    );
    if (!caminho || caminho.includes("/")) return null;
    return caminho;
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
 * foto aceita. Best-effort: falha ao apagar é logada e engolida (nunca lança),
 * porque a tela já tratou o envio como falha e não há o que desfazer.
 */
export async function descartarFotosDoProduto(urls: string[]): Promise<void> {
  try {
    const caminhos = urls
      .map(caminhoDaFotoEnviada)
      .filter((c): c is string => c !== null);
    if (caminhos.length === 0) return;
    // Import sob demanda: o cliente só é necessário neste caminho raro, e o
    // import estático faria toda tela que importa este módulo exigir as
    // variáveis do Supabase já ao carregar (EnvGuard).
    const { supabase } = await import("@/lib/supabase");
    const { error } = await supabase.storage.from("products").remove(caminhos);
    if (error) {
      console.error(
        "[descartarFotosDoProduto] não foi possível apagar:",
        caminhos,
        error,
      );
    }
  } catch (erro) {
    console.error("[descartarFotosDoProduto] falha ao apagar:", urls, erro);
  }
}
