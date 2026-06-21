#!/usr/bin/env node

import { Command } from 'commander';
import * as pc from 'picocolors';
import { initProject } from './commands/init';
import { build } from './commands/build';
import { dev } from './commands/dev';
import { deploy } from './commands/deploy';
import * as path from 'path';

const cwd = process.cwd();

const program = new Command();

program
  .name('mdsite')
  .description('Markdown文档静态站点生成器命令行工具')
  .version('1.0.0', '-v, --version', '显示版本号')
  .helpOption('-h, --help', '显示帮助信息');

program
  .command('init')
  .description('在当前目录初始化文档项目')
  .action(() => {
    try {
      initProject(cwd);
    } catch (e: any) {
      console.error(pc.red('✗ 初始化失败:'), e.message);
      process.exit(1);
    }
  });

program
  .command('build')
  .description('构建文档站点到dist目录')
  .option('--clean', '先清空dist目录再构建')
  .action(async (options) => {
    try {
      await build(cwd, { clean: options.clean === true });
    } catch (e: any) {
      console.error(pc.red('\n✗ 构建失败:'), e.message);
      if (e.stack) {
        console.error(pc.gray(e.stack));
      }
      process.exit(1);
    }
  });

program
  .command('dev')
  .description('启动开发服务器并监听文件变化')
  .option('-p, --port <port>', '服务器端口号', '3000')
  .option('-h, --host <host>', '服务器主机地址', '0.0.0.0')
  .action(async (options) => {
    try {
      await dev(cwd, {
        port: parseInt(options.port, 10),
        host: options.host
      });
    } catch (e: any) {
      console.error(pc.red('\n✗ 开发服务器启动失败:'), e.message);
      process.exit(1);
    }
  });

program
  .command('deploy')
  .description('将dist目录部署到Git仓库的指定分支')
  .option('-b, --branch <branch>', '目标分支', 'gh-pages')
  .option('-r, --remote <remote>', '远程仓库名称', 'origin')
  .option('-R, --repo <repo>', '自定义仓库URL（优先级高于remote）')
  .option('-m, --message <message>', '提交信息', `Deploy: ${new Date().toISOString()}`)
  .action(async (options) => {
    try {
      await deploy(cwd, {
        branch: options.branch,
        remote: options.remote,
        message: options.message,
        repo: options.repo
      });
    } catch (e: any) {
      console.error(pc.red('\n✗ 部署失败:'), e.message);
      process.exit(1);
    }
  });

program
  .addHelpText('before', `
${pc.bold(pc.blue('📖 mdsite-cli'))} - Markdown文档静态站点生成器
${pc.dim('─'.repeat(50))}
`);

program
  .addHelpText('after', `

${pc.bold('示例:')}
  ${pc.cyan('  mdsite init')}            初始化新项目
  ${pc.cyan('  mdsite build')}           构建站点
  ${pc.cyan('  mdsite build --clean')}   清理后构建
  ${pc.cyan('  mdsite dev')}             启动开发服务器
  ${pc.cyan('  mdsite dev -p 8080')}     指定端口启动
  ${pc.cyan('  mdsite deploy')}          部署到gh-pages
  ${pc.cyan('  mdsite deploy -b main')}  部署到main分支

${pc.bold('目录结构:')}
  docs/       Markdown源文件
  templates/  HTML模板文件
  public/     静态资源（会被复制到dist）
  dist/       构建输出目录
  .cache/     构建缓存
  site.yml    配置文件
`);

program.parseAsync(process.argv).catch((err: any) => {
  console.error(pc.red('✗ 命令执行失败:'), err.message);
  process.exit(1);
});
