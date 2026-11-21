# AI 工作站 · ai-workstation

3D 虚拟办公室的代码库与事实来源。办公室里有 GPT、Claude、Gemini、Grok、Antigravity 五张工位，
显示各自的真实工作状态。

- **在线预览**：Muse 里的 AI 工作站（artifact `aigong-zuo-zhan`），走的是同一份规范。
- **这个仓库**：多 AI 共用的代码库。Antigravity 桌面端直接克隆、改代码、提交；
  Gemini 网页端直接读这里的文件给建议；Muse 负责合并、测试、同步回在线办公室。

## 本地运行

仓库根目录就是可独立运行的单页 Three.js 应用（`index.html` + `src/`），运行时读取
`config/models.json`。必须用 HTTP 服务打开，不能直接双击 `file://`：

```bash
python -m http.server 8000
# 打开 http://localhost:8000
```

检查清单：五张工位按 `config/models.json` 显示模型；桌牌清晰；Zone A 的 Antigravity 和
Gemini 头顶标签不重叠（默认视角、窄屏、旋转时）；文案是“状态快照（非持续同步）”。

## 多 AI 怎么分工

| AI | 在这里能做什么 |
| --- | --- |
| Muse | 合并各方改动、测试、同步回 Muse 办公室、维护 `config/models.json` |
| Antigravity（桌面端） | 克隆仓库，直接改代码，提交 PR 或直接推 main |
| Gemini（网页端） | 读仓库文件，给优化方案和代码，Muse 负责应用和测试 |
| Claude / Grok | 接入后同样走这个仓库 |

## 目录

- `index.html` — 办公室单页应用外壳（Atelier Braun 界面：抽屉 3 标签页、检查员卡片、对话页、⌘K 指令坞）
- `src/app.js` — Three.js 场景：剖面式制图室、三区布局、视角、点选工位、对话解析
- `src/labels.js` — 桌牌（单层 1024×384）与头顶标签，含 Zone A 错开方案
- `config/models.json` — 五个 AI 的模型配置（已验证的才写进去，未验证的留空）
- `docs/v6-design-spec.md` — 办公室 v6「Atelier Braun · 精密制图室」设计规范
- `docs/known-issues.md` — 已知问题和待办，第一项就是 Zone A 的名字重叠

## 规则

1. 模型列表只写在登录好的软件里亲眼验证过的，过期 14 天要重新核对。
2. 改动先在分支或 PR 里做，Muse 测过再合进 main。
3. 办公室里的聊天是办公室内部的，不是直连各家账号的真实会话。

## 当前状态（2026-11-21 已验证）

- GPT：Plus，默认 GPT-6（另有 GPT-5.6 Sol）
- Gemini：Google AI Ultra，默认 4 Neon（另有 自动、4 Hydrogen、4 Carbon）
- Antigravity：Google AI Ultra，默认 Gemini 4 Neon High（另有 7 个模型）
- Claude、Grok：还没登录，模型列表待核对
