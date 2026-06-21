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
}
