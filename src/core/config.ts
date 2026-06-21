import * as fs from 'fs-extra';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { LocaleConfig, SiteConfig, PluginConfig } from '../types';

export const DEFAULT_CONFIG: SiteConfig = {
  title: 'My Documentation',
  description: 'Documentation site built with mdsite-cli',
  basePath: '/',
  themeColor: '#3b82f6',
  search: true,
  darkMode: true,
  headHtml: '',
  googleAnalyticsId: '',
  favicon: ''
};

export function getDefaultLocale(config: SiteConfig): LocaleConfig | null {
  if (!config.locales || config.locales.length === 0) {
    return null;
  }
  return config.locales[0];
}

export function isMultiLocale(config: SiteConfig): boolean {
  return !!(config.locales && config.locales.length > 0);
}

export const CONFIG_FILE_NAME = 'site.yml';

export function loadConfig(cwd: string): SiteConfig {
  const configPath = path.join(cwd, CONFIG_FILE_NAME);
  
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const userConfig = yaml.load(content) as Partial<SiteConfig> || {};
    return {
      ...DEFAULT_CONFIG,
      ...userConfig
    };
  } catch (e) {
    console.error(`Failed to load ${CONFIG_FILE_NAME}:`, e);
    return { ...DEFAULT_CONFIG };
  }
}

export function getDefaultConfigYaml(): string {
  return `# mdsite-cli 配置文件

# 站点标题
title: 'My Documentation'

# 站点描述
description: 'Documentation site built with mdsite-cli'

# 基础路径（部署在子路径时使用，例如 '/docs/'）
basePath: '/'

# 主题色
themeColor: '#3b82f6'

# 是否启用搜索功能
search: true

# 是否启用暗色模式切换
darkMode: true

# 自定义头部HTML注入（会被添加到<head>标签内）
headHtml: ''

# Google Analytics ID
googleAnalyticsId: ''

# favicon路径（相对于public目录）
favicon: ''

# 多语言配置（可选，不配置则为单语言模式）
# locales:
#   - code: zh
#     name: 中文
#     dir: docs/zh
#   - code: en
#     name: English
#     dir: docs/en

# 插件配置（可选）
# plugins:
#   - name: reading-time
#     options:
#       wordsPerMinute: 200
#   - name: ./my-local-plugin.js
#     options: {}
`;
}
