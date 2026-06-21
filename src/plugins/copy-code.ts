import { registerBuiltinPlugin } from '../core/plugin-manager';
import { PluginFactory, AfterRenderData, PluginContext } from '../types';

const copyCodePlugin: PluginFactory = (context: PluginContext) => {
  return {
    onAfterRender(data: AfterRenderData, ctx: PluginContext) {
      data.html = data.html.replace(
        /(<pre[^>]*>)([\s\S]*?)(<\/pre>)/g,
        (match, openTag, content, closeTag) => {
          if (content.includes('copy-code-btn')) return match;
          return `${openTag}<button class="copy-code-btn">复制</button>${content}${closeTag}`;
        }
      );
      return data;
    }
  };
};

registerBuiltinPlugin('copy-code', copyCodePlugin);

export { copyCodePlugin };
