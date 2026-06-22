import * as fs from 'fs-extra';
import * as path from 'path';
import * as pc from 'picocolors';
import { loadConfig, isMultiLocale, getDefaultLocale } from '../core/config';
import { TemplateEngine } from '../core/template-engine';
import { MarkdownParser } from '../core/markdown-parser';
import { NavigationGenerator } from '../core/navigation';
import { BuildCacheManager } from '../core/build-cache';
import { SearchIndexer, SeoGenerator } from '../core/search-seo';
import { PluginManager } from '../core/plugin-manager';
import { BuildStats, LocaleConfig, NavItem, PageMeta, SiteConfig, PageInfo, MarkdownParsedData, BeforeRenderData, AfterRenderData } from '../types';
import '../plugins/reading-time';
import '../plugins/copy-code';
import '../plugins/auto-toc';

interface BuildOptions {
  clean?: boolean;
}

export async function build(cwd: string, options: BuildOptions = {}): Promise<BuildStats> {
  const startTime = Date.now();
  console.log(pc.bold(pc.blue('🚀 开始构建站点...')));

  if (options.clean) {
    console.log(pc.cyan('🧹 清理输出目录...'));
    fs.removeSync(path.join(cwd, 'dist'));
  }

  let config = loadConfig(cwd);
  const pluginManager = new PluginManager(cwd, config);

  await pluginManager.loadPlugins();

  if (pluginManager.hasPlugins()) {
    console.log(pc.cyan(`🔌 已加载 ${pluginManager.getPluginNames().length} 个插件`));
  }

  config = await pluginManager.applyConfigLoaded(config);

  await pluginManager.applyBeforeBuild();

  const templateEngine = new TemplateEngine(cwd);
  const markdownParser = new MarkdownParser(cwd);
  const cacheManager = new BuildCacheManager(cwd);
  const searchIndexer = new SearchIndexer(cwd, config);
  const seoGenerator = new SeoGenerator(cwd, config);

  if (options.clean) {
    cacheManager.clear();
  }

  const distDir = path.join(cwd, 'dist');
  const publicDir = path.join(cwd, 'public');
  fs.mkdirpSync(distDir);

  const currentTemplateHash = templateEngine.getTemplatesHash();
  const cachedTemplateHash = cacheManager.getTemplateHash();
  const globalChanged = cachedTemplateHash !== currentTemplateHash;

  if (globalChanged) {
    console.log(pc.yellow('📋 模板结构已变更，将执行全量构建'));
  }

  const rebuilt: string[] = [];
  const skipped: string[] = [];
  let totalFiles = 0;

  const multiLocale = isMultiLocale(config);

  if (multiLocale) {
    const locales = config.locales!;
    const defaultLocale = locales[0];

    console.log(pc.cyan(`🌐 多语言模式: 检测到 ${locales.length} 个语言版本`));

    for (const locale of locales) {
      console.log(pc.dim(`  处理语言: ${locale.name} (${locale.code})`));

      const localeDocsDir = path.isAbsolute(locale.dir) ? locale.dir : path.join(cwd, locale.dir);
      if (!fs.existsSync(localeDocsDir)) {
        console.warn(pc.yellow(`    ⚠ 语言目录不存在: ${locale.dir}, 跳过`));
        continue;
      }

      const navGenerator = new NavigationGenerator(cwd, localeDocsDir);
      searchIndexer.setCurrentLocale(locale.code);
      seoGenerator.setCurrentLocale(locale.code);

      const currentSidebarHash = navGenerator.getSidebarHash();
      const cachedSidebarHash = cacheManager.getSidebarHash();
      const localeGlobalChanged = globalChanged || cachedSidebarHash !== currentSidebarHash;

      const navItems = navGenerator.generate(locale.code);
      const markdownFiles = scanMarkdownFiles(localeDocsDir);
      totalFiles += markdownFiles.length;

      const fileHashes: Record<string, string> = {};
      for (const file of markdownFiles) {
        const relativePath = path.relative(cwd, file);
        fileHashes[relativePath] = cacheManager.computeFileHash(file);
      }

      let staleFiles: Set<string>;
      if (localeGlobalChanged) {
        staleFiles = new Set(markdownFiles.map(f => path.relative(cwd, f)));
      } else {
        const directlyStale = cacheManager.getStaleFiles(fileHashes);
        staleFiles = new Set(directlyStale);

        for (const file of directlyStale) {
          const dependents = cacheManager.findFilesDependingOn(file);
          for (const dep of dependents) {
            staleFiles.add(dep);
          }
        }
      }

      for (const file of markdownFiles) {
        const relativePath = path.relative(cwd, file);
        const docsRelPath = path.relative(localeDocsDir, file);

        try {
          const rawContent = fs.readFileSync(file, 'utf-8');
          const { content: resolvedContent, includes } = markdownParser.parseIncludes(rawContent, file);
          const metaBase = markdownParser.getPageMeta(resolvedContent, docsRelPath, config.basePath);
          const plainText = markdownParser.extractPlainText(resolvedContent);

          const urlPrefix = '/' + locale.code;
          const fullPath = urlPrefix + (metaBase.path.startsWith('/') ? metaBase.path : '/' + metaBase.path);
          const basePath = config.basePath.endsWith('/') ? config.basePath : config.basePath + '/';
          const fullUrl = basePath + fullPath.replace(/^\//, '');
          const meta: PageMeta = {
            ...metaBase,
            path: fullPath,
            url: fullUrl
          };

          seoGenerator.addUrl(meta.url);

          if (config.search) {
            searchIndexer.addDocument({
              id: relativePath,
              title: meta.title,
              content: plainText,
              path: meta.url
            });
          }

          let htmlRelPath: string;
          if (docsRelPath.endsWith('/index.md')) {
            htmlRelPath = docsRelPath.replace(/\.md$/, '.html');
          } else if (docsRelPath === 'index.md') {
            htmlRelPath = 'index.html';
          } else {
            htmlRelPath = docsRelPath.replace(/\.md$/, '.html');
          }

          pluginManager.addPage({ filePath: file, relativePath, meta, htmlPath: htmlRelPath });
        } catch (e) {}

        if (!staleFiles.has(relativePath) && !localeGlobalChanged) {
          skipped.push(relativePath);
          continue;
        }

        try {
          const page = await processMarkdownFileLocale(
            file, relativePath, cwd, config, markdownParser,
            templateEngine, navGenerator, navItems, locale, locales, localeDocsDir,
            pluginManager
          );

          const htmlRelPath = path.posix.join(locale.code, page.htmlPath);
          const htmlFullPath = path.join(distDir, htmlRelPath);
          fs.mkdirpSync(path.dirname(htmlFullPath));
          fs.writeFileSync(htmlFullPath, page.html, 'utf-8');

          if (locale.code === defaultLocale.code) {
            const rootHtmlFullPath = path.join(distDir, page.htmlPath);
            fs.mkdirpSync(path.dirname(rootHtmlFullPath));
            fs.writeFileSync(rootHtmlFullPath, page.html, 'utf-8');
          }

          const fileEntry = {
            hash: fileHashes[relativePath],
            includes: page.includes,
            lastModified: Date.now()
          };
          cacheManager.setFileCache(relativePath, fileEntry);

          rebuilt.push(relativePath);

        } catch (e) {
          console.error(pc.red(`✗ 处理文件失败: ${relativePath}`), e);
        }
      }
    }
  } else {
    const docsDir = path.join(cwd, 'docs');
    if (!fs.existsSync(docsDir)) {
      console.error(pc.red('✗ docs/ 目录不存在，请先运行 mdsite init'));
      process.exit(1);
    }

    const navGenerator = new NavigationGenerator(cwd);
    const currentSidebarHash = navGenerator.getSidebarHash();
    const cachedSidebarHash = cacheManager.getSidebarHash();
    const localeGlobalChanged = globalChanged || cachedSidebarHash !== currentSidebarHash;

    const navItems = navGenerator.generate();
    const markdownFiles = scanMarkdownFiles(docsDir);
    totalFiles = markdownFiles.length;

    const fileHashes: Record<string, string> = {};
    for (const file of markdownFiles) {
      const relativePath = path.relative(cwd, file);
      fileHashes[relativePath] = cacheManager.computeFileHash(file);
    }

    let staleFiles: Set<string>;
    if (localeGlobalChanged) {
      staleFiles = new Set(markdownFiles.map(f => path.relative(cwd, f)));
    } else {
      const directlyStale = cacheManager.getStaleFiles(fileHashes);
      staleFiles = new Set(directlyStale);

      for (const file of directlyStale) {
        const dependents = cacheManager.findFilesDependingOn(file);
        for (const dep of dependents) {
          staleFiles.add(dep);
        }
      }
    }

    for (const file of markdownFiles) {
      const relativePath = path.relative(cwd, file);
      const docsRelPath = path.relative(docsDir, file);

      try {
        const rawContent = fs.readFileSync(file, 'utf-8');
        const { content: resolvedContent, includes } = markdownParser.parseIncludes(rawContent, file);
        const meta = markdownParser.getPageMeta(resolvedContent, docsRelPath, config.basePath);
        const plainText = markdownParser.extractPlainText(resolvedContent);

        seoGenerator.addUrl(meta.url);

        if (config.search) {
          searchIndexer.addDocument({
            id: relativePath,
            title: meta.title,
            content: plainText,
            path: meta.url
          });
        }

        let htmlRelPath: string;
        if (docsRelPath.endsWith('/index.md')) {
          htmlRelPath = docsRelPath.replace(/\.md$/, '.html');
        } else if (docsRelPath === 'index.md') {
          htmlRelPath = 'index.html';
        } else {
          htmlRelPath = docsRelPath.replace(/\.md$/, '.html');
        }

        pluginManager.addPage({ filePath: file, relativePath, meta, htmlPath: htmlRelPath });
      } catch (e) {}

      if (!staleFiles.has(relativePath) && !localeGlobalChanged) {
        skipped.push(relativePath);
        continue;
      }

      try {
        const page = await processMarkdownFile(
          file, relativePath, cwd, config, markdownParser,
          templateEngine, navGenerator, navItems, pluginManager
        );

        const htmlRelPath = page.htmlPath;
        const htmlFullPath = path.join(distDir, htmlRelPath);
        fs.mkdirpSync(path.dirname(htmlFullPath));
        fs.writeFileSync(htmlFullPath, page.html, 'utf-8');

        const fileEntry = {
          hash: fileHashes[relativePath],
          includes: page.includes,
          lastModified: Date.now()
        };
        cacheManager.setFileCache(relativePath, fileEntry);

        rebuilt.push(relativePath);

      } catch (e) {
        console.error(pc.red(`✗ 处理文件失败: ${relativePath}`), e);
      }
    }
  }

  if (config.search) {
    searchIndexer.buildAndWrite();
    console.log(pc.green('  ✓ 搜索索引已生成'));
  }

  seoGenerator.generateSitemap();
  seoGenerator.generateRobotsTxt();
  console.log(pc.green('  ✓ SEO 文件已生成 (sitemap.xml, robots.txt)'));

  copyPublicAssets(cwd, publicDir, distDir);
  copyCoreAssets(cwd, distDir, config);

  const extraAssets = pluginManager.getExtraAssets();
  for (const asset of extraAssets) {
    const assetFullPath = path.join(distDir, asset.path);
    fs.mkdirpSync(path.dirname(assetFullPath));
    fs.writeFileSync(assetFullPath, asset.content);
  }

  cacheManager.setTemplateHash(currentTemplateHash);
  cacheManager.save();

  const elapsedTime = Date.now() - startTime;

  await pluginManager.applyBuildComplete({
    totalFiles,
    rebuiltFiles: rebuilt.length,
    skippedFiles: skipped.length,
    elapsedTime
  });

  const elapsed = ((elapsedTime) / 1000).toFixed(2);

  console.log('');
  console.log(pc.bold(pc.green('✅ 构建完成！')));
  console.log(pc.dim('─'.repeat(40)));
  console.log(`  总文件数:  ${pc.cyan(String(totalFiles))}`);
  console.log(`  重新构建: ${pc.green(String(rebuilt.length))}`);
  console.log(`  跳过:     ${pc.gray(String(skipped.length))}`);
  console.log(`  耗时:     ${pc.yellow(elapsed + 's')}`);

  if (rebuilt.length > 0) {
    console.log('');
    console.log(pc.dim('  重新构建的文件:'));
    for (const f of rebuilt) {
      console.log(pc.green(`    + ${f}`));
    }
  }

  console.log('');
  console.log(`  输出目录: ${pc.cyan(distDir)}`);
  console.log('');

  return {
    rebuilt: rebuilt.length,
    skipped: skipped.length,
    total: totalFiles,
    time: elapsedTime,
    files: { rebuilt, skipped }
  };
}

function scanMarkdownFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      if (entry.isDirectory() && entry.name === 'includes') continue;

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files.sort();
}

async function processMarkdownFile(
  filePath: string,
  relativePath: string,
  cwd: string,
  config: SiteConfig,
  markdownParser: MarkdownParser,
  templateEngine: TemplateEngine,
  navGenerator: NavigationGenerator,
  navItems: NavItem[],
  pluginManager: PluginManager
) {
  const rawContent = fs.readFileSync(filePath, 'utf-8');
  const docsRelPath = path.relative(path.join(cwd, 'docs'), filePath);

  const { content: resolvedContent, includes } = markdownParser.parseIncludes(rawContent, filePath);

  const meta = markdownParser.getPageMeta(resolvedContent, docsRelPath, config.basePath);
  let htmlContent = markdownParser.render(resolvedContent);
  const plainText = markdownParser.extractPlainText(resolvedContent);

  const pageInfo: PageInfo = { filePath, relativePath, meta, htmlPath: '' };

  let htmlRelPath: string;
  if (docsRelPath.endsWith('/index.md')) {
    htmlRelPath = docsRelPath.replace(/\.md$/, '.html');
  } else if (docsRelPath === 'index.md') {
    htmlRelPath = 'index.html';
  } else {
    htmlRelPath = docsRelPath.replace(/\.md$/, '.html');
  }
  pageInfo.htmlPath = htmlRelPath;

  const parsedData: MarkdownParsedData = {
    filePath,
    rawContent,
    html: htmlContent,
    meta
  };
  const parsedResult = await pluginManager.applyMarkdownParsed(parsedData);
  htmlContent = parsedResult.html;

  const currentPath = meta.path;
  const navHtml = navGenerator.renderNavHtml(navItems, currentPath, config.basePath);

  const basePath = config.basePath.endsWith('/') ? config.basePath : config.basePath + '/';

  const headTags = pluginManager.getHeadTags().join('\n  ');

  let templateData: Record<string, any> = {
    site: config,
    page: meta,
    nav: navHtml,
    content: htmlContent,
    basePath: basePath,
    currentPath: currentPath,
    searchEnabled: config.search,
    darkModeEnabled: config.darkMode,
    headHtml: config.headHtml,
    gaId: config.googleAnalyticsId,
    favicon: config.favicon,
    pageLang: 'zh-CN',
    logoHref: basePath,
    hasLocales: false,
    searchIndexPath: basePath + 'search-index.js',
    pluginHeadTags: headTags
  };

  const beforeRenderResult = await pluginManager.applyBeforeRender({
    templateData,
    page: pageInfo
  });
  templateData = beforeRenderResult.templateData;

  let html = templateEngine.render('layout.html', templateData);

  const afterRenderResult = await pluginManager.applyAfterRender({
    html,
    page: pageInfo
  });
  html = afterRenderResult.html;

  return {
    html,
    meta,
    includes,
    plainText,
    htmlPath: htmlRelPath
  };
}

async function processMarkdownFileLocale(
  filePath: string,
  relativePath: string,
  cwd: string,
  config: SiteConfig,
  markdownParser: MarkdownParser,
  templateEngine: TemplateEngine,
  navGenerator: NavigationGenerator,
  navItems: NavItem[],
  locale: LocaleConfig,
  allLocales: LocaleConfig[],
  localeDocsDir: string,
  pluginManager: PluginManager
) {
  const rawContent = fs.readFileSync(filePath, 'utf-8');
  const docsRelPath = path.relative(localeDocsDir, filePath);

  const { content: resolvedContent, includes } = markdownParser.parseIncludes(rawContent, filePath);

  const metaBase = markdownParser.getPageMeta(resolvedContent, docsRelPath, config.basePath);
  const urlPrefix = '/' + locale.code;
  const fullPath = urlPrefix + (metaBase.path.startsWith('/') ? metaBase.path : '/' + metaBase.path);
  const basePathForUrl = config.basePath.endsWith('/') ? config.basePath : config.basePath + '/';
  const fullUrl = basePathForUrl + fullPath.replace(/^\//, '');
  const meta: PageMeta = {
    ...metaBase,
    path: fullPath,
    url: fullUrl
  };
  let htmlContent = markdownParser.render(resolvedContent);
  const plainText = markdownParser.extractPlainText(resolvedContent);

  const pageInfo: PageInfo = { filePath, relativePath, meta, htmlPath: '' };

  let htmlRelPath: string;
  if (docsRelPath.endsWith('/index.md')) {
    htmlRelPath = docsRelPath.replace(/\.md$/, '.html');
  } else if (docsRelPath === 'index.md') {
    htmlRelPath = 'index.html';
  } else {
    htmlRelPath = docsRelPath.replace(/\.md$/, '.html');
  }
  pageInfo.htmlPath = htmlRelPath;

  const parsedData: MarkdownParsedData = {
    filePath,
    rawContent,
    html: htmlContent,
    meta
  };
  const parsedResult = await pluginManager.applyMarkdownParsed(parsedData);
  htmlContent = parsedResult.html;

  const currentPath = meta.path;
  const navHtml = navGenerator.renderNavHtml(navItems, currentPath, config.basePath);

  const basePath = config.basePath.endsWith('/') ? config.basePath : config.basePath + '/';

  const templateLocales = allLocales.map(l => ({
    code: l.code,
    name: l.name,
    dir: l.dir,
    isCurrent: l.code === locale.code
  }));

  const headTags = pluginManager.getHeadTags().join('\n  ');

  let templateData: Record<string, any> = {
    site: config,
    page: meta,
    nav: navHtml,
    content: htmlContent,
    basePath: basePath,
    currentPath: currentPath,
    searchEnabled: config.search,
    darkModeEnabled: config.darkMode,
    headHtml: config.headHtml,
    gaId: config.googleAnalyticsId,
    favicon: config.favicon,
    locales: templateLocales,
    currentLocale: locale.code,
    currentLocaleName: locale.name,
    langCode: locale.code,
    pageLang: locale.code,
    logoHref: basePath + locale.code + '/',
    hasLocales: true,
    searchIndexPath: basePath + locale.code + '/search-index.js',
    pluginHeadTags: headTags
  };

  const beforeRenderResult = await pluginManager.applyBeforeRender({
    templateData,
    page: pageInfo
  });
  templateData = beforeRenderResult.templateData;

  let html = templateEngine.render('layout.html', templateData);

  const afterRenderResult = await pluginManager.applyAfterRender({
    html,
    page: pageInfo
  });
  html = afterRenderResult.html;

  return {
    html,
    meta,
    includes,
    plainText,
    htmlPath: htmlRelPath
  };
}

function copyPublicAssets(cwd: string, publicDir: string, distDir: string): void {
  if (fs.existsSync(publicDir)) {
    fs.copySync(publicDir, distDir, {
      dereference: true,
      filter: (src) => {
        const name = path.basename(src);
        return !name.startsWith('.');
      }
    });
    console.log(pc.green('  ✓ 静态资源已复制 (public/)'));
  }
}

function copyCoreAssets(cwd: string, distDir: string, config: SiteConfig): void {
  const assetsDir = path.join(distDir, 'assets');
  fs.mkdirpSync(assetsDir);

  const styles = generateStyles(config);
  fs.writeFileSync(path.join(assetsDir, 'styles.css'), styles, 'utf-8');

  const appJs = generateAppJs(config);
  fs.writeFileSync(path.join(assetsDir, 'app.js'), appJs, 'utf-8');

  console.log(pc.green('  ✓ 核心资源已生成 (CSS/JS)'));
}

function generateStyles(config: SiteConfig): string {
  return `/* ========== 基础变量 ========== */
:root {
  --primary: ${config.themeColor};
  --primary-light: ${config.themeColor}20;
  --bg: #ffffff;
  --bg-secondary: #f8fafc;
  --bg-tertiary: #f1f5f9;
  --text: #1e293b;
  --text-secondary: #64748b;
  --text-muted: #94a3b8;
  --border: #e2e8f0;
  --code-bg: #f8fafc;
  --sidebar-width: 280px;
  --header-height: 64px;
  --content-max-width: 1100px;
}

[data-theme="dark"] {
  --bg: #0f172a;
  --bg-secondary: #1e293b;
  --bg-tertiary: #334155;
  --text: #e2e8f0;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --border: #334155;
  --code-bg: #1e293b;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

html { scroll-behavior: smooth; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 15px;
  line-height: 1.7;
  color: var(--text);
  background: var(--bg);
  transition: background 0.3s, color 0.3s;
}

/* ========== 布局 ========== */
.app { min-height: 100vh; display: flex; flex-direction: column; }

.header {
  position: fixed;
  top: 0; left: 0; right: 0;
  height: var(--header-height);
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  z-index: 100;
  backdrop-filter: blur(10px);
}

.header-inner {
  max-width: 100%;
  height: 100%;
  margin: 0 auto;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.logo {
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  text-decoration: none;
}
.logo:hover { color: var(--primary); }

.header-actions { display: flex; align-items: center; gap: 12px; }

.main {
  flex: 1;
  display: flex;
  padding-top: var(--header-height);
}

.sidebar {
  position: fixed;
  top: var(--header-height);
  left: 0;
  bottom: 0;
  width: var(--sidebar-width);
  overflow-y: auto;
  border-right: 1px solid var(--border);
  background: var(--bg-secondary);
  padding: 20px 0;
  z-index: 50;
  transition: transform 0.3s ease;
}

.sidebar-toggle {
  display: none;
  position: fixed;
  top: calc(var(--header-height) + 16px);
  left: 16px;
  z-index: 60;
  background: var(--primary);
  color: white;
  border: none;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 18px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}

.content {
  flex: 1;
  margin-left: var(--sidebar-width);
  padding: 32px 48px;
  max-width: 100%;
}

.doc-content {
  max-width: var(--content-max-width);
  margin: 0 auto;
}

/* ========== 导航 ========== */
.nav { padding: 0 8px; }
.nav-list { list-style: none; }
.nav-level-0 { padding-left: 0; }
.nav-level-1 { padding-left: 16px; }
.nav-level-2 { padding-left: 16px; }
.nav-level-3 { padding-left: 16px; }

.nav-item { margin: 2px 0; }

.nav-link {
  display: block;
  padding: 8px 12px;
  color: var(--text-secondary);
  text-decoration: none;
  border-radius: 6px;
  font-size: 14px;
  transition: all 0.15s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nav-link:hover {
  background: var(--bg-tertiary);
  color: var(--text);
}
.nav-link.active {
  background: var(--primary-light);
  color: var(--primary);
  font-weight: 600;
}
.nav-link.external {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.external-icon { font-size: 12px; opacity: 0.6; }

.nav-group-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  color: var(--text);
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  user-select: none;
}
.nav-collapse-icon {
  font-size: 10px;
  transition: transform 0.2s;
  color: var(--text-muted);
}
.nav-item.collapsed > .nav-list { display: none; }
.nav-item.collapsed .nav-collapse-icon { transform: rotate(-90deg); }

/* ========== 搜索 ========== */
.search-box {
  position: relative;
  width: 320px;
  max-width: 100%;
}

#search-input {
  width: 100%;
  padding: 8px 14px 8px 36px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text);
  font-size: 14px;
  outline: none;
  transition: all 0.2s;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.35-4.35'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: 12px center;
}
#search-input:focus {
  border-color: var(--primary);
  background: var(--bg);
  box-shadow: 0 0 0 3px var(--primary-light);
}

.search-results {
  display: none;
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  max-height: 480px;
  overflow-y: auto;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.1);
  z-index: 200;
}
.search-no-results {
  padding: 32px;
  text-align: center;
  color: var(--text-muted);
  font-size: 14px;
}
.search-result-item {
  display: block;
  padding: 14px 16px;
  text-decoration: none;
  color: var(--text);
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
}
.search-result-item:last-child { border-bottom: none; }
.search-result-item:hover { background: var(--bg-secondary); }
.search-result-title {
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 6px;
}
.search-result-snippet {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
mark {
  background: rgba(250, 204, 21, 0.4);
  padding: 1px 2px;
  border-radius: 2px;
}

/* ========== 主题切换 ========== */
.theme-toggle {
  background: none;
  border: 1px solid var(--border);
  width: 36px;
  height: 36px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.theme-toggle:hover { background: var(--bg-tertiary); }

/* ========== 文档内容 ========== */
.doc-content h1, .doc-content h2, .doc-content h3,
.doc-content h4, .doc-content h5, .doc-content h6 {
  font-weight: 700;
  line-height: 1.3;
  margin-top: 1.6em;
  margin-bottom: 0.6em;
  color: var(--text);
}
.doc-content h1 { font-size: 2em; margin-top: 0; padding-bottom: 0.4em; border-bottom: 1px solid var(--border); }
.doc-content h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border); }
.doc-content h3 { font-size: 1.25em; }
.doc-content h4 { font-size: 1em; }

.heading-anchor {
  opacity: 0;
  margin-left: 8px;
  text-decoration: none;
  color: var(--text-muted);
  transition: opacity 0.2s;
}
h1:hover .heading-anchor,
h2:hover .heading-anchor,
h3:hover .heading-anchor,
h4:hover .heading-anchor,
h5:hover .heading-anchor,
h6:hover .heading-anchor { opacity: 1; }

.doc-content p { margin-bottom: 1em; }
.doc-content a {
  color: var(--primary);
  text-decoration: none;
}
.doc-content a:hover { text-decoration: underline; }

.doc-content ul, .doc-content ol {
  padding-left: 1.6em;
  margin-bottom: 1em;
}
.doc-content li { margin-bottom: 0.3em; }

.doc-content blockquote {
  margin: 1em 0;
  padding: 0.6em 1em;
  border-left: 4px solid var(--primary);
  background: var(--bg-secondary);
  border-radius: 0 6px 6px 0;
  color: var(--text-secondary);
}

.doc-content table {
  border-collapse: collapse;
  width: 100%;
  margin: 1.5em 0;
  font-size: 14px;
  overflow-x: auto;
  display: block;
}
.doc-content th, .doc-content td {
  border: 1px solid var(--border);
  padding: 10px 14px;
  text-align: left;
}
.doc-content th {
  background: var(--bg-secondary);
  font-weight: 600;
}
.doc-content tr:nth-child(even) td { background: var(--bg-secondary); }

.doc-content img {
  max-width: 100%;
  border-radius: 8px;
  margin: 1em 0;
}

.doc-content hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 2em 0;
}

/* ========== 代码 ========== */
.doc-content code {
  background: var(--code-bg);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
  font-family: "SF Mono", "Monaco", "Inconsolata", "Fira Mono", "Droid Sans Mono", "Source Code Pro", monospace;
}

.doc-content pre {
  background: var(--code-bg);
  padding: 16px 20px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 1.2em 0;
  border: 1px solid var(--border);
  position: relative;
}
.doc-content pre code {
  background: none;
  padding: 0;
  font-size: 13px;
  line-height: 1.6;
}

.copy-code-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s;
}
.doc-content pre:hover .copy-code-btn {
  opacity: 1;
}
.copy-code-btn:hover {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

/* ========== 任务列表 ========== */
.task-list-item {
  list-style: none !important;
  padding-left: 0 !important;
}
.task-list-item-checkbox {
  margin-right: 8px;
  vertical-align: middle;
}

/* ========== 提示框 ========== */
.admonition {
  margin: 1.2em 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid;
}
.admonition-title {
  padding: 10px 16px;
  font-weight: 600;
  font-size: 14px;
}
.admonition-content {
  padding: 12px 16px;
  font-size: 14px;
}
.admonition-tip {
  border-color: #10b98130;
  background: #10b98110;
}
.admonition-tip .admonition-title {
  background: #10b98120;
  color: #059669;
}
.admonition-warning {
  border-color: #f59e0b30;
  background: #f59e0b10;
}
.admonition-warning .admonition-title {
  background: #f59e0b20;
  color: #d97706;
}
.admonition-danger {
  border-color: #ef444430;
  background: #ef444410;
}
.admonition-danger .admonition-title {
  background: #ef444420;
  color: #dc2626;
}

/* ========== Mermaid ========== */
.mermaid-diagram {
  margin: 1.5em 0;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 1px solid var(--border);
  display: flex;
  justify-content: center;
}

/* ========== 数学公式 ========== */
.katex-block {
  overflow-x: auto;
  padding: 12px;
  margin: 1em 0;
  text-align: center;
  background: var(--bg-secondary);
  border-radius: 8px;
}
.katex-inline .katex { font-size: 1em; }

/* ========== 脚注 ========== */
.footnote-ref {
  font-size: 12px;
  vertical-align: super;
}
.footnotes {
  margin-top: 3em;
  padding-top: 1em;
  border-top: 1px solid var(--border);
  font-size: 13px;
  color: var(--text-secondary);
}
.footnotes ol { padding-left: 1.4em; }
.footnotes li { margin-bottom: 0.5em; }
.footnote-backref { font-size: 12px; }

/* ========== 目录 ========== */
.toc {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 20px;
  margin: 1.5em 0;
}
.toc-title {
  font-weight: 600;
  margin-bottom: 8px;
  font-size: 14px;
}
.toc ul { list-style: none; padding-left: 1em; margin: 0; }
.toc > ul { padding-left: 0; }
.toc li { margin: 4px 0; }
.toc a {
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 14px;
}
.toc a:hover { color: var(--primary); }

/* ========== 阅读时间 ========== */
.reading-time {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 1em;
}

/* ========== 自动目录导航栏 ========== */
.auto-toc-nav {
  position: fixed;
  top: calc(var(--header-height) + 32px);
  right: 32px;
  width: 200px;
  max-height: calc(100vh - var(--header-height) - 64px);
  overflow-y: auto;
  font-size: 13px;
  border-left: 2px solid var(--border);
  padding-left: 12px;
}
.auto-toc-nav-title {
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--text);
  font-size: 13px;
}
.auto-toc-nav ul {
  list-style: none;
  padding-left: 0;
  margin: 0;
}
.auto-toc-nav li {
  margin: 6px 0;
}
.auto-toc-nav a {
  color: var(--text-muted);
  text-decoration: none;
  display: block;
  padding: 2px 0;
  transition: color 0.2s;
}
.auto-toc-nav a:hover {
  color: var(--primary);
}
.auto-toc-nav a.active {
  color: var(--primary);
  font-weight: 600;
}
.auto-toc-nav .toc-h3 {
  padding-left: 12px;
}

@media (max-width: 1280px) {
  .auto-toc-nav { display: none; }
}

/* ========== 响应式 ========== */
@media (max-width: 960px) {
  :root { --sidebar-width: 260px; }

  .sidebar {
    transform: translateX(-100%);
    box-shadow: 4px 0 20px rgba(0,0,0,0.1);
  }
  .sidebar.open { transform: translateX(0); }

  .sidebar-toggle { display: block; }

  .content {
    margin-left: 0;
    padding: 20px;
    padding-top: 72px;
  }

  .search-box { width: 220px; }
}

@media (max-width: 640px) {
  :root { --header-height: 56px; }

  .header-inner { padding: 0 16px; }

  .search-box { width: 160px; }
  #search-input { padding: 6px 10px 6px 32px; font-size: 13px; }

  .content { padding: 16px; padding-top: 64px; }

  .doc-content h1 { font-size: 1.6em; }
  .doc-content h2 { font-size: 1.3em; }

  .logo { font-size: 16px; }
}

/* ========== 滚动条 ========== */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

/* ========== 语言切换器 ========== */
.lang-switcher {
  position: relative;
}

.lang-toggle {
  background: none;
  border: 1px solid var(--border);
  height: 36px;
  padding: 0 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text);
  transition: all 0.2s;
  white-space: nowrap;
}
.lang-toggle:hover { background: var(--bg-tertiary); }

.lang-arrow {
  font-size: 10px;
  color: var(--text-muted);
}

.lang-menu {
  display: none;
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 140px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.1);
  z-index: 200;
  overflow: hidden;
}
.lang-menu.open { display: block; }

.lang-item {
  display: block;
  padding: 10px 16px;
  text-decoration: none;
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s;
}
.lang-item:hover { background: var(--bg-secondary); }
.lang-item.active {
  background: var(--primary-light);
  color: var(--primary);
  font-weight: 600;
}

@media (max-width: 640px) {
  .lang-toggle {
    padding: 0 8px;
    font-size: 13px;
    height: 32px;
  }
}
`;
}

function generateAppJs(config: SiteConfig): string {
  const basePath = config.basePath.endsWith('/') ? config.basePath : config.basePath + '/';

  return `(function() {
  'use strict';

  // ========== 主题切换 ==========
  var THEME_KEY = 'mdsite-theme';

  function getInitialTheme() {
    try {
      var stored = localStorage.getItem(THEME_KEY);
      if (stored) return stored;
    } catch(e) {}
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      var hljsDark = document.getElementById('hljs-dark');
      if (hljsDark) hljsDark.removeAttribute('disabled');
    } else {
      document.documentElement.removeAttribute('data-theme');
      var hljsDark = document.getElementById('hljs-dark');
      if (hljsDark) hljsDark.setAttribute('disabled', 'true');
    }
    try { localStorage.setItem(THEME_KEY, theme); } catch(e) {}
  }

  var initialTheme = getInitialTheme();
  applyTheme(initialTheme);

  function initThemeToggle() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;

    var updateBtn = function() {
      var current = document.documentElement.getAttribute('data-theme');
      btn.textContent = current === 'dark' ? '☀️' : '🌙';
    };
    updateBtn();

    btn.addEventListener('click', function() {
      var current = document.documentElement.getAttribute('data-theme');
      var next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      updateBtn();
    });
  }

  // ========== 侧边栏折叠 ==========
  function initNavCollapse() {
    var groups = document.querySelectorAll('.nav-group-title');
    groups.forEach(function(group) {
      group.addEventListener('click', function() {
        var li = group.parentElement;
        if (li) {
          li.classList.toggle('collapsed');
        }
      });
    });
  }

  // ========== 移动端侧边栏 ==========
  function initMobileSidebar() {
    var toggle = document.getElementById('sidebar-toggle');
    var sidebar = document.getElementById('sidebar');
    if (!toggle || !sidebar) return;

    toggle.addEventListener('click', function(e) {
      e.stopPropagation();
      sidebar.classList.toggle('open');
    });

    document.addEventListener('click', function(e) {
      if (sidebar.classList.contains('open') &&
          !sidebar.contains(e.target) &&
          e.target !== toggle) {
        sidebar.classList.remove('open');
      }
    });

    var navLinks = sidebar.querySelectorAll('.nav-link');
    navLinks.forEach(function(link) {
      link.addEventListener('click', function() {
        if (window.innerWidth <= 960) {
          sidebar.classList.remove('open');
        }
      });
    });
  }

  // ========== Mermaid 渲染 ==========
  function initMermaid() {
    var diagrams = document.querySelectorAll('.mermaid-diagram[data-mermaid]');
    if (diagrams.length === 0) return;

    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10.6.1/dist/mermaid.min.js';
    script.onload = function() {
      if (window.mermaid) {
        var theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default';
        window.mermaid.initialize({ startOnLoad: false, theme: theme, securityLevel: 'loose' });
        diagrams.forEach(function(el, idx) {
          var id = 'mermaid-' + idx;
          var code = el.getAttribute('data-mermaid');
          try {
            var insertSvg = function(svgCode) {
              el.innerHTML = svgCode;
            };
            window.mermaid.render(id, code, insertSvg);
          } catch(e) {
            console.error('Mermaid render error:', e);
          }
        });
      }
    };
    document.head.appendChild(script);
  }

  // ========== 锚点滚动修正 ==========
  function initAnchorScroll() {
    function scrollToHash() {
      var hash = window.location.hash;
      if (!hash) return;
      var el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) {
        setTimeout(function() {
          var headerHeight = 64;
          if (window.innerWidth <= 640) headerHeight = 56;
          var rect = el.getBoundingClientRect();
          var top = rect.top + window.pageYOffset - headerHeight - 16;
          window.scrollTo({ top: top, behavior: 'smooth' });
        }, 100);
      }
    }

    window.addEventListener('load', scrollToHash);
    window.addEventListener('hashchange', scrollToHash);
  }

  // ========== 语言切换 ==========
  var BASE_PATH = ${JSON.stringify(basePath)};

  function initLangSwitcher() {
    var toggle = document.getElementById('lang-toggle');
    var menu = document.getElementById('lang-menu');
    if (!toggle || !menu) return;

    var langItems = menu.querySelectorAll('.lang-item');
    var availableLangs = [];
    langItems.forEach(function(item) {
      availableLangs.push({
        code: item.getAttribute('data-lang'),
        name: item.getAttribute('data-name')
      });
    });

    if (availableLangs.length === 0) return;

    function removeTrailingSlash(s) {
      while (s.length > 0 && s.charAt(s.length - 1) === '/') {
        s = s.slice(0, -1);
      }
      return s;
    }

    function removeLeadingSlash(s) {
      while (s.length > 0 && s.charAt(0) === '/') {
        s = s.slice(1);
      }
      return s;
    }

    function collapseTrailingSlashes(s) {
      while (s.length > 1 && s.charAt(s.length - 1) === '/' && s.charAt(s.length - 2) === '/') {
        s = s.slice(0, -1);
      }
      return s;
    }

    function stripBase(pathname) {
      var base = removeTrailingSlash(BASE_PATH);
      var relPath = pathname;
      if (base && relPath.indexOf(base) === 0) {
        relPath = relPath.slice(base.length);
      }
      return removeLeadingSlash(relPath);
    }

    function getCurrentLang() {
      var relPath = stripBase(window.location.pathname);
      var parts = relPath.split('/');
      if (parts.length > 0) {
        var firstPart = parts[0];
        for (var i = 0; i < availableLangs.length; i++) {
          if (availableLangs[i].code === firstPart) {
            return availableLangs[i].code;
          }
        }
      }
      return availableLangs[0].code;
    }

    function getRelativePathWithoutLang() {
      var relPath = stripBase(window.location.pathname);
      var parts = relPath.split('/');
      if (parts.length > 0) {
        var firstPart = parts[0];
        for (var i = 0; i < availableLangs.length; i++) {
          if (availableLangs[i].code === firstPart) {
            parts.shift();
            break;
          }
        }
      }
      return parts.join('/');
    }

    function switchLang(targetLang) {
      var currentLang = getCurrentLang();
      if (targetLang === currentLang) return;

      var relPath = getRelativePathWithoutLang();
      var targetPath = removeTrailingSlash(BASE_PATH) + '/' + targetLang + '/' + relPath;
      targetPath = collapseTrailingSlashes(targetPath);
      if (targetPath.endsWith('/')) {
        targetPath += 'index.html';
      }

      var hash = window.location.hash;
      window.location.href = targetPath + (hash || '');
    }

    toggle.addEventListener('click', function(e) {
      e.stopPropagation();
      menu.classList.toggle('open');
    });

    document.addEventListener('click', function(e) {
      if (menu.classList.contains('open') &&
          !menu.contains(e.target) &&
          e.target !== toggle) {
        menu.classList.remove('open');
      }
    });

    langItems.forEach(function(item) {
      item.addEventListener('click', function(e) {
        e.preventDefault();
        var lang = item.getAttribute('data-lang');
        if (lang) {
          switchLang(lang);
        }
      });
    });
  }

  // ========== 复制代码按钮 ==========
  function initCopyCode() {
    document.querySelectorAll('.copy-code-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var pre = btn.parentElement;
        var code = pre.querySelector('code');
        if (!code) return;
        var text = code.textContent || '';
        navigator.clipboard.writeText(text).then(function() {
          btn.textContent = '已复制';
          setTimeout(function() {
            btn.textContent = '复制';
          }, 2000);
        }).catch(function() {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); btn.textContent = '已复制'; setTimeout(function() { btn.textContent = '复制'; }, 2000); } catch(e) {}
          document.body.removeChild(ta);
        });
      });
    });
  }

  // ========== 自动目录导航高亮 ==========
  function initAutoToc() {
    var tocNav = document.querySelector('.auto-toc-nav');
    if (!tocNav) return;

    var links = tocNav.querySelectorAll('a');
    var headings = [];
    links.forEach(function(link) {
      var id = link.getAttribute('href');
      if (id && id.charAt(0) === '#') {
        var el = document.getElementById(id.slice(1));
        if (el) headings.push({ el: el, link: link });
      }
    });

    if (headings.length === 0) return;

    function updateActive() {
      var headerHeight = 80;
      var activeHeading = null;
      for (var i = headings.length - 1; i >= 0; i--) {
        var rect = headings[i].el.getBoundingClientRect();
        if (rect.top <= headerHeight) {
          activeHeading = headings[i];
          break;
        }
      }
      if (!activeHeading && headings.length > 0) {
        activeHeading = headings[0];
      }
      links.forEach(function(l) { l.classList.remove('active'); });
      if (activeHeading) {
        activeHeading.link.classList.add('active');
      }
    }

    var scrollTimer = null;
    window.addEventListener('scroll', function() {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(updateActive, 50);
    });
    updateActive();
  }

  // ========== WebSocket 热更新 ==========
  var ws = null;
  function initHotReload() {
    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var url = protocol + '//' + location.host + '/__hmr';

    try {
      ws = new WebSocket(url);
      ws.onmessage = function(event) {
        var data = JSON.parse(event.data);
        if (data.type === 'reload') {
          console.log('[mdsite] File changed, reloading...');
          location.reload();
        }
      };
      ws.onerror = function() {
        console.log('[mdsite] HMR disabled');
      };
    } catch(e) {}
  }

  // ========== 初始化 ==========
  function init() {
    initThemeToggle();
    initNavCollapse();
    initMobileSidebar();
    initMermaid();
    initAnchorScroll();
    initLangSwitcher();
    initCopyCode();
    initAutoToc();
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      initHotReload();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();`;
}
