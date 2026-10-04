/**
 * O que a gaveta de imagens do service worker (`supabase-images-cache`) pode
 * guardar — e o pedido que a página faz ao SW para jogar fora o resto.
 *
 * POR QUE EXISTE (R12, 04/10/2026): o SW guardava QUALQUER caminho de
 * `/storage/v1/object/` ou `/storage/v1/render/`, o que inclui o endereço
 * ASSINADO de bucket privado (`/object/sign/...?token=` — a foto de devolução
 * que o lojista abre por `createSignedUrl`), o download autenticado e a
 * transformação assinada. A cópia sobrevivia ao logout no Cache Storage do
 * aparelho e era servida por endereço a quem usasse o aparelho depois.
 *
 * A regra é uma LISTA BRANCA de dois prefixos, não uma lista negra de formas
 * privadas: o Storage ganha caminho novo (`upload/sign`, `authenticated`,
 * `GET /object/{bucket}/...` sem prefixo) e qualquer um que não esteja aqui
 * fica fora da gaveta por construção.
 *
 * Mora em `src/lib` (sem nenhum import) porque o SW e a página usam o MESMO
 * literal de tipo de mensagem — um contrato só, não dois que divergem.
 */

const PREFIXOS_PUBLICOS = [
  "/storage/v1/object/public/",
  "/storage/v1/render/image/public/",
] as const;

/** Tipo da mensagem que a página manda ao SW no logout. Só apaga; nunca
 * busca nem guarda nada que venha junto da mensagem. */
export const TIPO_PURGAR_ARQUIVOS_PRIVADOS = "PURGAR_ARQUIVOS_PRIVADOS";

/**
 * true só para arquivo de bucket PÚBLICO do Storage, sem token na query.
 *
 * Recebe `URL` já parseada de propósito: o parser normaliza `..` e `%2e%2e`
 * no `pathname`, então `/object/public/../sign/x` chega aqui como
 * `/object/sign/x` — comparar com `startsWith` numa string crua deixaria esse
 * caminho passar. O host (Supabase ou não) é decisão de quem chama.
 */
export function ehArquivoPublicoDoStorage(url: URL): boolean {
  if (url.searchParams.has("token")) return false;
  return PREFIXOS_PUBLICOS.some((prefixo) => url.pathname.startsWith(prefixo));
}

/**
 * Pede ao SW ativo que apague da gaveta de imagens tudo que não é público.
 *
 * Disparar-e-esquecer, e NUNCA lança: é chamado no meio do logout, e o logout
 * não pode travar nem falhar porque o aparelho não tem SW (navegador sem
 * suporte, aba aberta antes do registro, SW em atualização). Se a mensagem
 * não chegar, o `activate` da próxima versão do SW faz a mesma limpeza.
 */
export function pedirAoSwPurgarArquivosPrivados(): void {
  try {
    if (typeof navigator === "undefined") return;
    const container = navigator.serviceWorker;
    if (!container) return;
    const mensagem = { type: TIPO_PURGAR_ARQUIVOS_PRIVADOS };
    // `getRegistration()` alcança o SW ativo mesmo quando ESTA aba não é
    // controlada por ele (recarga forçada com Shift) — o `controller` sozinho
    // seria `null` nesse caso, e a gaveta continuaria cheia.
    Promise.resolve(container.getRegistration?.())
      .then((registro) => {
        const alvo = registro?.active ?? container.controller;
        alvo?.postMessage(mensagem);
      })
      .catch((erro: unknown) => {
        console.warn("[SW] Pedido de purga no logout não chegou:", erro);
      });
  } catch (erro) {
    console.warn("[SW] Pedido de purga no logout não chegou:", erro);
  }
}
