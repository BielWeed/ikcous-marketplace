import { useState, useEffect } from 'react';
import { logForensic } from '@/lib/forensicsDB';

interface DeviceSpecs {
    memory?: number;     // approximate RAM in GB
    cpus?: number;       // hardware concurrency
    saveData?: boolean;  // network save data mode
}

/**
 * useDeviceAdaptation v20.0
 * Adapts application limits based on hardware capabilities.
 * Uses Device Memory API and Hardware Concurrency.
 * 
 * Logic:
 * - Low Memory (< 4GB): Reduce cache limits, disable heavy animations.
 * - High Memory (> 8GB): Extended cache, speculation rules eager.
 */
export function useDeviceAdaptation() {
    const [specs] = useState<DeviceSpecs>(() => {
        const getNav = typeof navigator !== 'undefined' ? (navigator as any) : {};
        return {
            memory: getNav.deviceMemory || 0,
            cpus: navigator.hardwareConcurrency || 0,
            connection: getNav.connection?.effectiveType || 'unknown',
            saveData: getNav.connection?.saveData,
        };
    });

    useEffect(() => {
        void logForensic({
            t: new Date().toISOString(),
            m: 'Device Adaptation Profile Loaded',
            d: specs,
            level: 'info',
            source: 'app',
        });
    }, [specs]);

    const isLowEnd = (specs.memory || 8) < 4 || (specs.cpus || 8) < 4;
    const isHighEnd = (specs.memory || 0) >= 8 && (specs.cpus || 0) >= 8;

    return {
        specs,
        isLowEnd,
        isHighEnd,
        // Dynamic limits
        maxForensicsEntries: isLowEnd ? 100 : 500,
        cacheTTLMultiplier: isLowEnd ? 0.5 : (isHighEnd ? 2 : 1)
    };
}
