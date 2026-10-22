import { vi } from 'vitest';
// Layout isn't implemented by jsdom; these tests exercise document transactions.
Range.prototype.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }));
Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList);
