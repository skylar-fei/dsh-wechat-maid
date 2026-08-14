# dsh-weixin

微信个人号接入 DSH Web GUI 的插件：通过微信官方 ClawBot 接口，实现 (1) 微信端单聊双向对话（与 Web 共享同一 agent 会话与记忆）和 (2) 主动定时消息（配合内核 schedule_create，到点唤醒 agent 干活后把结果推到微信）。

## 能力

- 单聊双向对话：在微信发消息 -> agent 处理 -> 回复到微信；微信与 Web 共享同一个 agent 会话（session id 固定为 dsh-weixin-main，也出现在 Web 会话列表里）。
- 主动消息：agent 工具 weixin_send 随时把消息推到用户微信。
- 定时消息：复用 DSH 内核 schedule_create（at 定点 / after 延迟 / every 周期），到点 agent 醒来执行任务后调用 weixin_send 汇报。
- 连接管理：侧边栏「微信」面板查看状态、扫码登录、断开。

## 底层

- 微信接入走官方 ClawBot 接口，依赖 npm 包 weixin-agent-sdk（login 扫码 + start 长轮询 + sendMessage 主动发送）。
- DSH 侧只依赖官方 @deepseek-ai/* SDK（cordis / dsh-tools / dsh-session / dsh-llm / dsh-agent / dsh-settings / dsh-system-prompt / dsh-host-webserver），不改 DSH 源码。

## 安装

与其他 dsh-web-ui 插件一致，link: 安装后重启 dsh web：

```sh
dsh plugin --profile web add link:$(pwd)/packages/dsh-weixin
dsh web
```

## 使用

1. 侧边栏点「微信」，点「连接」。
2. 二维码打印在运行 dsh web 的终端，用微信扫码完成登录。
3. 在微信里给机器人发消息即可对话；agent 可在任意时刻用 weixin_send 主动推送。

## 限制

- 主动推送需最近约 24 小时内收到过至少一条微信消息（微信平台 context_token 限制）。
- 首次连接需在运行 dsh web 的终端扫码（二维码不在网页内渲染）。
- 定时主动消息依赖 DSH 进程常驻（dsh web 在跑）。
