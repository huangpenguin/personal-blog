# PB NEXUS

基于 [Astro](https://astro.build/) 与 Fuwari 的个人研究笔记站点，使用原创日系夜读风主题，部署在 GitHub Pages。

网站地址：[huangpenguin.github.io/personal-blog](https://huangpenguin.github.io/personal-blog/)

## 架构

| 仓库 | 职责 |
| --- | --- |
| `huangpenguin/my-obsidian-vault` | Obsidian 笔记源库；日常在此编辑、提交和推送。 |
| `huangpenguin/personal-blog` | 公开博客站点、主题与已选中的文章副本。 |

笔记源库中的 GitHub Actions 会在 Markdown 文件推送到 `main` 时运行：仅复制文件头声明 `publish: true` 的笔记到本仓库的 `src/content/posts/`，随后由本仓库的 GitHub Pages 工作流构建并部署网站。

```text
Obsidian 笔记库 → 筛选 publish: true → personal-blog → GitHub Pages
```

## 发布一篇笔记

在笔记的第 1 行添加 YAML 文件头；脱敏和校对完成前请保持 `publish: false`：

```yaml
---
title: "文章标题"
tags: []
category: ""
published: "2026-07-31"
draft: false
publish: false
---
```

准备公开时，只需改为：

```yaml
publish: true
```

然后正常提交并推送笔记源库的 `main` 分支。工作流会自动同步和部署。

- `publish: false`：不会上传；已公开文章改回此值后，下次同步会撤下它。
- `draft: true`：会同步到博客仓库，但生产网站不显示；它不能替代 `publish: false`。
- 不要手动编辑 `src/content/posts/`：该目录由同步脚本生成。

## 本地开发

需要 Node.js 22 与 npm。

```bash
npm ci
npm run dev
```

常用命令：

```bash
npm run build       # 生成生产构建到 dist/
npm run sync:notes  # 从本地笔记库同步所有 publish: true 笔记
npm run publish:notes # 同步后构建
```

本地同步默认读取相邻的 Obsidian 笔记库；也可通过环境变量指定路径：

```bash
OBSIDIAN_VAULT_PATH="/你的/笔记库路径" npm run sync:notes
```

## 部署

推送本仓库 `main` 后，[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) 会使用 npm 构建 `dist/` 并部署到 GitHub Pages。

跨仓库同步工作流位于笔记源库的 `.github/workflows/publish-blog.yml`，它需要笔记源库的 `BLOG_REPO_TOKEN` Secret，且该 token 必须拥有 `personal-blog` 的 **Contents: Read and write** 权限。

## 许可

除另有说明外，博客文章采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 协议。主题基础来自 Fuwari。
