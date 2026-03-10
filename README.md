# 铁墓Agent(Terminal Agent) - 让 AI 帮你操作 SSH 终端

铁墓 音似 term, 令人忍俊不禁

这是一个本地运行的 AI SSH 助手。

可用于自动安装软件、维护服务器。

GitHub 地址：https://github.com/zelixir/terminal-agent

温馨提示，安全起见最好使用本地部署的大模型，或使用你自己可控的 OpenAI 兼容接口。

## 1. 为什么不使用 chaterm

1. chaterm 会连接其服务端，但ssh相关的应用总是对安全很敏感。
2. 虽然它开源，但真要放心使用仍然需要自己审代码和依赖。
3. 即使屏蔽相关域名，你也没办法100%安心。
4. 自己做可以更方便地做各种定制。
5. ~~我还是喜欢零手工纯AI开发的软件~~

## 2. 怎么用

### 2.1. 开发模式

先安装依赖：

```bash
bun run install:all
```

启动前后端开发环境：

```bash
bun run dev
```

默认会启动前后端服务，之后在浏览器中访问即可。

### 2.2. 基本使用流程


1. 添加 AI 服务商，填入 OpenAI 兼容的 base URL 和 API key
2. 添加模型
3. 添加 SSH 服务器信息
4. 打开连接页，输入密码
5. 在右侧聊天框里直接说人话，例如“看看 CPU 和内存情况”“帮我查 nginx 为什么没起来”

命令如果不在自动审批规则里，会先停下来等待确认。

### 2.3. 打包 exe

如果你想要单文件 Windows 可执行程序：

```bash
bun run build:exe
```

目前的bun版本(1.3.10)下未压缩体积约一百一十多 MB，压缩后约二十几 MB。

## 3. 这项目的成本

1. 使用 GitHub Copilot、Claude Sonnet 4.6，共计约 24 次 agent 调用，部分 agent 有多轮对话，合计大约花掉了月额度的 15%(算上写这篇文章)。
2. 如果按平均一次 agent 花 15 分钟人力来算，包括写提示词和测试，整体大约投入了 8 小时人力。

## 4. 技术栈

bun + elysia + sqlite + react + vite + tailwindcss + ai-sdk

- Web UI 在浏览器里访问，因此不需要electron
- 数据全部在本地, 不会连接大模型以外的服务器
