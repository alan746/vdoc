export const DEFAULT_TAB_INTERVAL = 48;
export const validTabInterval = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 8 && value <= 480;
