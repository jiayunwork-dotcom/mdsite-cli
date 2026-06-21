import * as fs from 'fs-extra';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { NavItem, SidebarConfig, SidebarItemConfig } from '../types';

const SIDEBAR_FILE = '_sidebar.yml';

export class NavigationGenerator {
  private cwd: string;
  private docsDir: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.docsDir = path.join(cwd, 'docs');
  }

  public generate(): NavItem[] {
    const sidebarPath = path.join(this.docsDir, SIDEBAR_FILE);
    
    if (fs.existsSync(sidebarPath)) {
      try {
        const config = yaml.load(fs.readFileSync(sidebarPath, 'utf-8')) as SidebarConfig;
        return this.parseSidebarConfig(config);
      } catch (e) {
        console.warn('Failed to parse _sidebar.yml, falling back to auto-generated navigation:', e);
      }
    }
    
    return this.generateFromDirectory(this.docsDir);
  }

  private parseSidebarConfig(config: SidebarConfig): NavItem[] {
    const items: NavItem[] = [];

    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        items.push(this.parseItem(key, value));
      } else if (typeof value === 'object' && value !== null) {
        items.push(this.parseGroup(key, value as SidebarItemConfig));
      }
    }

    return items;
  }

  private parseItem(key: string, value: string): NavItem {
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return {
        title: key,
        href: value,
        external: true
      };
    }

    const cleanPath = value
      .replace(/^\//, '')
      .replace(/\.md$/, '')
      .replace(/\/index$/, '/');
    
    const filePath = cleanPath.endsWith('/') ? cleanPath : cleanPath + '.html';
    const urlPath = cleanPath === '' ? '/' : (cleanPath.endsWith('/') ? cleanPath : '/' + cleanPath + '.html');

    return {
      title: key,
      path: filePath,
      href: urlPath
    };
  }

  private parseGroup(key: string, config: SidebarItemConfig): NavItem {
    const children: NavItem[] = [];
    
    for (const [childKey, childValue] of Object.entries(config.items)) {
      if (typeof childValue === 'string') {
        children.push(this.parseItem(childKey, childValue));
      } else if (typeof childValue === 'object' && childValue !== null) {
        children.push(this.parseGroup(childKey, childValue as SidebarItemConfig));
      }
    }

    return {
      title: config.title || key,
      collapsed: config.collapsed || false,
      children
    };
  }

  private generateFromDirectory(dir: string, relativePath: string = ''): NavItem[] {
    const items: NavItem[] = [];
    
    if (!fs.existsSync(dir)) return items;

    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) {
        continue;
      }
      if (entry.isDirectory() && entry.name === 'includes') {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        const children = this.generateFromDirectory(fullPath, relPath);
        if (children.length > 0) {
          const indexPath = path.join(fullPath, 'index.md');
          const hasIndex = fs.existsSync(indexPath);
          
          const dirRelPath = relPath + '/';
          const item: NavItem = {
            title: this.prettyName(entry.name),
            children,
            collapsed: false
          };

          if (hasIndex) {
            item.path = dirRelPath;
            item.href = '/' + dirRelPath;
          }

          items.push(item);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        if (relativePath === '' && entry.name === 'index.md') {
          items.unshift({
            title: this.getTitleFromFile(fullPath) || '首页',
            path: '/',
            href: '/'
          });
        } else if (entry.name !== 'index.md') {
          const baseName = entry.name.replace(/\.md$/, '');
          const fileRelPath = (relativePath ? relativePath + '/' : '') + baseName + '.html';
          items.push({
            title: this.getTitleFromFile(fullPath) || this.prettyName(baseName),
            path: '/' + fileRelPath,
            href: '/' + fileRelPath
          });
        }
      }
    }

    return items;
  }

  private getTitleFromFile(filePath: string): string | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const h1Match = line.match(/^#\s+(.+)$/);
        if (h1Match) {
          return h1Match[1].trim();
        }
      }
    } catch (e) {
    }
    return null;
  }

  private prettyName(name: string): string {
    return name
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  public renderNavHtml(items: NavItem[], currentPath: string, basePath: string): string {
    return this.renderNavItems(items, currentPath, basePath, 0);
  }

  private renderNavItems(items: NavItem[], currentPath: string, basePath: string, level: number): string {
    if (!items || items.length === 0) return '';

    let html = `<ul class="nav-list nav-level-${level}">`;

    for (const item of items) {
      const isActive = item.path && this.isActive(item.path, currentPath);
      const hasChildren = item.children && item.children.length > 0;
      
      html += `<li class="nav-item${isActive ? ' active' : ''}${hasChildren ? ' has-children' : ''}${item.collapsed ? ' collapsed' : ''}">`;

      if (item.external) {
        html += `<a href="${item.href}" target="_blank" rel="noopener noreferrer" class="nav-link external">
          <span>${this.escapeHtml(item.title)}</span>
          <span class="external-icon">↗</span>
        </a>`;
      } else if (item.href) {
        const fullHref = this.joinPaths(basePath, item.href);
        html += `<a href="${fullHref}" class="nav-link${isActive ? ' active' : ''}">
          <span>${this.escapeHtml(item.title)}</span>
        </a>`;
      } else {
        html += `<span class="nav-group-title">
          <span>${this.escapeHtml(item.title)}</span>
          ${hasChildren ? '<span class="nav-collapse-icon">▼</span>' : ''}
        </span>`;
      }

      if (hasChildren) {
        html += this.renderNavItems(item.children!, currentPath, basePath, level + 1);
      }

      html += '</li>';
    }

    html += '</ul>';
    return html;
  }

  private isActive(itemPath: string, currentPath: string): boolean {
    const norm = (p: string) => p.replace(/\/index\.html?$/, '/').replace(/^\//, '').replace(/\.html?$/, '');
    const itemNorm = norm(itemPath);
    const currentNorm = norm(currentPath);
    
    if (itemNorm === '' || itemNorm === currentNorm) return true;
    if (currentNorm.startsWith(itemNorm + '/')) return true;
    
    return false;
  }

  private joinPaths(base: string, target: string): string {
    const baseClean = base.endsWith('/') ? base.slice(0, -1) : base;
    const targetClean = target.startsWith('/') ? target : '/' + target;
    return baseClean + targetClean;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  public getSidebarHash(): string {
    const sidebarPath = path.join(this.docsDir, SIDEBAR_FILE);
    if (fs.existsSync(sidebarPath)) {
      return this.hashString(fs.readFileSync(sidebarPath, 'utf-8'));
    }
    return this.hashDirectoryStructure(this.docsDir);
  }

  private hashDirectoryStructure(dir: string): string {
    let result = '';
    
    if (!fs.existsSync(dir)) return this.hashString('');
    
    const walk = (d: string, rel: string) => {
      const entries = fs.readdirSync(d).sort();
      for (const entry of entries) {
        if (entry.startsWith('_') || entry.startsWith('.')) continue;
        const fullPath = path.join(d, entry);
        const relPath = path.join(rel, entry);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          result += `D:${relPath}|`;
          walk(fullPath, relPath);
        } else if (entry.endsWith('.md')) {
          result += `F:${relPath}:${stat.mtimeMs}|`;
        }
      }
    };

    walk(dir, '');
    return this.hashString(result);
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
