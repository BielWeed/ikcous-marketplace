import { buildIdentity } from "@/config/buildIdentity";
import { useStore } from "@/contexts/StoreContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { lojaTemWhatsapp } from "@/lib/loja-tem-whatsapp";
import { nomeDaLoja } from "@/lib/nome-da-loja";
import { haptic } from "@/utils/haptic";
import DOMPurify from "dompurify";
import { motion } from "framer-motion";
import {
  ChevronRight,
  Clock,
  MapPin,
  MessageCircle,
  Navigation,
} from "lucide-react";
import { useEffect, useState } from "react";

// Página de LEITURA da marca do lojista assinante (peça 24). Fonte ÚNICA dos
// dados = StoreConfig da loja (useStore) — a mesma que alimenta o cabeçalho
// (logo/nome) e o rodapé da home (horário). Régua da casa: o dado que a loja
// não preencheu não vira bloco vazio nem "undefined" — o bloco simplesmente
// não existe na tela (migration 20261033000000). A descrição editável da loja
// depende de coluna nova (decisão do dono): enquanto ela não existir no
// banco, o campo nunca chega e o bloco fica oculto — nunca inventado aqui.
export function AboutStoreView() {
  const { config } = useStore();

  const storeName = nomeDaLoja(config);
  const horario = config.businessHours?.trim() || "";
  const local = [config.storeCity?.trim(), config.storeState?.trim()]
    .filter(Boolean)
    .join(", ");
  const temWhatsapp = lojaTemWhatsapp(config.whatsappNumber);
  const inicial = storeName.charAt(0).toUpperCase();

  // A descrição é RICA (o lojista formata texto e anexa imagem no painel —
  // peça futura do editor). Conteúdo do lojista renderizado como HTML SEMPRE
  // passa pelo DOMPurify: script, handler de evento e URL perigosa são
  // removidos; se a sanitização esvaziar tudo, o bloco não existe.
  const descricao = config.storeDescription?.trim() || "";
  const descricaoHtml = descricao
    ? DOMPurify.sanitize(descricao, { USE_PROFILES: { html: true } })
    : "";

  // Onde a loja está: o CEP de origem do frete é o dado mais "certinho" que a
  // loja JÁ TEM no sistema (cai na rua do CEP); sem CEP, centra na cidade/UF;
  // sem nenhum dos dois, o cartão de mapa nem existe. O Google geocodifica a
  // query sozinho no embed — sem chave, sem serviço pago, sem geocoder nosso.
  const onde = config.originCep?.trim() || local;
  const queryMaps = onde ? encodeURIComponent(onde) : "";

  // Mesma cascata do Header: logo do banco → asset local do build → inicial.
  // A máquina de estados de troca em tempo real fica no Header; aqui basta a
  // imagem com fallback, reiniciada quando a fonte muda.
  const logoSrc = config.logoUrl?.trim() || buildIdentity.localUrls.header;
  const [logoFalhou, setLogoFalhou] = useState(false);
  useEffect(() => {
    setLogoFalhou(false);
  }, [logoSrc]);

  useDocumentMeta({ title: `Sobre a loja | ${storeName}` });

  // Mesma formatação do suporte do Perfil: só dígitos, prefixo 55 quando o
  // número é nacional (10 ou 11 dígitos). A régua de existência é o
  // lojaTemWhatsapp — sem número, este bloco nem renderiza.
  const falarComALoja = () => {
    let phone = (config.whatsappNumber || "").replace(/\D/g, "");
    if (phone.length === 10 || phone.length === 11) {
      phone = `55${phone}`;
    }
    globalThis.open(
      `https://wa.me/${phone}?text=${encodeURIComponent("Olá! Vim pelo app da loja.")}`,
      "_blank",
    );
    haptic.light();
  };

  return (
    <div className="pb-customer min-h-full bg-zinc-50/40">
      <div className="mx-auto max-w-md space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col items-center gap-1.5 border-b border-zinc-100 pb-5 text-center"
        >
          <h1 className="text-3xl font-black leading-none tracking-tight text-zinc-900">
            Sobre a Loja
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            A marca por trás deste app.
          </p>
        </motion.div>

        {/* Marca + descrição */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="flex flex-col items-center gap-4 rounded-[2.5rem] border border-zinc-100 bg-white p-8 text-center shadow-sm"
        >
          {logoSrc && !logoFalhou ? (
            <img
              key={logoSrc}
              src={logoSrc}
              alt={`Logo da loja ${storeName}`}
              onError={() => setLogoFalhou(true)}
              className="size-24 rounded-[1.75rem] border border-zinc-100 bg-white object-contain"
            />
          ) : (
            <div className="flex size-24 items-center justify-center rounded-[1.75rem] bg-zinc-900 text-3xl font-black text-white">
              {inicial}
            </div>
          )}
          <div>
            <h2 className="text-lg font-black tracking-tight text-zinc-900">
              {storeName}
            </h2>
            {local && (
              <p className="mt-1.5 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                <MapPin className="size-3" />
                {local}
              </p>
            )}
          </div>
          {descricaoHtml && (
            <div
              className="w-full border-t border-zinc-100 pt-4 text-left text-[13px] leading-relaxed text-zinc-600 [&_a]:font-bold [&_a]:text-zinc-900 [&_a]:underline [&_h1]:mt-3 [&_h1]:text-sm [&_h1]:font-black [&_h1]:text-zinc-900 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-black [&_h2]:text-zinc-900 [&_h3]:mt-2 [&_h3]:text-[13px] [&_h3]:font-black [&_h3]:text-zinc-900 [&_img]:my-3 [&_img]:w-full [&_img]:rounded-2xl [&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_strong]:font-bold [&_strong]:text-zinc-800 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
              dangerouslySetInnerHTML={{ __html: descricaoHtml }}
            />
          )}
        </motion.div>

        {/* Onde a loja está — mapa real com o pin da query (CEP de origem ou
            cidade/UF) + link para levar o GPS até lá. Sem dado nenhum de
            localização, o cartão nem renderiza. */}
        {queryMaps && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="overflow-hidden rounded-[2.5rem] border border-zinc-100 bg-white shadow-sm"
          >
            {/* Recorte do topo esconde o chip "Open in Maps" do embed do
                Google (controle nosso, não do iframe): o mapa sobe 56px para
                fora do wrapper e continua navegável. */}
            <div className="relative h-56 w-full overflow-hidden">
              <iframe
                title={`Mapa da loja ${storeName}`}
                src={`https://maps.google.com/maps?q=${queryMaps}&z=15&output=embed`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="absolute left-0 top-[-56px] block h-[calc(100%+56px)] w-full border-0"
              />
            </div>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${queryMaps}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => haptic.light()}
              className="group flex w-full items-center justify-between border-t border-zinc-50 p-5 transition-colors hover:bg-zinc-50"
            >
              <div className="flex items-center gap-4">
                <div className="flex size-10 items-center justify-center rounded-2xl bg-zinc-50 transition-colors group-hover:bg-white">
                  <Navigation className="size-5 text-zinc-400" />
                </div>
                <div className="text-left">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-900">
                    Abrir no Google Maps
                  </p>
                  <p className="text-[9px] font-bold uppercase tracking-tighter text-zinc-400">
                    Levar o GPS até a loja
                  </p>
                </div>
              </div>
              <ChevronRight className="size-4 text-zinc-300 transition-transform group-hover:translate-x-1" />
            </a>
          </motion.div>
        )}

        {/* Horário de atendimento — só quando a loja preencheu (mesma fonte
            do rodapé da home: config.businessHours) */}
        {horario && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.15 }}
            className="rounded-[2rem] border border-zinc-100 bg-zinc-50/50 p-6 text-center"
          >
            <p className="flex items-center justify-center gap-2 text-sm font-bold text-zinc-700">
              <Clock className="size-4 text-admin-gold" />
              Horário de atendimento
            </p>
            <p className="mt-1 text-sm leading-relaxed text-zinc-500">
              {horario}
            </p>
          </motion.div>
        )}

        {/* Contato — só quando a loja tem WhatsApp configurado */}
        {temWhatsapp && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.2 }}
            className="overflow-hidden rounded-[2.5rem] border border-zinc-100 bg-white shadow-sm"
          >
            <button
              type="button"
              onClick={falarComALoja}
              className="group flex w-full items-center justify-between p-6 transition-colors hover:bg-emerald-50"
            >
              <div className="flex items-center gap-4">
                <div className="flex size-10 items-center justify-center rounded-2xl bg-emerald-50 transition-colors group-hover:bg-white">
                  <MessageCircle className="size-5 text-emerald-600" />
                </div>
                <div className="text-left">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-900">
                    Falar com a loja
                  </p>
                  <p className="text-[9px] font-bold uppercase tracking-tighter text-zinc-400">
                    Atendimento pelo WhatsApp
                  </p>
                </div>
              </div>
              <ChevronRight className="size-4 text-zinc-300 transition-transform group-hover:translate-x-1" />
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
