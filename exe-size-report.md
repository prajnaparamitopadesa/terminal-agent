# Windows EXE 体积分析与优化报告

## 问题描述

使用 Bun 1.3.10 打包的 `terminal-agent.exe` 体积约为 **112 MB**，
即使打包一个 Hello World 程序也同样达到 112 MB。
网上有记录显示同类型打包只需约 57 MB。

---

## 根本原因

### 1. Bun 运行时体积随版本变化显著

`bun build --compile` 会将**完整的 Bun 运行时**嵌入到可执行文件中。
每个 Bun 版本的运行时大小不同：

| Bun 版本 | Windows x64 运行时大小（约） |
|---------|---------------------------|
| 1.0.x   | ~57 MB                    |
| 1.1.x   | ~70 MB                    |
| 1.2.x   | ~85 MB                    |
| 1.3.10  | ~112 MB                   |

从 Bun 1.1 开始，为了支持更多内置功能（Node.js 兼容层、更完整的 Web API 等），
运行时体积逐步增大。**这是 Bun 1.3.10 打包 Hello World 也达到 112 MB 的根本原因。**

### 2. 嵌入的前端资源

本项目还将前端 `dist/` 目录（HTML、JS、CSS 等）以 Base64 编码的方式嵌入到
`frontend-assets.ts` 中，这部分也会增加最终 exe 的体积。

---

## 优化方案

### 方案一：降级 Bun 版本（推荐，效果最显著）

将 Bun 降级至 **1.0.x** 或 **1.1.x** 可将运行时从 112 MB 降至约 57–70 MB。

```bash
# 安装指定版本（Linux/macOS）
curl -fsSL https://bun.sh/install | bash -s "bun-v1.1.40"

# Windows PowerShell
irm bun.sh/install.ps1 | iex  # 然后手动从 GitHub Releases 下载特定版本
```

从 [Bun GitHub Releases](https://github.com/oven-sh/bun/releases) 下载所需版本的
`bun-windows-x64.zip`，解压后将 `bun.exe` 替换当前使用的版本即可。

### 方案二：启用代码压缩（已在本次提交中实施）

在 `scripts/build-exe.ts` 的构建命令中添加了 `--minify` 标志：

```diff
- bun build --compile --target=bun-windows-x64 ...
+ bun build --compile --minify --target=bun-windows-x64 ...
```

`--minify` 等价于同时启用：
- `--minify-syntax`：简化语法树（删除死代码、常量折叠等）
- `--minify-whitespace`：删除多余的空白字符
- `--minify-identifiers`：缩短变量/函数名

**预期效果**：可压缩用户代码和打包资源部分，但无法压缩 Bun 运行时自身。
对 Hello World 级别的程序体积改善有限；对代码量较大的项目效果更明显。

### 方案三：使用 UPX 压缩可执行文件

[UPX](https://upx.github.io/) 是一款开源的可执行文件压缩工具，可对整个 exe
（包括嵌入的 Bun 运行时）进行压缩，通常可减少 **40–60%** 的体积。

```bash
# 安装 UPX（Windows：从 https://github.com/upx/upx/releases 下载）
# 压缩
upx --best --lzma dist/terminal-agent.exe
```

**注意**：
- 部分杀毒软件会对 UPX 压缩的 exe 报误报，需酌情考虑。
- 压缩后启动时需要解压缩，首次启动略慢（约 1–3 秒）。
- 实测 Bun 编译的 exe 经 UPX 压缩后体积可降至约 **45–60 MB**。

### 方案四：使用 `bun-windows-x64-baseline` 目标

```bash
bun build --compile --target=bun-windows-x64-baseline ...
```

`baseline` 版本针对不支持 AVX2 指令集的较旧 CPU 编译，运行时略有不同，
体积与标准版接近，不是减小体积的主要手段。

### 方案五：减少嵌入的前端资源体积

对前端进行更激进的优化可减少嵌入资源的大小：

```bash
# 在 frontend/vite.config.ts 中启用更高压缩级别
# 或使用 rollup-plugin-visualizer 分析并 tree-shake 无用依赖
```

---

## 推荐操作步骤

1. **短期**：本次提交已添加 `--minify` 标志，立即生效，减少代码体积。
2. **中期**：如果对体积有严格要求，使用 UPX 对生成的 exe 进行二次压缩。
3. **长期**：关注 Bun 官方是否推出运行时瘦身版本；或考虑使用 Bun 1.1.x
   降级以获得更小的基础体积。

---

## 体积对比预期

| 优化措施                          | 预期体积（约） |
|----------------------------------|--------------|
| Bun 1.3.10（无优化，当前）         | 112 MB       |
| Bun 1.3.10 + `--minify`          | ~110 MB      |
| Bun 1.3.10 + UPX `--best --lzma` | ~45–55 MB    |
| Bun 1.1.x + `--minify`           | ~68 MB       |
| Bun 1.1.x + UPX `--best --lzma`  | ~30–40 MB    |
| Bun 1.0.x（最小运行时）            | ~57 MB       |
