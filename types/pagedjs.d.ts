declare module 'pagedjs' {
  export class Previewer {
    polisher: { styleEl?: HTMLElement; destroy(): void };
    chunker: { stop(): void; hooks: { renderNode: { register(fn: (clone: Node, source: Node) => void): void }; beforePageLayout: { register(fn: () => void): void } } };
    preview(content: string | HTMLElement, stylesheets: Record<string,string>[], renderTo: HTMLElement): Promise<{ total: number }>;
  }
}
