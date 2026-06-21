import * as fs from 'fs-extra';
import * as path from 'path';
import { Document } from 'flexsearch';
import { SearchDocument, SiteConfig } from '../types';
import { segmentChinese, simpleSegment } from './segmenter';

export class SearchIndexer {
  private cwd: string;
  private config: SiteConfig;
  private documents: SearchDocument[] = [];

  constructor(cwd: string, config: SiteConfig) {
    this.cwd = cwd;
    this.config = config;
  }

  public addDocument(doc: SearchDocument): void {
    this.documents.push(doc);
  }

  public clear(): void {
    this.documents = [];
  }

  public buildAndWrite(): void {
    const distDir = path.join(this.cwd, 'dist');
    fs.mkdirpSync(distDir);

    const outputPath = path.join(distDir, 'search-index.js');
    
    const indexData = {
      documents: this.documents.map(doc => ({
        id: doc.id,
        title: doc.title,
        content: doc.content,
        path: doc.path
      })),
      segments: this.buildSegmentedIndex()
    };

    const basePath = this.config.basePath.endsWith('/') ? this.config.basePath : this.config.basePath + '/';
    
    const jsContent = `(function() {
  window.__SEARCH_INDEX__ = ${JSON.stringify(indexData)};
  window.__SEARCH_BASE_PATH__ = ${JSON.stringify(basePath)};
  
  function initSearch() {
    var input = document.getElementById('search-input');
    var results = document.getElementById('search-results');
    if (!input || !results) return;
    
    var data = window.__SEARCH_INDEX__;
    var basePath = window.__SEARCH_BASE_PATH__;
    var debounceTimer = null;
    
    input.addEventListener('input', function() {
      clearTimeout(debounceTimer);
      var query = input.value.trim();
      debounceTimer = setTimeout(function() {
        if (query.length === 0) {
          results.innerHTML = '';
          results.style.display = 'none';
          return;
        }
        var matches = search(query, data);
        renderResults(matches, results, basePath, query);
      }, 150);
    });
    
    input.addEventListener('focus', function() {
      if (input.value.trim().length > 0) {
        results.style.display = 'block';
      }
    });
    
    document.addEventListener('click', function(e) {
      if (!results.contains(e.target) && e.target !== input) {
        results.style.display = 'none';
      }
    });
  }
  
  function search(query, data) {
    var queryLower = query.toLowerCase();
    var queryChars = query.split('');
    var scores = new Map();
    
    for (var i = 0; i < data.documents.length; i++) {
      var doc = data.documents[i];
      var score = 0;
      var titleLower = doc.title.toLowerCase();
      var contentLower = doc.content.toLowerCase();
      
      if (titleLower.includes(queryLower)) score += 100;
      if (contentLower.includes(queryLower)) score += 20;
      
      for (var j = 0; j < queryChars.length; j++) {
        var ch = queryChars[j].toLowerCase();
        if (titleLower.includes(ch)) score += 5;
        if (contentLower.includes(ch)) score += 1;
      }
      
      if (data.segments && data.segments[doc.id]) {
        var docSegs = data.segments[doc.id];
        for (var k = 0; k < queryChars.length; k++) {
          var qch = queryChars[k].toLowerCase();
          if (docSegs.indexOf(qch) !== -1) score += 3;
        }
      }
      
      if (score > 0) {
        scores.set(doc.id, { doc: doc, score: score });
      }
    }
    
    var sorted = Array.from(scores.values()).sort(function(a, b) {
      return b.score - a.score;
    });
    
    return sorted.slice(0, 20);
  }
  
  function renderResults(matches, container, basePath, query) {
    if (matches.length === 0) {
      container.innerHTML = '<div class="search-no-results">未找到匹配的结果</div>';
      container.style.display = 'block';
      return;
    }
    
    var html = '';
    for (var i = 0; i < matches.length; i++) {
      var item = matches[i];
      var doc = item.doc;
      var snippet = getSnippet(doc.content, query);
      var highlightedTitle = highlight(doc.title, query);
      var highlightedSnippet = highlight(snippet, query);
      var fullPath = doc.path;
      if (fullPath.startsWith('/')) {
        fullPath = basePath + fullPath.slice(1);
      } else {
        fullPath = basePath + fullPath;
      }
      
      html += '<a href="' + fullPath + '" class="search-result-item">' +
        '<div class="search-result-title">' + highlightedTitle + '</div>' +
        '<div class="search-result-snippet">' + highlightedSnippet + '</div>' +
      '</a>';
    }
    
    container.innerHTML = html;
    container.style.display = 'block';
  }
  
  function getSnippet(content, query) {
    var lower = content.toLowerCase();
    var queryLower = query.toLowerCase();
    var idx = lower.indexOf(queryLower);
    if (idx === -1) {
      for (var i = 0; i < content.length; i++) {
        if (query.includes(content[i])) {
          idx = i;
          break;
        }
      }
    }
    if (idx === -1) idx = 0;
    var start = Math.max(0, idx - 80);
    var end = Math.min(content.length, start + 200);
    var result = '';
    if (start > 0) result += '...';
    result += content.slice(start, end);
    if (end < content.length) result += '...';
    return result;
  }
  
  function highlight(text, query) {
    if (!query) return text;
    var result = text;
    var keywords = extractKeywords(query);
    for (var i = 0; i < keywords.length; i++) {
      var kw = keywords[i];
      if (kw.length < 1) continue;
      try {
        var regex = new RegExp('(' + escapeRegex(kw) + ')', 'gi');
        result = result.replace(regex, '<mark>$1</mark>');
      } catch(e) {}
    }
    return result;
  }
  
  function extractKeywords(query) {
    var result = [];
    var chinese = query.match(/[\u4e00-\u9fa5]/g) || [];
    var others = query.replace(/[\u4e00-\u9fa5]/g, ' ').split(/[\s,.;:!?()]+/).filter(function(w) { return w.length > 0; });
    result.push(...chinese);
    result.push(...others);
    if (query.length > 0) result.push(query);
    return result;
  }
  
  function escapeRegex(str) {
    var result = '';
    var specials = ['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\\\'];
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (specials.indexOf(ch) !== -1) {
        result += '\\\\' + ch;
      } else {
        result += ch;
      }
    }
    return result;
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSearch);
  } else {
    initSearch();
  }
})();`;

    fs.writeFileSync(outputPath, jsContent, 'utf-8');
  }

  private buildSegmentedIndex(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    
    for (const doc of this.documents) {
      const combined = doc.title + ' ' + doc.content;
      const segments = segmentChinese(combined);
      result[doc.id] = [...new Set(segments)].slice(0, 2000);
    }
    
    return result;
  }
}

export class SeoGenerator {
  private cwd: string;
  private config: SiteConfig;
  private urls: { loc: string; lastmod: string }[] = [];

  constructor(cwd: string, config: SiteConfig) {
    this.cwd = cwd;
    this.config = config;
  }

  public addUrl(path: string): void {
    const basePath = this.config.basePath.endsWith('/') ? this.config.basePath : this.config.basePath + '/';
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    const fullUrl = basePath + cleanPath;
    
    this.urls.push({
      loc: fullUrl,
      lastmod: new Date().toISOString().split('T')[0]
    });
  }

  public clear(): void {
    this.urls = [];
  }

  public generateSitemap(): void {
    const distDir = path.join(this.cwd, 'dist');
    fs.mkdirpSync(distDir);

    const sortedUrls = [...this.urls].sort((a, b) => a.loc.localeCompare(b.loc));
    
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    
    for (const url of sortedUrls) {
      xml += '  <url>\n';
      xml += `    <loc>${this.escapeXml(url.loc)}</loc>\n`;
      xml += `    <lastmod>${url.lastmod}</lastmod>\n`;
      xml += '  </url>\n';
    }
    
    xml += '</urlset>';
    
    fs.writeFileSync(path.join(distDir, 'sitemap.xml'), xml, 'utf-8');
  }

  public generateRobotsTxt(): void {
    const distDir = path.join(this.cwd, 'dist');
    fs.mkdirpSync(distDir);

    const basePath = this.config.basePath.endsWith('/') ? this.config.basePath : this.config.basePath + '/';
    
    let content = 'User-agent: *\n';
    content += 'Allow: /\n';
    content += `\nSitemap: ${basePath}sitemap.xml\n`;
    
    fs.writeFileSync(path.join(distDir, 'robots.txt'), content, 'utf-8');
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
