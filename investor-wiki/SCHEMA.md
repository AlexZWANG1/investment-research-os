# Thinking Engine — Schema

## 这个系统是什么

一个帮 Alex 做投资决策的思考库。不是笔记系统，不是百科全书。

它做两件事：**从海量材料里提炼出少量可交易的判断**，和**追踪这些判断的证据链和矛盾**。

Karpathy 的 LLM Wiki 解决了"知识积累"问题 — 你读过的东西不会丢。但我们要解决的是下一个问题：**积累之后，哪些是真正改变你仓位的信息？**

---

## 架构

```
raw/                    # 原始材料（只读，qmd 全量索引）
wiki/                   # LLM 编译层
  ├── ENVISION.md       # Alex 的判断（只 Alex 写）
  ├── _nav.md           # Signal 导航（wikilink 列表）
  ├── _log.md           # 操作日志
  ├── dashboard.html    # Dashboard（浏览器打开，obsidian:// 跳转）
  ├── sources/          # 事实与观点提炼
  └── signal/          # 可交易判断
workspace/              # 临时研究产出
```

**为什么只有 sources/ 和 signal/ 两层？**

以前有 tickers/ funds/ shorts/ 等专门目录。但"Sequoia 持有 GOOGL 8.2%"本质上和"Dana Groff 说 customer in debit state"一样 — 都是一个事实。它们都应该是 source，被 signal 引用。专门的目录只增加了分类成本，没增加分析价值。

---

## ENVISION.md

**为什么需要这个文件？**

LLM 不知道什么对你重要。没有这个锚，它会平均分配注意力 — 给一条无关新闻和一条关键 earnings 数据同等的编制力度。ENVISION 告诉系统"我现在关心什么"，系统的所有行为围绕这个走。

**谁写？** 只有 Alex。LLM 可以读、引用、挑战，但永不修改。

**内容**：

- **Beliefs** — 你当前相信什么，每条带 conviction（0-100）和 flip condition
- **Questions** — 你在找什么答案，每条带 deadline
- **Hunt List** — 具体在找的数据点

**为什么 Beliefs 要带 Flip Condition？**

因为投资判断不是对错二元的。"GOOGL 多头"在 Cloud 增速 25% 的世界里成立，在 Cloud 增速 15% 的世界里可能不成立。写下 flip condition 迫使你在建仓时就想清楚"什么会让我改主意"，而不是被套之后才想。

---

## Source 页

### 角色

Source 是 wiki 的"阅读者"。它读一份原始材料，提炼出事实和观点，标注可信度，然后放到合适的 signal 旁边。

**为什么要区分 Facts 和 Views？**

因为"TSMC 产能满载到 2028"和"Dana 认为 75% 毛利率可持续 3-4 年"是完全不同的信息。前者是客观事实，可以被 TSMC 财报验证或推翻。后者是一个人的判断，它的价值取决于这个人的经验和可能的 bias。如果你把 Dana 的判断写成事实，你会过度依赖一个可能有 positive bias 的前员工意见。

**为什么要有 Gaps 段？**

情报分析里最危险的不是错误信息，是**缺失信息**。Dana 详细讨论了 demand 但没提 AMD 竞争威胁 — 这个沉默本身是信号。可能 AMD 确实不构成威胁，也可能他作为前 NVDA 员工有盲区。记录"他没说什么"和记录"他说了什么"同样重要。CIA 的 Heuer 叫这个 "the dog that didn't bark"。

### 格式

```yaml
---
type: source
date: YYYY-MM-DD
who: 人名（身份）
firm: 机构
kind: expert-call | fund-letter | sell-side | memo | news
credibility: high | medium | low
raw: 文件名.md
relations:
  - target: signal-slug
    type: supports | contradicts | tensions
---
```

```markdown
# {谁} — {主题}

## Facts（客观事实，可独立验证）
- 事实 → 含义

## Views（主观判断，标 [谁]）
- [人名] "引用" → 含义

## Gaps（这个人没说什么？— 高价值一手源必填）
- 没讨论 X → 可能的原因

## Credibility Notes
- 为什么给这个 credibility 等级
```

### 限制

- **Facts ≤10 条，Views ≤5 条** — 不是行数限制，是条目数限制。一条 fact 可能需要 2-3 行写清上下文，这没问题。但超过 10+5 条说明你在搬运不在提炼。
- **不漏不重** — 同一个 fact/view 在整个 wiki 里只出现一次。如果 Dana 和 Steve 说了同一件事，只在一个 source 里写，另一个 source 里标"与 [[source-xxx]] 一致"。

### Credibility 判定

| 等级 | 条件 | 例子 |
|---|---|---|
| **high** | 一手经验 + 无明显利益冲突 | 前员工谈前雇主技术 / 直接客户谈供应商 / Hindenburg/MW 做空 |
| **medium** | 二手分析或有潜在 bias 的一手 | sell-side 报告 / 前员工谈前雇主估值 / Bear Cave/Spruce Point 做空 |
| **low** | 传闻 / 社交媒体 / 未署名 | 小红书帖子 / 匿名论坛 |

**每个 source 必须有 credibility 和 kind 字段。** 没有这两个字段的 source = 无法评估信息质量 = 垃圾进垃圾出。建 source 页时当场填，不要事后补。

### 孤立 Source 治理

批量导入的 source（如做空报告集合）如果不被任何 active signal 的 `## 证据` 或 `## 反方` 引用，就是**孤立 source**。孤立 source 不删除（留在 qmd 索引里可搜索），但不应占用维护精力。定期审计（workspace/short-report-audit.md）标注连接状态。

### 什么值得建 source 页

**核心判断**：这份材料有没有 wiki 里还没有的具体数字或具体事实？有 → 建。没有 → 留在 qmd 索引里。

| 材料类型 | 一般建不建 | 为什么 |
|---|---|---|
| Tegus / Third Bridge 专家访谈 | **建** | 一手独家，市场看不到 |
| 基金 Q 信件核心判断 | **建** | 顶级投资者的独立判断有价值 |
| webclipper 纪要 / 深度文章 | **视内容** | 有独立 view 或独家 fact 就建 |
| sell-side 研报 | **一般不建** | qmd 能搜到就行，除非有独家数据 |
| 日常新闻 | **不建** | 噪音 |

---

## Signal 页

### 角色

Signal 是一篇投资备忘录。**像一个基本面分析师写给自己的 PM 看的。**

不是主题百科。不是材料拼接。不是模板填表。是你坐下来想清楚一件事之后写出来的判断——为什么市场错了，怎么赚钱，什么会让你认错。

如果写完一个 signal 但说不出"long 什么 / short 什么"，它还不是 signal，只是一个有趣的观察。

### Frontmatter

```yaml
---
type: signal
name: slug-name
status: active | watching | archived
conviction: 0-100
last_verified: YYYY-MM-DD
deadline: YYYY-MM-DD   # 下一个真实催化剂（earnings / 政策节点），不要用默认值
tags: [...]
---
```

Conviction 独立评估。如果 4 个 signal 的 conviction 都是 75，说明在偷懒。Watching 也要有 conviction（15-55），表示离升级多远。

### 唯一硬要求：四个问题

**一篇好的 signal 必须回答四个问题。** 怎么组织、用什么格式、写多长、分几段——随便。但四个问题必须有答案：

1. **到底发生了什么？（机制）** — 不是"A 导致 B"。是 **为什么** A 导致 B，什么条件下不导致，因果链条走到底。像物理学家拆一个系统，不是像记者报道一个事件。
2. **市场为什么错了？（预期差）** — 共识是什么，你和共识差在哪，这个差距值多少钱。没有预期差的 signal = 市场已经定价的共识 = 不是 alpha。
3. **怎么赚钱？（Position）** — 具体标的、方向、为什么是这个不是那个。
4. **什么会让你认错？（Kill）** — 具体、可观察、有时间窗。不是"风险包括..."的风险清单。是"如果 X 在 Y 之前发生，我就认错止损"。

### 写作：像 PM 在想事情，不像分析师在交作业

**标题**是一句判断。读标题就知道 long 还是 short。不用 slug、不用问句、不两头都说。

- ❌ "软件护城河到底在哪一层？"
- ✅ "AI 只杀简单 SaaS，复杂工作流护城河反而加深"
- ✅ "不管谁赢模型战争，Google 都在卖军火"

**正文**是一篇连贯的分析文章——Stratechery 风格。不是 bullet point 堆砌，不是表格矩阵。每一段都在推进一个论点，每一段结尾读者都知道"so what"。

**反方不单独列，编织进叙事。** "Chancellor 认为这是 malinvest，但他的时间尺度是 5 年，而 Dana 说的是 12 个月内的订单——两个人都没错，矛盾在 scope。" 这比"## 反方：Chancellor 说..."有意义得多。

**引用原文**，不转述。引用是证据，让读者可以追溯。但引用为论点服务，不是为篇幅服务。

**中英文自然混合**。术语保留英文，解释用中文。

### 第一性原理思维

Signal 的质量不看有多少个 section，看思考到了哪一层。

**表层**："AI capex 增长 → 物理基础设施受益。" ← 这是新闻标题。

**机制层**："capex 一旦转化为 TSMC 的 wafer start 和 GEV 的 gas turbine 订单，就变成了 12-18 个月的物理交付周期，不可逆转。即使 demand 转弱，$150B backlog 不会取消。这和 SaaS 订阅可以下个月取消是本质不同。" ← 这是分析。

**反事实层**："如果这个判断完全错了，最可能的故事是什么？不是列 risk factors，是构建一个完整的反面叙事——哪些事件序列会让今天的证据在回头看时全是确认偏误？" ← 这是压力测试。

好的 signal 自然会涉及预期差、时间线、跨 signal 传导——因为一个认真思考的 PM 必然会想这些。但它们出现是因为思考到了那里，不是因为模板要求填。

### 思考纪律（不是格式纪律）

以下不是"必须有的 section"，是**写的时候问自己的问题**。如果答案自然融入了正文就不需要单独列出来：

- **我的判断依赖什么假设？** 几个看似独立的 signal 是否共享同一个假设（比如"Fed 不降息"）？如果是，你的仓位集中度比表面高得多。
- **时间对不对？** 同样的判断，early 6 个月和 late 6 个月是完全不同的 P&L。下一个验证窗口是什么？
- **谁在说反话？为什么？** 矛盾不是所有都一样严重。区分三种：scope（时间/条件不同导致的差异）、data（同一变量相反数字，硬矛盾）、framework（不同分析框架，需要判断哪个更适用）。
- **什么没人说？** "没有人讨论 X"有时比"所有人讨论 Y"更重要。

### 自主深挖

不等 Alex 要求。以下任一满足就**主动**做：

1. 某 signal 证据 ≥15 但反方 < 2 → **确认偏误警报**，必须搜反面
2. Deadline 30 天内 → 用最新数据更新
3. 两个 signal 的 positions 互相矛盾 → 必须解决或明确标注
4. Active signal 超过 14 天没碰 → 至少更新 last_verified

**搜索 bias 警示**：搜完 bear case 后，**必须用对称的 bull 关键词再搜一次**。信息输入的 bias 会变成判断的 bias。

**三角验证**：3+ 独立 source（不同人、不同机构、不同方法论）通过不同推理路径得出同一结论时，在文中标注。这种结论不依赖任何单一 source 的 credibility。

### Signal 数量控制

**Active 上限 15 个。为什么？**

因为人脑同时跟踪的 thesis 不超过 7±2 个。15 已经是上限了。超过 15 个 active signal 意味着你不够聚焦 — 你在跟踪太多方向，每个方向的深度都不够。

**怎么控制？**

- 新建 signal 前必须问：能合并到已有的吗？能用 Position 表达吗？有 ≥2 独立源吗？
- 三条都满足 → 可以建，但如果已有 15 个 active → 必须先 archive conviction 最低的
- 不满足 → watching 状态，等条件成熟

### Signal 涌现规则

**为什么不是"遇到有趣的就建"？**

因为 LLM 天然倾向于建新页面 — 每个新观点看起来都值得一个独立 signal。如果不控制，一个月后你会有 50 个 signal，大部分只有 1 个 source 支撑，没有 contradictions，没有 position。这就是旧系统的问题。

流程：
1. ≥2 个独立 source 指向同一判断 → 候选
2. 候选可以用 Position 表达 → watching
3. Alex 认为值得 → active

**Counterfactual prompting**：每处理 5 个 source 后，对 conviction 最高的 active signal 问一次："假设这个结论完全错了，最可能的原因是什么？"产出写到 Contradictions 段。最有信心的判断被挑战得最频繁。

---

## _nav.md

Dataview 动态生成，按 conviction 降序。不手动维护。

```
## Active
dataview query: FROM "signals" WHERE status = "active" SORT conviction DESC

## Watching
dataview query: FROM "signals" WHERE status = "watching" SORT conviction DESC

## Recently Archived
dataview query: FROM "signals" WHERE status = "archived" SORT file.mtime DESC LIMIT 10
```

---

## Think Loop

### 为什么只有一个流程？

Karpathy 分了 ingest / query / lint 三个操作。我们合成一个 Think，因为在投研场景下这三件事是同时发生的：读材料的时候就在联想（query），联想的时候就在检查已有判断是否过时（lint）。分开做会让编制变成机械任务。

### 信息源优先级

```
① raw/webclipper/         # 网页剪藏 — 纪要、访谈、文章，最高价值
② raw/ai-daily/           # 日报 — 结构化每日扫描
③ sources.py rss/folo/hn  # curated 源 — 40 RSS + Folo + HN
④ qmd search/vsearch      # 已有 640+ 文件里找关联
⑤ WebSearch               # 外部补漏 — 只在 ①-④ 不够时用
```

**为什么 webclipper 最优先？** 因为它是你主动剪藏的 — 你已经用人的判断做了第一层筛选。AI daily 次之因为它是结构化的。sources.py 是 curated 但未经你筛选。WebSearch 信噪比最低。

### 流程

```
材料进来
  ↓
GATE — 这份材料有 wiki 里还没有的具体数字或事实吗？
       回答了 ENVISION 的 Question？挑战了 Belief？
       → 都不是 → SKIP（留在 qmd 索引）
       → 是 → 继续
  ↓
EXTRACT — 提取 Facts（≤10）+ Views（≤5）+ Gaps
           写 source 页
  ↓
CONNECT — qmd vsearch 找 supports / contradicts / tensions
           标注 relations 到 frontmatter
           每 5 个 source 做一次 counterfactual prompting
  ↓
WRITE — 更新 signal 页（加 evidence 或 contradiction）
         旧数据被取代 → supersede（删旧加新）
         全新论点 + ≥2 源 → 考虑新建 signal
         写 _log.md
  ↓
RE-READ — 如果某个 signal 的 conviction 变化 ≥15 分：
           找该 signal 最早的 3 个 source
           带当前 context 重读
           结论是否需要修正？
  ↓
DECAY — 顺手检查碰过的 signal
         last_verified 更新
         stale 的处理
  ↓
SYNC — 更新 dashboard + _nav.md
  ↓
REFLECT — 每轮结束写 _log.md：
           本轮做了什么（新建/更新了哪些页面）
           关键发现（改变判断的信息）
           沉默信号（期待看到但没看到的信息）
           下一轮优先级（哪个 signal 最需要关注）
```

### GATE 为什么要这么严？

**因为旧系统的核心问题是编制太多、思考太少。**

292 个 source 页里大部分是"又一个人说了类似的话"。第 8 个人说"AI capex 太大"不会比前 7 个人增加任何信息量。GATE 的工作是拦住这种重复。

硬条件：材料必须包含**wiki 里还没有的**具体数字或具体事实。"又一个人看空 AI"不通过。"NVDA Q2 inference 收入占比 55%（wiki 里之前只有 48% 的数据）"通过。

### RE-READ 为什么存在？

**因为同一份材料在不同 context 下会得出不同结论。**

你 1 月读 Dana 说"customer in debit state"，结论是"demand 强劲"。3 个月后 hyperscaler 下修 capex，你重读同一句话，结论变成"那是当时的快照，已过期"。材料没变，你的 context 变了。

这个步骤只在 conviction 变化 ≥15 分时触发 — 不是每轮都做，是判断发生显著变化时回头看旧证据是否需要重新解读。

---

## 自净化

### Confidence Decay（与 deadline 挂钩）

**为什么不用固定 -10/月？**

因为好的投资 thesis 常常需要 3-6 个月等验证。GOOGL 多头论点的下一个验证是 Q2 earnings（5 月底），在那之前没有新数据不代表论点变弱了 — 只是验证窗口还没到。固定衰减会误杀慢热 signal。

```
距 deadline > 60 天 → 不衰减
距 deadline 30-60 天 → 每月 -5
距 deadline < 30 天 → 每月 -15
deadline 已过 → 每月 -20

收到 contradicts → conviction -15（不管 deadline）
收到 supports → conviction +5（上限 100）
conviction < 20 → stale
conviction < 10 → archived
```

### Supersession

新数据取代旧数据时，**删旧加新**，不追加。

```
旧：[Cankaya, 2025-10] AI TAM $300-350B
新：[Cankaya, 2026-03] AI TAM $800B [supersedes: 原 $300-350B]
```

**为什么？** 因为追加式编制会让页面越来越长、互相矛盾的数据共存。读者不知道哪个是最新的。

### 月度 Consolidation

1. active signal >15 → 合并 conviction 最低的
2. stale signal → refresh 或 archive
3. ENVISION Questions 过期 → 提醒 Alex
4. 没有 Contradictions 的 active signal → 标记"确认偏误风险"

---

## Neo4j + D3.js

### 节点与关系

```
(:Signal) (:Source) (:Belief) (:Question)

(source)-[:SUPPORTS]->(signal)
(source)-[:CONTRADICTS]->(signal)
(source)-[:TENSIONS]->(signal)
(signal)-[:SUPPORTS]->(signal)
(signal)-[:CONTRADICTS]->(signal)
(belief)-[:BASED_ON]->(signal)
(question)-[:SEEKS]->(signal)
```

### 三个视图

- **Signal Map** — 全局：节点=signal，边=typed relation，大小=conviction
- **Evidence Chain** — 单 signal：展开所有 source + contradiction
- **ENVISION Board** — beliefs conviction 进度条 + questions + 活动流

### 数据流

```
wiki frontmatter → sync_neo4j.py → Neo4j → JSON → D3.js
```

---

## 健康指标

不靠 checklist 衡量质量。问三个问题：

1. **读完一个 signal，PM 能不能直接做决策？** 如果还需要再看别的材料才能行动 → signal 没写好。
2. **每个 active signal 都能说出"市场认为 X，我认为 Y，因为 Z"吗？** 如果说不出 → 没有预期差 → 不是 alpha。
3. **有没有 signal 超过 2 周没碰过？** 有 → 要么更新要么降级，不要让 stale 判断挂着。

硬约束只有一个：**Active ≤ 15。** 超过就合并或 archive。

---

## v3 扩展：Cross-Session CoT（在现有 schema 上只增不改）

这部分不是推翻 `v2`，是把当前 `source/signal/log/fork` 升级成可跨 session 回放的推理底座。

目标只有三条：

1. **可续推**：下一次 run 不是重来，而是沿上一次的推理链继续。
2. **可审计**：任何 conviction 变化都能追到哪一步、哪份证据触发。
3. **可分叉**：fork 保持隔离，但链路上能看出它从哪条主线分出来。

### 核心不变量

- `markdown` 仍是真相源；索引或 UI 都是投影层。
- 一次 run 仍然只产一个 `log/*.md`。
- 旧字段不删，新增字段只做 additive。

### `log` frontmatter 的新增字段（v3）

```yaml
---
id: run-YYYY-MM-DD-HH-MM                 # 保留
session_id: sess-YYYYMMDD-xxxx           # 新增：同一推理会话稳定 ID（跨多次 run 不变）
parent_session_id: sess-...              # 新增：fork 或衍生会话的父 session
parent_run_id: run-...                   # 新增：本 run 直接承接哪次 run
mode: weave | sandbox | review           # 新增：运行模式显式化
question_id: Q1 | Q2 | q-<slug>          # 新增：本 run 回答的核心问题 ID
question_text: "..."                     # 新增：问题自然语言（可选）
cot_version: v3                          # 新增：causal schema 版本
cot_summary_zh: "..."                    # 新增：给 UI / agent 的一句话推理摘要
---
```

### `causal_chain` 升级为主线与沙盘的共同必填

`v2` 里只有沙盘强制 `causal_chain`。`v3` 要求主线编织也写（可以更短），这样才有跨 session CoT。

```yaml
causal_chain:
  - step: 1
    id: n1
    type: read | challenge | hypothesize | update | reflect | question | archive
    what: "读 [[source-xxx|title]]，发现..."
    refs:
      sources: [source-xxx]
      signals: [sig-yyy]
      questions: [q-abc]                  # 可空
    caused_by: []                         # 根步骤为空数组
    reason_next: "为什么导向下一步"
    outcome: read_completed | conviction_updated | signal_created | question_opened
```

字段解释：

- `type`：思维动作类型（可查询、可统计）。
- `refs`：这一步明确触达了哪些 source / signal / question。
- `caused_by`：父步骤 ID 列表（形成 session 内推理 DAG）。
- `outcome`：步骤结果标签，便于后续回放和质检。

### 问题队列（supervised thinking 的续推接口）

在每个 run 里显式记录“未解问题”和“本轮解决了什么”：

```yaml
open_questions:
  - id: q-hyperscaler-gpu-utilization
    text: "如果 GPU 利用率回落到 40%，哪些 signal 先失效？"
    priority: high | medium | low
    opened_by_step: n4

resolved_questions:
  - id: q-intuit-front-end-moat
    text: "Intuit 的 moat 是否只在 mid-market 成立？"
    resolved_by_step: n8
    resolution: "segment 分层成立，lower-end 不成立"
```

这两个字段是跨 session 的最小桥梁：下次 run 先接 `open_questions`，不是从空白 prompt 开始。

### `signal` 的最小增量字段

```yaml
---
id: sig-<slug>                            # 新增：显式稳定 ID（不依赖文件名推断）
last_touched_run: run-...                 # 新增：最后一次被修改的 run
---
conviction_history:
  - date: YYYY-MM-DD
    value: 82
    reason: "..."
    evidence: [source-...]
    caused_by_run: run-...
    caused_by_step: n5
```

这样每次 conviction 变化都能从 signal 反查到具体 run / step。

### `source` 的最小增量字段

```yaml
---
derived_from_run: run-...                 # 新增：由哪次 run 产出
extracted_by_step: n2                     # 新增：由 causal_chain 哪一步抽取
surprise_score: 0-10                      # 新增：Surprise Filter 显式化（可选）
surprise_reason: "..."                    # 新增：跳过或保留的原因（可选）
---
```

这让 source 不再只是静态摘录，而是有推理上下文。

### 向后兼容约定

- 没有 `session_id`：默认等于 `id`。
- 没有 `question_id`：回退 `envision_question`。
- 没有 `causal_chain`：允许读取，但视为“不可回放 run”。
- 旧 `reveals` 字段：兼容为 `refs` 的别名。

### 推荐迁移顺序（不打断现有工作流）

1. **先改 log**：主线也写 `causal_chain` + `session_id/question_id`。
2. **再改 signal**：`conviction_history` 补 `caused_by_run/step`。
3. **最后改 source**：补 `derived_from_run/extracted_by_step`。

做到第 1 步，就已经具备跨 session CoT 的最小闭环。
