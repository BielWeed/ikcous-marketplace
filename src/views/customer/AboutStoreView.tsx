import { buildIdentity } from "@/config/buildIdentity";
import { useStore } from "@/contexts/StoreContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { lojaTemWhatsapp } from "@/lib/loja-tem-whatsapp";
import { nomeDaLoja } from "@/lib/nome-da-loja";
import { haptic } from "@/utils/haptic";
import { motion } from "framer-motion";
import { ChevronRight, Clock, MapPin, MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";

// Página de LEITURA da marca do lojista assinante (peça 24). Fonte ÚNICA dos
// dados = StoreConfig da loja (useStore) — a mesma que alimenta o cabeçalho
// (logo/nome) e o rodapé da home (horário). Régua da casa: o dado que a loja
// não preencheu não vira bloco vazio nem "undefined" — o bloco simplesmente
// não existe na tela (migration 20261033000000). A descrição editável da loja
// ainda não tem coluna: é peça futura, não inventada aqui.
export function AboutStoreView() {
  const { config } = useStore();

  const storeName = nomeDaLoja(config);
  const horario = config.businessHours?.trim() || "";
  const local = [config.storeCity?.trim(), config.storeState?.trim()]
    .filter(Boolean)
    .join(", ");
  const temWhatsapp = lojaTemWhatsapp(config.whatsappNumber);
  const inicial = storeName.charAt(0).toUpperCase();

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
          className="flex flex-col gap-1 border-b border-zinc-100 pb-4 text-center"
        >
          <h1 className="text-xl font-extrabold tracking-tight text-zinc-900">
            Sobre a Loja
          </h1>
          <p className="text-xs text-zinc-500">A marca por trás deste app.</p>
        </motion.div>

        {/* Marca */}
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
        </motion.div>

        {/* Horário de atendimento — só quando a loja preencheu (mesma fonte
            do rodapé da home: config.businessHours) */}
        {horario && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
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
            transition={{ duration: 0.3, delay: 0.15 }}
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
