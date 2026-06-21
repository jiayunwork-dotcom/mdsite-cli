import * as path from 'path';
import * as pc from 'picocolors';
import {
  SiteConfig,
  PluginConfig,
  PluginFactory,
  PluginHooks,
  PluginContext,
  PluginLogger,
  PageInfo,
  LoadedPlugin,
  MarkdownParsedData,
  BeforeRenderData,
  AfterRenderData,
  BuildCompleteData
} from '../types';

const BUILTIN_PLUGINS: Record<string, PluginFactory> = {};

export function registerBuiltinPlugin(name: string, factory: PluginFactory): void {
  BUILTIN_PLUGINS[name] = factory;
}

export class PluginManager {
  private plugins: LoadedPlugin[] = [];
  private pages: PageInfo[] = [];
  private extraAssets: Array<{ path: string; content: string | Buffer }> = [];
  private headTags: string[] = [];
  private cwd: string;
  private config: SiteConfig;

  constructor(cwd: string, config: SiteConfig) {
    this.cwd = cwd;
    this.config = config;
  }

  public async loadPlugins(): Promise<void> {
    const pluginConfigs = this.config.plugins || [];

    for (const pluginConfig of pluginConfigs) {
      try {
        const factory = this.resolvePlugin(pluginConfig);
        if (!factory) continue;

        const context = this.createPluginContext(pluginConfig);
        const hooks = factory(context);

        this.plugins.push({
          name: pluginConfig.name,
          hooks,
          context
        });

        console.log(pc.green(`  ✓ 插件已加载: ${pc.cyan(pluginConfig.name)}`));
      } catch (e: any) {
        console.warn(pc.yellow(`  ⚠ 插件加载失败: ${pluginConfig.name} - ${e.message}`));
        console.warn(pc.dim(`    构建将继续，跳过此插件`));
      }
    }
  }

  private resolvePlugin(pluginConfig: PluginConfig): PluginFactory | null {
    const name = pluginConfig.name;

    if (BUILTIN_PLUGINS[name]) {
      return BUILTIN_PLUGINS[name];
    }

    if (name.startsWith('./') || name.startsWith('../')) {
      const localPath = path.resolve(this.cwd, name);
      try {
        const mod = require(localPath);
        const factory = mod.default || mod;
        if (typeof factory === 'function') return factory;
        console.warn(pc.yellow(`  ⚠ 插件 ${name} 未导出有效的工厂函数`));
        return null;
      } catch (e: any) {
        console.warn(pc.yellow(`  ⚠ 加载本地插件失败: ${name} - ${e.message}`));
        return null;
      }
    }

    try {
      const mod = require(name);
      const factory = mod.default || mod;
      if (typeof factory === 'function') return factory;
      console.warn(pc.yellow(`  ⚠ 插件 ${name} 未导出有效的工厂函数`));
      return null;
    } catch (e: any) {
      console.warn(pc.yellow(`  ⚠ 加载插件失败: ${name} - ${e.message}`));
      return null;
    }
  }

  private createPluginContext(pluginConfig: PluginConfig): PluginContext {
    const pluginName = pluginConfig.name;
    const self = this;

    const logger: PluginLogger = {
      info: (...args: any[]) => console.log(pc.cyan(`[${pluginName}]`), ...args),
      warn: (...args: any[]) => console.warn(pc.yellow(`[${pluginName}]`), ...args),
      error: (...args: any[]) => console.error(pc.red(`[${pluginName}]`), ...args)
    };

    return {
      logger,
      config: JSON.parse(JSON.stringify(this.config)),
      options: pluginConfig.options || {},
      addAsset(assetPath: string, content: string | Buffer) {
        self.extraAssets.push({ path: assetPath, content });
      },
      addHeadTag(tag: string) {
        self.headTags.push(tag);
      },
      getPages(): PageInfo[] {
        return [...self.pages];
      }
    };
  }

  public applyConfigLoaded(config: SiteConfig): SiteConfig {
    let result = config;
    for (const plugin of this.plugins) {
      if (plugin.hooks.onConfigLoaded) {
        try {
          result = plugin.hooks.onConfigLoaded(result);
        } catch (e: any) {
          plugin.context.logger.error(`onConfigLoaded 钩子执行失败: ${e.message}`);
        }
      }
    }
    this.config = result;
    return result;
  }

  public async applyBeforeBuild(): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.hooks.onBeforeBuild) {
        try {
          await plugin.hooks.onBeforeBuild(plugin.context);
        } catch (e: any) {
          plugin.context.logger.error(`onBeforeBuild 钩子执行失败: ${e.message}`);
        }
      }
    }
  }

  public applyMarkdownParsed(data: MarkdownParsedData): MarkdownParsedData {
    let result = data;
    for (const plugin of this.plugins) {
      if (plugin.hooks.onMarkdownParsed) {
        try {
          result = plugin.hooks.onMarkdownParsed(result, plugin.context);
        } catch (e: any) {
          plugin.context.logger.error(`onMarkdownParsed 钩子执行失败: ${e.message}`);
        }
      }
    }
    return result;
  }

  public applyBeforeRender(data: BeforeRenderData): BeforeRenderData {
    let result = data;
    for (const plugin of this.plugins) {
      if (plugin.hooks.onBeforeRender) {
        try {
          result = plugin.hooks.onBeforeRender(result, plugin.context);
        } catch (e: any) {
          plugin.context.logger.error(`onBeforeRender 钩子执行失败: ${e.message}`);
        }
      }
    }
    return result;
  }

  public applyAfterRender(data: AfterRenderData): AfterRenderData {
    let result = data;
    for (const plugin of this.plugins) {
      if (plugin.hooks.onAfterRender) {
        try {
          result = plugin.hooks.onAfterRender(result, plugin.context);
        } catch (e: any) {
          plugin.context.logger.error(`onAfterRender 钩子执行失败: ${e.message}`);
        }
      }
    }
    return result;
  }

  public applyBuildComplete(data: BuildCompleteData): void {
    for (const plugin of this.plugins) {
      if (plugin.hooks.onBuildComplete) {
        try {
          plugin.hooks.onBuildComplete(data, plugin.context);
        } catch (e: any) {
          plugin.context.logger.error(`onBuildComplete 钩子执行失败: ${e.message}`);
        }
      }
    }
  }

  public applyDevServerStart(server: any): void {
    for (const plugin of this.plugins) {
      if (plugin.hooks.onDevServerStart) {
        try {
          plugin.hooks.onDevServerStart(server, plugin.context);
        } catch (e: any) {
          plugin.context.logger.error(`onDevServerStart 钩子执行失败: ${e.message}`);
        }
      }
    }
  }

  public addPage(page: PageInfo): void {
    this.pages.push(page);
  }

  public getExtraAssets(): Array<{ path: string; content: string | Buffer }> {
    return this.extraAssets;
  }

  public getHeadTags(): string[] {
    return this.headTags;
  }

  public getPluginNames(): string[] {
    return this.plugins.map(p => p.name);
  }

  public hasPlugins(): boolean {
    return this.plugins.length > 0;
  }
}
