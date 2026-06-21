import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import { BuildCache, FileCacheEntry } from '../types';

const CACHE_VERSION = '1.0.0';
const CACHE_FILE = 'build-cache.json';

export class BuildCacheManager {
  private cwd: string;
  private cacheDir: string;
  private cacheFilePath: string;
  private cache: BuildCache;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.cacheDir = path.join(cwd, '.cache');
    this.cacheFilePath = path.join(this.cacheDir, CACHE_FILE);
    this.cache = this.loadCache();
  }

  private loadCache(): BuildCache {
    if (fs.existsSync(this.cacheFilePath)) {
      try {
        const data = fs.readFileSync(this.cacheFilePath, 'utf-8');
        const parsed = JSON.parse(data) as BuildCache;
        if (parsed.version === CACHE_VERSION) {
          return parsed;
        }
      } catch (e) {
      }
    }
    return {
      version: CACHE_VERSION,
      files: {},
      templateHash: '',
      sidebarHash: ''
    };
  }

  public save(): void {
    fs.mkdirpSync(this.cacheDir);
    fs.writeFileSync(this.cacheFilePath, JSON.stringify(this.cache, null, 2), 'utf-8');
  }

  public clear(): void {
    this.cache = {
      version: CACHE_VERSION,
      files: {},
      templateHash: '',
      sidebarHash: ''
    };
    if (fs.existsSync(this.cacheDir)) {
      fs.removeSync(this.cacheDir);
    }
  }

  public computeFileHash(filePath: string): string {
    if (!fs.existsSync(filePath)) return '';
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  }

  public getFileCache(relativePath: string): FileCacheEntry | undefined {
    return this.cache.files[relativePath];
  }

  public setFileCache(relativePath: string, entry: FileCacheEntry): void {
    this.cache.files[relativePath] = entry;
  }

  public removeFileCache(relativePath: string): void {
    delete this.cache.files[relativePath];
  }

  public getTemplateHash(): string {
    return this.cache.templateHash;
  }

  public setTemplateHash(hash: string): void {
    this.cache.templateHash = hash;
  }

  public getSidebarHash(): string {
    return this.cache.sidebarHash;
  }

  public setSidebarHash(hash: string): void {
    this.cache.sidebarHash = hash;
  }

  public hasGlobalChanges(currentTemplateHash: string, currentSidebarHash: string): boolean {
    return this.cache.templateHash !== currentTemplateHash || 
           this.cache.sidebarHash !== currentSidebarHash;
  }

  public findFilesDependingOn(targetRelativePath: string): string[] {
    const dependents: string[] = [];
    
    for (const [filePath, entry] of Object.entries(this.cache.files)) {
      if (entry.includes && entry.includes.includes(targetRelativePath)) {
        dependents.push(filePath);
        const transitive = this.findFilesDependingOn(filePath);
        dependents.push(...transitive);
      }
    }

    return [...new Set(dependents)];
  }

  public getStaleFiles(currentHashes: Record<string, string>): string[] {
    const stale: string[] = [];

    for (const [filePath, currentHash] of Object.entries(currentHashes)) {
      const cached = this.cache.files[filePath];
      if (!cached || cached.hash !== currentHash) {
        stale.push(filePath);
      }
    }

    const allCurrentFiles = new Set(Object.keys(currentHashes));
    for (const cachedFile of Object.keys(this.cache.files)) {
      if (!allCurrentFiles.has(cachedFile)) {
        stale.push(cachedFile);
      }
    }

    return stale;
  }
}
