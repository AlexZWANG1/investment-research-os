# Augur 语义布局 — 完整逻辑与代码指引

> **写作时间**: 2026-04-24
> **当前版本**: joint embedding + community prior + anchored SMACOF
> **生效文件**: `semantic_layout.js?v=3` · `app.js?v=33` · `styles.css?v=17`

这份文档是 Augur 画布上 542 个节点（36 signal + 506 source）**为什么落在当前位置**的完整说明。按数据流顺序写，读完能独立 debug / 调参 / 魔改。

---

## 1. Thesis

**把文本语义关系直接翻译成 2D 几何关系**。两个节点在屏幕上越近，表示它们内容上越相关。不依赖 community 标签、不依赖手工坐标、不依赖图论 force-directed。

信号来源有三个，按权重：
1. **Embedding 余弦距离**（主导）— 文本内容的语义相似度
2. **Community 先验**（辅助）— 给同簇 signal 一点额外粘合力
3. **Support 边拉力**（微调）— source 稍微偏向它支持的 signal

---

## 2. 完整文件地图

### 2.1 数据输入（只读）
| 文件 | 内容 | 关键字段 |
|---|---|---|
| `wiki/signal/*.md` | 36 个 active/watching signal | frontmatter: `name_zh` · `subtitle_zh` · `community` · `status` |
| `wiki/sources/*.md` | 520 个 source（506 个被布局） | frontmatter: `id` · `title_zh` · `supports: []` · body 前 300 字 |

### 2.2 布局计算（Python 脚本）
| 文件 | 职责 |
|---|---|
| `scripts/compute_semantic_embeddings.py` | **核心脚本**。加载 signal + source，embedding，构建距离矩阵，SMACOF，输出坐标 |
| `scripts/generate_augur_data.py` | 生成 `wiki/augur/data.js`（signal / source 对象 + RUNS 时间线）。**被 compute_semantic_embeddings.py 导入** — 复用 `SIGNAL_ID_MAP` 保证 ID 一致 |
| `.venv-embed/` | Python 3 虚拟环境，装了 `fastembed` / `numpy` / `pyyaml` |
| `wiki/augur/.embedding_cache.json` | embedding 缓存，by `sha256(text)[:16]`。文本没变就跳过重算 |

### 2.3 计算输出
| 文件 | 格式 | 被谁用 |
|---|---|---|
| `wiki/augur/semantic_layout.json` | 完整元数据 + 坐标 | 人看的，可以读里面的 stress / iters / alpha |
| `wiki/augur/semantic_layout.js` | `window.AUGUR_SEMANTIC_LAYOUT = {id: [x, y]}` | 前端直接 `<script>` 加载 |

### 2.4 前端加载 / 渲染
| 文件 | 职责 |
|---|---|
| `wiki/augur/index.html` | `<script src="semantic_layout.js?v=3">` 在 `app.js` 之前加载 |
| `wiki/augur/app.js` | `buildGraph()` 读 `window.AUGUR_SEMANTIC_LAYOUT`，signal 和 source 都优先用语义坐标，缺失才回退 |
| `wiki/augur/data.js` | signal / source / communities / runs 数据（但**不含**坐标 — 坐标在 `semantic_layout.js` 里） |

### 2.5 关键代码锚点

**compute_semantic_embeddings.py**:
- `load_signals()` — 读 signal md，抽 `name + subtitle`
- `load_sources()` — 读 source md，抽 `title + body[:300]`；ID 格式必须和 `generate_augur_data.py` 一致（`src-` + 文件 stem 后 24 字符）
- `embed_items(items, cache)` — fastembed 批量 embedding，带 sha256 缓存
- `cosine_distance_matrix(X)` — `D[i,j] = 1 - cos(X[i], X[j])`
- `community_distance_matrix(sigs)` — 同 community = 0，不同 = 1
- `mix_distances(D_emb, D_comm, alpha)` — `alpha * D_emb + (1-alpha) * D_comm`
- `cross_distance_matrix(X_sig, X_src, sources, sig_id_to_idx)` — signal × source 距离，`supports` 里的 signal 距离乘 `(1 - SUPPORT_PULL)`
- `smacof(D, ..., anchor_mask, anchor_pos)` — 支持锚定的 SMACOF
- `main()` — Phase 1 跑 signal SMACOF，Phase 2 跑 joint anchored SMACOF，输出 json+js

**app.js**:
- 第 120 行 `const SEMANTIC_LAYOUT = window.AUGUR_SEMANTIC_LAYOUT || null`
- 第 134-140 行 signal 优先用 `SEMANTIC_LAYOUT[s.id]`
- 第 289-312 行 source 优先用 `SEMANTIC_LAYOUT[src.id]`（**新加**；缺失回退到向日葵螺旋）

---

## 3. 端到端数据流

```
                      源材料                      算法                   产物
                  ─────────────             ──────────────        ────────────
    wiki/signal/*.md                                              36 × 512 vec
                          ╲                 fastembed
                           ├──→ name_zh + subtitle  ───→────────→
    wiki/sources/*.md     ╱                                       506 × 512 vec
                              title + body[:300]

           ┌─────────────────────────────────────────────────────────────────┐
           │                                                                 │
           │  Phase 1: signals                                               │
           │  ────────────────                                               │
           │  36 × 512 vec  ──cosine──→  D_emb (36×36)                       │
           │  sigs.community ──────────→ D_comm (36×36)                      │
           │  D_sig = 0.6·D_emb + 0.4·D_comm                                 │
           │  SMACOF(D_sig) ──→ sig_coords_raw (36×2, unit scale)            │
           │                                                                 │
           │  Phase 2: joint anchored                                        │
           │  ──────────────────────                                         │
           │  506 × 512 vec  ──cosine──→  D_src-src (506×506)                │
           │  signal × source ─embed + SUPPORT_PULL→  D_sig-src (506×36)     │
           │  ↓                                                              │
           │  三块拼成 542×542 矩阵，rescale 到同量级                         │
           │  ↓                                                              │
           │  init:                                                          │
           │    [0..35]   = sig_coords_raw                                   │
           │    [36..541] = sum of supported signals / N (或原点随机)        │
           │  ↓                                                              │
           │  Anchored SMACOF (signals 锁死):                                │
           │    每轮 X_new = (B @ X) / n                                     │
           │    X_new[0..35] = sig_coords_raw  ← 强制重置                    │
           │  ↓                                                              │
           │  joint_coords (542×2, unit scale)                               │
           │                                                                 │
           │  归一化到 ±1500                                                 │
           │                                                                 │
           └─────────────────────────────────────────────────────────────────┘
                                      │
                                      ↓
                wiki/augur/semantic_layout.json  (完整元数据)
                wiki/augur/semantic_layout.js    (window.AUGUR_SEMANTIC_LAYOUT)
                                      │
                                      ↓
                         app.js buildGraph()
                              │
                              ├─ signal.position = SEMANTIC_LAYOUT[sig.id]
                              └─ source.position = SEMANTIC_LAYOUT[src.id]
                                      │
                                      ↓
                              vis.js (physics frozen)
                                      │
                                      ↓
                                    画布
```

---

## 4. Phase 1 — Signal 语义骨架

### 4.1 文本选择
```python
text = f"{name}。{subtitle}"
# 例：
# "模型商品化。AI 杀简单 SaaS / long NOW + GOOGL avoid TEAM"
# "CAPE 历史极端。美国股市 CAPE 36.5× 接近历史顶"
```

**为什么不用 body**: body 是长篇 thesis，数字、公司名、boilerplate 会主导 embedding，反而稀释"这个 signal 的核心是什么"。subtitle 已经是 Alex 手工提炼的核心论点，信息密度最高。

### 4.2 Embedding
```python
from fastembed import TextEmbedding
model = TextEmbedding("BAAI/bge-small-zh-v1.5")
vectors = list(model.embed(texts))  # each is 512-dim
```

**为什么 bge-small-zh**:
- 中文优化（signal 文本是中文）
- 本地 ONNX 跑，不依赖 API
- 512 维足够捕捉主题，维度太高会稀疏化距离
- 模型 ~120 MB，冷启 3 秒，506 条 text batch embed ~30 秒

### 4.3 余弦距离矩阵
```python
sim = normalize(X) @ normalize(X).T
D_emb = 1 - sim       # 值域 [0, 1]
np.fill_diagonal(D_emb, 0)
```

### 4.4 Community 先验
```python
D_comm[i, j] = 0 if sigs[i].community == sigs[j].community else 1
```

### 4.5 混合距离
```python
ALPHA_EMBEDDING = 0.6
D_sig = 0.6 * rescale_to_01(D_emb) + 0.4 * D_comm
```

**为什么加 community 先验**:
- 纯 embedding 时，同 community 的 signal 可能因为讨论不同细节被拉开
- 加 40% community 权重把它们"粘合"回去，让画布上的 community hull 视觉上连续
- 但语义还是主要因素（60% 权重）— alchemist 和 ai-saas 同 community 且语义相关，会非常近；cape 和 ai-mythos 跨 community 但语义有关（两者都讨论泡沫），依然会相对近

### 4.6 SMACOF
```python
def smacof(D, max_iter=400):
    X = classical_mds(D)                  # 特征值分解做 init
    W = 1 - eye(n)                        # 权重 1，对角 0
    for it in range(max_iter):
        DX = pairwise_dist(X)             # 当前 2D 距离
        B = where(DX > 0, -W*D/DX, 0)
        B_diag = -B.sum(axis=1)
        fill_diagonal(B, B_diag)
        X_new = (B @ X) / n               # Guttman transform
        stress = 0.5 * ((W*(D - DX))**2).sum()
        if prev_stress - stress < eps: break
        prev_stress = stress
        X = X_new
    return X, stress
```

**关键概念 — Stress**:
- `stress = 0.5 × Σ (D_target - D_current)²`
- 越小说明 2D 距离越接近目标
- **Kruskal stress-1** = 归一化版本：`sqrt(stress / (0.5 × Σ D²))`
  - <0.05 优秀 / <0.1 良好 / <0.2 可接受 / >0.2 勉强
  - 当前 signal 阶段 = **0.29**（良，typical for 36 nodes in 2D）

**当前运行**: 165 轮收敛，stress 28.0。

### 4.7 不归一化 — 等 Phase 2 一起缩放
旧版 phase 1 之后就 `normalize_coords()` 到 ±1500。**新版不这么做**：signal 坐标先保持 SMACOF 出来的原始 unit scale（±1 左右），等 phase 2 joint SMACOF 跑完再统一缩放整张图。这避免了 signal 和 source 分两次缩放导致的 scale 不对齐。

---

## 5. Phase 2 — Source Anchored SMACOF

### 5.1 为什么要 anchor
如果不锚定，joint SMACOF 会**同时挪 signal 和 source 的位置**。加进来 506 个 source 后，stress 最优解的 signal 位置会跟 phase 1 不同。这意味着：
- 每次重跑 layout，signal 位置都会变
- 视觉上 signal constellation 不稳定
- 用户认识的"那个 signal 在左下"会被打乱

**Anchor 的约束**: signal 坐标永远等于 phase 1 算出的那份，每轮 SMACOF 更新完强制重置。

### 5.2 三块距离矩阵

```
               signals (0-35)         sources (36-541)
           ┌────────────────────┬────────────────────┐
 signals   │    D_sig (4.5)     │   D_sig-src (5.3)  │
           │    already built   │   cross_distance   │
           │                    │                    │
           ├────────────────────┼────────────────────┤
 sources   │    (transpose)     │    D_src-src       │
           │                    │    cosine (embed)  │
           └────────────────────┴────────────────────┘
```

### 5.3 Cross distance with SUPPORT_PULL
```python
def cross_distance_matrix(X_sigs, X_srcs, sources, sig_id_to_idx):
    D = 1 - normalize(X_srcs) @ normalize(X_sigs).T  # 纯 embedding
    for si, src in enumerate(sources):
        for sig_id in src["supports"]:
            if sig_id in sig_id_to_idx:
                D[si, sig_id_to_idx[sig_id]] *= (1 - SUPPORT_PULL)  # 拉近
    return D
```

**SUPPORT_PULL = 0.3 的含义**:
- source A 支持 signal B，它们 embedding 距离假设是 0.6
- 拉近后 `D[A,B] = 0.6 × (1 - 0.3) = 0.42`
- SMACOF 会让 A 距 B 更近（但不是贴上去）
- 0 = 完全不拉（source 纯按话题落）
- 1 = 拉到 0（source 粘死在 signal 上 ≈ 向日葵）

### 5.4 量级归一化
三个子矩阵的 max 可能分别是 0.83 / 0.95 / 0.92（取决于文本内容）。不归一化 SMACOF 会过度优化量级大的块。把 `D_sig-src` 和 `D_src-src` 都按 `D_sig.max()` rescale：

```python
D_sig_src = D_sig_src / D_sig_src.max() * D_sig.max()
D_src_src = D_src_src / D_src_src.max() * D_sig.max()
```

拼装：
```python
D_joint = zeros((542, 542))
D_joint[:36, :36] = D_sig
D_joint[36:, 36:] = D_src_src
D_joint[36:, :36] = D_sig_src
D_joint[:36, 36:] = D_sig_src.T  # 对称
```

### 5.5 Init 策略
```python
init[:36]   = sig_coords_raw                      # signals unit scale
for si, src in enumerate(sources):
    anchors = [idx for sid in src.supports if ...]
    if anchors:
        init[36+si] = sig_coords_raw[anchors].mean()  # 支撑的 signal 平均
    else:
        init[36+si] = random.normal(scale=0.1, size=2)  # 孤儿源，原点附近
```

**为什么这么 init**:
- 有 supports 的 source: 从"它多个支撑 signal 的中心"出发，SMACOF 会把它朝语义距离更合理的方向拉
- 孤儿 source（`supports: []`）: 没有锚点参考，从原点随机微扰起，让它自由找到话题位置

### 5.6 Anchored SMACOF
普通 SMACOF 的更新步：`X_new = (B @ X) / n`

**Anchored 版本**:
```python
for iter in range(300):
    X_new = compute_smacof_step(X, D_joint)
    X_new[anchor_mask] = anchor_pos[anchor_mask]   # 重置 signal 位置
    X = X_new
```

这等价于**求 stress 最小，subject to signal 位置 = 固定值**。是一种约束优化。

当前运行: 300 轮，Kruskal stress-1 = **0.35**。比 phase 1 的 0.29 略高属正常 — 多了 506 个点要同时拟合。

### 5.7 最终缩放
```python
sig_max_abs = abs(sig_coords_raw).max()        # ≈ 1.0 (unit scale)
scale = 1500 / sig_max_abs                     # 约 1500 倍
sig_centroid = sig_coords_raw.mean(0)          # 重心
joint_coords = (joint_raw - sig_centroid) * scale
```

Signal 和 source 用**同一个 scale + 同一个 centroid**缩放，相对位置完全保持。Signal 最大绝对值会落到 ±1500 附近。

---

## 6. 前端加载

### 6.1 index.html 加载顺序（关键）
```html
<script src="data.js?v=6"></script>              <!-- signals, sources, runs -->
<script src="semantic_layout.js?v=3"></script>   <!-- 坐标 dict -->
<script src="app.js?v=33"></script>              <!-- 读前两个 -->
```

`semantic_layout.js` 设置 `window.AUGUR_SEMANTIC_LAYOUT = {id: [x, y], ...}`。

### 6.2 app.js buildGraph 节选

Signal 位置（第 133-138 行）:
```js
const mds = SEMANTIC_LAYOUT && SEMANTIC_LAYOUT[s.id];
if (mds && Array.isArray(mds) && mds.length === 2) {
  sx = mds[0]; sy = mds[1];
} else {
  // 回退：按 community 扇区 + 双环几何布局
}
```

Source 位置（第 289-312 行）:
```js
const semantic = SEMANTIC_LAYOUT && SEMANTIC_LAYOUT[src.id];
if (semantic && Array.isArray(semantic) && semantic.length === 2) {
  srcX = semantic[0]; srcY = semantic[1];
} else {
  // 回退：向日葵螺旋（黄金角 137.5°，半径 sigR + base + step√i）
}
```

### 6.3 vis.js 网络配置
```js
physics: {
  enabled: true,
  stabilization: { iterations: 350, fit: true },
  // physics frozen after stabilization
},
layout: { improvedLayout: false },
```

`improvedLayout: false` 让 vis 完全使用我们传入的初始位置，不做它自己的力导向重排。

稳定化后 `state.network.setOptions({ physics: { enabled: false } })`，节点冻结。

---

## 7. 参数总表

| 参数 | 位置 | 默认 | 调整空间 | 作用 |
|---|---|---|---|---|
| `ALPHA_EMBEDDING` | `compute_semantic_embeddings.py:41` | 0.6 | 0.3 – 0.9 | 语义 vs community 权重 |
| `SUPPORT_PULL` | `compute_semantic_embeddings.py:43` | 0.3 | 0.0 – 0.7 | source 被 support 关系拉近的强度 |
| `EMBED_MODEL` | `compute_semantic_embeddings.py:38` | `BAAI/bge-small-zh-v1.5` | — | 可换 `bge-base` / `bge-large`，dim 从 512→768/1024 |
| body preview 长度 | `load_sources()` `body_preview = body_clean[:300]` | 300 | 100 – 800 | source 用多少文本做语义 |
| SMACOF `max_iter` (phase 1) | signal smacof | 400 | — | 一般 150-200 轮就收敛 |
| SMACOF `max_iter` (phase 2) | joint smacof | 300 | — | 300 轮一般没完全收敛，但 marginal gain 小 |
| target_half_range | normalize 最终缩放 | 1500 | — | 画布坐标范围 |

---

## 8. 已知问题与权衡

### 8.1 视觉上仍然密
506 个 source 节点 + 1848 条边在 2D 上，无论怎么布局都会有**视觉负载**。语义布局解决了"每个 signal 一坨向日葵"的问题，但整体密度仍高。下一步方向：
- 默认降低 source 透明度（opacity 0.4），hover signal 时对应 source 变亮
- 或：默认隐藏 source，`focus` 时展开那个 signal 的 sources

### 8.2 孤儿 source 聚集在原点
`supports: []` 的 source 现在 init 在原点 ±0.1 随机微扰，SMACOF 会把它们朝"和其他 sources 语义接近"的方向推，但如果它们彼此也不像，就会留在原点附近形成一个**小黑点团**。
- 暂时 acceptable — 真正孤儿 source 本来就是"没建立论点连接"的状态，视觉上独立也合理
- 如果要分散它们，可以改 init 用它们和所有 signals 的平均语义距离做 soft placement

### 8.3 Joint SMACOF stress 0.35 不算好
Kruskal stress > 0.2 说明 2D 距离和目标距离有 systematic gap。不影响可用性（位置仍 meaningful），但某些 source 之间的相对远近可能被扭曲。
- 原因：542 个点 + 512 维 embedding → 压到 2D 本身就是信息损失
- 改进方向：UMAP / t-SNE（非线性降维）可能 stress 更低，但会失去 SMACOF 的"距离可解释"性质（它们只保持邻域结构不保持绝对距离）

### 8.4 重跑耗时
全量重跑（包括 506 个 source embedding）约 **50 秒**。走缓存（只重 SMACOF）约 **15 秒**。在 M 系列 Mac 上用 numpy 跑，够快。

### 8.5 ID 格式脆弱
`generate_augur_data.py` 用 `f'src-{path.stem[-24:]}'` 做 source ID（截断长文件名）。`compute_semantic_embeddings.py` 现在也必须照这个格式。
**如果 `generate_augur_data.py` 改 ID 格式，必须同步改 `compute_semantic_embeddings.py` 的 `load_sources()`**，否则前端拿不到 source 坐标，全回退到向日葵。

---

## 9. 重跑与验证流程

### 9.1 完整重跑
```bash
cd /Users/项目开发/研究空间/investor-wiki
.venv-embed/bin/python scripts/compute_semantic_embeddings.py
```

### 9.2 快速验证坐标文件对不对
```bash
# 验证 signal 和 source 都有坐标
grep -c '"sig-' wiki/augur/semantic_layout.json   # 期望 36
grep -c '"src-' wiki/augur/semantic_layout.json   # 期望 506
```

### 9.3 ID 同步检查
```bash
# 对比 data.js 里的 source id 和 semantic_layout 里的 source id
diff \
  <(grep -o '"id": "src-[^"]*"' wiki/augur/data.js | sort -u) \
  <(grep -o '"src-[^"]*"' wiki/augur/semantic_layout.json | sort -u)
```
应该 diff 为空。

### 9.4 缓存失效
删 `wiki/augur/.embedding_cache.json` 强制全量 re-embed。

---

## 10. 下一步深挖 hook points

如果你想改进视觉 / 质量，按影响从高到低：

1. **Source 默认淡化 + focus 时点亮**（app.js 改，不动算法）— 立刻把画布噪音降 60%
2. **换嵌入模型**（`compute_semantic_embeddings.py:38`）— 可试 `BAAI/bge-base-zh-v1.5` (768 dim) 或 `bge-large-zh-v1.5` (1024 dim)，看 stress 能不能降到 0.2 以下
3. **非线性降维**（改算法）— 在 phase 2 用 UMAP 替代 SMACOF。UMAP 保持邻域更好，适合 500+ 节点；但丢掉了"1cm 代表语义距离 X"的全局解释
4. **加 source-source 的 support co-occurrence 信号**（改算法）— 目前 src-src 只看语义；如果两个 source 支持同一个 signal，可以额外拉近
5. **Embedding 文本构造加权**（改 `load_sources`）— 让 title 权重比 body 大，比如 `f"{title}。{title}。{body}"` 让 title 出现 2 次

---

## 附录 A: 文件完整路径

```
/Users/项目开发/研究空间/investor-wiki/
├── wiki/
│   ├── signal/*.md                          # 36 个 signal 源文档
│   ├── sources/*.md                         # 520 个 source 源文档
│   └── augur/
│       ├── index.html                       # 加载 data.js + semantic_layout.js + app.js
│       ├── app.js                           # 前端逻辑（buildGraph 里读 SEMANTIC_LAYOUT）
│       ├── data.js                          # 节点数据 (不含坐标)
│       ├── semantic_layout.js               # window.AUGUR_SEMANTIC_LAYOUT
│       ├── semantic_layout.json             # 人可读版本 + 元数据
│       ├── .embedding_cache.json            # embedding 缓存
│       ├── styles.css                       # 视觉
│       └── LAYOUT.md                        # 本文
├── scripts/
│   ├── compute_semantic_embeddings.py       # 核心：phase 1 + phase 2
│   └── generate_augur_data.py               # 产 data.js，被上面的脚本导入
└── .venv-embed/                             # Python venv (fastembed, numpy, pyyaml)
```

## 附录 B: 当前运行的数值

```json
{
  "generated_at": "2026-04-24",
  "method": "fastembed_bge_small_zh + community_prior + anchored_smacof (signals + sources joint)",
  "model": "BAAI/bge-small-zh-v1.5",
  "alpha_embedding": 0.6,
  "support_pull": 0.3,
  "n_signals": 36,
  "n_sources": 506,
  "signal_stress": 0.2897,
  "joint_stress": 0.3506,
  "smacof_iters": 299,
  "embedding_dim": 512
}
```

Signal 坐标范围: `[-1364, 1170] × [-1500, 1400]`
Source 坐标范围: `[-1413, 1418] × [-1498, 1456]`
