declare module 'markdown-it-footnote' {
  import MarkdownIt from 'markdown-it';
  const plugin: MarkdownIt.PluginSimple;
  export default plugin;
}

declare module 'markdown-it-task-lists' {
  import MarkdownIt from 'markdown-it';
  const plugin: MarkdownIt.PluginWithOptions<{ enabled?: boolean; label?: boolean; labelAfter?: boolean }>;
  export default plugin;
}

declare module 'markdown-it-container' {
  import MarkdownIt from 'markdown-it';
  const plugin: MarkdownIt.PluginWithParams;
  export default plugin;
}

declare module 'markdown-it-toc-done-right' {
  import MarkdownIt from 'markdown-it';
  interface TocOptions {
    containerClass?: string;
    level?: number[];
    listType?: 'ul' | 'ol';
    slugify?: (s: string) => string;
    format?: (name: string, md: MarkdownIt) => string;
    callback?: (html: string, ast: any[]) => string;
  }
  const plugin: MarkdownIt.PluginWithOptions<TocOptions>;
  export default plugin;
}
