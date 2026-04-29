---
name: augur
description: Augur 投研引擎主 skill — 两个 mode。(1) 编织模式:每次 run 读 ENVISION + 挑 5-10 篇新 raw + 写 source/signal/log 到主支线 wiki/。(2) 沙盘占卜模式:fork 一个独立 wiki 到 forks/{ts}-{slug}/,围绕一个限定问题 + 限定 resources 跑完整 augur pipeline,log 按因果顺序编排,不污染主支线。触发:跑 augur / 处理 raw {文件} / 沙盘占卜 {问题}。
---

# Augur · 占

Alex Wang 的投研思考引擎（现阶段主 skill）。`wiki-think` 保留作为 archive，后续用它做"审视"模式。本 skill 只做**编织** — 从新材料提炼判断，写入 wiki。

核心契约：**每次 run = 一个完整 pipeline = 一个 log md 文档 = UI 左栏一张 card**。

---

## ⛔ 模式门控 — 不问不跑

高权重 skill，任何触发先问 mode 再确认：

```
要跑 augur。请确认想跑哪个模式：

【编织模式 — 写入主支线 wiki/】
1. 处理最新 raw — 自动挑 5-10 篇未处理的 raw/webclipper/*.md
2. 处理指定 raw — 告诉我文件名

【沙盘占卜模式 — fork 独立 wiki，不污染主支线】
3. 沙盘占卜 — 反问你关心的问题 + 限定 resources，在 forks/{ts}-{slug}/ 下跑一次完整 augur pipeline

【其他】
4. 审视某 signal — 走 wiki-think 审视模式（不在本 skill）

不是 1/2/3 → 跳过。
```

明确回复后再执行。"处理 raw {文件名}" 直接进 Option 2。"沙盘占卜 {问题描述}" 直接进 Option 3。

---

## 编织模式 · 流程（每次 run 六步）

### 1. 读 ENVISION + 盘点 catalog

**[READ]** `/Users/项目开发/研究空间/investor-wiki/wiki/ENVISION.md` — 定位本 run 围绕哪个 Q1-Q5。无法归到任何 Q → 挑战 Alex 是否真该建 signal。

扫 `wiki/signal/*.md` **只读 frontmatter**（省 tokens）→ 当前 active signal 的 name / conviction / tags / community。

扫 `wiki/log/*.md` **只读 frontmatter.reads[].raw_path** → union → **已读 raw 全集**（含被 Surprise Filter 跳过的）。这是"读过 vs 没读过"的唯一真源 — **不靠 `sources/` 目录**（因为跳过的 raw 不建 source，只看 source 会让跳过的 raw 被反复挑出来重读浪费 tokens）。

### 2. 挑一批未处理 raw

"未处理" = **不在** Step 1 得到的已读全集里。

优先 `raw/webclipper/*.md`（.md 易读，PDF 成本高）。**默认 5-10 篇 / run，上限 ~20**。排序：当期 Q 相关 > 高信度 > 新日期。

"挑多" ≠ "建多" — Surprise Filter 会筛掉大部分（107 篇只 10 篇改变判断是正常比例）。批量读是为了**看到 pattern**，比如 3 个独立来源同时 hint 某个机制 → 这种发现单篇看不到。

### 3. 读 raw + Surprise Filter

**读完问自己：这篇最让我意外的是什么？**

- 有意外 → 建 source、可能动 signal
- 没意外 → 不建 source，log 里一句话记"跳过 X 因为 Y"

大部分 raw 应被跳过。107 篇只 10 篇改变判断是正常比例，不是失败 — 如果每篇都"有增量"说明 Surprise Filter 太松。

### 4. 思考纪律（继承 wiki-think）

1. **GATE 宽进严出** — 有具体数字 / 独立观点 / 反面立场 / 高信度一手源 → 建 source。不通过：纯转述新闻 / 零数据泛泛 / 同框架重复已有结论。
2. **Facts ≠ Views** — 客观事实和主观判断分开记。标 credibility。记录"他没说什么"（Gaps）同样重要 — 沉默是信号。
3. **找矛盾不找确认** — 两个专家说相反 → 分析**为什么**矛盾（scope / data / framework）。全是支持证据 → 搜得不够，不是你对了。
4. **发现必须 actionable** — 每个跨源发现对应：(a) conviction 调整，(b) position 修正，或 (c) ENVISION question 回答。上限 5 个发现/run。
5. **挑战最强信念** — 对 conviction 最高的 active signal 做一次 counterfactual。
6. **反思写动摇** — log 80% 写反思（意外 / 动摇 / 沉默），20% 写操作。禁止"本轮处理了 N 篇"开头。

### 5. 写 3 类文件（按下面 v2 schema）

- 0-N 个新 source（`wiki/sources/source-{slug}.md`）
- 0-N 个 signal 更新（`wiki/signal/{slug}.md` — **整篇重写 body + 更新 frontmatter**，详见 Schema 章节）
- 1 个 log md（`wiki/log/YYYY-MM-DD-HH-MM.md`）

### 6. 报告 + 不 commit

stdout 输出：读了什么 / 写了什么 / 改了什么 / 没做什么（跳过原因）。

**不做**：git commit / 跑 `generate_augur_data.py` / 改 UI / 改 ENVISION.md。

---

## 🔮 沙盘占卜模式 · 流程

**和编织模式的唯一区别**：
- **启动**：用户主动说 "沙盘占卜 {问题}"，不是 raw 到达触发
- **范围**：用户限定本次关心的问题 + 可读 resources 子集
- **产出目标**：写到 `investor-wiki/forks/{ts}-{slug}/`，**不写主支线 `wiki/`**
- **Log**：按因果顺序编排（`causal_chain` 字段），不是时间顺序
- **尾部**：跑完自动 `open` fork 的独立前端

主支线永远不被本 mode 任何操作影响。**每个 fork 是一张独立的地图，自生自灭**。未来可做 fork ↔ 主支线的 diff / cherry-pick，V1 不做。

### S1. 反问采集参数（AskUserQuestion，批量）

**Q1：你本次关心的问题是什么？**
- 可以是 ENVISION Q id（如 "Q2 agent harness"）
- 可以是一个临时新命题（自由文本）
- 本次 AI 读 ENVISION 时只关注这一条

**Q2：本次 Resources 范围？**（限定 AI 能读哪些 raw）
- a) 所有 active signal 及其 source（默认）
- b) 特定 community（指定 name，如 `ai-infra`）
- c) 最近 N 天的 `raw/webclipper/`（指定天数）
- d) 自定义（自然语言描述，由我 resolve）

两个参数都确认后进入 S2。

### S2. Bootstrap fork 目录

**Slug**：从 Q1 问题抽 2-4 个词 kebab-case。冲突时已包含 timestamp，不会撞。
**时间戳**：`$(date +%Y-%m-%d-%H-%M)`。
**Fork 路径**：`investor-wiki/forks/{ts}-{slug}/`。

Bash 骨架：

```bash
TS=$(date +%Y-%m-%d-%H-%M)
SLUG={从 Q1 抽的 kebab-case}
FORK=investor-wiki/forks/${TS}-${SLUG}

mkdir -p $FORK/{signal,sources,log,augur}

# Copy UI 模板 — fork 的独立前端（纯拷贝，主支线原件不动）
# V2 三件套从 reference fork 拷贝（主线 wiki/augur/ 仍是 V1 静态图无动画播放器，
# 待 Alex 决定何时 promote V2 到主线后这两行可改回 wiki/augur/）
V2_REF=investor-wiki/forks/2026-04-25-03-04-explore-recent/augur
cp $V2_REF/index.html                          $FORK/augur/
cp $V2_REF/app.js                              $FORK/augur/
cp $V2_REF/styles.css                          $FORK/augur/

# 静态资产从主线 cp（不会动）
cp investor-wiki/wiki/augur/semantic_layout.js $FORK/augur/ 2>/dev/null || true
cp investor-wiki/wiki/augur/logo.png           $FORK/augur/ 2>/dev/null || true

# ENVISION 作为只读引用复制过来
cp investor-wiki/wiki/ENVISION.md $FORK/ENVISION.md

# Fork 元信息
cat > $FORK/FORK.md <<EOF
---
fork_id: ${TS}-${SLUG}
created: $(date +%Y-%m-%d)
parent: wiki/
question: {Q1 原话}
resources_scope: {Q2 原话}
---

# Fork · {Q1 的一句话复述}

独立于主支线的一次沙盘占卜推演。主支线不受任何影响。
EOF
```

### S3. 在 fork 里跑完整 augur 编织流程

按【编织模式 · 流程】Step 1-5 的**完整纪律**跑一遍，但有三点区别：

- **读 raw** 严格限定在 Q2 的 resources 范围，不乱扩
- **写 source / 重写 signal / 写 log** — 全部写到 `$FORK/`，不写主 wiki
- 读 ENVISION 时只关注 Q1 的命题（其他 Q 的 signal 可以读作背景，但不被本 run 动）

### S4. Log 因果顺序编排（本 mode 独有）

写 log md 之前，做一次**因果编排 pass**。

编织模式的 log 是按"读 raw 的时间先后"dump 的；占卜模式要求 AI **回过头把已做的动作按因果重新排序** — 如果要把这次推演讲成一个故事，哪个先讲哪个后讲才通？

Log frontmatter 除了编织模式的字段，**追加** `causal_chain`：

```yaml
causal_chain:
  - step: 1
    id: n1
    what: "读 [[source-xxx|title]]"
    caused_by: null
    reason_next: "他的一句 claim 挑战了 sig-yyy 的机制假设"
  - step: 2
    id: n2
    what: "回头读 sig-yyy body 找漏洞"
    caused_by: [n1]
    reason_next: "发现机制描述把 X 和 Y 混为一谈，conviction 要降但先写精确化版本"
  - step: 3
    id: n3
    what: "新建 sig-zzz（sig-yyy 的精确化版本）"
    caused_by: [n1, n2]
    reason_next: "有了精确化才能降 sig-yyy 不丢判断"
  - step: 4
    id: n4
    what: "把 sig-yyy conviction 从 72 降到 60"
    caused_by: [n2, n3]
    reason_next: null  # 终点
```

**硬性要求**：
- 每个 step 有 `caused_by`（null 或一个/多个之前 step 的 id）
- 每个 step 有 `reason_next`（为什么导向下一步；终点 null）
- 编排顺序是"讲故事的顺序"，不是"时间顺序"
- step 数量 5-12（太少没故事，太多失焦）
- Log body 的段落顺序和 causal_chain 对齐：第 1 段 ↔ step 1，以此类推

### S5. 生成 fork 前端数据 + 语义布局 + 推演剧本（三件事必须都做）

**1. 生成 data.js**（结构化字段供 graph 渲染）：

```bash
/Users/项目开发/研究空间/investor-wiki/.venv-embed/bin/python \
  /Users/项目开发/研究空间/investor-wiki/scripts/generate_augur_data.py \
  --wiki-dir $FORK --today $(date +%Y-%m-%d)
```

**2. 跑语义布局**（fork-specific BGE + MDS 重新算 graph 节点位置）：

```bash
/Users/项目开发/研究空间/investor-wiki/.venv-embed/bin/python \
  /Users/项目开发/研究空间/investor-wiki/scripts/compute_semantic_embeddings.py \
  --wiki-dir $FORK
```

**3. 写推演剧本 `$FORK/augur/scenes.js`** — V2 动画播放器的真源（schema 见 S5a）。

**注意**：
- 必须用 `.venv-embed/bin/python`（系统 python3 没 fastembed / pyyaml）
- 编织模式禁止 AI 跑 `generate_augur_data.py`（主 wiki 由 Alex 手动 regen）；**沙盘占卜模式必须跑**
- 没有 scenes.js → UI 只是静态图，没动画播放器

### S5a. `scenes.js` Schema（V2 动画剧本）

scenes.js 是 IIFE，loaded after data.js by index.html，attach `window.AUGUR_SCENES`。

```javascript
(function(){
  const SCENES = [
    {
      id: "scene-N",                          // 唯一序号
      kind: "prep" | "hero" | "closing",      // 章节：铺垫 / 信号浮现 / 收尾
      title: "...",                           // scene 标题（短语，≤ 25 字）
      punch: {                                // UI 卡片的 3 段精简，每段 ≤ 70 字
        read: "...",                          // 这步看到什么材料（引文 / 关键 quote / 数字）
        found: "...",                         // 这步看到什么 pattern / 跨源 cluster
        derive: "..."                         // 推出什么判断 / position / conviction
      },
      body: [                                 // 完整叙事（备用，UI 不渲染，保留给未来引用）
        "150-300 字段落，跟 log narrative 风格一致 — 第一人称内省、时间感、自我对抗"
      ],
      step_ids: ["n1", "n2"],                 // 关联 log frontmatter causal_chain 的 step id
      reveal: {
        sources: ["source-xxx"],              // 这步揭示哪些 source
        signals: ["sig-xxx"]                  // 这步揭示哪些 signal（**用 sig- 前缀**）
      },
      duration_ms: 5000,                      // 播放时长（prep 5000-6500 / hero 8000 / closing 7000）
      hero: {                                 // 仅 kind="hero" 时
        name_zh: "...", sub: "...",
        community: "...", conviction: 75,
        position: "...", kill: "...",
        colors: ["#hex", "#hex"]              // 双色 gradient halo
      }
    }
    // ... more scenes
  ];

  // 末尾计算 cumulative reveal —— player 用来知道 "by scene N，what nodes have surfaced"
  const seenSrc = new Set(); const seenSig = new Set();
  SCENES.forEach((sc) => {
    (sc.reveal.sources || []).forEach(id => seenSrc.add(id));
    (sc.reveal.signals || []).forEach(id => seenSig.add(id));
    sc.cumulative = { sources: [...seenSrc], signals: [...seenSig] };
  });

  window.AUGUR_SCENES = SCENES;
})();
```

**写作契约**：
- 每个 sandbox fork **必产** `scenes.js`，8-12 个 scenes
- **kind 节奏**：4-7 个 `prep` + 2-4 个 `hero`（每个 emergent signal 一个 hero scene）+ 1 个 `closing`
- `punch` 三段（read / found / derive）是 UI 卡片显示的真主体 — **严格 ≤ 70 字**
- `step_ids` 必须匹配 log frontmatter causal_chain 的 id（n1 / n2 / ...）
- `reveal` 写时**只列本步新增**的 source/signal，cumulative 末尾自动算
- `hero` scene 的 `colors` 用 2 个 hex，UI 渲染成 gradient halo
- 参考实现：`forks/2026-04-25-03-04-explore-recent/augur/scenes.js`

### S5b. V2 模板源说明

V2 UI 三件套（`app.js / index.html / styles.css`）已在 **S2 cp 命令**中直接从 `forks/2026-04-25-03-04-explore-recent/augur/`（V2 reference fork）拷贝 — 不再需要 fork bootstrap 后再手动 cp。`scenes.js` 是 fork-specific 必产文件（写作契约见 S5a），**不拷贝**，每个 fork 自己写。

主线 `wiki/augur/` 当前仍是 V1（静态图，无动画播放器）— Alex 决定何时把 V2 promote 到主线，promote 后 S2 cp 命令的 `V2_REF` 可改回 `investor-wiki/wiki/augur`。

### S6. 启动 HTTP server + 打开 fork UI

V2 动画 `data.js` + `scenes.js` 必须经 HTTP 加载（file:// 协议受 CORS 限制不能加载 module）。

```bash
cd $FORK && python3 -m http.server 8770 &
sleep 1
open "http://localhost:8770/augur/?v=$(date +%s)"
```

`?v={timestamp}` 是 cache-bust，确保浏览器重新加载新 data.js / scenes.js。

### S7. 报告

stdout 输出：
- `fork: $FORK`
- source / signal / log / **scenes** 产出清单（路径 + 一句话说明）
- HTTP server URL + 已打开
- 本 fork 的 `causal_chain` step 数 + `scenes` 数量
- 一句话本次推演结论（取自 `log.summary_zh`）

### V1 → V2 状态

- ~~前端因果动画播放器（按 step 逐步揭示 + graph 同步高亮）~~ → **V2 已实现**（见 S5a `scenes.js` schema）
- 打断 / resume 不支持（跑起来只能等完）— 仍是 V2 限制
- Fork ↔ 主支线的 diff / cherry-pick 不支持 — 仍是 V2 限制
- 主线 UI 看 fork 列表 / 推演路径 — **V3 待实施**（`generate_augur_data.py` 扫 forks/ 注入 main data + 主线 `app.js` 加 fork sidebar + iframe modal）

---

## v2 Schema

### `wiki/sources/source-{slug}.md`（AI 写）

```yaml
---
id: source-{slug}
title_zh: {2-10 字中文短标题}
author: {人名 或 机构}
source_raw_path: raw/webclipper/{filename}.md   # 冗余索引便于查询；去重真源在 log.reads[].raw_path
kind: webclipper | fund-letter | expert-call | tweet | pdf | sell-side | podcast
credibility: high | medium | low
published: YYYY-MM-DD       # 原材料发布日期
ingested: YYYY-MM-DD        # 今天
supports: [sig-a, sig-b]    # 这份材料支撑哪些 signal
contradicts: []             # 这份材料反驳哪些 signal
---

# {谁} — {主题}

## 摘要

**150-250 字，2-4 句紧凑论证**。Source 是独立研究文档，不是笔记 — 不要"我读这篇之前在想什么"这种第一人称内省，直接讲 fact 和判断。

必答三要素：① **这是什么**（谁 / 什么机构 / 什么类型材料 / 发布日期）② **核心观点**（最 punch 的论点 / 数据 — 不列清单，挑最关键那个，引原文不转述）③ **为什么值得看**（触及哪个 signal、支撑还是挑战、surface 了什么 gap）。

**写清楚不写废话**：禁止"这篇分析了..." / "本文讨论了..." / "作者认为..." 这种引导句，直接进事实。**硬标准**：没读过这份材料、也没读过 wiki 的第三方朋友，看完摘要应该知道"这是什么、主要在说什么、为什么值得花时间"。不许把 Facts 第一条复制过来当摘要。

## Facts（客观事实，可独立验证）
- **关键数字加粗** → 含义。标来源。

## Views（主观判断）
- [人名] "直接引用" → 含义。bullish / bearish / neutral。

## Gaps（这个人/材料没说什么）
- 没讨论 X → 可能原因

## Credibility Notes
- 为什么给这个等级
```

**条目限制**：Facts ≤ 10 条，Views ≤ 5 条。超过说明在搬运不在提炼。
**不漏不重**：同一 fact 全 wiki 只出现一次。重复的标 `与 [[source-xxx]] 一致`。
**Supersession**：新数据取代旧 → 删旧加新，**不追加**。

**Credibility**：
- high = 一手经验 + 无利益冲突（前员工谈前雇主技术 / 直接客户谈供应商）
- medium = 二手分析或有 bias 的一手（sell-side / 前员工谈前雇主估值）
- low = 传闻 / 社媒 / 未署名

### `wiki/signal/{slug}.md`（AI 每次重写 body + 更新 frontmatter）

**Signal = 当前判断的快照**。每次被动到，AI **整篇重写 body** 为当前最新叙事 — 不 append bullet，编织成 Stratechery 风格连贯分析。

**迭代历史不在 signal 里，在 log 里**。想看这个 signal 怎么演化 → 看 UI 左栏 Run Timeline（或 Obsidian 里翻 `log/*.md`）。signal body 只讲"现在"，不讲"曾经"。这是**关注点分离** — signal = 最新立场，log = 思考过程。

**Signal body 写作契约**（继承 wiki-think signal-standard.md）：
- **标题是一句判断**（Long / Short / Avoid 方向明确）。❌ "软件护城河到底在哪一层？" ✅ "AI 只杀简单 SaaS，复杂工作流护城河反而加深"
- **body 顶部必须有 `## 摘要` 段**（**150-250 字，2-4 句紧凑论证**）：必含 Thesis（核心判断）+ 机制（为什么）+ Position（具体标的 + 方向）三要素。**Signal 是独立研究文档不是笔记** — 不要"我浮现这个 signal 是因为..."这种第一人称内省，直接陈述判断。**硬标准**：不读下面论证只读摘要，第三方朋友要能 30 秒知道"这是什么 + 为什么重要 + 对应什么动作"。
- **body 写得自由清楚**：机制 / 预期差 / Position / Kill 是必答问题，不是固定 section 模板。允许长段落 Stratechery 风格论证 — 每段推进一个论点，机制和预期差自然交织，反方编织进论证不单独列 risk factors。章节标题可以用 inflection point 命名（"为什么这次和过去几次不一样" / "市场只看到了一半" / "这条机制链的 upstream"），不强求 "## 机制" 这种工整模板。**body 字数没上限，有话讲就讲清楚，没废话就别凑**。
- **必须保留的结构**：Position 单独成段或单独章节，让读者一秒找到具体标的 + 方向；Kill Criteria 单独一段，具体、可观察、有时间窗，不是 risk factors 清单。
- **第一性原理**：机制层 + 反事实层都要有 — 反事实层写"如果整条 thesis 是错的，最 plausible 的 framing 是什么"。
- **引用原文不转述**。中英文自然混合。

**首次碰到老 signal**（没 v2 字段） → 补齐 `name_zh / subtitle_zh / community / conviction_history` + 整篇重写 body（吸收老 body 有用部分，不是拼接）
**已有 v2 signal** → 重写 body + append `conviction_history` 新条目 + 更新 `conviction` / `last_verified`

```yaml
---
# v1 老字段（保留不动）
type: signal
name: {英文 slug}
status: active | watching | archived
conviction: 0-100
last_verified: YYYY-MM-DD
deadline: YYYY-MM-DD
tags: [...]

# v2 新字段（首次补齐，后续 append）
name_zh: {2-6 字}
subtitle_zh: {10-20 字 Position 或机制}
community: {自由 slug — LLM 涌现命名，见下方 community 规则}
conviction_history:
  - { date: YYYY-MM-DD, value: N, reason: {一句话}, evidence: [source-...] }
---
```

**`name_zh` 规则**（UI 右栏要求）：
- 2-6 字，**一眼知道在说什么** — 不是艺术，是信号
- **硬性测试**：给一个没读过你 wiki 的朋友看 name_zh — 他应能**猜到方向**（哪个领域 / long or short）。猜不到 = fail，重写。
- ❌ **禁止**只有内部术语才懂的：
  - "限制框架" → ✅ "约束识别框架" 或 "能源稀土约束"
  - "财政主导" → ✅ "利息超国防" 或 "主权债拥挤"
  - "谦卑即 Alpha" → ✅ "预测链数学" 或 "低基准率判断"
  - "波动率洗平" → ✅ "私募估值平滑" 或 "mark 失真套利"
  - "Mythos 分级准入" → ✅ "AI 分级发布" 或 "Anthropic 网安新规"
  - "智慧而非聪明" → ✅ "持有纪律" 或 "quality-stay"
- ❌ 抽象隐喻："炼金谬误" → ✅ "模型商品化"
- ✅ 业内专有可保留，但 **subtitle 必须补足含义**："CAPE 历史极端" / "Sell America 轮动" / "Agent 护城河" / "Buffer 疯狂→结构化泡沫"
- ✅ 包含 ticker 也 OK，但 ticker 要可识别（大公司而非小 ticker）

**`subtitle_zh` 规则**：
- 10-20 字，Position 指向或机制核心
- **硬性测试**：外人读到 subtitle 应能理解大概方向和动作，**不需要额外查 ticker 是什么**
- ❌ **禁止**只用 ticker 缩写（读者要能从 subtitle 本身推出投资动作）：
  - "long GEV + 铀" → ✅ "long 核电设备（GEV）+ 铀矿"
  - "long 矿业股 > GLD" → ✅ "央行购金 / long 金矿股（GDX）优于 GLD"
  - "long TLT" → ✅ "long 长久期国债（TLT）"
  - "long APO + 等 distressed" → ✅ "PE 退出堵死 / long 私募信贷龙头（APO）+ 等 distressed 买家入场"
- ✅ "AI 模型商品化 / long 入口（GOOGL）avoid 纯模型"
- ✅ "央行结构性购金 / long 金矿股（GDX）优于 GLD"
- ✅ "AI 杀简单 SaaS / long 复杂工作流（NOW + GOOGL）avoid 旧 SaaS（TEAM）"

**`community`**：**LLM 涌现，不是预设**。
- 不再限定 7 个固定值（之前的 `ai-infra / macro-rotation / private-credit / market-structure / physical-infra / value-invest / shorts` 都只是历史观察，不是约束）
- 每次新建 signal，扫所有现有 signal 的 community slug，**优先复用已存在的**（kebab-case）。如果 thesis 真的不属于任何现存 community，**新建一个**：自己选一个 2-3 词的英文 slug（kebab-case），写进 frontmatter。命名贴近机制层而不是 sector 层（"hbm-supply-shift" > "memory" > "hardware"）
- UI 端会自动 hash slug → 颜色（HSL → hex），新 community 自动有颜色，不需要更新前端
- 如果你新建了 community，在 conviction_history 第一条的 `reason` 里写一句"新建 community 因为 X 不属于任何现有"
- 不要为了好玩新建。只在 thesis 真的开辟一条新的因果链时新建。1 个 community 通常应该有 ≥3 个 signal 才稳定。

**`conviction_history`**：每次本 signal 被本 run 动到就 append 一条。**evidence 必须是本次新建或已存在的 source id**。

**Conviction 调整原则**（继承 wiki-think）：
- 收到支持 → +5（上限 100）
- 收到矛盾 → -15
- Counterfactual 做完 → 按贝叶斯更新
- 数字必须和 body 一致，改数字必写 reason

### `wiki/log/YYYY-MM-DD-HH-MM.md`（AI 写）

文件名用 run 开始时间。**log/ 目录不存在就 mkdir**。

```yaml
---
id: run-YYYY-MM-DD-HH-MM
trigger: manual          # manual | envision_change（未来用）
envision_question: Q1 | Q2 | Q3 | Q4 | Q5 | none
reads:
  # 建了 source 的
  - { raw_path: raw/webclipper/xxx.md, outcome: source_built, id: source-xxx, title: {中文} }
  # Surprise Filter 跳过的
  - { raw_path: raw/webclipper/yyy.md, outcome: skipped, reason: {一句话为什么跳} }
signal_changes:
  - { signal: sig-xxx, from: 77, to: 82, reason: {一句} }
new_signals:
  - { id: sig-xxx, name: {name_zh} }
archived_signals:
  - { id: sig-xxx, reason: {为什么 archive} }
summary_zh: {一句话本 run 结论}
---

# {一句话日记式标题 — narrative 起势，"凌晨 3 点睡不着" 不是 "本轮处理 N 篇"}

正文 stream-of-consciousness。**4 层模板（读了什么 → 他们说了什么 → 为什么重要 → 我的想法）已废**。允许一段就是一段思考，按因果或时间自然展开，长字数。

每段一个 micro-discovery。没有固定子标题模板，章节标题用"故事中的 inflection point"命名：
- "04-23 那天，5 倍这个数字让我手停下来"
- "等等，这次和过去几次有什么区别"
- "罗福莉那篇文章把 Anthropic 的动作翻译成商业逻辑"
- "然后我把 Google 全栈叙事和中国 token 出海 cross 起来"

不是 "## 第一个发现" / "## 下一个发现" 这种 placeholder。

## 没看到的东西
- {应该出现但没出现的沉默信号}
- {数据分布不对称也是 signal}

## 下一轮
- {next run 优先级}
- {需要主动搜的 data / source}
- {等 Alex 决定的事项}
```

**深度日记写作契约**（硬性）：

允许、鼓励、几乎要求做的事：
- **时间感** — "凌晨 3 点睡不着"、"转过两天 04-23 的 daily 出来"、"我滑到 SK Hynix Q1 财报那一段"。让读者跟你一起在时间里走。
- **自我对抗** — "我必须承认，第一反应是想 long Google。但我得先停下来盘问自己。" 先抢一拍，再停下来质问。
- **修正瞬间** — "这一刻我意识到我刚才看错了"、"5 倍这个数字让我手停下来"、"我没全信，但我的 base rate 从'又一次周期性涨价'调整到'这次有 50% 以上概率是结构性的'"。判断 evolve 的 micro-moment 要写出来。
- **Bias 承认** — "我自己 long GOOGL，所以容易 rationalize 这条 narrative。对反方证据应该 stress test 得更严。"
- **数字稀疏化** — 把核心数字单独成段（"净利同比 5 倍。"），密集数字推到引用 source 里。
- **Stress test 反方 framing** — "有没有别的 framing 可以解释同一组 evidence？最 plausible 的反方是..."；写完后说明为什么暂时被 evidence 排除，但要把它留作 6 个月后回看的触发点。
- **生活化连接** — "我滑到那一段。"、"我顺手看了 04-22 收盘。"、"打开罗福莉批 OpenClaw 的那篇。"。不是论文体。

要做的内容（不是结构）：
- **每段必须推进** — 推进一个判断 / 一次自我修正 / 一个机制揭示。事实留在 source，log 写思考。
- **沉默信号主动挖** — 期待看到但没看到、数据分布不对称、两种解释差异巨大的留白。
- **中英文自然混合**，术语 inline 翻译。

禁止：
- ❌ "本轮处理 N 篇材料" 开头 / "综上所述" / "本轮小结" 等模板化语言
- ❌ "## 第一个发现" / "## 下一个发现" 这种 placeholder 标题
- ❌ 一段混写多个 source 的事实复述（事实在 source，log 写思考）
- ❌ 没有"我" — 没防御、没不确定、没 bias 承认
- ❌ 操作记录 > 20% 篇幅
- ❌ 把 source 的具体数字大段复述到 log（一句话引用即可）

**Examplar**：`investor-wiki/forks/2026-04-25-03-04-explore-recent/log/2026-04-25-03-04.md`。这是当前最高水位风格 — 新 log 应至少达到这个 narrative 强度和"看得到思路"的密度。每次开写前重新读一遍 examplar 的前两节做对齐。

**语气**：分析师晚上写给自己看的笔记，但假设未来的自己是 reader 需要上下文。有犹豫、冲突、未解决的问题、自我质疑。不是交老板的报告，也不是 AI 工作汇报。

---

## 为什么 schema 长这样 — UI 反向决定

Augur UI（`wiki/augur/`）是 Alex 的日常入口。Schema 的每个结构化字段都对应 UI 一个视觉元素。**写 skill 时要脑补 UI 怎么渲染**，而不是把结构化字段当成"额外负担"。

### 左栏：Run Timeline — 一张 card = 一个 log md

```
┌─────────────────────────────────────┐
│ 09:15  {log body 标题}               │  ← time + h1
│ {frontmatter.summary_zh}            │  ← 一句话结论
│                                     │
│ ▸ 读入 N source                      │  ← reads 筛 outcome=source_built 的 count
│   [src-1 title] [src-2 title]       │  ← 同上，渲染 title
│                                     │
│ ▲ {sig-name} 77 → 82  {reason}       │  ← signal_changes 绿色
│ ▼ {sig-name} 45 → 38  {reason}       │  ← signal_changes 红色
│                                     │
│ ✨ +{new-sig name_zh}                │  ← new_signals 紫色
│ 🗑 {arch-sig name_zh}                │  ← archived_signals 划掉
└─────────────────────────────────────┘
```

Click card → 跳 Obsidian 打开对应 log md 看深度日记 body。

**这就是为什么 log frontmatter 必须结构化** — UI 只读 frontmatter 渲染 card，深度内容留给 Obsidian。body 不结构化，是**思考日记**。

### 右栏：Signal List — 按 community 分组

按 `community` 分组（**LLM 涌现，组数不固定**；当前 wiki 自然形成的组比如 AI Infra / Macro Rotation / Private Credit / Market Structure / Physical Infra / Value Discipline / Shorts 只是观察结果，不是约束），组内按 `conviction` 降序。每行：

```
●  {name_zh}              {conviction}  {Δ}
    {subtitle_zh}                         ← 小字副标题
```

- `name_zh` 2-6 字 — 一眼知道在说什么 → "炼金谬误"（看不懂）要改成"模型商品化"
- `subtitle_zh` 10-20 字 — Position / 机制 → 用户不点进 signal 也知道这 signal 在说什么
- `community` — 分组键 + 颜色（**LLM 涌现，自由 slug**；UI 自动 hash → HSL → hex 配色）
- `conviction_history` — UI 显示 Δ 和将来 sparkline 的数据源

Click row → 跳 Obsidian 打开 signal md 看完整论证。

### 中间：Graph — 节点关系图

- **Signal 节点**：size = conviction，color = community 色
- **Source 卫星**：颜色继承主 signal，画虚线到 `supports: []` 里的每个 signal
- **Signal↔Signal 虚线**：表达张力 / 支撑关系（通过 signal body 里的交叉引用推导）

**这就是为什么 source.supports 必填** — 不填 source 就是孤节点，graph 画不出来。

### 为什么 signal body 每次重写

Signal md 打开 → 用户看到**现在这个判断是什么**。迭代历史靠 UI 左栏 Run Timeline 逆序看（本 run 怎么动了这个 signal → 上次 run 怎么动 → 更早…）。

这是**关注点分离**：signal = 最新立场，log = 思考过程。Append 模式让 signal body 越长越乱；重写模式让它始终"当前最新"，演化在 log 里可追溯。

### Alex 的日常动线

```
早晨打开 UI
  ├─ 左栏扫 Run Timeline → 昨夜 AI 做了什么（≤ 30 秒看完）
  ├─ 右栏扫 Signal List → conviction 变化谁最大 / 新 signal 什么颜色
  └─ 中间 Graph → 哪些 signal 现在密切联动

点某张 card 或 signal → 跳 Obsidian 深读
  └─ 深读完想补充 → 编辑 ENVISION.md
  
再跑一次 augur → 新 log 出现在 UI 最上方
```

**Skill 写文件时要想着这个动线**：
- log summary_zh 必须让 Alex 30 秒看懂本 run 发生了什么
- signal_changes.reason 必须让 Alex 不点进去也知道为什么动
- new_signals.name 必须让 Alex 一眼懂它在讲什么
- sources.title_zh 必须让 Alex 从标题判断要不要深读

---

## Vault 路径

```
/Users/项目开发/研究空间/investor-wiki/
  wiki/
    ENVISION.md              # 只读
    signal/{slug}.md         # AI 写 frontmatter
    sources/source-{slug}.md # AI 写
    log/YYYY-MM-DD-HH-MM.md  # AI 写（不存在先 mkdir）
    augur/                   # UI，绝对不碰
  raw/
    webclipper/*.md          # 优先摄入
    sell-side research/*.pdf # 成本高，v1 少碰
    ai-daily/                # 日报
    investor-letters/        # 基金信
```

---

## 产出要求

每次 run 必须交付：

1. **0-N 个新 source md**（GATE 通过的 raw）
2. **0-N 个 signal 更新**（整篇重写 body + append conviction_history + 首次补齐 name_zh/subtitle_zh/community）
3. **1 个 log md**（即便 raw 全跳过也写一个，body 说明为什么都跳过）
4. **stdout 报告**：文件路径清单 + 一句话结论

### ⛔ 产出前自检 Checklist（每一项必须过，否则重写）

对每个**新建或重写的 source**：
- [ ] body 顶部有 `## 摘要` 段（**150-250 字**），包含"是什么 / 核心观点 / 为什么值得看"三要素
- [ ] 摘要是独立研究文档不是笔记 — 没有"我读它之前在想什么"等第一人称内省
- [ ] 摘要不是 Facts 第一条的复制 — 是提炼而非搬运，没有"这篇分析了..." / "本文讨论了..." 这种废话引导句
- [ ] Facts / Views / Gaps / Credibility 保留 bullet 结构（reference 层不变）
- [ ] 没读过此材料的朋友看完摘要能判断"要不要深读"

对每个**新建或重写的 signal**：
- [ ] body 顶部（h1 之后）有 `## 摘要` 段（**150-250 字**），包含 thesis / 机制 / position 三要素紧凑论证
- [ ] 摘要是独立研究文档不是笔记 — 没有"我浮现这个 signal 是因为..."等第一人称内省
- [ ] body 不强求 `## 机制 / ## 预期差 / ## Position / ## Kill` 工整模板，章节用 inflection point 命名 — 但 Position 单独成段、Kill Criteria 单独一段必须保留
- [ ] `name_zh` 外人能猜到方向（不是内部术语缩写）— 对照禁用清单检查
- [ ] `subtitle_zh` 读者不查 ticker 也能理解方向 — 禁止纯 ticker 缩写
- [ ] `conviction_history` 新 entry 的 evidence 都是实际存在的 source id

对每个**新建或重写的 log**：
- [ ] 标题不是 "本轮处理 N 篇" 模板，是 narrative 起势
- [ ] body 至少 2/3 是思考过程不是操作记录
- [ ] 每段一个 micro-discovery，章节标题是 inflection point 不是 "## 第一个发现" 这种 placeholder
- [ ] 至少出现一次修正瞬间（"我意识到我刚才看错了" / "等等..." / "我必须承认...但...")
- [ ] 至少出现一次明确的 bias 承认或 stress test 反方 framing
- [ ] 没看到 / 下一轮 两个 section 收口

自检不过 = 写完再改。不允许交付有 fail 的文件。

**永不做**：
- git commit（Alex 自己 review 后手动）
- 跑 `generate_augur_data.py` 指向**主支线** `wiki/`（Alex 手动 regen）
  - **例外**：沙盘占卜模式必须跑它指向 fork 目录 `--wiki-dir $FORK` — 这是 fork bootstrap 的必要步骤
- 改**主支线** UI `wiki/augur/*`（占卜模式 copy 模板到 fork 的 `augur/`，主支线原件绝不动）
- 改 ENVISION.md（唯一编辑入口是 Obsidian）
- 改已经归 archived 的 signal 文件
- 编造数据（没来源标 [ESTIMATED]）
- 在沙盘占卜模式下写任何文件到**主支线** `wiki/` — 所有产出都必须在 `$FORK/` 下

---

## 和 wiki-think 的关系

| | wiki-think | **augur** (主) |
|---|---|---|
| 状态 | archive，不改 | 现阶段主 skill |
| 模式 | 编织 + 审视 | 只编织 |
| 日记 | `_log.md` 追加 | `log/{ts}.md` 每 run 一个（UI 一张 card） |
| Signal body | AI 编织进叙事（append） | AI 每次**整篇重写** — signal 是"现在"快照 |
| 迭代历史 | 在 signal body 里 | 在 log timeline 里（UI 左栏） |
| 触发 | think loop / 审视 | 跑 augur / 处理 raw |
| 何时用 | 审视某个 signal | 每天常规编织 pipeline |

审视某 signal（自上而下，问题驱动找证据）→ 用 wiki-think 审视模式。
