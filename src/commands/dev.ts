import * as fs from 'fs-extra';
import * as path from 'path';
import * as http from 'http';
import * as pc from 'picocolors';
import * as chokidar from 'chokidar';
import { WebSocketServer, WebSocket } from 'ws';
import { build } from './build';

interface DevOptions {
  port?: number;
  host?: string;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'font/eot',
  '.md': 'text/markdown; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

export async function dev(cwd: string, options: DevOptions = {}): Promise<void> {
  const port = options.port || 3000;
  const host = options.host || '0.0.0.0';
  const distDir = path.join(cwd, 'dist');

  console.log(pc.bold(pc.blue('🔧 启动开发服务器...')));
  console.log('');

  try {
    await build(cwd, { clean: false });
  } catch (e) {
    console.warn(pc.yellow('⚠️  初始构建失败，将继续启动服务器...'));
  }

  fs.mkdirpSync(distDir);

  const server = http.createServer((req, res) => {
    handleRequest(req, res, distDir);
  });

  const wss = new WebSocketServer({ noServer: true });

  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    
    ws.on('close', () => {
      clients.delete(ws);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });

    ws.send(JSON.stringify({ type: 'connected' }));
  });

  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/__hmr') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  function broadcast(message: object) {
    const data = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(data);
        } catch (e) {}
      }
    }
  }

  let rebuildTimer: NodeJS.Timeout | null = null;
  let isRebuilding = false;

  async function triggerRebuild() {
    if (isRebuilding) {
      if (rebuildTimer) clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(triggerRebuild, 300);
      return;
    }

    if (rebuildTimer) {
      clearTimeout(rebuildTimer);
      rebuildTimer = null;
    }

    isRebuilding = true;
    
    console.log('');
    console.log(pc.cyan('📁 文件变更，重新构建...'));

    try {
      await build(cwd, { clean: false });
      broadcast({ type: 'reload', timestamp: Date.now() });
      console.log(pc.green('  ✓ 浏览器已通知刷新'));
    } catch (e) {
      console.error(pc.red('  ✗ 构建失败:'), e);
    } finally {
      isRebuilding = false;
    }
  }

  const watchPatterns = [
    path.join(cwd, 'docs', '**', '*.md'),
    path.join(cwd, 'docs', '**', '_sidebar.yml'),
    path.join(cwd, '**', 'docs', '**', '*.md'),
    path.join(cwd, '**', 'docs', '**', '_sidebar.yml'),
    path.join(cwd, 'templates', '**', '*.html'),
    path.join(cwd, 'public', '**', '*'),
    path.join(cwd, 'site.yml')
  ];

  const watcher = chokidar.watch(watchPatterns, {
    ignored: /(^|[\/\\])\../,
    ignoreInitial: true,
    persistent: true
  });

  watcher.on('add', triggerRebuild);
  watcher.on('change', triggerRebuild);
  watcher.on('unlink', triggerRebuild);
  watcher.on('addDir', triggerRebuild);
  watcher.on('unlinkDir', triggerRebuild);

  watcher.on('ready', () => {
    console.log('');
    console.log(pc.bold(pc.green('✅ 开发服务器已启动！')));
    console.log(pc.dim('─'.repeat(40)));
    console.log(`  本地访问:  ${pc.cyan(`http://localhost:${port}`)}`);
    if (host !== 'localhost' && host !== '127.0.0.1') {
      console.log(`  网络访问:  ${pc.cyan(`http://${getLocalIp()}:${port}`)}`);
    }
    console.log('');
    console.log(pc.dim('  正在监听文件变更...'));
    console.log(pc.dim('  按 Ctrl+C 停止服务器'));
    console.log('');
  });

  server.on('error', (err) => {
    console.error(pc.red('✗ 服务器错误:'), err.message);
    process.exit(1);
  });

  server.listen(port, host);

  process.on('SIGINT', async () => {
    console.log('');
    console.log(pc.cyan('📴 正在关闭服务器...'));
    
    try {
      await watcher.close();
    } catch (e) {}
    
    for (const client of clients) {
      try { client.close(); } catch (e) {}
    }
    
    try {
      wss.close();
    } catch (e) {}
    
    try {
      server.close();
    } catch (e) {}
    
    console.log(pc.green('👋 再见！'));
    process.exit(0);
  });
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse, distDir: string): void {
  let urlPath = decodeURIComponent(req.url!.split('?')[0]);

  if (urlPath === '/__hmr') {
    res.statusCode = 400;
    res.end('Use WebSocket connection for HMR');
    return;
  }

  if (urlPath === '/') {
    urlPath = '/index.html';
  }

  const filePath = path.join(distDir, urlPath);

  if (!filePath.startsWith(distDir)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err) {
      if (err.code === 'ENOENT') {
        const htmlPath = filePath.endsWith('.html') ? filePath : filePath + '.html';
        fs.stat(htmlPath, (err2, stats2) => {
          if (err2) {
            const indexPath = path.join(filePath, 'index.html');
            fs.stat(indexPath, (err3, stats3) => {
              if (err3) {
                serve404(res, distDir);
              } else {
                serveFile(res, indexPath, stats3);
              }
            });
          } else {
            serveFile(res, htmlPath, stats2);
          }
        });
      } else {
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
      return;
    }

    if (stats.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      fs.stat(indexPath, (err2, stats2) => {
        if (err2) {
          serve404(res, distDir);
        } else {
          serveFile(res, indexPath, stats2);
        }
      });
    } else {
      serveFile(res, filePath, stats);
    }
  });
}

function serveFile(res: http.ServerResponse, filePath: string, stats: fs.Stats): void {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', stats.size);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('ETag', `"${stats.size.toString(36)}-${stats.mtimeMs.toString(36)}"`);

  const stream = fs.createReadStream(filePath);
  stream.on('error', (err) => {
    res.statusCode = 500;
    res.end('Internal Server Error');
  });
  stream.pipe(res);
}

function serve404(res: http.ServerResponse, distDir: string): void {
  const notFoundPath = path.join(distDir, '404.html');
  
  fs.stat(notFoundPath, (err, stats) => {
    if (!err && stats.isFile()) {
      res.statusCode = 404;
      serveFile(res, notFoundPath, stats);
      return;
    }

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>404 - 页面未找到</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f8fafc;
      color: #1e293b;
    }
    .container { text-align: center; padding: 40px; }
    .code {
      font-size: 120px;
      font-weight: 800;
      color: #3b82f6;
      line-height: 1;
      margin-bottom: 20px;
    }
    h1 { font-size: 28px; margin-bottom: 12px; }
    p { color: #64748b; margin-bottom: 32px; }
    a {
      display: inline-block;
      padding: 12px 24px;
      background: #3b82f6;
      color: white;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      transition: background 0.2s;
    }
    a:hover { background: #2563eb; }
  </style>
</head>
<body>
  <div class="container">
    <div class="code">404</div>
    <h1>页面未找到</h1>
    <p>您访问的页面不存在或已被移动</p>
    <a href="/">返回首页</a>
  </div>
</body>
</html>`;

    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  });
}

function getLocalIp(): string {
  const interfaces = require('os').networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const nets = interfaces[name];
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}
