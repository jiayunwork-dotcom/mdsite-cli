export function segmentChinese(text: string): string[] {
  const tokens: string[] = [];
  
  const regex = /[\u4e00-\u9fa5]+|[a-zA-Z0-9]+|[\p{P}\p{S}]+|\s+/gu;
  const matches = text.match(regex) || [];
  
  for (const match of matches) {
    if (/^[\u4e00-\u9fa5]+$/.test(match)) {
      tokens.push(...segmentChineseChars(match));
    } else if (/^[a-zA-Z0-9]+$/.test(match)) {
      tokens.push(match.toLowerCase());
      tokens.push(...splitCamelCase(match));
    } else if (/^[\s]+$/.test(match)) {
    } else {
      tokens.push(match);
    }
  }
  
  return tokens.filter(t => t.length > 0);
}

function segmentChineseChars(text: string): string[] {
  const tokens: string[] = [];
  const n = text.length;
  
  const commonWords = loadCommonWords();
  
  let i = 0;
  while (i < n) {
    let matched = false;
    for (let len = Math.min(4, n - i); len >= 2; len--) {
      const candidate = text.slice(i, i + len);
      if (commonWords.has(candidate)) {
        tokens.push(candidate);
        i += len;
        matched = true;
        break;
      }
    }
    
    if (!matched) {
      tokens.push(text[i]);
      i++;
    }
  }
  
  for (let i = 0; i < text.length - 1; i++) {
    tokens.push(text.slice(i, i + 2));
  }
  for (let i = 0; i < text.length - 2; i++) {
    tokens.push(text.slice(i, i + 3));
  }
  
  return tokens;
}

function splitCamelCase(word: string): string[] {
  const result: string[] = [];
  const parts = word
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .split(/[_-]/);
  
  for (const part of parts) {
    if (part.length > 1) {
      result.push(part.toLowerCase());
    }
  }
  
  return result;
}

function loadCommonWords(): Set<string> {
  return new Set([
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
    '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看',
    '好', '自己', '这', '他', '她', '它', '那', '被', '从', '但', '而', '与',
    '或', '如果', '因为', '所以', '虽然', '但是', '可以', '可能', '应该',
    '使用', '方法', '函数', '代码', '文件', '项目', '配置', '参数', '属性',
    '返回', '执行', '创建', '删除', '更新', '添加', '获取', '设置', '查询',
    '搜索', '文档', '内容', '页面', '站点', '模板', '目录', '链接', '标题',
    '安装', '配置', '部署', '启动', '停止', '运行', '测试', '开发', '生产',
    '错误', '异常', '警告', '信息', '数据', '接口', '请求', '响应', '服务',
    '应用', '程序', '模块', '组件', '实例', '对象', '数组', '字符串', '数字',
    '类型', '变量', '常量', '循环', '条件', '判断', '分支', '递归', '遍历'
  ]);
}

export function simpleSegment(text: string): string[] {
  const result: string[] = [];
  
  text = text.toLowerCase();
  
  const chineseRegex = /[\u4e00-\u9fa5]/g;
  const englishWords = text.replace(/[\u4e00-\u9fa5]/g, ' ').split(/[\s,.;:!?()\[\]{}<>"'`~@#$%^&*|\\/+=_-]+/).filter(w => w.length > 0);
  result.push(...englishWords);
  
  const chineseChars = text.match(chineseRegex) || [];
  result.push(...chineseChars);
  
  for (let i = 0; i < chineseChars.length - 1; i++) {
    result.push(chineseChars[i] + chineseChars[i + 1]);
  }
  
  return [...new Set(result)];
}

export function highlightText(text: string, keyword: string, maxLength: number = 200): string {
  if (!keyword || !text) return text.slice(0, maxLength);
  
  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  
  let startIndex = lowerText.indexOf(lowerKeyword);
  
  if (startIndex === -1) {
    for (let i = 0; i < text.length; i++) {
      if (/[\u4e00-\u9fa5]/.test(text[i])) {
        for (let j = 0; j < keyword.length; j++) {
          if (lowerText.includes(keyword[j].toLowerCase())) {
            startIndex = lowerText.indexOf(keyword[j].toLowerCase());
            break;
          }
        }
        if (startIndex !== -1) break;
      }
    }
  }
  
  if (startIndex === -1) {
    return text.slice(0, maxLength) + (text.length > maxLength ? '...' : '');
  }
  
  const halfLength = Math.floor(maxLength / 2);
  let contextStart = Math.max(0, startIndex - halfLength);
  let contextEnd = Math.min(text.length, startIndex + keyword.length + halfLength);
  
  let result = '';
  if (contextStart > 0) result += '...';
  
  const context = text.slice(contextStart, contextEnd);
  result += context;
  
  if (contextEnd < text.length) result += '...';
  
  return result;
}

export function highlightKeywords(text: string, keywords: string[]): string {
  if (!keywords || keywords.length === 0) return text;
  
  let result = text;
  
  for (const keyword of keywords.filter(k => k.length > 0)) {
    const regex = new RegExp(`(${escapeRegExp(keyword)})`, 'gi');
    result = result.replace(regex, '<mark>$1</mark>');
  }
  
  return result;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
