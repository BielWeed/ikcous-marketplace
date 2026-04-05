import { useCartContext } from '@/contexts/CartContext';

/**
 * useCart - Legacy Wrapper
 * Now consumes the centralized CartContext to ensure singleton behavior
 * and prevent duplication loops across multiple instances.
 */
export function useCart() {
  return useCartContext();
}
