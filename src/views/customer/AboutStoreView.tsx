import { IconeWhatsapp } from "@/components/icons/IconeWhatsapp";
import { buildIdentity } from "@/config/buildIdentity";
import { useStore } from "@/contexts/StoreContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { abrirWhatsapp } from "@/lib/abrir-whatsapp";
import { lojaTemWhatsapp } from "@/lib/loja-tem-whatsapp";
import { nomeDaLoja } from "@/lib/nome-da-loja";
import { haptic } from "@/utils/haptic";
import DOMPurify from "dompurify";
import { motion, useIsPresent } from "framer-motion";
import { Clock, MapPin, Navigation } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

// Caixa do mapa embutido: o iframe sobe 56px para esconder o chip "Open in
// Maps" do Google, e o centro GEOGRÁFICO do mapa (onde o Google desenha o
// marcador do endereço) é o centro DESSA caixa — 28px acima do centro do
// cartão visível. O pino mora na MESMA caixa (mesmas classes, uma fonte só):
// se um dia o recorte mudar, os dois mudam juntos e a ponta nunca desvia.
const CAIXA_DO_IFRAME =
  "pointer-events-none absolute left-0 top-[-56px] h-[calc(100%+56px)] w-full";

// Pino da casa (pedido do dono, 14/10/2026): PEQUENO (30x38) e redondo.
// A logo vai num CÍRCULO (raio 13) e o anel de 2px em volta é o próprio
// corpo preto do pino. O corpo é um círculo de raio 15 com um bico, cuja
// PONTA é a base do SVG (`M15,38`): com o ancoradouro em 50%/-100% da caixa
// do iframe, a ponta cai no centro do mapa, onde o Google desenha o
// marcador nativo do endereço — que este corpo, maior que o marcador do
// Google (mesma ponta, mesmo eixo), cobre por inteiro. Os +2px: medido no
// Chromium em 3 endereços, a ponta do marcador do Google fica 1–2px ABAIXO
// do centro da caixa; sem eles uma agulha vermelha aparecia sob a ponta.
//
// Ícone: o MESMO que vai para a tela inicial do celular — papel `icon_192`
// (o do manifest do PWA, `porteiro.ts`, e o da notificação push, `sw.ts`).
// NUNCA a logo LARGA do cabeçalho: uma logo-palavra (ex.: "SAVY") recortada
// num círculo pequeno virava um borrão preto (dono, 28/09). O ícone já vem
// QUADRADO e validado no build. Falha de rede cai na inicial, nunca num
// borrão. Fundo branco por baixo: ícone com transparência não vira buraco.
function PinDoMapa({ nome, inicial }: { nome: string; inicial: string }) {
  const [iconeFalhou, setIconeFalhou] = useState(false);
  const icone = iconeFalhou ? null : buildIdentity.localUrls.icon_192;
  return (
    <div data-pino-do-mapa="" className={CAIXA_DO_IFRAME}>
      <div className="absolute left-1/2 top-[calc(50%+2px)] -translate-x-1/2 -translate-y-full drop-shadow-[0_2px_2px_rgba(0,0,0,0.35)]">
        <svg
          width="30"
          height="38"
          viewBox="0 0 30 38"
          role="img"
          aria-label={`Local da loja ${nome}`}
        >
          <defs>
            <clipPath id="pin-icone-recorte">
              <circle cx="15" cy="15" r="13" />
            </clipPath>
          </defs>
          <path
            data-pino-corpo=""
            d="M15,38 L26.37,24.78 A15,15 0 1,0 3.63,24.78 Z"
            fill="#18181b"
          />
          <circle cx="15" cy="15" r="12.5" fill="#ffffff" />
          <g clipPath="url(#pin-icone-recorte)">
            {icone ? (
              <image
                href={icone}
                x="2"
                y="2"
                width="26"
                height="26"
                preserveAspectRatio="xMidYMid meet"
                onError={() => setIconeFalhou(true)}
              />
            ) : (
              <>
                <circle cx="15" cy="15" r="13" fill="#18181b" />
                <text
                  x="15"
                  y="20"
                  textAnchor="middle"
                  fontSize="15"
                  fontWeight="900"
                  fill="#ffffff"
                >
                  {inicial}
                </text>
              </>
            )}
          </g>
        </svg>
      </div>
    </div>
  );
}

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
  // Só LÊ o estado (não registra a tela como participante de saída, o que
  // exigiria chamar safeToRemove). Fora de um AnimatePresence é sempre true; dentro dele vira
  // false quando a tela está saindo — aí o botão (portalado) some junto.
  const isPresent = useIsPresent();
  const inicial = storeName.charAt(0).toUpperCase();

  // A descrição é RICA (o lojista formata texto e anexa imagem no painel —
  // peça futura do editor). Conteúdo do lojista renderizado como HTML SEMPRE
  // passa pelo DOMPurify: script, handler de evento e URL perigosa são
  // removidos; se a sanitização esvaziar tudo, o bloco não existe.
  const descricao = config.storeDescription?.trim() || "";
  const descricaoHtml = descricao
    ? DOMPurify.sanitize(descricao, { USE_PROFILES: { html: true } })
    : "";

  // Onde a loja está (20261167000000): o ENDEREÇO que a loja declarou na
  // tela "Sobre a Loja" vence; sem endereço, o CEP de origem do frete é o
  // dado mais "certinho" que a loja JÁ TEM (cai na rua do CEP); sem CEP,
  // centra na cidade/UF; sem nenhum dos dois, o cartão de mapa nem existe.
  // O Google geocodifica a query sozinho no embed — sem chave, sem serviço
  // pago, sem geocoder nosso. Por isso o chip segue "Localização
  // aproximada": query de texto, nunca coordenada cravada.
  const onde = config.storeAddress?.trim() || config.originCep?.trim() || local;
  const queryMaps = onde ? encodeURIComponent(onde) : "";

  // Mesma cascata do Header: logo do banco → asset local do build → inicial.
  // A logo do banco que falha NÃO pula para a inicial: avança para a
  // candidata seguinte — a inicial só vence quando a do build também falha.
  // A máquina de troca em tempo real fica no Header; aqui basta o estágio com
  // revisão, reiniciado quando a fonte (logoUrl) muda.
  const logoUrl = config.logoUrl?.trim() || null;
  const [logoSelection, setLogoSelection] = useState<{
    url: string | null;
    revision: number;
    stage: "db" | "local" | "text";
  }>({ url: logoUrl, revision: 0, stage: logoUrl ? "db" : "local" });
  if (logoSelection.url !== logoUrl) {
    setLogoSelection({
      url: logoUrl,
      revision: logoSelection.revision + 1,
      stage: logoUrl ? "db" : "local",
    });
  }
  let logoSrc: string | null = null;
  if (logoSelection.stage === "db" && logoUrl) {
    logoSrc = logoUrl;
  } else if (logoSelection.stage === "local") {
    logoSrc = buildIdentity.localUrls.header;
  }
  const logoFalhou = () => {
    setLogoSelection((current) => {
      // Falha só avança a candidata que a originou.
      if (current !== logoSelection) return current;
      const stage =
        current.stage === "db" && logoSrc !== buildIdentity.localUrls.header
          ? "local"
          : "text";
      return { ...current, stage };
    });
  };

  useDocumentMeta({ title: `Sobre a loja | ${storeName}` });

  // Mesma formatação do suporte do Perfil: só dígitos, prefixo 55 quando o
  // número é nacional (10 ou 11 dígitos). A régua de existência é o
  // lojaTemWhatsapp — sem número, este bloco nem renderiza.
  const falarComALoja = () => {
    let phone = (config.whatsappNumber || "").replace(/\D/g, "");
    if (phone.length === 10 || phone.length === 11) {
      phone = `55${phone}`;
    }
    abrirWhatsapp(
      `https://wa.me/${phone}?text=${encodeURIComponent("Olá! Vim pelo app da loja.")}`,
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
          {/* Título em SVG VETORIAL (pedido do dono, 15/09): nítido em
              qualquer zoom. Aprovado pelo dono SEM a camada dourada de fundo —
              texto único preto. `textLength` trava a largura para o desenho
              não depender do momento em que a fonte carrega. O h1 permanece
              nomeado (aria-label) para leitores de tela. */}
          <h1 className="flex justify-center">
            <svg
              width="252"
              height="40"
              viewBox="0 0 252 40"
              role="img"
              aria-label="Sobre a Loja"
            >
              <text
                x="126"
                y="31"
                textAnchor="middle"
                textLength="244"
                lengthAdjust="spacingAndGlyphs"
                fontFamily="Inter, Arial, sans-serif"
                fontSize="34"
                fontWeight="900"
                letterSpacing="-1"
                fill="#18181b"
              >
                Sobre a Loja
              </text>
            </svg>
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            A marca por trás deste app.
          </p>
        </motion.div>

        {/* Marca + localização + descrição. Ordem do dono (14/09): o mapa
            mora AQUI, entre o nome da loja e a cidade. Clicar em QUALQUER
            ponto do mapa abre o Google Maps — sem botão separado. */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="flex flex-col items-center gap-4 rounded-[2.5rem] border border-zinc-100 bg-white p-6 text-center shadow-sm sm:p-8"
        >
          {logoSrc ? (
            <img
              key={`${logoSelection.revision}:${logoSelection.stage}`}
              src={logoSrc}
              alt={`Logo da loja ${storeName}`}
              onError={logoFalhou}
              className="size-24 rounded-[1.75rem] border border-zinc-100 bg-white object-contain"
            />
          ) : (
            <div className="flex size-24 items-center justify-center rounded-[1.75rem] bg-zinc-900 text-3xl font-black text-white">
              {inicial}
            </div>
          )}
          <h2 className="text-lg font-black tracking-tight text-zinc-900">
            {storeName}
          </h2>
          {queryMaps && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${queryMaps}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => haptic.light()}
              aria-label="Abrir no Google Maps"
              className="group block w-full overflow-hidden rounded-[2rem] border border-zinc-100"
            >
              {/* Recorte do topo esconde o chip "Open in Maps" do embed do
                  Google. Mapa ESTÁTICO (pointer-events none) porque o pin é
                  da CASA, fixo no centro — enquanto a loja não crava a
                  localização exata no painel (peça futura), o dado é o CEP de
                  origem: aproximação, com aviso. */}
              <div className="relative h-48 w-full overflow-hidden">
                {/* credentialless: mantido mesmo sem o COEP do app (removido do
                    vercel.json em 26/09/2026 — decisão do dono, travava o Card
                    Payment Brick). Sem o COEP do app o frame do Google não
                    corre mais risco de ser barrado por causa dele; o atributo
                    fica porque é inofensivo aqui — o mapa não usa cookie
                    nosso — e continua carregando num contexto efêmero. */}
                <iframe
                  title={`Mapa da loja ${storeName}`}
                  src={`https://maps.google.com/maps?q=${queryMaps}&z=15&output=embed`}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  credentialless=""
                  className={`${CAIXA_DO_IFRAME} block border-0`}
                />
                {/* Pino da casa (ver `PinDoMapa`). Mora na MESMA caixa do
                    iframe — não no centro do cartão, que fica 28px abaixo do
                    centro do mapa por causa do recorte do topo. */}
                <PinDoMapa nome={storeName} inicial={inicial} />
                <p className="absolute bottom-2 left-2 rounded-full bg-white/90 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 shadow-sm">
                  Localização aproximada
                </p>
              </div>
              <span className="flex items-center justify-center gap-1.5 bg-zinc-50 py-2 text-[9px] font-black uppercase tracking-widest text-zinc-400 transition-colors group-hover:text-zinc-900">
                <Navigation className="size-3" />
                Toque no mapa · abre no Google Maps
              </span>
            </a>
          )}
          {local && (
            <p className="-mt-1 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              <MapPin className="size-3" />
              {local}
            </p>
          )}
          {descricaoHtml && (
            <div
              className="w-full border-t border-zinc-100 pt-4 text-left text-[13px] leading-relaxed text-zinc-600 [&_a]:font-bold [&_a]:text-zinc-900 [&_a]:underline [&_h1]:mt-3 [&_h1]:text-sm [&_h1]:font-black [&_h1]:text-zinc-900 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-black [&_h2]:text-zinc-900 [&_h3]:mt-2 [&_h3]:text-[13px] [&_h3]:font-black [&_h3]:text-zinc-900 [&_img]:my-3 [&_img]:w-full [&_img]:rounded-2xl [&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_strong]:font-bold [&_strong]:text-zinc-800 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: o HTML vem do lojista e passa por DOMPurify ANTES (script/handlers/URLs perigosos removidos) — o teste da página prova o ataque inerte.
              dangerouslySetInnerHTML={{ __html: descricaoHtml }}
            />
          )}
        </motion.div>

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
      </div>

      {/* WhatsApp ANCORADO (pedido do dono, 14/09): sai da lista e vira botão
          flutuante, sempre visível enquanto a pessoa rola a descrição e o
          mapa. Ícone oficial do WhatsApp (IconeWhatsapp). Só existe se a loja
          configurou o número. O offset nasce ACIMA da nav do app
          (--nav-height); z sob a nav para nunca competir com ela.

          PORTAL no body (17/10/2026, relato do dono): o <main> do app tem
          `will-change: transform` (animação de troca de tela), o que vira
          o "bloco de contenção" de qualquer filho `fixed` — o botão rolava
          junto com o conteúdo em vez de ficar parado na tela. Mesmo padrão
          da FavoritesView/ProductView: o elemento fixo mora no body. */}
      {temWhatsapp &&
        isPresent &&
        typeof document !== "undefined" &&
        createPortal(
          <button
            type="button"
            onClick={falarComALoja}
            aria-label="Falar com a loja no WhatsApp"
            className="fixed right-4 z-[115] flex size-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/40 transition-transform hover:bg-emerald-700 active:scale-95"
            style={{
              bottom:
                "calc(var(--nav-height, 56px) + 20px + var(--safe-area-bottom, 0px))",
            }}
          >
            <IconeWhatsapp className="size-8" />
          </button>,
          document.body,
        )}
    </div>
  );
}
