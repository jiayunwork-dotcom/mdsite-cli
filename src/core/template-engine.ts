import * as fs from 'fs-extra';
import * as path from 'path';

export class TemplateEngine {
  private cwd: string;
  private defaultTemplates: Map<string, string> = new Map();

  constructor(cwd: string) {
    this.cwd = cwd;
    this.initDefaultTemplates();
  }

  private initDefaultTemplates(): void {
    this.defaultTemplates.set('layout.html', this.getDefaultLayout());
  }

  private getDefaultLayout(): string {
    return `<!DOCTYPE html>
<html lang="{{ pageLang }}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{ page.title }} - {{ site.title }}</title>
  <meta name="description" content="{{ page.description }}" />
  <meta property="og:title" content="{{ page.title }}" />
  <meta property="og:description" content="{{ page.description }}" />
  {{#if site.favicon}}<link rel="icon" href="{{ basePath }}{{ site.favicon }}" />{{/if}}
  {{{ site.headHtml }}}
  {{#if site.googleAnalyticsId}}
  <script async src="https://www.googletagmanager.com/gtag/js?id={{ site.googleAnalyticsId }}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '{{ site.googleAnalyticsId }}');
  </script>
  {{/if}}
  <link rel="stylesheet" href="{{ basePath }}assets/styles.css" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css" />
  <link rel="stylesheet" id="hljs-dark" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css" disabled />
  {{#if site.search}}
  <script src="https://cdn.jsdelivr.net/npm/flexsearch@0.7.43/dist/flexsearch.bundle.min.js"></script>
  {{/if}}
</head>
<body>
  <div class="app">
    <header class="header">
      <div class="header-inner">
        <a href="{{ logoHref }}" class="logo">{{ site.title }}</a>
        <div class="header-actions">
          {{#if site.search}}
          <div class="search-box">
            <input type="text" id="search-input" placeholder="搜索文档..." />
            <div id="search-results" class="search-results"></div>
          </div>
          {{/if}}
          {{#if hasLocales}}
          <div class="lang-switcher">
            <button id="lang-toggle" class="lang-toggle" title="切换语言">
              <span id="lang-current-name">{{ currentLocaleName }}</span>
              <span class="lang-arrow">▼</span>
            </button>
            <div id="lang-menu" class="lang-menu">
              {{#for locale in locales}}
              <a href="#" class="lang-item{{#if locale.isCurrent}} active{{/if}}" data-lang="{{ locale.code }}" data-name="{{ locale.name }}">
                {{ locale.name }}
              </a>
              {{/for}}
            </div>
          </div>
          {{/if}}
          {{#if site.darkMode}}
          <button id="theme-toggle" class="theme-toggle" title="切换主题">🌙</button>
          {{/if}}
        </div>
      </div>
    </header>
    <div class="main">
      <button id="sidebar-toggle" class="sidebar-toggle">☰</button>
      <aside class="sidebar" id="sidebar">
        <nav class="nav">
          {{{ nav }}}
        </nav>
      </aside>
      <main class="content">
        <article class="doc-content">
          {{{ content }}}
        </article>
      </main>
    </div>
  </div>
  <script src="{{ basePath }}assets/app.js"></script>
  {{#if site.search}}
  <script src="{{ searchIndexPath }}"></script>
  {{/if}}
</body>
</html>
`;
  }

  public render(templateName: string, data: Record<string, any>): string {
    let template = this.loadTemplate(templateName);
    return this.process(template, data);
  }

  private loadTemplate(name: string): string {
    const userTemplatePath = path.join(this.cwd, 'templates', name);
    if (fs.existsSync(userTemplatePath)) {
      return fs.readFileSync(userTemplatePath, 'utf-8');
    }
    if (this.defaultTemplates.has(name)) {
      return this.defaultTemplates.get(name)!;
    }
    throw new Error(`Template not found: ${name}`);
  }

  public process(template: string, data: Record<string, any>): string {
    let result = template;

    result = this.processLoops(result, data);
    result = this.processConditionals(result, data);
    result = this.processVariables(result, data);

    return result;
  }

  private processConditionals(template: string, data: Record<string, any>): string {
    const ifElseRegex = /\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g;
    let result = template.replace(ifElseRegex, (match, variablePath, trueContent, falseContent) => {
      const value = this.getNestedValue(data, variablePath);
      return value ? trueContent : falseContent;
    });

    const ifRegex = /\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
    result = result.replace(ifRegex, (match, variablePath, content) => {
      const value = this.getNestedValue(data, variablePath);
      return value ? content : '';
    });

    return result;
  }

  private processLoops(template: string, data: Record<string, any>): string {
    const forRegex = /\{\{#for\s+(\w+)\s+in\s+([\w.]+)\}\}([\s\S]*?)\{\{\/for\}\}/g;
    
    return template.replace(forRegex, (match, itemName, listPath, content) => {
      const list = this.getNestedValue(data, listPath);
      if (!Array.isArray(list)) return '';

      return list.map((item: any, index: number) => {
        const itemData = {
          ...data,
          [itemName]: item,
          index,
          first: index === 0,
          last: index === list.length - 1
        };
        return this.process(content, itemData);
      }).join('');
    });
  }

  private processVariables(template: string, data: Record<string, any>): string {
    const rawVarRegex = /\{\{\{\s*([\w.]+)\s*\}\}\}/g;
    const escapedVarRegex = /\{\{\s*([\w.]+)\s*\}\}/g;

    let result = template.replace(rawVarRegex, (match, variablePath) => {
      const value = this.getNestedValue(data, variablePath);
      return value !== undefined && value !== null ? String(value) : '';
    });

    result = result.replace(escapedVarRegex, (match, variablePath) => {
      const value = this.getNestedValue(data, variablePath);
      return value !== undefined && value !== null ? this.escapeHtml(String(value)) : '';
    });

    return result;
  }

  private getNestedValue(obj: Record<string, any>, path: string): any {
    const keys = path.split('.');
    let value: any = obj;

    for (const key of keys) {
      if (value === undefined || value === null) {
        return undefined;
      }
      value = value[key];
    }

    return value;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  public getTemplatesHash(): string {
    let combined = '';
    const templatesDir = path.join(this.cwd, 'templates');
    
    if (fs.existsSync(templatesDir)) {
      const templateFiles = fs.readdirSync(templatesDir)
        .filter(f => f.endsWith('.html'))
        .sort();
      
      for (const file of templateFiles) {
        combined += fs.readFileSync(path.join(templatesDir, file), 'utf-8');
      }
    }

    for (const [, content] of this.defaultTemplates) {
      combined += content;
    }

    return this.hashString(combined);
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
}
