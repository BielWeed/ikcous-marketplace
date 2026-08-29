/**
 * Triggers a premium 60fps flying thumbnail animation towards the cart target in the UI.
 *
 * O alvo e' SEMPRE `#bottom-nav-cart`, em qualquer largura. Ate 24/08/2026 ela
 * mirava `#header-cart` acima de 768px, mas o carrinho do topo saiu do Header
 * naquele dia (em tela larga apareciam dois carrinhos ao mesmo tempo). Mirar o
 * elemento removido cairia no `if (!target)` abaixo: aviso no console e
 * NENHUMA animacao justamente nas telas grandes.
 */
export function triggerFlyingCartAnimation(
  startElement: HTMLElement,
  imageSrc: string,
) {
  if (typeof window === "undefined") return;

  const targetId = "bottom-nav-cart";
  const target = document.getElementById(targetId);

  if (!target) {
    console.warn(
      `[cartAnimation] Target element #${targetId} not found in DOM.`,
    );
    return;
  }

  const startRect = startElement.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();

  // Create flyer container (moves horizontally)
  const container = document.createElement("div");
  container.className = "cart-flyer-container";

  // Create flyer image (moves vertically and scales)
  const flyer = document.createElement("img");
  flyer.src = imageSrc;
  flyer.alt = "";
  flyer.className = "cart-flyer-img";

  const size = 50; // px
  // Calculate center coordinates
  const startX = startRect.left + startRect.width / 2 - size / 2;
  const startY = startRect.top + startRect.height / 2 - size / 2;
  const targetX = targetRect.left + targetRect.width / 2 - size / 2;
  const targetY = targetRect.top + targetRect.height / 2 - size / 2;

  // Apply base styles for container (X-axis movement)
  Object.assign(container.style, {
    position: "fixed",
    top: `${startY}px`,
    left: `${startX}px`,
    width: `${size}px`,
    height: `${size}px`,
    zIndex: "99999",
    pointerEvents: "none",
    transition: "transform 0.75s cubic-bezier(0.25, 1, 0.5, 1)", // easeOutQuad for horizontal
    transform: "translate3d(0, 0, 0)",
  });

  // Apply base styles for image (Y-axis movement + scale + opacity)
  Object.assign(flyer.style, {
    width: "100%",
    height: "100%",
    borderRadius: "50%",
    objectFit: "cover",
    boxShadow: "0 10px 25px rgba(0, 0, 0, 0.25)",
    border: "2px solid white",
    transition:
      "transform 0.75s cubic-bezier(0.55, 0, 1, 0.45), opacity 0.75s cubic-bezier(0.55, 0, 1, 0.45)", // easeInQuad for vertical
    transform: "scale(1.3) translate3d(0, 0, 0)",
    opacity: "1",
  });

  container.appendChild(flyer);
  document.body.appendChild(container);

  // Force reflow
  container.getBoundingClientRect();

  // Trigger animations
  container.style.transform = `translate3d(${targetX - startX}px, 0, 0)`;
  flyer.style.transform = `translate3d(0, ${targetY - startY}px, 0) scale(0.15)`;
  flyer.style.opacity = "0.3";

  // Cleanup and trigger pop effect on cart icon
  setTimeout(() => {
    container.remove();
    target.classList.add("cart-pop");
    setTimeout(() => {
      target.classList.remove("cart-pop");
    }, 300);
  }, 750);
}
