import { BotaoWhatsapp } from "@/components/ui/custom/BotaoWhatsapp";
import { buildIdentity } from "@/config/buildIdentity";
import { useStore } from "@/contexts/StoreContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { abrirWhatsapp } from "@/lib/abrir-whatsapp";
import { lojaTemWhatsapp } from "@/lib/loja-tem-whatsapp";
import { nomeDaLoja } from "@/lib/nome-da-loja";
import { haptic } from "@/utils/haptic";
import DOMPurify from "dompurify";
import { motion, useIsPresent } from "framer-motion";
import { ArrowUpRight, Clock, MapPin } from "lucide-react";
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
    <div className="pb-customer min-h-full bg-background text-foreground">
      <div
        className={`mx-auto max-w-md space-y-6 px-4 pt-6 sm:px-6 sm:pt-8 ${temWhatsapp ? "pb-28" : "pb-6"}`}
      >
        {/* Cabeçalho Tinta: logo à esquerda; rótulo mono, nome (h1) e cidade à
            direita. `min-w-0` + `break-words` deixam o nome longo quebrar sem
            rolagem lateral em 320px. */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex items-center gap-4"
        >
          {logoSrc ? (
            <img
              key={`${logoSelection.revision}:${logoSelection.stage}`}
              src={logoSrc}
              alt={`Logo da loja ${storeName}`}
              onError={logoFalhou}
              className="size-20 shrink-0 rounded-[18px] border border-border bg-background object-contain sm:size-24"
            />
          ) : (
            <div className="flex size-20 shrink-0 items-center justify-center rounded-[18px] bg-foreground text-3xl font-bold text-background sm:size-24">
              {inicial}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              Sobre a loja
            </p>
            <h1 className="mt-1 break-words text-[28px] font-bold leading-8 tracking-tight text-foreground">
              {storeName}
            </h1>
            {local && (
              <p className="mt-1 flex items-center gap-1.5 text-base text-muted-foreground">
                <MapPin className="size-4 shrink-0" />
                <span className="min-w-0 break-words">{local}</span>
              </p>
            )}
          </div>
        </motion.div>

        {/* Mapa. Ordem do dono (14/09): o mapa mora na área da marca. Clicar
            em QUALQUER ponto abre o Google Maps — sem botão separado. */}
        {queryMaps && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05 }}
          >
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${queryMaps}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => haptic.light()}
              aria-label="Abrir no Google Maps"
              className="group block w-full overflow-hidden rounded-[18px] border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {/* Recorte do topo esconde o chip "Open in Maps" do embed do
                  Google. Mapa ESTÁTICO (pointer-events none) porque o pin é
                  da CASA, fixo no centro — enquanto a loja não crava a
                  localização exata no painel (peça futura), o dado é o CEP de
                  origem: aproximação, com aviso. Altura fixa (h-52): o mapa
                  não pula quando o iframe carrega. */}
              <div className="relative h-52 w-full overflow-hidden bg-muted/40">
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
                <p className="absolute bottom-2 left-2 rounded-full bg-background/90 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground shadow-sm">
                  Localização aproximada
                </p>
              </div>
              <span className="flex min-h-11 items-center justify-between gap-2 border-t border-border bg-background px-4 py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition-colors group-hover:text-foreground">
                Toque para abrir no Google Maps
                <ArrowUpRight className="size-4 shrink-0" />
              </span>
            </a>
          </motion.div>
        )}

        {descricaoHtml && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="space-y-3"
          >
            <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              Nossa história
            </h2>
            <div
              className="break-words text-base leading-relaxed text-foreground [&_a]:font-semibold [&_a]:text-foreground [&_a]:underline [&_h1]:mt-3 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:mt-2 [&_h3]:text-base [&_h3]:font-bold [&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-[14px] [&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: o HTML vem do lojista e passa por DOMPurify ANTES (script/handlers/URLs perigosos removidos) — o teste da página prova o ataque inerte.
              dangerouslySetInnerHTML={{ __html: descricaoHtml }}
            />
          </motion.section>
        )}

        {/* Horário de atendimento — só quando a loja preencheu (mesma fonte
            do rodapé da home: config.businessHours) */}
        {horario && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.15 }}
            className="rounded-[18px] border border-border bg-muted/30 p-4"
          >
            <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <Clock className="size-4 shrink-0" />
              Horário de atendimento
            </p>
            <p className="mt-2 break-words text-base leading-relaxed text-foreground">
              {horario}
            </p>
          </motion.div>
        )}
      </div>

      {/* "Falar com a loja" ANCORADO (pedido do dono, 14/09): continua sempre
          visível enquanto a pessoa rola a descrição e o mapa — agora uma
          barra com o botão verde oficial do WhatsApp (glifo oficial; pedido do
          dono, 26/10/2026 — antes era texto simples). Só
          existe se a loja configurou o número. O offset nasce ACIMA da nav do
          app (--nav-height); z sob a nav para nunca competir com ela.

          PORTAL no body (17/10/2026, relato do dono): o <main> do app tem
          `will-change: transform` (animação de troca de tela), o que vira
          o "bloco de contenção" de qualquer filho `fixed` — o botão rolava
          junto com o conteúdo em vez de ficar parado na tela. Mesmo padrão
          da FavoritesView/ProductView: o elemento fixo mora no body. */}
      {temWhatsapp &&
        isPresent &&
        typeof document !== "undefined" &&
        createPortal(
          <BotaoWhatsapp
            onClick={falarComALoja}
            aria-label="Falar com a loja no WhatsApp"
            className="fixed left-1/2 z-[115] h-[52px] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 shadow-lg"
            style={{
              bottom:
                "calc(var(--nav-height, 56px) + 16px + var(--safe-area-bottom, 0px))",
            }}
          >
            Falar com a loja
          </BotaoWhatsapp>,
          document.body,
        )}
    </div>
  );
}
