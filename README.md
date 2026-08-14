# dsh-wechat-maid

![version](https://img.shields.io/badge/version-0.1.0-4f8ef7) ![license](https://img.shields.io/badge/license-BSD--3--Clause-9b59b6) ![platform](https://img.shields.io/badge/platform-DSH%20Web-00c2a8) ![language](https://img.shields.io/badge/language-TypeScript-3178c6)

> 一个仓库，两个插件，三个能力：**微信机器人**、**主动消息 / 定时推送**、**深蓝女仆桌宠**。

## 这是什么

把三样东西放进同一个 GitHub 项目：

| 能力 | 插件 | 说明 |
|---|---|---|
| 微信 bot 连接 | [dsh-weixin](packages/dsh-weixin) | 微信个人号接入，走官方 ClawBot 接口；单聊双向对话，与 Web 共享同一 agent 会话与记忆 |
| 主动消息 | [dsh-weixin](packages/dsh-weixin) | agent 工具 `weixin_send` 随时推送到微信；内置 cron 定时任务（存 `~/.dsh/dsh-weixin-tasks.json`），到点唤醒 agent 干活后把结果推到微信 |
| 深蓝女仆桌宠 | [dsh-pet-maid](packages/dsh-pet-maid) | 跟随模型状态切换动画的治愈系桌宠，摸头 / 喂糖 / 亲密度 / 糖果经济 / 拖动 / 隐藏召唤 |

三个能力本质是**两个插件**，它们已经在运行时联动起来，不是从零打通。

## 联动

两个插件通过 DSH 宿主运行时 + 共享 JSON 文件协作，互不 npm 依赖：

- `dsh-weixin` 用 `ctx.provide('weixin', { sendMessage, status })` 把主动消息能力暴露给兄弟插件。
- `dsh-pet-maid` 的 **auto-coding 模式**每回合结束调 `ctx.weixin.sendMessage` 给微信发提醒（「模型已响应，请继续对话」）。
- `dsh-pet-maid` 直接读 `dsh-weixin` 的定时任务文件 `~/.dsh/dsh-weixin-tasks.json`，在桌宠面板展示「即将执行 / 今日已执行」的定时任务。

```
微信发消息 --> dsh-weixin bridge --> 共享 agent 会话 <-- Web GUI
                    |                        |
                    | ctx.provide('weixin')  | activity/status 事件
                    v                        v
             主动消息/定时任务            dsh-pet-maid 桌宠
                    |                        |
                    +------- 共享 JSON ------+  桌宠面板显示定时任务
                                            +  auto-coding 每回合推微信
```

## 仓库结构

```
dsh-wechat-maid/
|-- packages/
|   |-- dsh-weixin/       # 微信机器人 + 主动消息 + 定时任务
|   |-- dsh-pet-maid/     # 深蓝女仆桌宠
|-- shared/               # 共享构建预设（tsdown.client.ts + web-platform.ts）
|-- pnpm-workspace.yaml
|-- package.json
|-- .npmrc                # 仅 scope 映射，token 放用户级 ~/.npmrc
|-- LICENSE
`-- README.md
```

## 安装

两个插件都通过官方插件机制挂载（`cordis.patch.yml` + profile 机制），不改 DSH 源码。

```sh
git clone https://github.com/<you>/dsh-wechat-maid.git
cd dsh-wechat-maid
pnpm install && pnpm -r build

dsh plugin --profile web add link:$(pwd)/packages/dsh-weixin
dsh plugin --profile web add link:$(pwd)/packages/dsh-pet-maid
dsh web
```

## 使用

1. 侧边栏点「微信」，点「连接」，在运行 `dsh web` 的终端扫码完成登录。
2. 在微信里给机器人发消息即可对话；agent 可在任意时刻用 `weixin_send` 主动推送。
3. 桌宠出现在界面右下角，随模型状态切换动画；悬浮面板可摸头 / 喂糖 / 改名 / 查看工作面板与微信定时任务。
4. 在桌宠面板或设置里打开 auto-coding，每回合结束自动给微信发提醒。

## 限制

- 主动推送需最近约 24 小时内收到过至少一条微信消息（微信平台 context_token 限制）。
- 首次连接需在运行 `dsh web` 的终端扫码（二维码不在网页内渲染）。
- 定时主动消息依赖 `dsh web` 进程常驻。
- 微信登录态、定时任务、桌宠数据都存在用户主目录（`~/.openclaw`、`~/.dsh`），不进本仓库。

## 开发

```sh
pnpm -r build       # 编译两个插件（node 半区 + 浏览器 bundle）
pnpm -r test        # vitest 单元测试
pnpm -r typecheck   # 类型检查
```

## License

[BSD-3-Clause](LICENSE)

素材说明：`dsh-pet-maid/assets/maid/spritesheet.png` 的角色底图由通义万相（qwen-image）生成后程序化合成，公开发布前请确认该素材的授权允许对外分发。
