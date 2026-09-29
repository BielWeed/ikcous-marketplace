import type { ProvedorFrete } from "@/components/admin/settings/TransportadorasCard";
import { ChevronDown, ExternalLink, HelpCircle } from "lucide-react";
import { useId, useState } from "react";

/**
 * "Como pegar a chave" — passo a passo curto para lojista leigo, um guia por
 * provedor (não compartilham texto: cada painel tem um caminho diferente).
 * Fontes oficiais lidas e verificadas ANTES de escrever (22–23/09/2026):
 *
 * - Melhor Envio: Central de Ajuda oficial, artigo "Integração Magento 1 -
 *   Inserção do Token" (seção "Geração do token", independente de Magento) —
 *   https://centraldeajuda.melhorenvio.com.br/hc/pt-br/articles/31220417726228
 *   Passos e nomes de botão confirmados ao pé da letra ("GERAR NOVO TOKEN",
 *   "Avançar", "Selecionar todos", "GERAR TOKEN", "COPIAR TOKEN") e reforçado
 *   por um segundo artigo da mesma Central ("O que é um token..."): "É
 *   crucial que você marque todas as caixas de seleção para garantir o
 *   funcionamento completo". Os nomes EXATOS de cada permissão individual
 *   (cotação/carrinho/checkout/etiqueta) não aparecem em nenhum artigo
 *   oficial encontrado — por isso o guia manda marcar TODAS, em vez de
 *   inventar nomes de caixa que ninguém confirmou.
 * - Frenet: Central de Ajuda oficial, artigo "Saiba como conseguir acesso a
 *   API Frenet" (atualizado 12/11/2025) —
 *   https://ajuda.frenet.com.br/knowledge-base/api-frenet
 *   Passos e nomes confirmados ao pé da letra ("ACESSAR MEU PAINEL", ícone
 *   de usuário no canto superior direito, "DADOS CADASTRAIS", seção "Chaves
 *   de acesso", campo "TOKEN").
 * - SuperFrete: o artigo que o dono apontou inicialmente
 *   (ajuda.superfrete.com/artigo/como-criar-token-superfrete-irroba) é
 *   ESPECÍFICO da integração com a plataforma Irroba (cadastro cruzado,
 *   popup de outra tela) — não serve para integração própria via API. O app
 *   chama `api.superfrete.com`/`sandbox.superfrete.com` direto com um
 *   Bearer token (`supabase/functions/calculate-shipping/provedores.ts`),
 *   então o caminho certo é o da documentação de API oficial da SuperFrete —
 *   https://superfrete.readme.io/reference/primeiros-passos — que descreve
 *   o token de PRODUÇÃO em `web.superfrete.com/#/integrations` e o de
 *   SANDBOX em `sandbox.superfrete.com/#/integrations`, cada um com
 *   "Integrar em Desenvolvedores" > confirmar > copiar. Os dois ambientes
 *   usam tokens DIFERENTES (mesma regra que a tela de Sandbox já aplica).
 *
 * Nomenclatura de tela: confirmada pelo TEXTO dos artigos oficiais acima
 * (datados); prints/telas atuais dos três painéis não foram abertos por
 * login exigir credencial do lojista — se o rótulo de um botão mudou desde
 * a data do artigo, este guia pode ficar um passo atrás até o dono avisar.
 */
interface GuiaDoProvedor {
  readonly passos: readonly string[];
  readonly urlOficial: string;
  readonly rotuloLink: string;
  readonly nota?: string;
}

const GUIA_POR_PROVEDOR: ReadonlyMap<ProvedorFrete, GuiaDoProvedor> = new Map([
  [
    "melhor_envio",
    {
      passos: [
        "Acesse o painel do Melhor Envio e faça login.",
        'No menu à esquerda, clique em "Integrações" e depois em "Permissões de Acesso".',
        'Clique no botão "GERAR NOVO TOKEN".',
        'Marque "Li e concordo com as condições descritas acima" e clique em "Avançar".',
        'Dê um nome para o token (ex.: "IKCOUS Marketplace") no campo "Nome".',
        'Clique em "Selecionar todos" — garante que cotação e etiqueta funcionem juntas.',
        'Clique em "GERAR TOKEN".',
        'Clique em "COPIAR TOKEN" e cole aqui embaixo. Ele só aparece nesta tela, uma vez só — se sair sem copiar, precisa gerar outro.',
      ],
      urlOficial:
        "https://centraldeajuda.melhorenvio.com.br/hc/pt-br/articles/31220417726228-Integra%C3%A7%C3%A3o-Magento-1-Inser%C3%A7%C3%A3o-do-Token",
      rotuloLink: "Ver a instrução oficial do Melhor Envio",
      nota: 'Com o "Modo de testes" ligado aqui, gere o token no Melhor Envio de testes ("sandbox.melhorenvio.com.br"). Um token do ambiente errado não funciona.',
    },
  ],
  [
    "superfrete",
    {
      passos: [
        'Faça login na SuperFrete e abra a página de integrações: "web.superfrete.com/#/integrations" (com o Modo de testes ligado: "sandbox.superfrete.com/#/integrations").',
        'Clique em "Integrar em Desenvolvedores".',
        "Confirme a ação quando a tela pedir.",
        "Copie o token mostrado e cole aqui embaixo.",
      ],
      urlOficial: "https://superfrete.readme.io/reference/primeiros-passos",
      rotuloLink: "Ver a documentação oficial da SuperFrete",
      nota: 'Produção e Sandbox usam tokens DIFERENTES — gere o token no mesmo ambiente que está marcado no "Modo de testes" acima. Um token do ambiente errado não cota.',
    },
  ],
  [
    "frenet",
    {
      passos: [
        'No site da Frenet, clique em "ACESSAR MEU PAINEL" e faça login.',
        "No canto superior direito, clique no ícone de usuário.",
        'Selecione "DADOS CADASTRAIS".',
        'Na seção "Chaves de acesso", copie o token do campo "TOKEN".',
        "Cole aqui embaixo.",
      ],
      urlOficial: "https://ajuda.frenet.com.br/knowledge-base/api-frenet",
      rotuloLink: "Ver a instrução oficial da Frenet",
    },
  ],
]);

/**
 * Disclosure independente do cartão do provedor (fica dentro dele, mas
 * fechado por padrão mesmo quando o cartão nasce aberto) — passo a passo
 * curto para quem nunca gerou uma chave de API. `<button aria-expanded
 * aria-controls>` + painel com `hidden` (mesmo padrão do cartão, ver
 * `TransportadorasCard.tsx`): Enter/Espaço funcionam nativamente porque o
 * cabeçalho é um `<button>` de verdade.
 */
export function GuiaDaChaveDoProvedor({
  provider,
}: {
  readonly provider: ProvedorFrete;
}) {
  const [aberto, setAberto] = useState(false);
  const idCorpo = useId();
  const guia = GUIA_POR_PROVEDOR.get(provider);
  if (!guia) return null;

  return (
    <div className="rounded-lg border border-white/5 bg-zinc-900/30">
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls={idCorpo}
        onClick={() => setAberto((v) => !v)}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-bold text-zinc-300 transition-colors hover:text-admin-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold/60"
      >
        <HelpCircle className="size-3.5 shrink-0 text-admin-gold" />
        <span className="flex-1">Como pegar a chave</span>
        <ChevronDown
          className={`size-3.5 shrink-0 transition-transform ${aberto ? "rotate-180" : ""}`}
        />
      </button>
      <div id={idCorpo} hidden={!aberto} className="space-y-2 px-2.5 pb-2.5">
        <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-snug text-zinc-400">
          {guia.passos.map((passo, i) => (
            // Passos são estáticos (não vêm de dado do usuário nem da rede);
            // a posição É a identidade do item.
            <li key={i}>{passo}</li>
          ))}
        </ol>
        {guia.nota && (
          <p className="text-[10.5px] leading-snug text-amber-300/90">
            {guia.nota}
          </p>
        )}
        <a
          href={guia.urlOficial}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-bold text-admin-gold hover:underline"
        >
          <span>{guia.rotuloLink}</span>
          <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  );
}
