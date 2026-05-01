import type { ExpiryOption } from '@/types';

export function getExpiryOptions(maxHours: number, isAuthenticated: boolean = false): ExpiryOption[] {
    const allOptions: ExpiryOption[] = [
        { label: '1 Hour', value: 1 },
        { label: '2 Hours', value: 2 },
        { label: '4 Hours', value: 4 },
        { label: '6 Hours', value: 6 },
        { label: '12 Hours', value: 12 },
        { label: '1 Day', value: 24 },
        { label: '2 Days', value: 48 },
        { label: '3 Days', value: 72 },
        { label: '5 Days', value: 120 },
        { label: '7 Days', value: 168 },
        { label: '14 Days', value: 336 },
        { label: '30 Days', value: 720 },
        { label: '90 Days', value: 2160 },
        { label: '180 Days', value: 4320 },
        { label: '365 Days', value: 8760 },
    ];
    const options = allOptions.filter(o => o.value <= maxHours);
    if (isAuthenticated) {
        options.push({ label: 'Never', value: 0 });
    }
    return options;
}
