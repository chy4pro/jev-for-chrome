import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const readRepositoryFile = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const sectionBetween = (markdown: string, heading: string, nextHeading: string) => {
  const start = markdown.indexOf(`${heading}\n`);
  const end = markdown.indexOf(`\n${nextHeading}`, start + heading.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return markdown.slice(start, end);
};

describe('extension installation docs', () => {
  it('distinguishes the loadable release asset from GitHub source archives', () => {
    const english = sectionBetween(readRepositoryFile('README.md'), '## Install', '## Configure');
    const chinese = sectionBetween(readRepositoryFile('README_CN.md'), '## 安装', '## 配置');

    expect(english).toContain('`jev-for-chrome-<version>.zip`');
    expect(english).toMatch(/Source code/);
    expect(english).toMatch(/top level[^\n]*`manifest\.json`|`manifest\.json`[^\n]*top level/);
    expect(chinese).toContain('`jev-for-chrome-<版本>.zip`');
    expect(chinese).toMatch(/源码压缩包/);
    expect(chinese).toMatch(/顶层[^\n]*`manifest\.json`|`manifest\.json`[^\n]*顶层/);
  });
});
