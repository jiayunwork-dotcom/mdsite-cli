import { registerBuiltinPlugin } from '../core/plugin-manager';
import { PluginFactory, MarkdownParsedData, BeforeRenderData, PluginContext } from '../types';

const readingTimePlugin: PluginFactory = (context: PluginContext) => {
  const wordsPerMinute = context.options.wordsPerMinute || 200;

  return {
    onMarkdownParsed(data: MarkdownParsedData, ctx: PluginContext) {
      const plainText = data.rawContent
        .replace(/^#.*$/gm, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`]*`/g, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/[#*_~>]/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      const chineseChars = (plainText.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
      const englishWords = plainText
        .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 0).length;
      const totalWords = chineseChars + englishWords;
      const minutes = Math.max(1, Math.ceil(totalWords / wordsPerMinute));

      ctx.store.set(`readingTime:${data.filePath}`, minutes);

      return data;
    },

    onBeforeRender(data: BeforeRenderData, ctx: PluginContext) {
      const filePath = data.page.filePath;
      const minutes = ctx.store.get(`readingTime:${filePath}`);

      if (minutes !== undefined) {
        data.templateData.readingTime = `预计阅读${minutes}分钟`;
        data.templateData.readingTimeMinutes = minutes;
      }

      return data;
    }
  };
};

registerBuiltinPlugin('reading-time', readingTimePlugin);

export { readingTimePlugin };
