// Ícones dos meios de pagamento do checkout (pedido do dono, 25/09/2026: os
// ícones genéricos — um cartão para "Pagar com PIX", um celular para "Pix na
// entrega" — não diziam qual era a forma de pagamento).
//
// - Pix: glifo OFICIAL (traço do simple-icons 16.32, CC0). O manual da marca
//   Pix do Banco Central prevê o símbolo para identificar a opção de
//   pagamento. Cor oficial: #32BCAD (aplicada por quem usa).
// - Cartão e dinheiro não têm símbolo oficial: desenhos próprios que dizem o
//   objeto (cartão com tarja; cédula com medalhão).
//
// Componentes próprios, como IconeWhatsapp: um glifo cada, zero pacote extra.

interface IconeProps {
  className?: string;
}

export function IconePix({ className }: IconeProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      shapeRendering="geometricPrecision"
      className={className}
    >
      <path d="M5.283 18.36a3.505 3.505 0 0 0 2.493-1.032l3.6-3.6a.684.684 0 0 1 .946 0l3.613 3.613a3.504 3.504 0 0 0 2.493 1.032h.71l-4.56 4.56a3.647 3.647 0 0 1-5.156 0L4.85 18.36ZM18.428 5.627a3.505 3.505 0 0 0-2.493 1.032l-3.613 3.614a.67.67 0 0 1-.946 0l-3.6-3.6A3.505 3.505 0 0 0 5.283 5.64h-.434l4.573-4.572a3.646 3.646 0 0 1 5.156 0l4.559 4.559ZM1.068 9.422 3.79 6.699h1.492a2.483 2.483 0 0 1 1.744.722l3.6 3.6a1.73 1.73 0 0 0 2.443 0l3.614-3.613a2.482 2.482 0 0 1 1.744-.723h1.767l2.737 2.737a3.646 3.646 0 0 1 0 5.156l-2.736 2.736h-1.768a2.482 2.482 0 0 1-1.744-.722l-3.613-3.613a1.77 1.77 0 0 0-2.444 0l-3.6 3.6a2.483 2.483 0 0 1-1.744.722H3.791l-2.723-2.723a3.646 3.646 0 0 1 0-5.156" />
    </svg>
  );
}

// Cartão e cédula são SÓLIDOS (fill + evenodd), no mesmo peso do glifo do
// Pix: em traço fino, a 20px, o chip e o "R$" sumiam (medido no navegador).
export function IconeCartao({ className }: IconeProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {/* cartão, com a tarja magnética e a linha do número vazadas */}
      <path d="M4.5 4h15A2.5 2.5 0 0 1 22 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 17.5v-11A2.5 2.5 0 0 1 4.5 4ZM2 8v2.75h20V8ZM5 14.25v2h6v-2Z" />
    </svg>
  );
}

export function IconeDinheiro({ className }: IconeProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {/* cédula: medalhão central vazado com a moeda dentro, e os dois
          cantos marcados, como numa nota */}
      <path d="M3.5 5h17A2 2 0 0 1 22.5 7v10a2 2 0 0 1-2 2h-17a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM5.5 10.75a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5ZM18.5 10.75a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}
