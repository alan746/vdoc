import { graphemeCount } from '../text/unicode';

const forbidden = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069\uD800-\uDFFF]/u;
export const validNumberAffix = (value: unknown): value is string => typeof value === 'string' && value.length <= 64 && graphemeCount(value) <= 8 && !forbidden.test(value) && !/%[1-9]/.test(value);
export const validBulletText = (value: unknown): value is string => typeof value === 'string' && value.length <= 32 && graphemeCount(value) === 1 && !forbidden.test(value) && !/\s/u.test(value) && /[\p{L}\p{N}\p{P}\p{S}]/u.test(value);
// Escape every code point: text can never terminate a CSS string or declaration.
