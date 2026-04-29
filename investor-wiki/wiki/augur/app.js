// Augur — main app logic
// Builds vis.js graph from AUGUR_DATA, wires up Daily Pulse, hover card, tweaks.

(function() {
  const { SIGNALS, SOURCES, COMMUNITIES, SOURCE_KINDS, TODAY, daysAgo, RUNS, ENVISION_TEXT } = window.AUGUR_DATA;
  const SIGNALS_BY_ID = Object.fromEntries(SIGNALS.map(s => [s.id, s]));

  // ───── State ─────
  const state = {
    timeWindow: 'month',     // today | week | month — default 'month' 让日记更丰富
    hideSources: false,
    focusedSignal: null,
    mutedCommunities: new Set(),
    canvasDragging: false,
    canvasWheelMotion: false,
    hoveredNodeId: null,
    hoverCardNodeId: null,
    network: null,
    nodesDs: null,
    edgesDs: null,
    density: 'full',
    darkMode: false,
    showDeltas: true,
    pulsePlacement: 'left',  // left | floating | top
    panSuppressClickUntil: 0,
  };

  function graphEl() {
    return document.getElementById('graph');
  }

  function syncGraphCursorState() {
    const el = graphEl();
    if (!el) return;
    if (el.classList.contains('is-dragging')) {
      el.classList.remove('is-hover-node');
      return;
    }
    el.classList.toggle('is-hover-node', !!state.hoveredNodeId);
  }

  function isCanvasMotionActive() {
    return !!(state.canvasDragging || state.canvasWheelMotion);
  }

  function setGraphDragging(on) {
    const el = graphEl();
    if (!el) return;
    state.canvasDragging = !!on;
    el.classList.toggle('is-dragging', !!on);
    if (on) el.classList.remove('is-hover-node');
    else syncGraphCursorState();
  }

  // ───── Helpers ─────
  const daysBetween = (dateStr) => {
    const d = new Date(dateStr);
    const diffMs = TODAY - d;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  };
  const deadlineDays = (dateStr) => {
    if (!dateStr) return null;
    return Math.round((new Date(dateStr) - TODAY) / (1000*60*60*24));
  };

  // Community color: hash slug → HSL → hex. Communities are LLM-emergent (no fixed palette).
  // MUST output #rrggbb because downstream shade() / withAlpha() parse hex; hsl strings break them.
  // Falls back to COMMUNITIES[cid].color if generator still emitted one (backward compat).
  function hslToHex(hDeg, sPct, lPct) {
    const s = sPct / 100, l = lPct / 100;
    const k = (n) => (n + hDeg / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const ch = (n) => {
      const v = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return Math.round(v * 255).toString(16).padStart(2, '0');
    };
    return '#' + ch(0) + ch(8) + ch(4);
  }
  const communityColor = (cid) => {
    if (!cid) return '#888';
    const preset = COMMUNITIES[cid]?.color;
    if (preset) return preset;
    let h = 0;
    const s = String(cid);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return hslToHex(h % 360, 52, 48);
  };

  // Obsidian 跳转 helper
  // VAULT_PATH 由 generate_augur_data.py inject(window.AUGUR_VAULT_PATH),
  // 主支线 = "investor-wiki/wiki",fork = "investor-wiki/forks/{ts}-{slug}"
  const VAULT_NAME = '研究空间';
  const VAULT_PATH = (window.AUGUR_VAULT_PATH || 'investor-wiki/wiki').replace(/^\/+|\/+$/g, '');
  function obsidianUrl(kind, slug) {
    if (!slug) return null;
    const subdir = kind === 'signal' ? 'signal' : 'sources';
    const vault = encodeURIComponent(VAULT_NAME);
    const file = encodeURIComponent(`${VAULT_PATH}/${subdir}/${slug}`);
    return `obsidian://open?vault=${vault}&file=${file}`;
  }
  function openInObsidian(kind, slug) {
    const url = obsidianUrl(kind, slug);
    if (url) window.location.href = url;
  }
  // Expose for E2E testing + devtools debugging
  window.__augur = window.__augur || {};
  window.__augur.obsidianUrl = obsidianUrl;
  window.__augur.openInObsidian = openInObsidian;

  const convBucket = (signal) => {
    const delta = signal.prevConviction == null ? null : signal.conviction - signal.prevConviction;
    if (delta == null) return 'new';
    if (delta > 0) return 'up';
    if (delta < 0) return 'down';
    return 'flat';
  };

  // ───── Build graph data ─────
  function buildGraph() {
    const nodes = [];
    const edges = [];

    // ── Community-based radial layout ──
    // 每个 community 占据一个扇区（按 signal 数量加权）。扇区的圆周**顺序**按
    // 思想邻接手工排列（PoC 1），让相邻 community 语义相关 → cross-community
    // 张力/支持线自然变短，视觉上也有"主题流动"感。
    const commSize = {};
    SIGNALS.forEach(s => { commSize[s.community] = (commSize[s.community] || 0) + 1; });

    // 思想邻接圆周顺序（相邻 community 语义相关）：
    //   ai-infra → physical-infra → macro-rotation → value-invest
    //   → shorts → private-credit → market-structure → (环回 ai-infra)
    const COMMUNITY_CYCLE = [
      'ai-infra',
      'physical-infra',
      'macro-rotation',
      'value-invest',
      'shorts',
      'private-credit',
      'market-structure',
    ];
    // 用 cycle 顺序覆盖默认 Object.keys 偶然顺序。未在 cycle 里的 community（新加的）
    // 追加到末尾，避免漏。
    const commList = [
      ...COMMUNITY_CYCLE.filter(c => commSize[c]),
      ...Object.keys(commSize).filter(c => !COMMUNITY_CYCLE.includes(c)),
    ];
    const totalSigs = SIGNALS.length || 1;

    // 按扇区中心角度，从顶部开始顺时针分配
    const commAngle = {};
    let accAngle = -Math.PI / 2;
    commList.forEach(cid => {
      const slice = (commSize[cid] / totalSigs) * 2 * Math.PI;
      commAngle[cid] = accAngle + slice / 2;
      accAngle += slice;
    });

    const SIGNAL_R = 620;

    // 按 community 分组、组内按 conviction 降序，预计算每个 signal 的 rank
    // 大 community（>5）分内外两圈：conviction 高的外圈（显眼）、低的内圈
    const sigRank = {};  // s.id → { rank, total }
    const commGroups = {};
    SIGNALS.forEach(s => { (commGroups[s.community] ||= []).push(s); });
    Object.keys(commGroups).forEach(cid => {
      const sorted = [...commGroups[cid]].sort((a, b) => b.conviction - a.conviction);
      sorted.forEach((s, i) => { sigRank[s.id] = { rank: i, total: sorted.length }; });
    });

    // 记录 signal 的初始位置，source 将锚定到其 primary signal 附近
    const sigPos = {};

    // 若有 MDS 语义布局（scripts/compute_semantic_mds.py 生成），优先用它的坐标。
    // 缺失的 signal 回退到扇区 + 双环的几何布局。
    const SEMANTIC_LAYOUT = (typeof window !== 'undefined' && window.AUGUR_SEMANTIC_LAYOUT) || null;

    SIGNALS.forEach(s => {
      const color = communityColor(s.community);
      const convFrac = Math.max(0.05, Math.min(1, s.conviction / 100));
      const baseSize = 12 + Math.pow(convFrac, 2.2) * 76;
      const daysSinceUpdate = daysBetween(s.last_modified || s.last_verified || s.created);
      const sat = daysSinceUpdate <= 3 ? 1.0
                : daysSinceUpdate <= 14 ? 0.9
                : daysSinceUpdate <= 45 ? 0.72
                : 0.55;
      const fillColor = withAlpha(color, sat);

      let sx, sy;
      const mds = SEMANTIC_LAYOUT && SEMANTIC_LAYOUT[s.id];
      if (mds && Array.isArray(mds) && mds.length === 2) {
        // 语义坐标
        sx = mds[0];
        sy = mds[1];
      } else {
        // 扇区 fallback — 原几何布局
        const angle = commAngle[s.community] ?? 0;
        const { rank, total } = sigRank[s.id];
        const useTwoRings = total > 5;
        let myRingIdx, myRingCount, ringROffset;
        if (useTwoRings) {
          const outerCount = Math.ceil(total / 2);
          if (rank < outerCount) {
            myRingIdx = rank;
            myRingCount = outerCount;
            ringROffset = 70;
          } else {
            myRingIdx = rank - outerCount;
            myRingCount = total - outerCount;
            ringROffset = -90;
          }
        } else {
          myRingIdx = rank;
          myRingCount = total;
          ringROffset = 0;
        }
        const tangent = (myRingIdx - (myRingCount - 1) / 2) * (baseSize + 130);
        const radial = (Math.random() - 0.5) * 20;
        const r = SIGNAL_R + ringROffset + radial;
        const cx = r * Math.cos(angle);
        const cy = r * Math.sin(angle);
        const tx = -Math.sin(angle);
        const ty = Math.cos(angle);
        sx = cx + tx * tangent;
        sy = cy + ty * tangent;
      }
      sigPos[s.id] = { x: sx, y: sy, size: baseSize };

      nodes.push({
        id: s.id,
        label: s.name,
        _type: 'signal',
        _data: s,
        _color: color,
        _baseSize: baseSize,
        shape: 'dot',
        size: baseSize,
        x: sx,
        y: sy,
        // MDS 算的坐标直接用，physics 完全不动 signal 位置，否则 barnesHut 的斥力 +
        // 同簇 spring 链会把语义布局推歪。
        fixed: { x: true, y: true },
        physics: false,
        // 单层纯色 — 去掉 border 双圈避免视觉噪声
        color: { background: fillColor, border: fillColor },
        borderWidth: 0,
        font: {
          face: 'Inter, "PingFang SC", "Noto Sans SC", -apple-system, sans-serif',
          size: 24,
          color: '#1A1A1C',
          strokeColor: 'rgba(250,250,247,0.98)',
          strokeWidth: 6,
          vadjust: -(baseSize + 18),
          bold: { face: 'Inter, "PingFang SC", "Noto Sans SC", sans-serif', size: 24 },
        },
      });
    });

    // Signal-signal edges: 同 community 全连接成簇（弱边，仅用于聚拢）
    // 可见主链 visible（按 conviction 降序串连）+ 隐形 layout 边（两两全连接）
    const byComm = {};
    SIGNALS.forEach(s => { (byComm[s.community] ||= []).push(s); });
    Object.values(byComm).forEach(group => {
      if (group.length < 2) return;
      const sorted = [...group].sort((a,b) => b.conviction - a.conviction);
      const color = communityColor(sorted[0].community);
      // 可见主链（conviction 降序连接相邻）— 纯视觉线，不参与 physics
      for (let i = 0; i < sorted.length - 1; i++) {
        edges.push({
          from: sorted[i].id,
          to: sorted[i+1].id,
          _type: 'sig-sig',
          _stance: 'support',
          color: {
            color: withAlpha(shade(color, -15), 0.45),
            highlight: shade(color, -30),
            hover: shade(color, -30),
          },
          width: 1.6,
          physics: false,
        });
      }
      // 原本有"两两全连接"的隐形边来聚拢同 community — 现在初始位置按扇区双环排好
      // 不再需要，且这些 spring 会把同簇 signal 互相拖成一团。删除。
    });

    // Cross-community edges — some SUPPORT (reinforce), some TENSION (contradict)
    const crossPairs = [
      { a: 'sig-gold', b: 'sig-sell-america', stance: 'support' },
      { a: 'sig-alchemist', b: 'sig-agent-harness', stance: 'support' },
      { a: 'sig-alchemist', b: 'sig-china-model', stance: 'tension' },   // US alchemist vs China model
      { a: 'sig-hyperscaler-capex', b: 'sig-power-infra', stance: 'support' },
      { a: 'sig-private-capital', b: 'sig-cape', stance: 'tension' },    // lots of private capital vs high public CAPE
      { a: 'sig-vibe-investing', b: 'sig-cape', stance: 'tension' },     // retail froth vs valuation concern
    ];
    crossPairs.forEach(({a, b, stance}) => {
      // 跨 community edges — physics:false，只做视觉连接，不把两 community 拉拢
      if (stance === 'support') {
        edges.push({
          from: a, to: b, _type: 'sig-sig', _stance: 'support',
          color: {
            color: 'rgba(60, 80, 110, 0.5)',
            highlight: 'rgba(40, 60, 90, 0.9)',
            hover: 'rgba(40, 60, 90, 0.9)',
          },
          width: 1.5,
          physics: false,
        });
      } else {
        edges.push({
          from: a, to: b, _type: 'sig-sig', _stance: 'tension',
          color: {
            color: 'rgba(200, 60, 40, 0.65)',
            highlight: 'rgba(200, 60, 40, 0.95)',
            hover: 'rgba(200, 60, 40, 0.95)',
          },
          width: 1.6,
          dashes: [6, 4],
          physics: false,
        });
      }
    });

    // Source nodes + edges
    // 先按 primary signal 分组，source 以向日葵螺旋（黄金角）分布在 signal 外圈，
    // 每组内部自然铺开，绝不互相重叠。
    const sourcesByPrimary = {};
    SOURCES.forEach(src => {
      const pid = src.signals[0];
      if (pid) (sourcesByPrimary[pid] ||= []).push(src);
    });
    const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));  // ≈ 137.5°
    const SRC_R_BASE = 14;   // 离 signal 表面的基础距离
    const SRC_R_STEP = 2.5;  // 步长减小，让花瓣更紧凑

    SOURCES.forEach(src => {
      const primarySig = SIGNALS.find(s => s.id === src.signals[0]);
      const color = communityColor(primarySig?.community);
      const age = daysBetween(src.date);
      const opacity = age <= 7 ? 1 : age <= 30 ? 0.75 : 0.45;
      const isNew = age <= 1;
      const shortLabel = (src.title || '').length > 22
        ? src.title.slice(0, 20).trim() + '…'
        : (src.title || '');

      // 优先用 joint SMACOF 的语义坐标（semantic_layout.js 里 source 也有位置）。
      // 缺失才回退到向日葵螺旋。
      let srcX, srcY;
      const semantic = SEMANTIC_LAYOUT && SEMANTIC_LAYOUT[src.id];
      if (semantic && Array.isArray(semantic) && semantic.length === 2) {
        srcX = semantic[0];
        srcY = semantic[1];
      } else {
        const anchor = sigPos[primarySig?.id];
        if (anchor) {
          const group = sourcesByPrimary[primarySig.id] || [];
          const idx = group.indexOf(src);
          const sigRadius = (anchor.size || 30) / 2;
          const r = sigRadius + SRC_R_BASE + SRC_R_STEP * Math.sqrt(idx);
          const angle = idx * GOLDEN_ANGLE;
          srcX = anchor.x + r * Math.cos(angle);
          srcY = anchor.y + r * Math.sin(angle);
        } else {
          const a = Math.random() * Math.PI * 2;
          const r = 150 + Math.random() * 200;
          srcX = r * Math.cos(a);
          srcY = r * Math.sin(a);
        }
      }

      nodes.push({
        id: src.id,
        _type: 'source',
        _data: src,
        _color: color,
        _shortLabel: shortLabel,
        shape: 'dot',
        // source 统一大小 — 只用颜色表达所属 community，不用大小编码新旧
        size: 3.5,
        x: srcX,
        y: srcY,
        // 质量小 → physics 推力对 source 影响弱，向日葵螺旋初始位置得以保留
        mass: 0.3,
        color: {
          background: withAlpha(color, opacity),
          border: withAlpha(shade(color, -20), opacity),
          highlight: { background: color, border: shade(color, -35) },
        },
        borderWidth: 0.5,
        label: '',
        font: {
          face: 'Inter, "PingFang SC", "Noto Sans SC", -apple-system, sans-serif',
          size: 12,
          color: shade(color, -45),
          strokeColor: 'rgba(250,250,247,0.95)',
          strokeWidth: 3.5,
          vadjust: -11.5,
        },
      });
      src.signals.forEach((sigId, i) => {
        // Credibility affects line weight; primary signal is heavier.
        const credMult = src.cred === 'high' ? 1.0 : src.cred === 'med' ? 0.75 : 0.55;
        const baseW = i === 0 ? 1.3 : 0.9;
        const edgeOpacity = Math.min(0.9, 0.45 * opacity + (src.cred === 'high' ? 0.15 : 0));
        // primary edge 有短 spring(源靠近其主 signal);次要 edge physics:false 避免乱拉
        edges.push({
          from: src.id, to: sigId, _type: 'src-sig', _stance: 'support',
          color: {
            color: withAlpha(shade(color, -15), edgeOpacity),
            highlight: shade(color, -35),
            hover: shade(color, -35),
          },
          width: baseW * credMult,
          dashes: src.cred === 'low' ? [3, 3] : false,
          length: i === 0 ? 110 : 160,
          physics: i === 0,
        });
      });
    });

    return { nodes, edges };
  }

  // Color helpers
  function shade(hex, amt) {
    const m = hex.replace('#','').match(/.{2}/g).map(x => parseInt(x,16));
    const out = m.map(v => Math.max(0, Math.min(255, v + amt)));
    return '#' + out.map(v => v.toString(16).padStart(2,'0')).join('');
  }
  function withAlpha(hex, a) {
    const m = hex.replace('#','').match(/.{2}/g).map(x => parseInt(x,16));
    return `rgba(${m[0]},${m[1]},${m[2]},${a})`;
  }

  // ───── Init network ─────
  function initNetwork() {
    const { nodes, edges } = buildGraph();
    state.nodesDs = new vis.DataSet(nodes);
    state.edgesDs = new vis.DataSet(edges);

    state.network = new vis.Network(
      document.getElementById('graph'),
      { nodes: state.nodesDs, edges: state.edgesDs },
      {
        physics: {
          enabled: true,
          solver: 'barnesHut',
          barnesHut: {
            // 初始位置已按 community 扇区 + 双环排好，physics 只做微调去重叠。
            gravitationalConstant: -2000,
            centralGravity: 0.03,
            springLength: 90,
            springConstant: 0.06,
            damping: 0.94,
            avoidOverlap: 0.65,
          },
          stabilization: { iterations: 350, updateInterval: 25, fit: true },
          maxVelocity: 30,
          timestep: 0.35,
          adaptiveTimestep: true,
        },
        interaction: {
          // pan/zoom 由 wireCanvasControls() 托管（仅作用于 #graph）。
          // vis 这层只负责命中/hover/click。
          hover: true,
          hoverConnectedEdges: false,
          selectConnectedEdges: false,
          tooltipDelay: 1e9,
          zoomView: false,
          dragView: false,
          dragNodes: false,
          navigationButtons: false,
          keyboard: false,
        },
        layout: { improvedLayout: false },
        nodes: {
          shadow: { enabled: false },
          chosen: false,   // 禁 hover/select 视觉切换 —— hover 不改颜色、不 redraw
        },
        edges: {
          hoverWidth: 0,
          selectionWidth: 0,
          chosen: false,
        },
      }
    );

    state.network.once('stabilizationIterationsDone', () => {
      state.network.setOptions({ physics: { enabled: false } });
      state.network.fit({ animation: { duration: 500, easingFunction: 'easeOutQuad' } });
      setTimeout(() => renderDeltaBadges(), 550);
    });
    // Fallback: force fit even if stabilization hasn't reported done
    setTimeout(() => {
      if (state.network && state.network.getScale() === 1) {
        state.network.setOptions({ physics: { enabled: false } });
        state.network.fit({ animation: { duration: 600, easingFunction: 'easeOutQuad' } });
        setTimeout(() => renderDeltaBadges(), 650);
      }
    }, 1500);
    window.__augurNetwork = state.network;
    wireCanvasControls();
    wireCommunityHalos();
    applySourceLabelZoom();

    // Hover → card。只保留最小延迟，避免闪烁。
    let _hideHoverTimer = null;
    const cancelHide = () => {
      if (_hideHoverTimer) { clearTimeout(_hideHoverTimer); _hideHoverTimer = null; }
    };
    const scheduleHide = (delay = 90) => {
      cancelHide();
      _hideHoverTimer = setTimeout(hideHoverCard, delay);
    };
    state.network.on('hoverNode', (p) => {
      if (isCanvasMotionActive()) return;
      cancelHide();
      const node = state.nodesDs.get(p.node);
      if (!node) return;
      state.hoveredNodeId = p.node;
      syncGraphCursorState();
      showHoverCard(p.node, p.event);
    });
    state.network.on('blurNode', () => {
      if (isCanvasMotionActive()) return;
      state.hoveredNodeId = null;
      syncGraphCursorState();
      scheduleHide();
    });
    const hc = hoverEl();
    if (hc) {
      hc.addEventListener('pointerenter', cancelHide);
      hc.addEventListener('pointerleave', () => {
        if (!state.hoveredNodeId) scheduleHide(0);
      });
    }
    // Programmatic zoom/focus（fit/moveTo）也同步 label gating。
    state.network.on('zoom', applySourceLabelZoom);

    // 点击 node → 打开 Obsidian；点击空白 → 清 focus；双击 signal → focus
    state.network.on('click', (p) => {
      if (Date.now() < state.panSuppressClickUntil) return;
      if (p.nodes.length) {
        const node = state.nodesDs.get(p.nodes[0]);
        if (!node) return;
        openInObsidian(node._type, (node._data || {}).slug);
      } else {
        clearFocus();
      }
    });
    state.network.on('doubleClick', (p) => {
      if (Date.now() < state.panSuppressClickUntil) return;
      if (p.nodes.length) {
        const node = state.nodesDs.get(p.nodes[0]);
        if (node && node._type === 'signal') focusSignal(p.nodes[0]);
      }
    });
    state.network.on('animationFinished', renderDeltaBadges);
  }

  // ───── Community halos (graphify-style 色块聚簇) ─────
  // 用 afterDrawing hook 在每个 community 的 signal 节点群周围画半透明色块，
  // 让 signals "属于同一簇" 视觉上立刻可见。
  function wireCommunityHalos() {
    if (!state.network) return;
    state.network.on('afterDrawing', function(ctx) {
      // 按 community 分组收集 signal 位置
      const byComm = {};
      SIGNALS.forEach(s => {
        if (state.mutedCommunities.has(s.community)) return;
        const node = state.nodesDs.get(s.id);
        if (!node || node.hidden) return;
        const pos = state.network.getPositions([s.id])[s.id];
        if (!pos) return;
        (byComm[s.community] ||= []).push({ x: pos.x, y: pos.y, size: node.size || 20 });
      });

      Object.entries(byComm).forEach(([cid, points]) => {
        if (points.length === 0) return;
        const color = communityColor(cid);

        // 点数少于 3 个：每个点画独立光晕，不画 hull（避免 2 点 fallback 画成巨圆）
        if (points.length < 3) {
          points.forEach(p => {
            ctx.save();
            ctx.globalAlpha = 0.10;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size + 40, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          });
          return;
        }

        // 多个节点：取距质心最近的 70% 进 hull，剩下 30% 当 outlier
        const cx0 = points.reduce((s, p) => s + p.x, 0) / points.length;
        const cy0 = points.reduce((s, p) => s + p.y, 0) / points.length;
        const withDist = points.map(p => ({ p, d: Math.hypot(p.x - cx0, p.y - cy0) }));
        withDist.sort((a, b) => a.d - b.d);
        const cutIdx = Math.max(2, Math.ceil(points.length * 0.7));
        const core = withDist.slice(0, cutIdx).map(x => x.p);
        const outliers = withDist.slice(cutIdx).map(x => x.p);

        // Outlier 每个画一个独立圆光晕
        outliers.forEach(p => {
          ctx.save();
          ctx.globalAlpha = 0.10;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size + 40, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });

        // core 不足 3 点：给 core 里每个点也画独立光晕，不画 hull
        if (core.length < 3) {
          core.forEach(p => {
            ctx.save();
            ctx.globalAlpha = 0.10;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size + 40, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          });
          return;
        }

        // Core 重算质心 + 扩展点 → convex hull
        const cx = core.reduce((s, p) => s + p.x, 0) / core.length;
        const cy = core.reduce((s, p) => s + p.y, 0) / core.length;
        const padding = 60;
        const expanded = core.map(p => {
          const dx = p.x - cx;
          const dy = p.y - cy;
          const dist = Math.sqrt(dx*dx + dy*dy) || 1;
          const scale = (dist + padding + p.size) / dist;
          return { x: cx + dx * scale, y: cy + dy * scale };
        });
        const hull = convexHull(expanded);
        if (hull.length < 3) return;  // 退化成个别点光晕已经在上面处理

        // Draw hull with rounded fill
        ctx.save();
        ctx.globalAlpha = 0.09;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(hull[0].x, hull[0].y);
        for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i].x, hull[i].y);
        ctx.closePath();
        ctx.fill();
        // subtle border
        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      });
    });
  }

  // Gift-wrap convex hull
  function convexHull(pts) {
    if (pts.length < 3) return pts;
    const sorted = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (O, A, B) => (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
    const lower = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop();
      upper.push(p);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }

  // ───── Source label zoom gating ─────
  // Source nodes carry `_shortLabel` but render with label='' by default so the
  // overview stays clean. Once the user zooms past SHOW_AT, we swap the label in;
  // below it we swap it back out. We also scale font opacity across a band to
  // avoid a binary pop-in.
  const SRC_LABEL_SHOW_AT = 1.15;   // zoom at which labels first appear
  const SRC_LABEL_FULL_AT = 1.75;   // zoom at which they reach full opacity
  let _srcLabelState = null;         // 'off' | 'on' — debounces identical updates
  function applySourceLabelZoom() {
    if (!state.network || !state.nodesDs) return;
    const scale = state.network.getScale();
    const shouldShow = scale >= SRC_LABEL_SHOW_AT;
    // Also fade strokeColor/color alpha in the band [SHOW_AT .. FULL_AT]
    const t = Math.max(0, Math.min(1, (scale - SRC_LABEL_SHOW_AT) / (SRC_LABEL_FULL_AT - SRC_LABEL_SHOW_AT)));
    // Quantize t to reduce noisy updates during continuous zoom
    const tBucket = Math.round(t * 4) / 4;
    const next = shouldShow ? `on-${tBucket}` : 'off';

    // Skip redundant updates when the zoom bucket hasn't moved.
    if (next === _srcLabelState) return;
    _srcLabelState = next;

    const updates = [];
    state.nodesDs.forEach(n => {
      if (n._type !== 'source') return;
      if (!shouldShow) {
        if (n.label !== '') updates.push({ id: n.id, label: '' });
      } else {
        const desired = n._shortLabel || '';
        const fontColor = shade(n._color, -45);
        updates.push({
          id: n.id,
          label: desired,
          font: {
            ...(n.font || {}),
            color: fontColor,
            size: 9 + Math.round(tBucket * 2),  // 9 → 11 across the band
            strokeColor: `rgba(250,250,247,${0.55 + 0.4 * tBucket})`,
          },
        });
      }
    });
    if (updates.length) state.nodesDs.update(updates);
  }

  // ───── Canvas controls (pan + zoom, scoped to #graph) ─────
  function wireCanvasControls() {
    const el = graphEl();
    if (!el || !state.network) return;

    const MIN_SCALE = 0.05;
    const MAX_SCALE = 5;
    const PINCH_EVENT_MIN = 2;
    const PINCH_DELTA_MIN = 16;
    const PINCH_IDLE_MS = 150;
    const DRAG_THRESHOLD = 3;
    let press = null;
    let wheelPanDx = 0;
    let wheelPanDy = 0;
    let wheelPanRaf = null;
    let wheelPanEndTimer = null;
    let pinchEventCount = 0;
    let pinchDeltaAccum = 0;
    let pinchLastTs = 0;
    let pinchActive = false;

    const endPointerPan = () => {
      if (!press) return;
      const { dragging, pointerId } = press;
      press = null;
      el.releasePointerCapture?.(pointerId);
      if (dragging) {
        setGraphDragging(false);
        hideHoverCard();
        state.hoveredNodeId = null;
        state.panSuppressClickUntil = Date.now() + 140;
      }
      syncGraphCursorState();
    };

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const view = state.network.getViewPosition();
      press = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        viewX: view.x,
        viewY: view.y,
        dragging: false,
      };
      el.setPointerCapture?.(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
      if (!press || e.pointerId !== press.pointerId) return;
      if ((e.buttons & 1) === 0) {
        endPointerPan();
        return;
      }

      const dx = e.clientX - press.startX;
      const dy = e.clientY - press.startY;

      if (!press.dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        press.dragging = true;
        state.hoveredNodeId = null;
        setGraphDragging(true);
        hideHoverCard();
      }

      const scale = state.network.getScale() || 1;
      state.network.moveTo({
        position: {
          x: press.viewX - dx / scale,
          y: press.viewY - dy / scale,
        },
        animation: false,
      });
      scheduleRenderDeltaBadges();
      e.preventDefault();
    });

    el.addEventListener('pointerup', (e) => {
      if (!press || e.pointerId !== press.pointerId) return;
      endPointerPan();
    });
    el.addEventListener('pointercancel', (e) => {
      if (!press || e.pointerId !== press.pointerId) return;
      endPointerPan();
    });

    const flushWheelPan = () => {
      if (wheelPanRaf != null) return;
      wheelPanRaf = requestAnimationFrame(() => {
        wheelPanRaf = null;
        if (!wheelPanDx && !wheelPanDy) return;
        const scale = state.network.getScale() || 1;
        const view = state.network.getViewPosition();
        state.network.moveTo({
          position: {
            x: view.x + wheelPanDx / scale,
            y: view.y + wheelPanDy / scale,
          },
          animation: false,
        });
        wheelPanDx = 0;
        wheelPanDy = 0;
        scheduleRenderDeltaBadges();
      });
    };

    const resetPinchState = () => {
      pinchEventCount = 0;
      pinchDeltaAccum = 0;
      pinchLastTs = 0;
      pinchActive = false;
    };

    const shouldActivatePinch = (deltaY) => {
      const now = performance.now ? performance.now() : Date.now();
      if ((now - pinchLastTs) > PINCH_IDLE_MS) {
        resetPinchState();
      }
      pinchLastTs = now;
      pinchEventCount += 1;
      pinchDeltaAccum += Math.abs(deltaY || 0);
      if (pinchActive) return true;
      if (pinchEventCount >= PINCH_EVENT_MIN && pinchDeltaAccum >= PINCH_DELTA_MIN) {
        pinchActive = true;
      }
      return pinchActive;
    };

    const markWheelMotionActive = () => {
      state.hoveredNodeId = null;
      state.canvasWheelMotion = true;
      hideHoverCard();
      if (wheelPanEndTimer) clearTimeout(wheelPanEndTimer);
      wheelPanEndTimer = setTimeout(() => {
        if (press?.dragging) return;
        state.canvasWheelMotion = false;
        hideHoverCard();
        state.hoveredNodeId = null;
        syncGraphCursorState();
      }, 120);
    };

    // Trackpad pinch on macOS usually maps to wheel+ctrlKey.
    el.addEventListener('wheel', (e) => {
      const isPinch = !!e.ctrlKey;
      e.preventDefault();
      markWheelMotionActive();

      // 只响应双指 pinch，忽略一指/普通滚动，彻底消除“悬停详情时抖动缩放”。
      if (!isPinch) {
        resetPinchState();
        wheelPanDx += e.deltaX;
        wheelPanDy += e.deltaY;
        flushWheelPan();
        return;
      }

      // Pinch 需要连续输入达阈值才激活，屏蔽偶发 ctrlKey 毛刺导致的微缩放抖动。
      if (!shouldActivatePinch(e.deltaY)) return;

      const rect = el.getBoundingClientRect();
      const domPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const canvasPos = state.network.DOMtoCanvas(domPos);
      const currentScale = state.network.getScale() || 1;

      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.02 : 0.003));
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, currentScale * factor));
      const view = state.network.getViewPosition();

      state.network.moveTo({
        scale: newScale,
        position: {
          x: canvasPos.x - (canvasPos.x - view.x) * (currentScale / newScale),
          y: canvasPos.y - (canvasPos.y - view.y) * (currentScale / newScale),
        },
        animation: false,
      });
      applySourceLabelZoom();
      scheduleRenderDeltaBadges();
    }, { passive: false });

    // Safari gesture events fallback: prevent browser page zoom over graph.
    const stopGesture = (e) => e.preventDefault();
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(type => {
      el.addEventListener(type, stopGesture, { passive: false });
    });

    el.addEventListener('pointerleave', () => {
      if (isCanvasMotionActive() || press?.dragging) return;
      state.hoveredNodeId = null;
      syncGraphCursorState();
    });
  }

  // ───── Focus ring (只画 focus-ring，badges 已删除) ─────
  // 之前这里是 delta badges 的 DOM overlay — 删了原因：
  //   1. Pan 时 canvasToDOM 坐标有 1-2 帧延迟，badges 跟不上，视觉 bug
  //   2. Hover card 已经有 conviction delta sparkline，badges 是冗余信息
  //   3. 简化视觉（Karpathy Simplicity First）
  function renderDeltaBadges() {
    // focus ring
    const ring = document.getElementById('focus-ring');
    if (!ring) return;
    if (state.focusedSignal) {
      const pos = state.network.getPositions([state.focusedSignal])[state.focusedSignal];
      if (pos) {
        const dom = state.network.canvasToDOM(pos);
        const node = state.nodesDs.get(state.focusedSignal);
        const r = (node.size || 14) * state.network.getScale() + 10;
        ring.style.left = (dom.x - r) + 'px';
        ring.style.top  = (dom.y - r) + 'px';
        ring.style.width = ring.style.height = (r*2) + 'px';
        ring.classList.add('visible');
      }
    } else {
      ring.classList.remove('visible');
    }
  }

  let _badgeRaf = null;
  function scheduleRenderDeltaBadges() {
    if (_badgeRaf != null) return;
    _badgeRaf = requestAnimationFrame(() => {
      _badgeRaf = null;
      renderDeltaBadges();
    });
  }

  // ───── Hover card ─────
  const hoverEl = () => document.getElementById('hovercard');

  function sparklineSvg(history, w, h, small) {
    if (!history || history.length < 2) {
      return `<svg viewBox="0 0 ${w} ${h}" class="${small?'sparkline':'hc-spark'}"><line x1="4" y1="${h-6}" x2="${w-4}" y2="${h-6}" stroke="var(--ink-5)" stroke-dasharray="2 3"/></svg>`;
    }
    const pad = 4;
    const xs = history.map((_, i) => pad + (i * (w - pad*2)) / (history.length - 1));
    const minV = Math.min(...history.map(p => p.v)) - 5;
    const maxV = Math.max(...history.map(p => p.v)) + 5;
    const ys = history.map(p => pad + (h - pad*2) * (1 - (p.v - minV)/(maxV - minV)));
    const d = history.map((_, i) => `${i===0?'M':'L'}${xs[i].toFixed(1)} ${ys[i].toFixed(1)}`).join(' ');
    const area = d + ` L${xs[xs.length-1].toFixed(1)} ${h-pad} L${xs[0].toFixed(1)} ${h-pad} Z`;
    const lastUp = history.length > 1 && history[history.length-1].v >= history[0].v;
    const stroke = lastUp ? 'var(--up)' : 'var(--down)';
    const fill = lastUp ? 'var(--up-soft)' : 'var(--down-soft)';

    let dots = '';
    history.forEach((p, i) => {
      if (i === history.length-1) {
        dots += `<circle cx="${xs[i].toFixed(1)}" cy="${ys[i].toFixed(1)}" r="2.5" fill="${stroke}"/>`;
      } else {
        dots += `<circle cx="${xs[i].toFixed(1)}" cy="${ys[i].toFixed(1)}" r="1.2" fill="${stroke}" opacity="0.4"/>`;
      }
    });
    return `<svg viewBox="0 0 ${w} ${h}" class="${small?'sparkline':'hc-spark'}" preserveAspectRatio="none" style="width:100%">
      <path d="${area}" fill="${fill}" opacity="0.5"/>
      <path d="${d}" fill="none" stroke="${stroke}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
    </svg>`;
  }

  // Explicit stance relationships between signals (mirrors the edges in buildGraph)
  // Used by the hovercard to group related signals into Supports vs. Tensions.
  const SIG_RELATIONS = [
    { a: 'sig-gold',              b: 'sig-sell-america',  stance: 'support' },
    { a: 'sig-alchemist',         b: 'sig-agent-harness', stance: 'support' },
    { a: 'sig-alchemist',         b: 'sig-china-model',   stance: 'tension' },
    { a: 'sig-hyperscaler-capex', b: 'sig-power-infra',   stance: 'support' },
    { a: 'sig-private-capital',   b: 'sig-cape',          stance: 'tension' },
    { a: 'sig-vibe-investing',    b: 'sig-cape',          stance: 'tension' },
  ];
  function relationsFor(sigId) {
    const out = { support: [], tension: [] };
    SIG_RELATIONS.forEach(r => {
      if (r.a === sigId) out[r.stance].push(r.b);
      else if (r.b === sigId) out[r.stance].push(r.a);
    });
    // Also include same-community neighbours as "support" (our intra-community edges)
    const self = SIGNALS.find(s => s.id === sigId);
    if (self) {
      SIGNALS.forEach(x => {
        if (x.id === sigId) return;
        if (x.community !== self.community) return;
        if (out.support.includes(x.id) || out.tension.includes(x.id)) return;
        out.support.push(x.id);
      });
    }
    return out;
  }

  function buildSignalCard(s) {
    const delta = s.prevConviction == null ? null : s.conviction - s.prevConviction;
    const deltaCls = delta == null ? 'flat' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    const deltaTxt = delta == null ? 'new thesis' : delta === 0 ? '— no change' : (delta > 0 ? `↑ ${delta}` : `↓ ${Math.abs(delta)}`) + ' past 7d';
    const dd = deadlineDays(s.deadline);
    const deadlineStr = dd == null ? '—' : dd < 0 ? `${Math.abs(dd)}d overdue` : `in ${dd}d`;
    const deadlineCls = dd == null ? '' : dd < 15 ? 'warn' : '';

    // 按 cred + recency 混合排序，显示 top 5
    const credScore = { high: 3, med: 2, low: 1 };
    const allSrcsForSig = SOURCES.filter(src => src.signals.includes(s.id));
    const srcsForSig = [...allSrcsForSig]
      .map(src => ({
        src,
        score: (credScore[src.cred] || 2) * 10
             - Math.min(60, daysBetween(src.date)) * 0.3
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(x => x.src);

    const rel = relationsFor(s.id);
    const chipFor = (sigId) => {
      const x = SIGNALS.find(y => y.id === sigId);
      if (!x) return '';
      return `<span class="hc-chip"><span class="d" style="background:${communityColor(x.community)}"></span>${x.name}</span>`;
    };
    const supportChips = rel.support.slice(0, 4).map(chipFor).join('');
    const tensionChips = rel.tension.slice(0, 4).map(chipFor).join('');

    const comm = COMMUNITIES[s.community] || { color: communityColor(s.community), label: s.community };

    return `<div class="hc-head">
      <div class="hc-kicker">
        <span>SIGNAL · ${s.status.toUpperCase()}</span>
        <span class="community-tag"><span class="community-dot" style="background:${comm.color}"></span>${comm.label}</span>
      </div>
      <div class="hc-title">${s.name}</div>
      <div class="hc-subtitle">${s.subtitle}</div>
    </div>
    <div class="hc-conv">
      <div>
        <div class="hc-conv-label">Conviction</div>
        <div class="hc-conv-value">${s.conviction}<span style="font-size:15px;color:var(--ink-4)">/100</span></div>
        <div class="hc-conv-delta ${deltaCls}">${deltaTxt}</div>
      </div>
      <div>${sparklineSvg(s.conviction_history, 170, 56, false)}</div>
    </div>
    <div class="hc-meta">
      <div class="hc-meta-item"><div class="l">Created</div><div class="v mono">${s.created}</div></div>
      <div class="hc-meta-item"><div class="l">Last touched</div><div class="v mono">${daysBetween(s.last_modified)===0 ? 'today' : daysBetween(s.last_modified)+'d ago'}</div></div>
      <div class="hc-meta-item"><div class="l">Deadline</div><div class="v mono ${deadlineCls}">${deadlineStr}</div></div>
      <div class="hc-meta-item"><div class="l">Sources</div><div class="v mono">${srcsForSig.length > 0 ? SOURCES.filter(x=>x.signals.includes(s.id)).length : 0} total</div></div>
    </div>
    ${srcsForSig.length ? `<div class="hc-sources">
      <div class="hc-sources-head"><span>Top sources · 按可信度 × 新鲜度</span><span>${srcsForSig.length}/${allSrcsForSig.length}</span></div>
      ${srcsForSig.map(src => {
        const credColor = src.cred === 'high' ? 'var(--up)' : src.cred === 'low' ? 'var(--down)' : 'var(--ink-4)';
        const age = daysBetween(src.date);
        return `<div class="hc-source">
          <div class="hc-source-icon" style="color:${credColor}" title="cred: ${src.cred}">${SOURCE_KINDS[src.kind].icon}</div>
          <div class="hc-source-title">${src.title}</div>
          <div class="hc-source-date">${age===0 ? 'today' : age<7 ? age+'d' : age<30 ? Math.round(age/7)+'w' : Math.round(age/30)+'mo'}</div>
        </div>`;
      }).join('')}
    </div>` : ''}
    <div class="hc-summary">“${s.summary}”</div>
    ${supportChips ? `<div class="hc-sources"><div class="hc-sources-head"><span>↗ Supports / reinforces</span><span style="color:var(--up)">${rel.support.length}</span></div>${supportChips}</div>` : ''}
    ${tensionChips ? `<div class="hc-sources" style="background:rgba(200,60,40,0.04);border-color:rgba(200,60,40,0.18)"><div class="hc-sources-head"><span style="color:rgb(170,50,30)">⚡ In tension with</span><span style="color:rgb(170,50,30)">${rel.tension.length}</span></div>${tensionChips}</div>` : ''}
    <div class="hc-foot"><span>CLICK TO FOCUS</span><span class="cta">OPEN IN OBSIDIAN →</span></div>`;
  }

  function buildSourceCard(src) {
    const primarySig = SIGNALS.find(s => s.id === src.signals[0]);
    const commSlug = primarySig?.community || '';
    const comm = COMMUNITIES[commSlug] || { color: communityColor(commSlug), label: commSlug || '—' };
    const kindMeta = SOURCE_KINDS[src.kind];
    const supports = src.signals.map(sid => {
      const sig = SIGNALS.find(s => s.id === sid);
      return `<span class="hc-chip"><span class="d" style="background:${communityColor(sig.community)}"></span>${sig.name}</span>`;
    }).join('');
    const age = daysBetween(src.date);

    return `<div class="hc-head">
      <div class="hc-kicker">
        <span>${kindMeta.label.toUpperCase()} · ${src.cred.toUpperCase()} CRED</span>
        <span class="community-tag"><span class="community-dot" style="background:${comm.color}"></span>${comm.label}</span>
      </div>
      <div class="hc-title" style="font-size:15px">${src.title}</div>
      <div class="hc-subtitle">${src.author} · ${age===0 ? 'today' : age+' days ago'}</div>
    </div>
    <div class="hc-src-support">
      <div class="hc-sources-head">Supports ${src.signals.length} signal${src.signals.length>1?'s':''}</div>
      ${supports}
    </div>
    <div class="hc-foot"><span>SOURCE · ${src.id}</span><span class="cta">OPEN →</span></div>`;
  }

  let _hoverCardRaf = null;
  function hoverAnchorForNode(nodeId, event) {
    const net = state.network;
    const g = graphEl();
    if (net && g) {
      const pos = net.getPositions([nodeId])[nodeId];
      if (pos) {
        const dom = net.canvasToDOM(pos);
        const rect = g.getBoundingClientRect();
        return { x: rect.left + dom.x, y: rect.top + dom.y };
      }
    }
    const e = event?.center || event?.srcEvent || event || {};
    return {
      x: e.x ?? e.clientX ?? e.pageX ?? (window.innerWidth / 2),
      y: e.y ?? e.clientY ?? e.pageY ?? (window.innerHeight / 2),
    };
  }

  function placeHoverCard(card, anchor) {
    if (_hoverCardRaf) cancelAnimationFrame(_hoverCardRaf);
    _hoverCardRaf = requestAnimationFrame(() => {
      const cardRect = card.getBoundingClientRect();
      const cw = cardRect.width || 360;
      const ch = cardRect.height || 420;
      const margin = 16;
      const gap = 20;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let x = anchor.x + gap;
      if (x + cw > vw - margin) x = anchor.x - cw - gap;
      if (x < margin) x = margin;

      let y = anchor.y - ch / 2;
      if (y + ch > vh - margin) y = vh - ch - margin;
      if (y < margin) y = margin;

      card.style.left = `${x}px`;
      card.style.top = `${y}px`;
    });
  }

  function showHoverCard(nodeId, event) {
    if (isCanvasMotionActive()) return;
    const node = state.nodesDs.get(nodeId);
    if (!node) return;
    const card = hoverEl();
    if (!card) return;

    const sameNode = state.hoverCardNodeId === nodeId;
    card.className = 'hovercard visible' + (node._type === 'source' ? ' hc-src' : '');
    if (!sameNode) {
      card.innerHTML = node._type === 'signal' ? buildSignalCard(node._data) : buildSourceCard(node._data);
      state.hoverCardNodeId = nodeId;
    }

    const anchor = hoverAnchorForNode(nodeId, event);
    placeHoverCard(card, anchor);
  }

  function hideHoverCard() {
    const card = hoverEl();
    if (card) card.classList.remove('visible');
    state.hoverCardNodeId = null;
  }

  // ───── Edge hover tooltip (lightweight — shows stance / cred / age) ─────
  let _edgeTip = null;
  function ensureEdgeTip() {
    if (_edgeTip) return _edgeTip;
    _edgeTip = document.createElement('div');
    _edgeTip.className = 'edge-tip';
    _edgeTip.style.cssText = `
      position: fixed; z-index: 200; pointer-events: none;
      background: var(--bg-elev); border: 1px solid var(--rule);
      border-radius: 8px; box-shadow: var(--shadow-2);
      padding: 7px 10px; font-size: 11px; line-height: 1.45;
      color: var(--ink-2); max-width: 260px;
      opacity: 0; transform: translate(-50%, calc(-100% - 10px));
      transition: opacity 120ms;
    `;
    document.body.appendChild(_edgeTip);
    return _edgeTip;
  }
  function showEdgeTip(edgeId, event) {
    const edge = state.edgesDs.get(edgeId);
    if (!edge) return;
    const tip = ensureEdgeTip();
    let body = '';
    if (edge._type === 'sig-sig') {
      const a = SIGNALS.find(s => s.id === edge.from);
      const b = SIGNALS.find(s => s.id === edge.to);
      if (edge._stance === 'tension') {
        body = `<div style="color:rgb(170,50,30);font-weight:600;letter-spacing:0.03em;margin-bottom:2px">⚡ TENSION</div>
          <div style="color:var(--ink)"><strong>${a?.name ?? edge.from}</strong> ↔ <strong>${b?.name ?? edge.to}</strong></div>
          <div style="color:var(--ink-4);margin-top:3px">These theses contradict each other — if one plays out, the other likely doesn't.</div>`;
      } else {
        body = `<div style="color:var(--up);font-weight:600;letter-spacing:0.03em;margin-bottom:2px">↗ SUPPORT</div>
          <div style="color:var(--ink)"><strong>${a?.name ?? edge.from}</strong> ↔ <strong>${b?.name ?? edge.to}</strong></div>
          <div style="color:var(--ink-4);margin-top:3px">Related thesis — same community or reinforcing logic.</div>`;
      }
    } else if (edge._type === 'src-sig') {
      const src = SOURCES.find(x => x.id === edge.from);
      const sig = SIGNALS.find(x => x.id === edge.to);
      const age = src ? daysBetween(src.date) : null;
      body = `<div style="color:var(--accent-ink);font-weight:600;letter-spacing:0.03em;margin-bottom:2px">EVIDENCE · ${(src?.cred || '').toUpperCase()} CRED</div>
        <div style="color:var(--ink)">${src?.title ?? edge.from}</div>
        <div style="color:var(--ink-4);margin-top:3px">supports <strong>${sig?.name ?? edge.to}</strong>${age != null ? ` · ${age === 0 ? 'today' : age + 'd ago'}` : ''}</div>`;
    } else {
      body = `<div>${edge._type}</div>`;
    }
    tip.innerHTML = body;
    const e = event.center || event;
    tip.style.left = e.x + 'px';
    tip.style.top = e.y + 'px';
    tip.style.opacity = '1';
  }
  function hideEdgeTip() {
    if (_edgeTip) _edgeTip.style.opacity = '0';
  }

  // ───── Focus signal (center only, no zoom) ─────
  // 点 signal 只做平移聚焦，不改变当前缩放级别。
  function focusSignal(sigId) {
    if (!state.network || !state.nodesDs.get(sigId)) return;

    // 如果所在 community 被 mute，先恢复可见
    const sig = SIGNALS_BY_ID[sigId];
    if (sig && state.mutedCommunities.has(sig.community)) {
      state.mutedCommunities.delete(sig.community);
      const legendBtn = document.querySelector(`.legend-row[data-comm="${CSS.escape(sig.community)}"]`);
      if (legendBtn) legendBtn.classList.remove('muted');
      applyMuted();
    }

    state.focusedSignal = sigId;
    const pos = state.network.getPositions([sigId])[sigId];
    if (pos) {
      state.network.moveTo({
        position: pos,
        animation: { duration: 420, easingFunction: 'easeInOutCubic' },
      });
    }

    updatePulseFocus();
    renderDeltaBadges();
    setTimeout(renderDeltaBadges, 550);
  }
  function clearFocus() {
    state.focusedSignal = null;
    updatePulseFocus();
    renderDeltaBadges();
  }

  function updatePulseFocus() {
    // 高亮当前 focused signal：左栏所有 run-sig 对应行 + 右栏 sig-row
    const sid = state.focusedSignal;
    document.querySelectorAll('.run-sig[data-sig]').forEach(el => {
      el.classList.toggle('focused', !!sid && el.dataset.sig === sid);
    });
    document.querySelectorAll('.sig-row[data-sig]').forEach(el => {
      el.classList.toggle('focused', !!sid && el.dataset.sig === sid);
    });
  }

  // ───── Run Timeline (Think Loop 运行日志) ─────
  //
  // 左栏主视图：解析 _log.md 得到的 86+ 条 run 记录，按日期倒序显示。
  // 每条 run：date + title + summary + signals_touched + sources_touched。
  // 点击 run card → 跳 Obsidian `_log.md` 看完整版。
  // 点击内部 signal chip → 跳对应 signal md。
  function buildPulse() {
    if (RUNS && RUNS.length > 0) {
      buildRunTimeline();
      return;
    }
    buildDailyJournal();
  }

  function buildRunTimeline() {
    const list = document.getElementById('pulse-list');
    const windowDays = state.timeWindow === 'today' ? 2 : state.timeWindow === 'week' ? 10 : 90;

    const filtered = RUNS.filter(r => {
      const d = daysBetween(r.date);
      return d <= windowDays && d >= 0;
    });

    if (filtered.length === 0) {
      list.innerHTML = `<div class="journal-empty">
        <div class="journal-empty-ic">◦</div>
        <div class="journal-empty-msg">该时间窗内无运行记录</div>
        <div class="journal-empty-sub">切到 Month →</div>
      </div>`;
      document.getElementById('pulse-count').textContent = '0 runs';
      return;
    }

    const byDate = {};
    filtered.forEach(r => { (byDate[r.date] ||= []).push(r); });
    const sortedDates = Object.keys(byDate).sort().reverse();

    const dayWord = (dateStr) => {
      const d = daysBetween(dateStr);
      if (d === 0) return 'Today';
      if (d === 1) return 'Yesterday';
      if (d < 7) return `${d}d ago`;
      if (d < 30) return `${Math.round(d/7)}w ago`;
      return `${Math.round(d/30)}mo ago`;
    };
    const fmtDate = (dateStr) => {
      const parts = dateStr.split('-');
      const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
      const dt = new Date(dateStr + 'T00:00:00Z');
      const wk = ['SUN','MON','TUE','WED','THU','FRI','SAT'][dt.getUTCDay()];
      return `${months[parseInt(parts[1])-1]} ${parseInt(parts[2])} · ${wk}`;
    };

    const logUrl = (anchor) => {
      const vault = encodeURIComponent('研究空间');
      const file = encodeURIComponent(`${VAULT_PATH}/_log`);
      const frag = anchor ? `#${encodeURIComponent(anchor)}` : '';
      return `obsidian://open?vault=${vault}&file=${file}${frag}`;
    };

    const clip = (t, n) => {
      if (!t) return '';
      return t.length > n ? t.slice(0, n - 1).trim() + '…' : t;
    };

    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

    let html = '';
    sortedDates.forEach(date => {
      const runs = byDate[date].sort((a, b) => (b.time || '').localeCompare(a.time || ''));

      let totalThoughts = 0;
      runs.forEach(r => {
        totalThoughts += (r.conv_changes || []).length
          + (r.new_signals || []).length
          + (r.archived_signals || []).length
          + (r.reads || []).length;
      });

      html += `<section class="run-day">
        <header class="run-day-head">
          <span class="run-day-word">${dayWord(date)}</span>
          <span class="run-day-date">${fmtDate(date)}</span>
          <span class="run-day-count">${totalThoughts} thought${totalThoughts !== 1 ? 's' : ''}</span>
        </header>
        <div class="run-day-body">`;

      runs.forEach(r => {
        const convChanges = r.conv_changes || [];
        const newSigs = r.new_signals || [];
        const archSigs = r.archived_signals || [];
        const reads = r.reads || [];
        const total = convChanges.length + newSigs.length + archSigs.length + reads.length;
        if (total === 0) return;

        const changeN = convChanges.length + newSigs.length + archSigs.length;
        const kind = changeN > 0 ? '改动' : '读';
        const countN = changeN > 0 ? changeN : reads.length;
        const commColor = r.community ? communityColor(r.community) : 'var(--ink-5)';
        const titleTxt = clip(r.title || '', 80);

        let rows = '';
        convChanges.forEach(c => {
          const sig = SIGNALS_BY_ID[c.signal_id];
          const name = sig ? sig.name : c.signal_id;
          const delta = c.to - c.from;
          const dCls = delta > 0 ? 'up' : delta < 0 ? 'down' : '';
          const dTxt = delta === 0 ? '' : (delta > 0 ? `+${delta}` : `${delta}`);
          const dotColor = sig?.community ? communityColor(sig.community) : 'var(--ink-5)';
          rows += `<button class="run-sig" data-slug="${escAttr(sig?.slug || '')}" data-sig="${escAttr(c.signal_id)}" title="${escAttr(c.reason || '')}">
            <span class="run-sig-dot" style="background:${dotColor}"></span>
            <span class="run-sig-name">${esc(name)}</span>
            ${dTxt ? `<span class="run-sig-delta ${dCls}">${dTxt}</span>` : ''}
            <span class="run-sig-tag">revised</span>
          </button>`;
        });
        newSigs.forEach(s => {
          const name = s.name || s.id;
          const slug = (s.id || '').replace(/^sig-/, '');
          const sig = SIGNALS_BY_ID[s.id];
          const dotColor = sig?.community ? communityColor(sig.community) : 'var(--accent)';
          rows += `<button class="run-sig new" data-slug="${escAttr(slug)}" data-sig="${escAttr(s.id || '')}">
            <span class="run-sig-dot" style="background:${dotColor}"></span>
            <span class="run-sig-name">${esc(name)}</span>
            <span class="run-sig-tag">new</span>
          </button>`;
        });
        archSigs.forEach(s => {
          const name = s.name || s.id;
          const slug = (s.id || '').replace(/^sig-/, '');
          rows += `<button class="run-sig archived" data-slug="${escAttr(slug)}">
            <span class="run-sig-dot"></span>
            <span class="run-sig-name">${esc(name)}</span>
            <span class="run-sig-tag">archive</span>
          </button>`;
        });
        reads.forEach(s => {
          const title = clip(s.title || s.id || '', 42);
          rows += `<div class="run-sig read">
            <span class="run-sig-dot"></span>
            <span class="run-sig-name" title="${escAttr(s.title || '')}">${esc(title)}</span>
            <span class="run-sig-tag">read</span>
          </div>`;
        });

        html += `<article class="run-card" data-anchor="${escAttr(r.anchor || '')}">
          <header class="run-card-head">
            <span class="run-card-time">${esc(r.time || '—')}</span>
            <span class="run-card-comm-dot" style="background:${commColor}"></span>
            <span class="run-card-kind">${kind}</span>
            <span class="run-card-count">${countN}</span>
            <span class="run-card-open">open →</span>
          </header>
          ${titleTxt ? `<div class="run-card-title" title="${escAttr(r.title || '')}">${esc(titleTxt)}</div>` : ''}
          ${rows ? `<div class="run-card-signals">${rows}</div>` : ''}
        </article>`;
      });

      html += `</div></section>`;
    });

    list.innerHTML = html;

    // Run card header / title → open _log.md at anchor
    list.querySelectorAll('.run-card-head, .run-card-title').forEach(el => {
      el.addEventListener('click', (e) => {
        const anchor = el.closest('.run-card').dataset.anchor;
        window.location.href = logUrl(anchor);
      });
    });
    // Inner signal row → focus canvas + open signal md
    list.querySelectorAll('.run-sig[data-slug]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const slug = el.dataset.slug;
        const sid = el.dataset.sig;
        if (sid) focusSignal(sid);
        if (slug) openInObsidian('signal', slug);
      });
    });

    document.getElementById('pulse-count').textContent = `${filtered.length} runs · ${sortedDates.length} days`;
  }

  // Fallback: Daily Journal (原 buildPulse 逻辑)
  function buildDailyJournal() {
    const windowDays = state.timeWindow === 'today' ? 1 : state.timeWindow === 'week' ? 7 : 30;
    const events = [];  // {day: int, kind, signal?, source?, delta?, ...}

    // 1. Conviction 变化（从 history 中提取所有 delta 事件）
    SIGNALS.forEach(s => {
      if (!s.conviction_history || s.conviction_history.length < 2) return;
      for (let i = 1; i < s.conviction_history.length; i++) {
        const prev = s.conviction_history[i-1];
        const cur = s.conviction_history[i];
        const delta = cur.v - prev.v;
        if (delta === 0) continue;
        const day = daysBetween(cur.d);
        if (day > windowDays) continue;
        events.push({
          day, kind: 'conviction',
          signal: s,
          delta,
          prevV: prev.v,
          curV: cur.v,
          reason: cur.r,
        });
      }
    });

    // 2. 新 signal (isNew)
    SIGNALS.filter(s => s.isNew).forEach(s => {
      events.push({
        day: 0, kind: 'new-signal', signal: s,
      });
    });

    // 3. 新增 source（按日期）
    SOURCES.forEach(src => {
      const day = daysBetween(src.date);
      if (day > windowDays || day < 0) return;
      events.push({
        day, kind: 'new-source', source: src,
      });
    });

    // 4. Deadline 临近
    SIGNALS.forEach(s => {
      const dd = deadlineDays(s.deadline);
      if (dd == null || dd < 0 || dd > 30) return;
      if (state.timeWindow === 'today' && dd > 20) return;
      events.push({
        day: 0, kind: 'deadline', signal: s, deadlineDays: dd,
      });
    });

    // 5. Stale signal
    SIGNALS.forEach(s => {
      if (!s.stale) return;
      events.push({
        day: daysBetween(s.last_modified), kind: 'stale', signal: s,
      });
    });

    // 按日期分组
    const byDay = {};
    events.forEach(ev => {
      const k = ev.day;
      (byDay[k] ||= []).push(ev);
    });
    const sortedDays = Object.keys(byDay).map(Number).sort((a, b) => a - b);

    const list = document.getElementById('pulse-list');
    if (events.length === 0) {
      list.innerHTML = `<div class="journal-empty">
        <div class="journal-empty-ic">◦</div>
        <div class="journal-empty-msg">这段时间没有变化。</div>
        <div class="journal-empty-sub">切到更长的时间窗 →</div>
      </div>`;
      document.getElementById('pulse-count').textContent = '0 entries';
      return;
    }

    const dateFormat = (dayAgo) => {
      const d = new Date(TODAY);
      d.setDate(d.getDate() - dayAgo);
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const dayName = ['SUN','MON','TUE','WED','THU','FRI','SAT'][d.getDay()];
      return `${months[d.getMonth()]} ${d.getDate()} · ${dayName}`;
    };
    const dayLabel = (dayAgo) => {
      if (dayAgo === 0) return '今天 · TODAY';
      if (dayAgo === 1) return '昨天 · YESTERDAY';
      if (dayAgo < 7) return `${dayAgo} 天前`;
      if (dayAgo < 30) return `${Math.round(dayAgo/7)} 周前`;
      return `${Math.round(dayAgo/30)} 月前`;
    };

    let html = '';
    sortedDays.forEach(day => {
      const dayEvents = byDay[day];
      html += `<div class="journal-day">
        <div class="journal-day-head">
          <span class="journal-day-label">${dayLabel(day)}</span>
          <span class="journal-day-date">${dateFormat(day)}</span>
        </div>
        <div class="journal-day-body">`;

      // 组内再按 kind 分组
      const grouped = { 'new-signal': [], 'conviction': [], 'new-source': [], 'deadline': [], 'stale': [] };
      dayEvents.forEach(ev => (grouped[ev.kind] ||= []).push(ev));

      // 新 signal
      grouped['new-signal'].forEach(ev => {
        html += journalEntryHtml('new', 'NEW', ev.signal.name, ev.signal.subtitle || '新假说', '', ev.signal.id, ev.signal.slug, 'signal');
      });

      // Conviction 变化
      grouped['conviction'].forEach(ev => {
        const cls = ev.delta > 0 ? 'up' : 'down';
        const badge = ev.delta > 0 ? `+${ev.delta}` : `${ev.delta}`;
        const meta = `conv ${ev.prevV}→${ev.curV}`;
        html += journalEntryHtml(cls, badge, ev.signal.name, ev.reason || '—', meta, ev.signal.id, ev.signal.slug, 'signal', ev.signal.conviction_history);
      });

      // Deadline
      grouped['deadline'].forEach(ev => {
        html += journalEntryHtml('warn', '⚠', ev.signal.name,
          `deadline 还剩 ${ev.deadlineDays} 天`,
          `last verified ${daysBetween(ev.signal.last_verified)}d ago`,
          ev.signal.id, ev.signal.slug, 'signal');
      });

      // Stale
      grouped['stale'].forEach(ev => {
        html += journalEntryHtml('stale', 'STALE', ev.signal.name,
          `${daysBetween(ev.signal.last_modified)} 天未重读`,
          'conviction may have decayed',
          ev.signal.id, ev.signal.slug, 'signal');
      });

      // New sources（折叠显示前 5，多则折叠）
      const sources = grouped['new-source'];
      if (sources.length > 0) {
        const top = sources.slice(0, 5);
        const rest = sources.length - 5;
        top.forEach(ev => {
          const src = ev.source;
          const kindIcon = SOURCE_KINDS[src.kind]?.icon || '◦';
          const credCls = src.cred === 'high' ? 'up' : src.cred === 'low' ? 'down' : 'neutral';
          const linkedSigs = (src.signals || []).slice(0, 3).map(sid => {
            const sig = SIGNALS.find(x => x.id === sid);
            return sig ? sig.name : sid;
          }).join(' · ');
          html += `<button class="journal-entry src" data-src="${src.id}" data-slug="${src.slug || ''}" title="click to open in Obsidian">
            <span class="je-badge src ${credCls}">${kindIcon}</span>
            <div class="je-body">
              <div class="je-title">${src.title}</div>
              <div class="je-meta"><span class="mono">${src.author}</span><span class="je-dot">·</span><span>${linkedSigs}</span></div>
            </div>
          </button>`;
        });
        if (rest > 0) {
          html += `<div class="journal-more">+${rest} 条 sources</div>`;
        }
      }

      html += `</div></div>`;
    });

    list.innerHTML = html;

    // 绑定 click: signal → open obsidian + focus; source → open obsidian
    list.querySelectorAll('.journal-entry').forEach(el => {
      el.addEventListener('click', () => {
        const kind = el.dataset.kind || (el.classList.contains('src') ? 'source' : 'signal');
        const slug = el.dataset.slug;
        const sigId = el.dataset.sig;
        if (slug) openInObsidian(kind, slug);
        if (sigId) focusSignal(sigId);
      });
    });

    document.getElementById('pulse-count').textContent = `${events.length} entries · ${sortedDays.length} 天`;
  }

  // 单条日记条目 HTML 生成器
  function journalEntryHtml(cls, badge, title, subtitle, meta, sigId, slug, kind, history) {
    const spark = history && history.length > 1 ? sparklineSvg(history, 200, 18, true) : '';
    return `<button class="journal-entry sig" data-sig="${sigId}" data-slug="${slug || ''}" data-kind="${kind}" title="click to open in Obsidian">
      <span class="je-badge ${cls}">${badge}</span>
      <div class="je-body">
        <div class="je-title">${title}</div>
        <div class="je-subtitle">${subtitle}</div>
        ${meta ? `<div class="je-meta mono">${meta}</div>` : ''}
        ${spark}
      </div>
    </button>`;
  }

  // ───── Communities + Signal list (right rail) ─────
  function buildLegend() {
    // --- Communities (click to filter) ---
    const el = document.getElementById('legend-communities');
    const counts = {};
    SIGNALS.forEach(s => counts[s.community] = (counts[s.community] || 0) + 1);

    el.innerHTML = Object.entries(COMMUNITIES).map(([id, c]) =>
      `<button class="legend-row" data-comm="${id}">
        <span class="legend-dot" style="background:${c.color}"></span>
        <span>${c.label}</span>
        <span class="legend-count">${counts[id] || 0}</span>
      </button>`
    ).join('');

    el.querySelectorAll('.legend-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const comm = btn.dataset.comm;
        if (state.mutedCommunities.has(comm)) state.mutedCommunities.delete(comm);
        else state.mutedCommunities.add(comm);
        applyMuted();
        btn.classList.toggle('muted', state.mutedCommunities.has(comm));
      });
    });

    // --- Signal list (按 community + conviction 排序，click 开 Obsidian) ---
    buildSignalList();
  }

  function buildSignalList() {
    const listEl = document.getElementById('signal-list');
    const countEl = document.getElementById('signal-count');
    if (!listEl) return;

    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

    const byComm = {};
    SIGNALS.forEach(s => { (byComm[s.community] ||= []).push(s); });

    let html = '';
    Object.entries(COMMUNITIES).forEach(([cid, c]) => {
      const group = byComm[cid];
      if (!group || group.length === 0) return;
      const sorted = [...group].sort((a, b) => b.conviction - a.conviction);
      html += `<div class="sig-group">
        <div class="sig-group-head">
          <span class="sig-group-dot" style="background:${c.color}"></span>
          <span class="sig-group-label">${esc(c.label)}</span>
          <span class="sig-group-count">${group.length}</span>
        </div>`;
      sorted.forEach(s => {
        const delta = s.prevConviction == null ? 0 : s.conviction - s.prevConviction;
        const dCls = delta > 0 ? 'up' : delta < 0 ? 'down' : '';
        const dTxt = delta === 0 ? '' : (delta > 0 ? `+${delta}` : `${delta}`);
        html += `<button class="sig-row" data-sig="${escAttr(s.id)}" data-slug="${escAttr(s.slug || '')}" title="${escAttr((s.subtitle || '') + ' · click 切换隐藏 · shift+click 打开 Obsidian')}">
          <span class="sig-row-dot" style="background:${c.color}"></span>
          <span class="sig-row-name">${esc(s.name)}</span>
          <span class="sig-row-conv mono">${s.conviction}</span>
          ${dTxt ? `<span class="sig-row-delta ${dCls} mono">${dTxt}</span>` : ''}
        </button>`;
      });
      html += `</div>`;
    });

    listEl.innerHTML = html;
    if (countEl) countEl.textContent = String(SIGNALS.length);

    // Click = focus canvas + 打开 Obsidian signal md
    listEl.querySelectorAll('.sig-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const sid = btn.dataset.sig;
        const slug = btn.dataset.slug;
        focusSignal(sid);
        if (slug) setTimeout(() => openInObsidian('signal', slug), 100);
      });
    });
  }

  function filterHiddenForNode(n) {
    // Signal 被"藏"iff 它的 community 被 mute。
    if (n._type === 'signal') {
      const sig = SIGNALS_BY_ID[n.id];
      return !!sig && state.mutedCommunities.has(sig.community);
    }
    // Source 被"藏":
    // 1) hideSources 开启时全部隐藏
    // 2) 否则，仅当它的所有支撑 signal 都被 mute 时隐藏
    if (n._type === 'source') {
      if (state.hideSources) return true;
      if (!n._data?.signals?.length) return false;
      return n._data.signals.every((sid) => {
        const sig = SIGNALS_BY_ID[sid];
        return !!sig && state.mutedCommunities.has(sig.community);
      });
    }
    return false;
  }

  function applyVisibilityFilters() {
    if (!state.nodesDs) return;
    const updates = [];
    state.nodesDs.forEach(n => {
      const hidden = filterHiddenForNode(n);
      if (!!n.hidden !== hidden) updates.push({ id: n.id, hidden });
    });
    if (updates.length) state.nodesDs.update(updates);
    renderDeltaBadges();
  }

  function applyMuted() {
    applyVisibilityFilters();
  }

  // ───── Time window toggle ─────
  function wireTimeToggle() {
    document.querySelectorAll('.time-toggle button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.time-toggle button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.timeWindow = btn.dataset.w;
        buildPulse();
      });
    });
  }

  // ───── Hide sources ─────
  function wireHideSources() {
    const tog = document.getElementById('toggle-sources');
    tog.addEventListener('click', () => {
      state.hideSources = !state.hideSources;
      tog.classList.toggle('on', !state.hideSources);
      applyVisibilityFilters();
    });
  }

  function wireDeltas() {
    // Delta badges 已删除（见 renderDeltaBadges 注释）— 保留函数签名避免破坏 init() 调用链
    const tog = document.getElementById('toggle-deltas');
    if (tog) tog.style.display = 'none';
  }

  // ───── Timeline playback ─────
  const tl = {
    open: false,
    playing: false,
    speed: 2,
    startDay: 45,    // 45 days ago
    endDay: 0,       // today
    currentDay: 45,  // start at beginning
    raf: null,
    lastTick: 0,
    events: [],      // [{day, label, sigId, kind}]
    originalNodes: null,
    originalEdges: null,
  };

  function tlClone(v) {
    if (v == null) return v;
    return JSON.parse(JSON.stringify(v));
  }

  function tlSnapshotGraphState() {
    if (tl.originalNodes || tl.originalEdges) return;
    if (!state.nodesDs || !state.edgesDs) return;
    const nodes = new Map();
    const edges = new Map();
    state.nodesDs.forEach(n => {
      nodes.set(n.id, {
        hidden: !!n.hidden,
        size: n.size,
        borderWidth: n.borderWidth,
        color: tlClone(n.color),
        font: tlClone(n.font),
      });
    });
    state.edgesDs.forEach(e => {
      edges.set(e.id, { hidden: !!e.hidden });
    });
    tl.originalNodes = nodes;
    tl.originalEdges = edges;
  }

  function tlRestoreGraphState() {
    if (!tl.originalNodes || !tl.originalEdges) return;
    if (!state.nodesDs || !state.edgesDs) return;
    const nodeUpdates = [];
    const edgeUpdates = [];
    tl.originalNodes.forEach((snap, id) => {
      if (!state.nodesDs.get(id)) return;
      nodeUpdates.push({
        id,
        hidden: snap.hidden,
        size: snap.size,
        borderWidth: snap.borderWidth,
        color: tlClone(snap.color),
        font: tlClone(snap.font),
      });
    });
    tl.originalEdges.forEach((snap, id) => {
      if (!state.edgesDs.get(id)) return;
      edgeUpdates.push({ id, hidden: snap.hidden });
    });
    if (nodeUpdates.length) state.nodesDs.update(nodeUpdates);
    if (edgeUpdates.length) state.edgesDs.update(edgeUpdates);
    tl.originalNodes = null;
    tl.originalEdges = null;
  }

  function tlBuildEvents() {
    // Walk signals + sources and generate a chronological event stream
    const events = [];
    SIGNALS.forEach(s => {
      const cday = daysBetween(s.created);
      if (cday > tl.startDay || cday < tl.endDay) return; // older/newer than window
      events.push({ day: cday, label: `new signal: ${s.name}`, sigId: s.id, kind: 'signal-created' });
      s.conviction_history.forEach((h, i) => {
        const d = daysBetween(h.d);
        if (d > tl.startDay || d < tl.endDay) return;
        if (i === 0) return; // skip the first one (= creation)
        const prev = s.conviction_history[i-1].v;
        const delta = h.v - prev;
        events.push({
          day: d,
          label: `${s.name}: ${h.r} (${delta>0?'+':''}${delta})`,
          sigId: s.id,
          kind: 'conviction',
          conviction: h.v,
        });
      });
    });
    SOURCES.forEach(src => {
      const d = daysBetween(src.date);
      if (d > tl.startDay || d < tl.endDay) return;
      events.push({ day: d, label: `${src.title}`, srcId: src.id, kind: 'source' });
    });
    events.sort((a,b) => b.day - a.day); // chronological: oldest→newest (high day → low day)
    tl.events = events;
  }

  function tlApplyState() {
    // Given tl.currentDay, show nodes/edges that existed on or before that day,
    // and scale source opacity based on age at that day.
    if (!state.nodesDs) return;
    const nodeUpdates = [];
    const edgeUpdates = [];

    state.nodesDs.forEach(n => {
      if (n._type === 'signal') {
        const s = n._data;
        const cday = daysBetween(s.created);
        const visible = cday >= tl.currentDay; // created before/on currentDay
        if (!visible) {
          if (!n.hidden) nodeUpdates.push({ id: n.id, hidden: true });
          return;
        }
        // conviction at currentDay — find last history point <= currentDay
        const histAt = [...s.conviction_history].reverse().find(h => daysBetween(h.d) >= tl.currentDay);
        const conv = histAt ? histAt.v : s.conviction_history[0].v;
        const support = SOURCES.filter(src =>
          src.signals.includes(s.id) && daysBetween(src.date) >= tl.currentDay
        ).length;
        // MATCH composite encoding from buildGraph
        const newSize = 16 + (conv / 100) * 28;
        const color = n._color;
        const fillColor = withAlpha(color, 1); // during playback assume fresh
        nodeUpdates.push({
          id: n.id,
          hidden: false,
          size: newSize,
          borderWidth: 0,
          color: { background: fillColor, border: fillColor },
          font: { ...(n.font||{}), vadjust: -(newSize + 12) },
        });
      } else if (n._type === 'source') {
        const src = n._data;
        const sday = daysBetween(src.date);
        const visible = sday >= tl.currentDay;
        if (!visible) { if (!n.hidden) nodeUpdates.push({ id: n.id, hidden: true }); return; }
        const age = sday - tl.currentDay;
        const opacity = age <= 7 ? 1 : age <= 30 ? 0.75 : 0.45;
        const color = n._color;
        nodeUpdates.push({
          id: n.id, hidden: false,
          color: {
            background: withAlpha(color, opacity),
            border: withAlpha(shade(color, -20), opacity),
            highlight: { background: color, border: shade(color, -35) },
          },
          size: age <= 1 ? 7 : 5,
        });
      }
    });

    state.edgesDs.forEach(e => {
      const fromNode = state.nodesDs.get(e.from);
      const toNode = state.nodesDs.get(e.to);
      let hide = false;
      if (fromNode._type === 'source') {
        hide = daysBetween(fromNode._data.date) < tl.currentDay;
      } else if (toNode._type === 'source') {
        hide = daysBetween(toNode._data.date) < tl.currentDay;
      } else {
        // sig-sig: both must exist
        hide = daysBetween(fromNode._data.created) < tl.currentDay
             || daysBetween(toNode._data.created) < tl.currentDay;
      }
      if (e.hidden !== hide) edgeUpdates.push({ id: e.id, hidden: hide });
    });

    // Batch updates - suppress physics from restarting
    if (nodeUpdates.length) state.nodesDs.update(nodeUpdates);
    if (edgeUpdates.length) state.edgesDs.update(edgeUpdates);

    // Update date label
    const d = new Date(TODAY);
    d.setDate(d.getDate() - tl.currentDay);
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    document.getElementById('tl-date').textContent = `${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
    document.getElementById('tl-ago').textContent = tl.currentDay === 0 ? 'today' : `${Math.round(tl.currentDay)} days ago`;

    // Thumb position
    const pct = 1 - (tl.currentDay - tl.endDay) / (tl.startDay - tl.endDay);
    const thumbEl = document.getElementById('tl-thumb');
    const fillEl = document.getElementById('tl-fill');
    thumbEl.style.left = (pct * 100) + '%';
    fillEl.style.width = (pct * 100) + '%';

    // Active event label near thumb
    const activeEvent = tl.events.find(ev => ev.day <= tl.currentDay + 0.8 && ev.day >= tl.currentDay - 0.8);
    const evEl = document.getElementById('tl-event');
    if (activeEvent) {
      evEl.textContent = activeEvent.label;
      evEl.style.left = (pct * 100) + '%';
      evEl.classList.add('visible');
    } else {
      evEl.classList.remove('visible');
    }
  }

  function tlBuildTicks() {
    const ticks = document.getElementById('tl-ticks');
    ticks.innerHTML = '';
    // Major event ticks
    const seen = new Set();
    tl.events.forEach(ev => {
      if (ev.kind !== 'signal-created' && ev.kind !== 'conviction') return;
      const pct = 1 - (ev.day - tl.endDay) / (tl.startDay - tl.endDay);
      const el = document.createElement('div');
      el.className = 'timeline-tick big';
      el.style.left = (pct * 100) + '%';
      el.title = ev.label;
      ticks.appendChild(el);
    });
    // Week labels
    [45, 30, 14, 7, 0].forEach(d => {
      if (d > tl.startDay) return;
      const pct = 1 - (d - tl.endDay) / (tl.startDay - tl.endDay);
      const label = document.createElement('div');
      label.className = 'timeline-tick-label';
      label.style.left = (pct * 100) + '%';
      label.textContent = d === 0 ? 'now' : d === 7 ? '1w' : d === 14 ? '2w' : d === 30 ? '1m' : '45d';
      ticks.appendChild(label);
    });
  }

  function tlTick(ts) {
    if (!tl.playing) return;
    if (!tl.lastTick) tl.lastTick = ts;
    const dt = (ts - tl.lastTick) / 1000;
    tl.lastTick = ts;
    // speed: 1× = 8 days/sec, 2× = 16, 4× = 32
    const daysPerSec = 8 * tl.speed;
    tl.currentDay = Math.max(tl.endDay, tl.currentDay - daysPerSec * dt);
    tlApplyState();
    renderDeltaBadges();

    // Flash arrive rings for any signal whose creation just passed
    tl.events.forEach(ev => {
      if (ev.kind !== 'signal-created') return;
      if (!ev._flashed && ev.day <= tl.currentDay + 1 && ev.day >= tl.currentDay - 0.5) {
        ev._flashed = true;
        flashArrive(ev.sigId);
      }
    });

    if (tl.currentDay <= tl.endDay + 0.01) {
      tl.currentDay = tl.endDay;
      tl.playing = false;
      tlUpdatePlayIcon();
      tlApplyState();
      return;
    }
    tl.raf = requestAnimationFrame(tlTick);
  }

  function flashArrive(sigId) {
    if (!state.network) return;
    const pos = state.network.getPositions([sigId])[sigId];
    if (!pos) return;
    const dom = state.network.canvasToDOM(pos);
    const layer = document.getElementById('arrive-layer');
    const el = document.createElement('div');
    el.className = 'arrive-ring';
    el.style.left = dom.x + 'px';
    el.style.top = dom.y + 'px';
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  function tlUpdatePlayIcon() {
    const ic = document.getElementById('tl-play-icon');
    ic.innerHTML = tl.playing
      ? '<rect x="3" y="2" width="2.5" height="8"/><rect x="6.5" y="2" width="2.5" height="8"/>'
      : '<polygon points="3,2 10,6 3,10"/>';
  }

  function tlPlay() {
    if (tl.currentDay <= tl.endDay + 0.01) {
      // restart from beginning
      tl.currentDay = tl.startDay;
      tl.events.forEach(ev => ev._flashed = false);
    }
    tl.playing = true;
    tl.lastTick = 0;
    tlUpdatePlayIcon();
    tl.raf = requestAnimationFrame(tlTick);
  }
  function tlPause() {
    tl.playing = false;
    tlUpdatePlayIcon();
    if (tl.raf) cancelAnimationFrame(tl.raf);
  }

  function tlOpen() {
    tl.open = true;
    tlSnapshotGraphState();
    document.getElementById('timeline').classList.add('open');
    document.querySelector('.canvas').classList.add('timeline-open');
    if (!tl.events.length) tlBuildEvents();
    tlBuildTicks();
    tl.events.forEach(ev => { ev._flashed = false; });
    tl.currentDay = tl.startDay;
    tlApplyState();
  }
  function tlClose() {
    tl.open = false;
    tlPause();
    document.getElementById('timeline').classList.remove('open');
    document.querySelector('.canvas').classList.remove('timeline-open');
    tl.currentDay = tl.endDay;
    tlRestoreGraphState();
    applyVisibilityFilters();
  }

  function wireTimeline() {
    document.getElementById('btn-timeline').addEventListener('click', () => {
      tl.open ? tlClose() : tlOpen();
    });
    document.getElementById('tl-close').addEventListener('click', tlClose);
    document.getElementById('tl-play').addEventListener('click', () => {
      tl.playing ? tlPause() : tlPlay();
    });
    document.querySelectorAll('.timeline-speed button').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.timeline-speed button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        tl.speed = parseInt(b.dataset.speed, 10);
      });
    });
    const track = document.getElementById('tl-track');
    const scrubFromEvent = (e) => {
      const rect = track.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      tl.currentDay = tl.startDay - x * (tl.startDay - tl.endDay);
      tlApplyState();
    };
    let dragging = false;
    track.addEventListener('mousedown', (e) => {
      dragging = true;
      tlPause();
      scrubFromEvent(e);
    });
    window.addEventListener('mousemove', (e) => { if (dragging) scrubFromEvent(e); });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  // ───── Tweaks ─────
  function wireTweaks() {
    window.addEventListener('message', (e) => {
      if (e.data?.type === '__activate_edit_mode') openTweaks();
      if (e.data?.type === '__deactivate_edit_mode') closeTweaks();
    });
    try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch(e){}

    // manual toggle
    document.getElementById('tweaks-toggle').addEventListener('click', () => {
      document.getElementById('tweaks').classList.toggle('open');
    });
    document.getElementById('tweaks-close').addEventListener('click', closeTweaks);

    // Palette
    document.querySelectorAll('[data-tweak="palette"] button').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('[data-tweak="palette"] button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        setPalette(b.dataset.val);
      });
    });
    // Placement
    document.querySelectorAll('[data-tweak="placement"] button').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('[data-tweak="placement"] button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        setPulsePlacement(b.dataset.val);
      });
    });
    // Dark mode
    document.querySelectorAll('[data-tweak="theme"] button').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('[data-tweak="theme"] button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        document.body.classList.toggle('theme-dark', b.dataset.val === 'dark');
      });
    });
  }
  function openTweaks() { document.getElementById('tweaks').classList.add('open'); }
  function closeTweaks() { document.getElementById('tweaks').classList.remove('open'); }

  // ───── ENVISION preview (read-only) ─────
  //
  // ENVISION.md 的唯一编辑入口是 Obsidian。这里只显示当前内容 + 一键打开 md。
  // 之前有 textarea + "保存本地" 是假按钮（只写 localStorage，不碰 md），删了。
  function wireEnvision() {
    const preview = document.getElementById('envision-preview');
    const openBtn = document.getElementById('envision-open');
    if (preview) preview.textContent = ENVISION_TEXT || '(ENVISION.md 未加载)';
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        const vault = encodeURIComponent('研究空间');
        const file = encodeURIComponent(`${VAULT_PATH}/ENVISION`);
        window.location.href = `obsidian://open?vault=${vault}&file=${file}`;
      });
    }
  }

  // Settings button in right rail
  function wireSettingsButton() {
    const btn = document.getElementById('settings-open');
    if (btn) btn.addEventListener('click', openTweaks);
  }

  function setPalette(name) {
    const r = document.documentElement.style;
    if (name === 'indigo') { r.setProperty('--accent', '#4F46E5'); r.setProperty('--accent-soft', '#EEF0FF'); r.setProperty('--accent-ink', '#3730A3'); }
    if (name === 'forest') { r.setProperty('--accent', '#1F7A4C'); r.setProperty('--accent-soft', '#E5F2EC'); r.setProperty('--accent-ink', '#13533A'); }
    if (name === 'ochre')  { r.setProperty('--accent', '#B07510'); r.setProperty('--accent-soft', '#F7EEDB'); r.setProperty('--accent-ink', '#7A4F08'); }
  }

  function setPulsePlacement(p) {
    state.pulsePlacement = p;
    const main = document.querySelector('.main');
    const pulse = document.querySelector('.pulse');
    const canvas = document.querySelector('.canvas');
    pulse.style.position = '';
    pulse.style.width = '';
    pulse.style.top = '';
    pulse.style.right = '';
    pulse.style.bottom = '';
    pulse.style.left = '';
    pulse.style.borderRadius = '';
    pulse.style.boxShadow = '';
    pulse.style.zIndex = '';
    pulse.style.maxHeight = '';
    pulse.style.border = '';
    main.style.gridTemplateColumns = '';

    if (p === 'left') {
      main.style.gridTemplateColumns = '300px 1fr 260px';
    } else if (p === 'floating') {
      main.style.gridTemplateColumns = '0 1fr 260px';
      pulse.style.position = 'fixed';
      pulse.style.top = '70px';
      pulse.style.left = '18px';
      pulse.style.width = '300px';
      pulse.style.maxHeight = 'calc(100vh - 90px)';
      pulse.style.borderRadius = '14px';
      pulse.style.boxShadow = 'var(--shadow-3)';
      pulse.style.zIndex = '50';
      pulse.style.border = '1px solid var(--rule)';
    }
  }

  function wireCollapse() {
    const main = document.querySelector('.main');
    const left = document.getElementById('collapse-left');
    const right = document.getElementById('collapse-right');
    if (left) left.addEventListener('click', () => {
      main.style.gridTemplateColumns = ''; // clear any inline override
      main.classList.toggle('pulse-collapsed');
      setTimeout(() => state.network && state.network.redraw(), 260);
    });
    if (right) right.addEventListener('click', () => {
      main.style.gridTemplateColumns = '';
      main.classList.toggle('legend-collapsed');
      setTimeout(() => state.network && state.network.redraw(), 260);
    });
  }

  function wireFit() {
    const btn = document.getElementById('btn-refit');
    if (btn) btn.addEventListener('click', () => {
      if (!state.network || !state.nodesDs) return;
      const visibleIds = [];
      state.nodesDs.forEach(n => { if (!n.hidden) visibleIds.push(n.id); });
      if (visibleIds.length === 0) return;
      const posMap = state.network.getPositions(visibleIds);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      visibleIds.forEach(id => {
        const p = posMap[id];
        if (!p) return;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      });
      if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;
      state.network.moveTo({
        position: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
        animation: { duration: 500, easingFunction: 'easeInOutQuad' },
      });
    });
  }

  // ───── Init DOM ─────
  function init() {
    buildLegend();
    buildPulse();
    wireTimeToggle();
    wireHideSources();
    wireDeltas();
    wireTweaks();
    wireEnvision();
    wireSettingsButton();
    wireTimeline();
    wireCollapse();
    wireFit();
    initNetwork();

    // Refocus / reposition badges on resize
    window.addEventListener('resize', () => state.network && state.network.redraw());

    // Simple throttled badge positioning — one rAF per frame max
    let rafScheduled = false;
    function scheduleBadgeUpdate() {
      if (rafScheduled) return;
      rafScheduled = true;
      requestAnimationFrame(() => {
        rafScheduled = false;
        if (state.network) renderDeltaBadges();
      });
    }
    // Subscribe the throttled version (only place these are bound)
    state.network.on('dragStart', scheduleBadgeUpdate);
    state.network.on('dragging', scheduleBadgeUpdate);
    state.network.on('dragEnd', scheduleBadgeUpdate);
    state.network.on('zoom', scheduleBadgeUpdate);
    // 注意：**不**绑 afterDrawing → scheduleBadgeUpdate。vis 对 hover / 其他内部
    // 状态会 redraw，每帧调 rAF 做 badge 更新会放大视觉抖动感。drag/zoom 事件
    // 已覆盖 badge 同步的真正需求。
  }

  document.addEventListener('DOMContentLoaded', init);
})();
