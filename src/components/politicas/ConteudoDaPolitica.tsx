import { MapPin, MessageCircle } from "lucide-react";
import { useMemo } from "react";

import { useStore } from "@/contexts/StoreContext";
import { usePoliticaDeTrocasDaLoja } from "@/hooks/usePoliticaDeTrocasDaLoja";
import { abrirWhatsapp } from "@/lib/abrir-whatsapp";
import { lojaTemWhatsapp } from "@/lib/loja-tem-whatsapp";
import { nomeDaLoja } from "@/lib/nome-da-loja";
import type { TipoDePolitica } from "@/lib/nomes-das-politicas";
import {
  type DocumentoDePolitica,
  montarPolitica,
} from "@/lib/textos-das-politicas";
import { formatarWhatsAppParaExibicao } from "@/utils/telefone";

/**
 * O documento da política (Termos, Privacidade ou Trocas) em tela: resumo,
 * seções e o contato da loja. Serve a página inteira (`PoliticaDaLojaView`)
 * e a folha que abre no checkout, no produto e no cadastro — por isso o
 * título fica por conta de quem o usa (h1 na página, título da folha lá).
 *
 * Só `trocas` consulta o banco (a política que a lojista configurou); os
 * outros dois textos são fixos. Cores pelos tokens do tema (`foreground`,
 * `muted-foreground`, `border`), nunca zinc fixo: vale no claro e no escuro.
 */
export function ConteudoDaPolitica({
  tipo,
}: { readonly tipo: TipoDePolitica }) {
  const { config } = useStore();
  const nome = nomeDaLoja(config);
  const trocas = usePoliticaDeTrocasDaLoja(tipo === "trocas");

  const documento: DocumentoDePolitica = useMemo(
    () => montarPolitica(tipo, { nome }, trocas.politica),
    [tipo, nome, trocas.politica],
  );

  return (
    <div data-testid={`politica-${tipo}`} className="space-y-6">
      <p className="text-sm leading-relaxed text-muted-foreground">
        {documento.resumo}
      </p>

      {tipo === "trocas" && trocas.estado === "carregando" ? (
        <p
          role="status"
          className="rounded-2xl border border-border p-4 text-sm text-muted-foreground"
        >
          Carregando as regras da loja…
        </p>
      ) : (
        documento.secoes.map((secao) => (
          <section key={secao.id} aria-labelledby={`politica-${secao.id}`}>
            <h2
              id={`politica-${secao.id}`}
              className="mb-1.5 text-sm font-black tracking-tight text-foreground"
            >
              {secao.titulo}
            </h2>
            {secao.paragrafos.map((p) => (
              <p
                key={p}
                className="mb-2 text-sm leading-relaxed text-muted-foreground last:mb-0"
              >
                {p}
              </p>
            ))}
          </section>
        ))
      )}

      <ContatoDaLoja />
    </div>
  );
}

/**
 * O contato que a lojista cadastrou (WhatsApp e endereço). Sem nenhum dos
 * dois o bloco diz isso com todas as letras em vez de apontar para um canal
 * que não existe.
 */
function ContatoDaLoja() {
  const { config } = useStore();
  const nome = nomeDaLoja(config);
  const temWhatsapp = lojaTemWhatsapp(config.whatsappNumber);
  const endereco = config.storeAddress?.trim() || "";

  function falarComALoja() {
    let fone = (config.whatsappNumber || "").replace(/\D/g, "");
    if (fone.length === 10 || fone.length === 11) fone = `55${fone}`;
    abrirWhatsapp(
      `https://wa.me/${fone}?text=${encodeURIComponent("Olá! Vim pelo app da loja.")}`,
    );
  }

  return (
    <section
      aria-labelledby="politica-contato-da-loja"
      className="rounded-2xl border border-border p-4"
    >
      <h2
        id="politica-contato-da-loja"
        className="mb-2 text-sm font-black tracking-tight text-foreground"
      >
        Contato da {nome}
      </h2>
      {temWhatsapp && (
        <button
          type="button"
          onClick={falarComALoja}
          className="flex min-h-11 w-full items-center gap-2 text-left text-sm font-semibold text-foreground underline underline-offset-2"
        >
          <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
          WhatsApp {formatarWhatsAppParaExibicao(config.whatsappNumber ?? "")}
        </button>
      )}
      {endereco && (
        <p className="mt-1 flex items-start gap-2 text-sm text-muted-foreground">
          <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {endereco}
        </p>
      )}
      {!temWhatsapp && !endereco && (
        <p className="text-sm text-muted-foreground">
          A loja ainda não cadastrou um contato neste app. Procure a loja pelos
          canais em que você a conheceu.
        </p>
      )}
    </section>
  );
}
