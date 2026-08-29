// Trava do conserto do BLOQUEIA 1 do #321 (achado da 3ª janela de revisão,
// confirmado na develop depois do merge 4e07e8f): a recarga por visibilidade
// dispara `fetchUserOrders` quando a aba volta ao foco, e TODA
// `fetchUserOrders` começa abortando a anterior (useOrders:862-865). A busca
// abortada devolve `[]` EM SILÊNCIO (useOrders:912-919) e a CartView gravava
// esse `[]` por cima da lista que já estava na tela — a pessoa voltava do
// pagamento PIX, tocava em "Meus Pedidos" dentro da janela do timer e via a
// lista vazia com o pedido pago.
//
// POR QUE FUNÇÃO PURA E NÃO MONTAR A VIEW: a decisão "recarregou vazio com
// lista em memória → mantém" segue o precedente do #328
// (`decidirSaidaDoCheckout`) — exportada da própria view para o teste prender
// A ESCOLHA DELA sem montar a tela inteira. E aqui é dobro: medido neste
// ambiente, montar a CartView com `initialTab="orders"` (ou chegar nela por
// clique e desmontar) PENDE o `act` do React 19 + framer-motion no jsdom —
// o `act` não resolve nem com volta por clique e unmount assistido. A fiação
// (o `.then` da CartView chama ESTA função) é coberta por revisão de código e
// CI; o comportamento da decisão é preso AQUI, incluído o caso que a guarda
// NÃO pode quebrar: vazio genuíno na primeira carga continua fluindo.
import { describe, expect, it, vi } from "vitest";

// Importar a CartView arrasta `@/lib/supabase` (via AuthContext), e o
// [EnvGuard] lança no import sem VITE_SUPABASE_* — a máquina tem .env, o CI
// não tem nenhum (o mesmo porquê da emenda a42cea5 do #328). A função sob
// teste é pura; o mock existe só para o módulo carregar.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { mesclarListaAposRecarga } from "@/views/customer/CartView";

describe("mesclarListaAposRecarga — recarga vazia não apaga lista carregada", () => {
  it("busca abortada devolve [] com lista em memória: mantém o que está na tela", () => {
    const emMemoria = [{ id: "pedido-A" }, { id: "pedido-B" }];
    expect(mesclarListaAposRecarga(emMemoria, [])).toBe(emMemoria);
  });

  it("devolve A MESMA referência quando mantém — React desiste do re-render", () => {
    const emMemoria = [{ id: "pedido-A" }];
    expect(mesclarListaAposRecarga(emMemoria, [])).toBe(emMemoria);
  });

  it("recarga que trouxe conteúdo SEMPRE substitui — a guarda não congela dado velho", () => {
    const emMemoria = [{ id: "pedido-antigo" }];
    const nova = [{ id: "pedido-novo" }];
    expect(mesclarListaAposRecarga(emMemoria, nova)).toBe(nova);
  });

  it("vazio GENUÍNO na primeira carga flui: sem nada em memória, [] é gravado", () => {
    expect(mesclarListaAposRecarga([], [])).toEqual([]);
  });

  it("null/undefined na resposta (o `data ||` de antes) continua virando lista", () => {
    expect(mesclarListaAposRecarga([], null)).toEqual([]);
    expect(mesclarListaAposRecarga([], undefined)).toEqual([]);
    // e com memória, resposta nula também não apaga (mesmo contrato do [])
    const emMemoria = [{ id: "pedido-A" }];
    expect(mesclarListaAposRecarga(emMemoria, null)).toBe(emMemoria);
  });
});
