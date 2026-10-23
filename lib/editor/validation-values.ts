export const validColor = (value: unknown) => value == null || value === '' || typeof value === 'string' && /^(#[\da-f]{3,8}|rgba?\([\d.,\s]+\)|transparent)$/i.test(value);
