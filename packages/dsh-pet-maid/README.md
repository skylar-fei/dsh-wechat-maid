# dsh-pet-maid — deepseek 娘桌宠插件

![version](https://img.shields.io/badge/version-0.1.0-4f8ef7) ![license](https://img.shields.io/badge/license-BSD--3--Clause-9b59b6) ![platform](https://img.shields.io/badge/platform-DSH%20Web-00c2a8) ![language](https://img.shields.io/badge/language-TypeScript-3178c6)

> 一只可爱的 deepseek 娘桌宠「牢梁」，陪你在 DeepSeek Harness 里工作。

模型思考的时候你在等，她在动。她会跟着模型的工作状态切换动画——干活、等待、思考、庆祝完成；你还可以摸头、喂糖果，看着她从初见慢慢长成你的心灵之约。

## 功能

| 功能 | 说明 |
|---|---|
| 状态动画 | 模型状态 → 桌宠动画：`thinking/tool → 工作`、`waiting → 等待`、`done → 跳跃庆祝`、空闲 `idle` 呼吸待机 |
| 摸头互动 | 点击桌宠 → 气泡反馈 + 亲密度 +1（10s 冷却） |
| 睡眠/惊醒 | 空闲 60 秒后打盹（闭眼呼吸），鼠标/键盘一动即惊醒 |
| 点击变体 | 单击=被摸、双击=戳（惊讶）、三下=生气、四下以上=甩手（慌张），各有独立逐帧反应动画与气泡 |
| 喂糖 | 悬浮面板「喂糖」→ 消耗 1 颗糖果 + 亲密度 +5（30s 冷却） |
| 糖果经济 | 糖果库存（上限 20）：工作每 3 回合 +1 颗、每 30 分钟 +1 颗；库存不足会提示「多陪牢梁工作一会儿」 |
| 亲密度 | 每完成一个回合 +1；4 个等级：初见 → 熟识 → 亲密 → 心灵之约（100 点封顶） |
| 自定义命名 | 悬浮面板「改名」→ 1–20 字符，持久化，召唤按钮/面板同步显示 |
| 拖动 | 按住桌宠拖动重新摆放，位置持久化 |
| 隐藏/召唤 | 悬浮面板「隐藏」；隐藏后输入选择行出现「召唤{名字}」按钮 |
| 状态气泡 | 工作时显示模型当前状态短语 |
| 主动搭话 | 空闲时随机冒一句关怀/提示（约 1.5–4 分钟一次） |
| 工作面板 | 悬浮面板「面板」按钮展示今日/累计任务、模型、tokens、缓存命中率、今日总结 |

## 素材

素材为 8 列 × 14 行图集（384×416 单元，3072×4160，透明背景，2 倍高清），程序化合成 9 态动画帧（呼吸 / 奔跑左右 / 挥手 / 跳跃 / 失败 / 等待 / 奔跑 / 复盘），呼吸/挥手/等待/复盘/睡眠用正反来回（ping-pong）补成 6 帧更顺滑。每行实际帧数与节奏在 `src/client/spritesheet.ts` 的 `TRACKS` 中定义，行序契约：0 idle / 1 running-right / 2 running-left / 3 waving / 4 jumping / 5 failed / 6 waiting / 7 running / 8 review。

角色形象为 deepseek 娘，来自 B 站 UP 主 @ZipZipPipe。

## 架构

```
dsh-pet-maid/
|-- src/
|   |-- index.ts        # host 半区：插件入口（cordis apply，注册路由）
|   |-- service.ts      # PetService：宠物状态机 + 亲密度 + 配置（HTTP API 服务面）
|   |-- state.ts        # 宠物状态机：activity/status phase → 9 状态动画
|   |-- affinity.ts     # 亲密度账本（纯函数 + 冷却）
|   |-- treats.ts       # 糖果库存账本
|   |-- persist.ts      # 持久化（$DSH_HOME/pet-maid.json，原子写入）
|   |-- routes.ts       # /api/pet-maid/* JSON API + /pet/maid/* 素材静态路由
|   `-- client/         # 浏览器半区
|       |-- index.ts    # slots 注册 + 轮询（800ms）+ 交互接线（fetch）
|       |-- PetDockEntry.tsx  # shell.overlay 挂载点
|       |-- MaidPet.tsx       # 浮层组件（portal + rAF 帧动画 + 拖动）
|       |-- spritesheet.ts    # 图集几何 + 每状态动画轨道（帧/时长）
|       `-- pet.module.css
|-- assets/maid/        # 桌宠素材（pet.json + spritesheet.png）
`-- cordis.patch.yml    # bundle patch：插入 pet-maid 插件行
```

### 数据流

```
activity/status session 事件 --> PetService（host）
                                  | /api/pet-maid/* JSON
shell.overlay 槽位  <-- 轮询 800ms -- pet-maid client（浏览器）
                                  |
                           MaidPet 浮层（portal + rAF）
```

- **状态源**：监听 `activity/status` 会话事件（phase: idle/waiting/thinking/tool/done + 状态短语）。
- **挂载点**：`shell.overlay`（list 槽位，全程挂载），组件内部 `createPortal` 渲染全局浮层。
- **渲染**：CSS sprite（background-position）逐帧动画，帧时长来自 `spritesheet.ts` 的轨道定义。
- **通信**：浏览器 ↔ host 走同源 `/api/pet-maid/*` JSON 端点（state/interact/set-visible/set-config/set-name），图集从 `/pet/maid/spritesheet.png` 加载。

## 安装

```sh
git clone https://github.com/skylar-fei/dsh-wechat-maid.git
cd dsh-wechat-maid
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-pet-maid
```

安装后**重启 `dsh web`**，桌宠出现在界面右下角即生效。link 模式下改代码后重新 `pnpm build` 并刷新页面即可，无需重装。

## 开发

```sh
pnpm build        # tsc -b（类型+声明）&& tsdown（node 半区 + 浏览器 bundle）
pnpm test         # vitest 单元测试（affinity / treats / persist / state）
pnpm prepare      # 仅转译构建（无类型检查，供消费者安装）
pnpm typecheck    # 仅类型检查
```

## License

[BSD-3-Clause](LICENSE)
