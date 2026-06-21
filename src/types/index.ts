export interface LocaleConfig {
  code: string;
  name: string;
  dir: string;
}

export interface PluginConfig {
  name: string;
  options?: Record<string, any>;
}

export interface SiteConfig {
  title: string;
  description: string;
  basePath: string;
  themeColor: string;
  search: boolean;
  darkMode: boolean;
  headHtml: string;
  googleAnalyticsId: string;
  favicon: string;
  locales?: LocaleConfig[];
  plugins?: PluginConfig[];
}

export interface NavItem {
  title: string;
  path?: string;
  href?: string;
  external?: boolean;
  children?: NavItem[];
  collapsed?: boolean;
}

export interface PageMeta {
  title: string;
  description: string;
  path: string;
  url: string;
}

export interface BuildCache {
  version: string;
  files: Record<string, FileCacheEntry>;
  templateHash: string;
  sidebarHash: string;
}

export interface FileCacheEntry {
  hash: string;
  includes: string[];
  lastModified: number;
}

export interface SearchDocument {
  id: string;
  title: string;
  content: string;
  path: string;
}

export interface BuildStats {
  rebuilt: number;
  skipped: number;
  total: number;
  time: number;
  files: {
    rebuilt: string[];
    skipped: string[];
  };
}

export interface SidebarConfig {
  [key: string]: SidebarItemConfig | string;
}

export interface SidebarItemConfig {
  title: string;
  items: SidebarConfig;
  collapsed?: boolean;
}

export interface RenderContext {
  site: SiteConfig;
  page: PageMeta;
  nav: NavItem[];
  content: string;
  basePath: string;
  currentPath: string;
  searchEnabled: boolean;
  darkModeEnabled: boolean;
  headHtml: string;
  gaId: string;
  favicon: string;
  locales?: LocaleConfig[];
  currentLocale?: string;
  langCode?: string;
}

export interface PluginLogger {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

export interface PluginContext {
  logger: PluginLogger;
  config: SiteConfig;
  options: Record<string, any>;
  addAsset: (path: string, content: string | Buffer) => void;
  addHeadTag: (tag: string) => void;
  getPages: () => PageInfo[];
}

export interface PageInfo {
  filePath: string;
  relativePath: string;
  meta: PageMeta;
  htmlPath: string;
}

export interface MarkdownParsedData {
  filePath: string;
  rawContent: string;
  html: string;
  meta: PageMeta;
}

export interface BeforeRenderData {
  templateData: Record<string, any>;
  page: PageInfo;
}

export interface AfterRenderData {
  html: string;
  page: PageInfo;
}

export interface BuildCompleteData {
  totalFiles: number;
  rebuiltFiles: number;
  skippedFiles: number;
  elapsedTime: number;
}

export interface PluginHooks {
  onConfigLoaded?: (config: SiteConfig) => SiteConfig;
  onBeforeBuild?: (context: PluginContext) => void | Promise<void>;
  onMarkdownParsed?: (data: MarkdownParsedData, context: PluginContext) => MarkdownParsedData;
  onBeforeRender?: (data: BeforeRenderData, context: PluginContext) => BeforeRenderData;
  onAfterRender?: (data: AfterRenderData, context: PluginContext) => AfterRenderData;
  onBuildComplete?: (data: BuildCompleteData, context: PluginContext) => void;
  onDevServerStart?: (server: any, context: PluginContext) => void;
}

export type PluginFactory = (context: PluginContext) => PluginHooks;

export interface LoadedPlugin {
  name: string;
  hooks: PluginHooks;
  context: PluginContext;
}
