export const MAX_LIST_START = 2147483647;
export const validListStart = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_LIST_START;
