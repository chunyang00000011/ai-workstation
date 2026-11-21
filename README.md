# AI 工作站 · ai-workstation

3D 虚拟办公室的代码库与事实来源。办公室里有 **GPT 网页版**、**Codex**、**Claude**、**Gemini**、**Grok**、**Antigravity** 六张工位，并有一位巡逻的 **3D 宇航员奶龙老板**。

- **在线预览**：Muse 里的 AI 工作站（artifact `aigong-zuo-zhan`），走的是同一份规范。
- **这个仓库**：多 AI 共用的代码库。Antigravity 桌面端直接克隆、改代码、提交；
  Gemini 网页端直接读这里的文件给建议；Muse 负责合并、测试、同步回在线办公室。

## 本地运行

### 方式一：本地桥接模式（推荐，可直连本机 Codex CLI 真实对话与状态）

```bash
python server.py
# 打开 http://localhost:8000
```

`server.py` 仅监听 `127.0.0.1:8000`，会读取 `~/.codex` 中的模型默认配置与最近会话摘要，并允许在对话弹窗中通过 `codex exec --sandbox read-only --ephemeral` 与本机已登录的 Codex 进行真实对话；其它工位仍为办公室内部模拟对话。

### 方式二：纯静态快照模式（兼容任意静态服务器）

```bash
python -m http.server 8000
# 打开 http://localhost:8000
```

检查清单：六张工位按 `config/models.json` 显示模型（GPT 网页版与 Codex 分开）；桌牌清晰；Zone A 的 Antigravity 和
Gemini 头顶标签不重叠（默认视角、窄屏、旋转时）；文案是“状态快照（非持续同步）”。

## 多 AI 怎么分工

| AI | 在这里能做什么 |
| --- | --- |
| Muse | 合并各方改动、测试、同步回 Muse 办公室、维护 `config/models.json` |
| Antigravity（桌面端） | 克隆仓库，直接改代码，提交 PR 或直接推 main |
| Gemini（网页端） | 读仓库文件，给优化方案和代码，Muse 负责应用和测试 |
| Codex（本机 CLI / 桌面端） | 已通过 `server.py` 接入只读桥接，可在工作站内直连对话 |
| Claude / Grok | 接入后同样走这个仓库 |

## 目录

- `index.html` — 办公室单页应用外壳（Atelier Braun 界面：抽屉 3 标签页、检查员卡片、对话页、⌘K 指令坞）
- `server.py` — 本地 Codex CLI 只读桥接与静态服务器（`/api/codex/status`、`/api/codex/chat`）
- `src/app.js` — Three.js 场景：剖面式制图室（旋转自动降矮切墙）、三区六工位布局、视角、点选工位、对话解析
- `src/boss.js` — 巡逻 3D 宇航员奶龙老板模型与巡视状态机
- `src/labels.js` — 桌牌（单层 1024×384）与头顶标签，含 Zone A / Zone B 错开防重叠方案
- `config/models.json` — 六个 AI 的模型配置（已验证的才写进去，未验证的留空）
- `docs/v6-design-spec.md` — 办公室 v6「Atelier Braun · 精密制图室」设计规范
- `docs/known-issues.md` — 已知问题和待办

## 规则

1. 模型列表只写在登录好的软件里亲眼验证过的，过期 14 天要重新核对。
2. 改动先在分支或 PR 里做，Muse 测过再合进 main。
3. 除通过 `server.py` 实连的本机 Codex CLI 外，其余工位聊天均为办公室内部模拟，不是直连各家网页账号的真实会话。

## 当前状态（2026-11-21 已验证）

- GPT 网页版：Plus，默认 GPT-6（另有 GPT-5.6 Sol）
- Codex：Plus / Codex CLI，默认 GPT-6.2-Sol / High（另有 9 个已缓存模型，可本地桥接实连）
- Gemini：Google AI Ultra，默认 4 Neon（另有 自动、4 Hydrogen、4 Carbon）
- Antigravity：Google AI Ultra，默认 Gemini 4 Neon High（另有 7 个模型）
- Claude、Grok：还没登录，模型列表待核对
