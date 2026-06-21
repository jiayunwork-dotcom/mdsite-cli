import * as fs from 'fs-extra';
import * as path from 'path';
import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import container from 'markdown-it-container';
import toc from 'markdown-it-toc-done-right';
import katex from 'katex';
import hljs from 'highlight.js';
import { PageMeta } from '../types';

const LANGUAGES = [
  'javascript', 'typescript', 'python', 'go', 'rust', 'java',
  'html', 'css', 'json', 'yaml', 'shell', 'bash', 'sql',
  'xml', 'markdown', 'dockerfile', 'makefile'
];

export class MarkdownParser {
  private md: MarkdownIt;
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.md = this.createMarkdownInstance();
  }

  private createMarkdownInstance(): MarkdownIt {
    const md = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true,
      breaks: false,
      highlight: (code, lang) => this.highlightCode(code, lang)
    });

    md.use(anchor, {
      permalink: anchor.permalink.headerLink()
    });

    md.use(footnote);
    md.use(taskLists, { enabled: true });
    md.use(toc, { containerClass: 'toc', level: [2, 3] });
    this.setupContainers(md);
    this.setupKatex(md);
    this.setupTables(md);
    this.setupMermaid(md);

    return md;
  }

  private highlightCode(code: string, lang: string): string {
    if (!lang) {
      return `<pre><code class="hljs">${this.escapeHtml(code)}</code></pre>`;
    }

    lang = lang.toLowerCase();
    
    try {
      if (LANGUAGES.includes(lang) || hljs.getLanguage(lang)) {
        const result = hljs.highlight(code, { language: lang, ignoreIllegals: true });
        return `<pre><code class="hljs language-${lang}">${result.value}</code></pre>`;
      }
    } catch (e) {
    }

    return `<pre><code class="hljs language-${lang}">${this.escapeHtml(code)}</code></pre>`;
  }

  private setupContainers(md: MarkdownIt): void {
    const self = this;
    ['tip', 'warning', 'danger'].forEach(type => {
      md.use(container, type, {
        validate: function(params: string): boolean {
          return !!params.trim().match(new RegExp(`^${type}\\s*(.*)$`));
        },
        render: function(tokens: any[], idx: number): string {
          const m = tokens[idx].info.trim().match(new RegExp(`^${type}\\s*(.*)$`));
          if (tokens[idx].nesting === 1) {
            const title = m && m[1] ? m[1].trim() : self.getDefaultTitle(type);
            return `<div class="admonition admonition-${type}">
  <div class="admonition-title">${self.escapeHtml(title)}</div>
  <div class="admonition-content">
`;
          } else {
            return '</div></div>\n';
          }
        }
      });
    });
  }

  private getDefaultTitle(type: string): string {
    const titles: Record<string, string> = {
      tip: '💡 提示',
      warning: '⚠️ 警告',
      danger: '🚫 注意'
    };
    return titles[type] || type;
  }

  private setupKatex(md: MarkdownIt): void {
    const inlineTex = /^\$([^$\n]+?)\$/;
    const blockTex = /^\$\$([^]+?)\$\$/;

    md.inline.ruler.after('escape', 'inline_katex', (state, silent) => {
      const start = state.pos;
      const src = state.src.slice(start);
      const match = src.match(inlineTex);
      
      if (!match) return false;
      if (silent) return true;

      try {
        const rendered = katex.renderToString(match[1], {
          throwOnError: false,
          displayMode: false,
          output: 'html'
        });
        const token = state.push('inline_katex', 'span', 0);
        token.content = rendered;
        token.markup = '$';
        state.pos += match[0].length;
        return true;
      } catch (e) {
        return false;
      }
    });

    md.block.ruler.after('blockquote', 'block_katex', (state, start, end, silent) => {
      const firstLine = state.getLines(start, start + 1, state.blkIndent, false);
      if (!firstLine.trim().startsWith('$$')) return false;

      let lastLine = start;
      let foundEnd = false;
      const contentLines: string[] = [];

      for (let i = start; i < end; i++) {
        const line = state.getLines(i, i + 1, state.blkIndent, false);
        if (i > start) contentLines.push(line);
        if (i > start && line.trim().endsWith('$$')) {
          lastLine = i;
          foundEnd = true;
          contentLines[contentLines.length - 1] = line.replace(/\$\$\s*$/, '');
          break;
        }
      }

      if (!foundEnd) return false;
      if (silent) return true;

      const content = contentLines.join('\n').replace(/^\$\$/, '').trim();
      
      try {
        const rendered = katex.renderToString(content, {
          throwOnError: false,
          displayMode: true,
          output: 'html'
        });
        
        state.line = lastLine + 1;
        const token = state.push('block_katex', 'div', 0);
        token.content = rendered;
        token.markup = '$$';
        token.map = [start, lastLine + 1];
        return true;
      } catch (e) {
        return false;
      }
    }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

    md.renderer.rules.inline_katex = (tokens, idx) => {
      return `<span class="katex-inline">${tokens[idx].content}</span>`;
    };

    md.renderer.rules.block_katex = (tokens, idx) => {
      return `<div class="katex-block">${tokens[idx].content}</div>\n`;
    };
  }

  private setupTables(md: MarkdownIt): void {
    md.enable('table');
  }

  private setupMermaid(md: MarkdownIt): void {
    const defaultFence = md.renderer.rules.fence || function(tokens: any[], idx: number, options: any, env: any, self: any) {
      return self.renderToken(tokens, idx, options);
    };

    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const info = token.info ? String(token.info).trim() : '';
      const langName = info.split(/\s+/g)[0];

      if (langName === 'mermaid') {
        const code = token.content.trim();
        return `<div class="mermaid-diagram" data-mermaid="${this.escapeHtml(code)}"><pre><code>${this.escapeHtml(code)}</code></pre></div>\n`;
      }

      return defaultFence(tokens, idx, options, env, self);
    };
  }

  public parseIncludes(content: string, currentFilePath: string, visited: Set<string> = new Set()): {
    content: string;
    includes: string[];
  } {
    const includes: string[] = [];
    const includeRegex = /\{\{\{\s*include\s+([^\s}]+)\s*\}\}\}/g;

    let processedContent = content;
    let match;

    while ((match = includeRegex.exec(content)) !== null) {
      const includePath = match[1];
      const resolvedPath = this.resolveIncludePath(includePath, currentFilePath);
      
      if (resolvedPath && fs.existsSync(resolvedPath)) {
        const relativePath = path.relative(this.cwd, resolvedPath);
        
        if (visited.has(resolvedPath)) {
          console.warn(`Circular include detected: ${relativePath}, skipping`);
          continue;
        }
        
        includes.push(relativePath);
        
        try {
          const includedContent = fs.readFileSync(resolvedPath, 'utf-8');
          const newVisited = new Set(visited);
          newVisited.add(resolvedPath);
          const result = this.parseIncludes(includedContent, resolvedPath, newVisited);
          includes.push(...result.includes);
          processedContent = processedContent.replace(match[0], result.content);
        } catch (e: any) {
          console.warn(`Failed to include file: ${includePath} - ${e.message}`);
        }
      } else {
        console.warn(`Include file not found: ${includePath} (searched from ${path.dirname(currentFilePath)})`);
      }
    }

    return { content: processedContent, includes };
  }

  private resolveIncludePath(includePath: string, currentFilePath: string): string | null {
    if (path.isAbsolute(includePath)) {
      return includePath;
    }

    const docsDir = path.join(this.cwd, 'docs');
    const currentDir = path.dirname(currentFilePath);
    const fromCurrent = path.join(currentDir, includePath);
    const fromDocs = path.join(docsDir, includePath);

    if (fs.existsSync(fromCurrent)) {
      return fromCurrent;
    }
    if (fs.existsSync(fromDocs)) {
      return fromDocs;
    }

    return null;
  }

  public render(markdown: string): string {
    return this.md.render(markdown);
  }

  public extractTitle(markdown: string): string {
    const lines = markdown.split('\n');
    for (const line of lines) {
      const h1Match = line.match(/^#\s+(.+)$/);
      if (h1Match) {
        return h1Match[1].trim();
      }
    }
    return '';
  }

  public extractDescription(markdown: string, maxLength: number = 150): string {
    let plainText = markdown
      .replace(/^#.*$/gm, '')
      .replace(/^#{2,6}\s+/gm, '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]*`/g, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[[^\]]*\]\([^)]*\)/g, '$1')
      .replace(/[#*_~>]/g, '')
      .replace(/:::[\s\S]*?:::/g, '')
      .replace(/\$\$[\s\S]*?\$\$/g, '')
      .replace(/\$[^$]+\$/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (plainText.length > maxLength) {
      plainText = plainText.slice(0, maxLength) + '...';
    }

    return plainText;
  }

  public extractPlainText(markdown: string): string {
    return this.extractDescription(markdown, Infinity);
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  public getPageMeta(markdown: string, relativePath: string, basePath: string): PageMeta {
    const title = this.extractTitle(markdown) || this.filenameToTitle(relativePath);
    const description = this.extractDescription(markdown);
    const pathName = relativePath
      .replace(/\.md$/, '')
      .replace(/\/index$/, '/')
      .replace(/^index$/, '/');
    
    const url = basePath + (pathName.startsWith('/') ? pathName.slice(1) : pathName);
    
    return {
      title,
      description,
      path: pathName === '' ? '/' : (pathName.endsWith('/') ? pathName : pathName + '.html'),
      url: url === '' ? '/' : url
    };
  }

  private filenameToTitle(filepath: string): string {
    const basename = path.basename(filepath, '.md');
    if (basename === 'index') {
      const dirname = path.dirname(filepath);
      if (dirname === '.') return '首页';
      return path.basename(dirname);
    }
    return basename
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }
}
