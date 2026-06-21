import * as fs from 'fs-extra';
import * as path from 'path';
import * as pc from 'picocolors';
import { getDefaultConfigYaml, CONFIG_FILE_NAME } from '../core/config';

const DIRECTORIES = ['docs', 'templates', 'public', 'dist', '.cache'];

const DEFAULT_DOCS = {
  'index.md': `# 欢迎使用 mdsite-cli

这是您的文档首页。

## 快速开始

1. 在 \`docs/\` 目录中编辑 Markdown 文件
2. 运行 \`mdsite build\` 构建站点
3. 运行 \`mdsite dev\` 启动开发服务器

## 特性

- ✅ 完整的 Markdown 支持
- ✅ GFM 表格、任务列表、脚注
- ✅ 数学公式（KaTeX）
- ✅ 代码语法高亮
- ✅ Mermaid 图表
- ✅ 自定义提示框
- ✅ 全文搜索
- ✅ 增量构建
- ✅ 热更新
`,
  'guide/getting-started.md': `# 快速入门

本指南将帮助您快速上手使用 mdsite-cli。

## 安装

\`\`\`bash
npm install -g mdsite-cli
\`\`\`

## 创建项目

\`\`\`bash
mkdir my-docs && cd my-docs
mdsite init
\`\`\`

## 编写文档

在 \`docs/\` 目录下创建 Markdown 文件即可。

:::tip 提示
目录结构会自动转换为导航菜单。
:::
`
};

const DEFAULT_TEMPLATES = {
  'layout.html': `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{ page.title }} - {{ site.title }}</title>
  <meta name="description" content="{{ page.description }}" />
  <meta property="og:title" content="{{ page.title }}" />
  <meta property="og:description" content="{{ page.description }}" />
  {{#if favicon}}<link rel="icon" href="{{ basePath }}{{ favicon }}" />{{/if}}
  {{ headHtml }}
  {{#if gaId}}
  <script async src="https://www.googletagmanager.com/gtag/js?id={{ gaId }}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '{{ gaId }}');
  </script>
  {{/if}}
  <link rel="stylesheet" href="{{ basePath }}assets/styles.css" />
  {{#if searchEnabled}}
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/flexsearch@0.7.43/dist/flexsearch.bundle.min.js" />
  {{/if}}
</head>
<body>
  <div class="app">
    <header class="header">
      <div class="header-inner">
        <a href="{{ basePath }}" class="logo">{{ site.title }}</a>
        <div class="header-actions">
          {{#if searchEnabled}}
          <div class="search-box">
            <input type="text" id="search-input" placeholder="搜索文档..." />
            <div id="search-results" class="search-results"></div>
          </div>
          {{/if}}
          {{#if darkModeEnabled}}
          <button id="theme-toggle" class="theme-toggle" title="切换主题">🌙</button>
          {{/if}}
        </div>
      </div>
    </header>
    <div class="main">
      <aside class="sidebar">
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
</body>
</html>
`
};

export function initProject(cwd: string): void {
  console.log(pc.blue('🔧 初始化 mdsite-cli 项目...'));

  for (const dir of DIRECTORIES) {
    const dirPath = path.join(cwd, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirp(dirPath);
      console.log(pc.green(`  ✓ 创建目录: ${dir}/`));
    } else {
      console.log(pc.gray(`  - 目录已存在: ${dir}/`));
    }
  }

  const configPath = path.join(cwd, CONFIG_FILE_NAME);
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, getDefaultConfigYaml(), 'utf-8');
    console.log(pc.green(`  ✓ 创建配置文件: ${CONFIG_FILE_NAME}`));
  } else {
    console.log(pc.gray(`  - 配置文件已存在: ${CONFIG_FILE_NAME}`));
  }

  for (const [filename, content] of Object.entries(DEFAULT_DOCS)) {
    const filePath = path.join(cwd, 'docs', filename);
    if (!fs.existsSync(filePath)) {
      const dirName = path.dirname(filePath);
      if (!fs.existsSync(dirName)) {
        fs.mkdirpSync(dirName);
      }
      fs.outputFileSync(filePath, content, 'utf-8');
      console.log(pc.green(`  ✓ 创建示例文档: docs/${filename}`));
    }
  }

  for (const [filename, content] of Object.entries(DEFAULT_TEMPLATES)) {
    const filePath = path.join(cwd, 'templates', filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, 'utf-8');
      console.log(pc.green(`  ✓ 创建模板: templates/${filename}`));
    }
  }

  const gitignorePath = path.join(cwd, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    const gitignoreContent = `# mdsite-cli
dist/
.cache/
node_modules/
`;
    fs.writeFileSync(gitignorePath, gitignoreContent, 'utf-8');
    console.log(pc.green('  ✓ 创建 .gitignore'));
  }

  console.log(pc.bold(pc.green('\n✅ 项目初始化完成！')));
  console.log('\n下一步:');
  console.log(pc.cyan('  mdsite build') + '    构建文档站点');
  console.log(pc.cyan('  mdsite dev') + '      启动开发服务器');
  console.log('');
}
