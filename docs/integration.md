# 桌宠与微信的联动

`dsh-weixin` 和 `dsh-pet-maid` 是两个独立插件，互不 npm 依赖。它们通过 DSH 宿主运行时和一份共享 JSON 文件协作。

## 集成点一：运行时上下文 `ctx.weixin`

`dsh-weixin/src/index.ts` 在插件挂载时把主动消息能力暴露给兄弟插件：

```ts
ctx.provide('weixin', {
  sendMessage: (text: string) => engine.sendMessage(text),
  status: () => engine.status(),
})
```

`dsh-pet-maid/src/service.ts` 通过 cordis 的模块扩充声明消费它：

```ts
interface WeixinNotify { sendMessage(text: string): Promise<{ ok: boolean; error?: string }> }
declare module '@deepseek-ai/cordis' {
  interface Context { pet: PetService; weixin?: WeixinNotify }
}
```

桌宠的 auto-coding 模式在每回合完成后调用 `ctx.weixin.sendMessage('模型已响应，请继续对话')`。

## 集成点二：共享定时任务文件

`dsh-weixin` 把定时任务持久化到 `~/.dsh/dsh-weixin-tasks.json`。

`dsh-pet-maid/src/weixin-tasks.ts` 直接读取该文件（缺失或损坏时安全降级为空列表），
并用一个最小 cron 解析器计算出下次执行时间，在桌宠面板展示「即将执行 / 今日已执行」两组任务。

## 解耦约束

- 桌宠对微信是**可选依赖**：即使不装 `dsh-weixin`，桌宠照常工作，仅任务面板为空、auto-coding 不生效。
- 微信对桌宠**零依赖**：不装桌宠，微信机器人与主动消息完全正常。
- 两者之间的唯一“契约”是文件名 `dsh-weixin-tasks.json` 和 cordis 上下文键 `weixin`，改任意一侧都要同步另一侧。
