import { registerBuiltinPlugin } from '../core/plugin-manager';
import { PluginFactory, MarkdownParsedData, BeforeRenderData, AfterRenderData, PluginContext } from '../types';

interface TocItem {
  level: number;
  id: string;
  text: string;
}

const autoTocPlugin: PluginFactory = (context: PluginContext) => {
  const tocMap = new Map<string, TocItem[]>();

  return {
    dependencies: ['reading-time'],

    onMarkdownParsed(data: MarkdownParsedData, ctx: PluginContext) {
      const headings: TocItem[] = [];
      const regex = /<h([23])[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/h[23]>/g;
      let match;

      while ((match = regex.exec(data.html)) !== null) {
        const level = parseInt(match[1], 10);
        const id = match[2];
        const text = match[3].replace(/<[^>]+>/g, '').trim();
        headings.push({ level, id, text });
      }

      tocMap.set(data.filePath, headings);
      return data;
    },

    onBeforeRender(data: BeforeRenderData, ctx: PluginContext) {
      const filePath = data.page.filePath;
      const headings = tocMap.get(filePath);

      if (headings && headings.length > 0) {
        data.templateData.toc = headings;
        data.templateData.hasToc = true;
      } else {
        data.templateData.toc = [];
        data.templateData.hasToc = false;
      }

      return data;
    },

    onAfterRender(data: AfterRenderData, ctx: PluginContext) {
      const tocNavMatch = data.html.match(/class="auto-toc-nav"/);
      if (tocNavMatch) return data;

      const filePath = data.page.filePath;
      const headings = tocMap.get(filePath);
      if (!headings || headings.length === 0) return data;

      const readingTime = ctx.store.get(`readingTime:${filePath}`);
      const readingTimeText = readingTime ? ` · ${readingTime}分钟` : '';

      let tocHtml = '<nav class="auto-toc-nav">';
      tocHtml += `<div class="auto-toc-nav-title">目录${readingTimeText}</div>`;
      tocHtml += '<ul>';

      for (const h of headings) {
        const className = h.level === 3 ? ' class="toc-h3"' : '';
        tocHtml += `<li${className}><a href="#${h.id}">${h.text}</a></li>`;
      }

      tocHtml += '</ul></nav>';

      data.html = data.html.replace(
        '</body>',
        tocHtml + '\n</body>'
      );

      return data;
    }
  };
};

registerBuiltinPlugin('auto-toc', autoTocPlugin);

export { autoTocPlugin };
