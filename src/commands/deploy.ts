import * as fs from 'fs-extra';
import * as path from 'path';
import * as pc from 'picocolors';
import { execSync, spawn } from 'child_process';

interface DeployOptions {
  branch?: string;
  remote?: string;
  message?: string;
  repo?: string;
}

export async function deploy(cwd: string, options: DeployOptions = {}): Promise<void> {
  const distDir = path.join(cwd, 'dist');
  const branch = options.branch || 'gh-pages';
  const remote = options.remote || 'origin';
  const message = options.message || `Deploy: ${new Date().toISOString()}`;
  const repo = options.repo;

  console.log(pc.bold(pc.blue('🚀 部署到 GitHub Pages...')));
  console.log('');

  if (!fs.existsSync(distDir)) {
    console.error(pc.red('✗ dist/ 目录不存在，请先运行 mdsite build'));
    process.exit(1);
  }

  const distStat = fs.statSync(distDir);
  if (!distStat.isDirectory()) {
    console.error(pc.red('✗ dist/ 不是一个目录'));
    process.exit(1);
  }

  const distContents = fs.readdirSync(distDir);
  if (distContents.length === 0) {
    console.error(pc.red('✗ dist/ 目录为空，请先运行 mdsite build'));
    process.exit(1);
  }

  const inGitRepo = checkGitRepository(cwd);
  
  if (!inGitRepo) {
    console.error(pc.red('✗ 当前目录不是一个 Git 仓库'));
    console.log('');
    console.log(pc.yellow('请先运行以下命令初始化 Git 仓库:'));
    console.log(pc.cyan('  git init'));
    console.log(pc.cyan('  git add .'));
    console.log(pc.cyan('  git commit -m "Initial commit"'));
    console.log('');
    process.exit(1);
  }

  if (!repo && !checkRemoteExists(cwd, remote)) {
    console.error(pc.red(`✗ 找不到远程仓库 "${remote}"`));
    console.log('');
    console.log(pc.yellow('您可以:'));
    console.log(pc.cyan(`  1. git remote add ${remote} <仓库URL>`));
    console.log(pc.cyan('  2. 使用 --repo 参数指定仓库: mdsite deploy --repo <仓库URL>'));
    console.log(pc.cyan(`  3. 使用 --remote 参数指定远程: mdsite deploy --remote origin`));
    console.log('');
    process.exit(1);
  }

  const deployDir = path.join(cwd, '.deploy-tmp');
  
  try {
    console.log(pc.cyan('📋 准备部署文件...'));
    
    if (fs.existsSync(deployDir)) {
      fs.removeSync(deployDir);
    }
    fs.mkdirpSync(deployDir);

    const gitDir = path.join(deployDir, '.git');
    const workTree = deployDir;

    console.log(pc.cyan(`🔄 克隆分支 ${branch}...`));
    
    let branchExists = true;
    try {
      execSync(`git ls-remote --exit-code --heads ${repo ? repo : remote} ${branch}`, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (e) {
      branchExists = false;
    }

    try {
      if (branchExists) {
        console.log(pc.gray(`   分支 ${branch} 已存在，将更新`));
        execSync(`git clone --depth 1 --branch ${branch} ${repo ? repo : getRemoteUrl(cwd, remote)} .`, {
          cwd: deployDir,
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } else {
        console.log(pc.gray(`   分支 ${branch} 不存在，将创建新分支`));
        execSync(`git clone --depth 1 ${repo ? repo : getRemoteUrl(cwd, remote)} .`, {
          cwd: deployDir,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        try {
          execSync(`git checkout --orphan ${branch}`, {
            cwd: deployDir,
            stdio: ['pipe', 'pipe', 'pipe']
          });
        } catch (e) {
          execSync(`git checkout -b ${branch}`, {
            cwd: deployDir,
            stdio: ['pipe', 'pipe', 'pipe']
          });
        }
      }
    } catch (e: any) {
      console.warn(pc.yellow(`⚠️  克隆失败，创建孤儿分支: ${e.message}`));
      execSync('git init', { cwd: deployDir, stdio: ['pipe', 'pipe', 'pipe'] });
      execSync(`git checkout -b ${branch}`, {
        cwd: deployDir,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    }

    const deployFiles = fs.readdirSync(deployDir);
    for (const file of deployFiles) {
      if (file !== '.git') {
        const filePath = path.join(deployDir, file);
        fs.removeSync(filePath);
      }
    }

    console.log(pc.cyan('📦 复制构建文件...'));
    fs.copySync(distDir, deployDir, {
      dereference: true,
      filter: (src) => {
        const name = path.basename(src);
        return !name.startsWith('.');
      }
    });

    const nojekyll = path.join(deployDir, '.nojekyll');
    if (!fs.existsSync(nojekyll)) {
      fs.writeFileSync(nojekyll, '', 'utf-8');
    }

    console.log(pc.cyan('📝 提交更改...'));
    try {
      execSync('git add -A', { cwd: deployDir, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {}

    try {
      execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
        cwd: deployDir,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (e: any) {
      const stderr = e.stderr?.toString() || '';
      if (!stderr.includes('nothing to commit') && !stderr.includes('no changes added')) {
        console.log(pc.gray('   无新变更需要提交'));
      }
    }

    console.log(pc.cyan(`📤 推送到 ${remote}/${branch}...`));
    
    if (repo) {
      execSync(`git push -f ${repo} ${branch}`, {
        cwd: deployDir,
        stdio: 'inherit'
      });
    } else {
      execSync(`git push -f ${remote} ${branch}`, {
        cwd: deployDir,
        stdio: 'inherit'
      });
    }

    console.log('');
    console.log(pc.bold(pc.green('✅ 部署成功！')));
    console.log('');
    console.log(pc.cyan('  📋 部署信息:'));
    console.log(`     分支:   ${pc.white(branch)}`);
    console.log(`     远程:   ${pc.white(remote)}${repo ? ' (自定义仓库)' : ''}`);
    console.log(`     提交:   ${pc.white(message)}`);
    console.log('');

    try {
      const remoteUrl = repo || getRemoteUrl(cwd, remote);
      const pagesUrl = inferPagesUrl(remoteUrl, branch);
      if (pagesUrl) {
        console.log(pc.cyan('  🌐 站点地址:'));
        console.log(`     ${pc.white(pagesUrl)}`);
        console.log('');
        console.log(pc.yellow('  💡 注意: GitHub Pages 可能需要几分钟才能生效'));
        console.log('');
      }
    } catch (e) {}

  } catch (e: any) {
    console.error('');
    console.error(pc.red('✗ 部署失败:'), e.message);
    console.error('');
    process.exit(1);
  } finally {
    if (fs.existsSync(deployDir)) {
      try {
        fs.removeSync(deployDir);
      } catch (e) {}
    }
  }
}

function checkGitRepository(cwd: string): boolean {
  try {
    execSync('git rev-parse --git-dir', {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return true;
  } catch (e) {
    return false;
  }
}

function checkRemoteExists(cwd: string, remote: string): boolean {
  try {
    execSync(`git remote get-url ${remote}`, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return true;
  } catch (e) {
    return false;
  }
}

function getRemoteUrl(cwd: string, remote: string): string {
  try {
    return execSync(`git remote get-url ${remote}`, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    }).toString().trim();
  } catch (e) {
    return '';
  }
}

function inferPagesUrl(remoteUrl: string, branch: string): string | null {
  if (!remoteUrl) return null;

  let url = remoteUrl;
  
  if (url.startsWith('git@')) {
    url = url.replace(/^git@([^:]+):/, 'https://$1/');
  }
  
  url = url.replace(/\.git$/, '');
  
  if (url.includes('github.com')) {
    const match = url.match(/github\.com\/([^/]+)\/(.+)/);
    if (match) {
      const user = match[1];
      const repo = match[2];
      
      if (repo.endsWith('.github.io') || repo === `${user}.github.io`) {
        return `https://${user}.github.io/`;
      }
      
      if (branch === 'gh-pages') {
        return `https://${user}.github.io/${repo}/`;
      }
      
      return `https://${user}.github.io/${repo}/`;
    }
  }
  
  return url;
}
