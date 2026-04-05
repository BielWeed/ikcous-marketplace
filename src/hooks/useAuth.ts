import { useContext } from 'react';
import { AuthContext } from '@/contexts/AuthContext';

/**
 * useAuth - Consumes the centralized AuthContext
 */
export function useAuth() {
    return useContext(AuthContext);
}
