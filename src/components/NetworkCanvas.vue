<template>
  <div class="network-canvas" @click="closeContextMenu">
    <!-- 拖拽提示区域 -->
    <div v-if="!hasModel" class="drop-zone" @drop="handleDrop" @dragover="handleDragOver" @dragleave="handleDragLeave">
      <div class="drop-content">
        <div class="logo">
          <span class="logo-text">VIS</span>
          <div class="logo-icon">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
              <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
              <circle cx="16" cy="8" r="1.5" fill="currentColor"/>
              <circle cx="8" cy="16" r="1.5" fill="currentColor"/>
              <circle cx="16" cy="16" r="1.5" fill="currentColor"/>
              <circle cx="12" cy="6" r="1.5" fill="currentColor"/>
              <circle cx="12" cy="18" r="1.5" fill="currentColor"/>
              <line x1="8" y1="8" x2="16" y2="8" stroke="currentColor" stroke-width="1"/>
              <line x1="8" y1="16" x2="16" y2="16" stroke="currentColor" stroke-width="1"/>
              <line x1="12" y1="6" x2="8" y2="8" stroke="currentColor" stroke-width="1"/>
              <line x1="12" y1="6" x2="16" y2="8" stroke="currentColor" stroke-width="1"/>
              <line x1="12" y1="18" x2="8" y2="16" stroke="currentColor" stroke-width="1"/>
              <line x1="12" y1="18" x2="16" y2="16" stroke="currentColor" stroke-width="1"/>
            </svg>
          </div>
          <span class="logo-text">NIR</span>
        </div>
        <button class="open-button" @click="openFileBrowser">
          {{ t('canvas.openModel') }}
        </button>
        <input
          ref="fileInput"
          type="file"
          accept=".nir,.json"
          style="display: none"
          @change="handleFileSelect"
        />
      </div>
    </div>

    <!-- 网络图容器 -->
    <div v-else ref="networkContainer" class="network-container"></div>

    <!-- 连线模式横幅 -->
    <div v-if="hasModel && connectMode" class="connect-banner">
      <span v-if="!connectSource">{{ t('canvas.connectPick') }}</span>
      <span v-else>{{ t('canvas.connectFrom', { src: connectSource }) }}</span>
      <button class="banner-button" @click.stop="cancelConnect">{{ t('canvas.exitConnect') }}</button>
    </div>

    <!-- 右键菜单 -->
    <div
      v-if="contextMenu.visible"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      @click.stop
    >
      <template v-if="contextMenu.targetType === 'node'">
        <div
          v-if="targetPrunable"
          class="context-item"
          @click="emitAction({ kind: 'request-prune', name: contextMenu.targetId })"
        >{{ t('canvas.ctxPrune') }}</div>
        <div class="context-item" @click="startConnectFrom(contextMenu.targetId)">{{ t('canvas.ctxConnectFrom') }}</div>
        <div class="context-item" @click="emitAction({ kind: 'request-rename', name: contextMenu.targetId })">{{ t('canvas.ctxRename') }}</div>
        <div
          v-if="selectedIds.length >= 2 && selectedIds.includes(contextMenu.targetId)"
          class="context-item"
          @click="emitAction({ kind: 'request-group', names: [...selectedIds] })"
        >{{ t('canvas.ctxGroup', { n: selectedIds.length }) }}</div>
        <div
          v-if="targetNodeType === 'NIRGraph'"
          class="context-item"
          @click="emitAction({ kind: 'request-enter', name: contextMenu.targetId })"
        >{{ t('subgraph.enter') }}</div>
        <div
          v-if="targetNodeType === 'NIRGraph'"
          class="context-item"
          @click="emitAction({ kind: 'request-ungroup', name: contextMenu.targetId })"
        >{{ t('canvas.ctxUngroup') }}</div>
        <div class="context-item danger" @click="emitAction({ kind: 'request-remove', name: contextMenu.targetId })">{{ t('canvas.ctxRemove') }}</div>
      </template>
      <template v-else-if="contextMenu.targetType === 'edge'">
        <div class="context-item danger" @click="emitAction({ kind: 'request-disconnect', src: contextMenu.targetId[0], dst: contextMenu.targetId[1] })">{{ t('canvas.ctxDisconnect') }}</div>
      </template>
      <template v-else>
        <div class="context-item" @click="emitAction({ kind: 'request-add-node' })">{{ t('canvas.ctxAddNode') }}</div>
      </template>
    </div>
  </div>
</template>

<script>
import { ref, computed, markRaw, onMounted, nextTick, watch } from 'vue'
import { Network } from 'vis-network'
import { DataSet } from 'vis-data'
import { ElMessage } from 'element-plus'
import { openNirFile } from '../io/nirIO.js'
import { loadJsonModel } from '../io/jsonLoader.js'
import { t } from '../i18n/index.js'

export default {
  name: 'NetworkCanvas',
  props: {
    modelData: {
      type: Object,
      default: null
    },
    hasModel: {
      type: Boolean,
      default: false
    },
    // 被改动的节点名清单(画布上橙色边框标记)
    changedNames: {
      type: Array,
      default: () => []
    },
    // 有问题的节点名清单(画布上红色标记)
    issueNodes: {
      type: Array,
      default: () => []
    },
    // 有问题的边 ['a->b', ...](画布上红色)
    issueEdges: {
      type: Array,
      default: () => []
    },
    // 连线模式开关(工具栏切换)
    connectMode: {
      type: Boolean,
      default: false
    },
    // 会话序号:载入新文件时 +1,画布据此整体重排;普通编辑不换序号,
    // 走差量更新保持没动的节点位置不变(坐标存会话状态,不写进 NIR 文件)
    sessionKey: {
      type: Number,
      default: 0
    },
    // 进入子图的视图路径字符串(如 'block' 或 'block/inner');变化 = 换层,
    // 画布整体重排(每层是不同的图),位置存储也按层分开记
    viewKey: {
      type: String,
      default: ''
    }
  },
  emits: ['nodeSelect', 'nodeDeselect', 'selectionChange', 'fileDrop', 'openFile', 'action'],
  setup(props, { emit }) {
    const networkContainer = ref(null)
    const network = ref(null)
    const nodes = ref(new DataSet())
    const edges = ref(new DataSet())
    const fileInput = ref(null)
    // 连线模式内部状态:当前已选的起点节点
    const connectSource = ref('')
    // 右键菜单状态
    const contextMenu = ref({ visible: false, x: 0, y: 0, targetType: 'blank', targetId: null })
    // 多选:当前选中的节点 id 清单(Ctrl+点选;成组菜单用)
    const selectedIds = ref([])
    // 布局会话状态:节点 id -> {x, y};只在内存里,不写进 NIR 文件
    const positionStore = new Map()
    // 初始层级布局稳定后冻结物理引擎,之后的编辑不再整体重排
    const physicsFrozen = ref(false)
    let lastSessionKey = null
    // 上一次的视图层键(进入子图/返回上层时画布整体重排)
    let lastViewKey = null

    // 主题取色:颜色只在 src/styles/theme.css 一处定义,脚本用变量名现读。
    // documentElement 在模块执行前已存在,:root 变量随时可读。
    const cssVar = (name) => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
      return v || '#808080'
    }
    // 缓存一轮:画布初始化和每次数据刷新都会取色,避免重复触发样式计算
    const themeColors = {}
    const themeColor = (name) => {
      if (!(name in themeColors)) themeColors[name] = cssVar(name)
      return themeColors[name]
    }
    // 读无单位数值变量(如 --sv-min-scale: 0.75),解析失败回退 fallback
    const numVar = (name, fallback) => {
      const v = Number.parseFloat(cssVar(name))
      return Number.isFinite(v) ? v : fallback
    }

    // 节点类别:标题行颜色按类别区分(输入输出/神经元/突触权重/池化形状/子图)
    const CATEGORY_OF = {
      Input: 'io', Output: 'io',
      LIF: 'neuron', LI: 'neuron', IF: 'neuron', I: 'neuron', CubaLIF: 'neuron', CubaLI: 'neuron',
      Linear: 'synapse', Affine: 'synapse', Conv1d: 'synapse', Conv2d: 'synapse',
      SumPool2d: 'shape', AvgPool2d: 'shape', Flatten: 'shape', Scale: 'shape', Threshold: 'shape', Delay: 'shape',
      NIRGraph: 'graph'
    }
    const CATEGORY_VAR = {
      io: '--sv-cat-io',
      neuron: '--sv-cat-neuron',
      synapse: '--sv-cat-synapse',
      shape: '--sv-cat-shape',
      graph: '--sv-cat-graph',
      other: '--sv-cat-other'
    }

    // vis-network 的画布选项:颜色全部来自主题变量
    const buildNetworkOptions = () => {
      const edgeColor = themeColor('--sv-edge')
      const px = (name, fallback) => Number(cssVar(name)) || fallback
      return {
        nodes: {
          shape: 'box',
          shapeProperties: { borderRadius: px('--sv-radius-node', 6) },
          // 卡片最小尺寸:三行文字不挤、不贴边(vis-network box 的内边距固定,
          // 用最小宽高把卡片撑开)
          widthConstraint: { minimum: px('--sv-node-min-width', 180) },
          heightConstraint: { minimum: px('--sv-node-min-height', 88) },
          font: { size: px('--sv-node-font-name', 15), face: themeColor('--sv-font') },
          borderWidth: 2,
          borderWidthSelected: 3,
          shadow: {
            enabled: true,
            color: 'rgba(0, 0, 0, 0.4)',
            size: 8,
            x: 3,
            y: 3
          },
          color: {
            border: themeColor('--sv-node-border'),
            background: themeColor('--sv-bg-node'),
            highlight: {
              border: themeColor('--sv-node-border-selected'),
              background: themeColor('--sv-bg-node-selected')
            },
            hover: {
              border: themeColor('--sv-node-border-hover'),
              background: themeColor('--sv-bg-node-hover')
            }
          }
        },
        edges: {
          width: 2,
          color: { color: edgeColor, highlight: themeColor('--sv-primary-hover'), hover: themeColor('--sv-primary-hover') },
          smooth: { type: 'continuous' },
          arrows: { to: { enabled: true, scaleFactor: 0.5 } }
        },
        physics: {
          enabled: true,
          hierarchicalRepulsion: { nodeDistance: 240 },
          solver: 'hierarchicalRepulsion'
        },
        layout: {
          // 从左到右:链式模型横向铺开,宽屏下利用率远高于上下方向。
          // levelSeparation 是相邻层中心距,节点最小宽 180 时取 280 保证层间留白
          hierarchical: {
            enabled: true,
            direction: 'LR',
            sortMethod: 'directed',
            levelSeparation: 280,
            nodeSpacing: 140
          }
        },
        interaction: { hover: true, tooltipDelay: 200, multiselect: true }
      }
    }
    const networkOptions = buildNetworkOptions()

    // 会话位置键:按"视图层 + 节点名"分开记,根层与各子图层的同名节点互不串位
    const posKey = (id) => (props.viewKey ? `${props.viewKey}\u0001${id}` : id)

    // 把当前画布坐标抄进会话存储(编辑差量更新后调用,供撤销/重做恢复位置)
    const capturePositions = () => {
      if (!network.value) return
      const pos = network.value.getPositions()
      for (const id of Object.keys(pos)) {
        positionStore.set(posKey(id), { x: pos[id].x, y: pos[id].y })
      }
    }

    // 重叠检测与修正:两两比较节点包围盒,横向重叠时把右侧节点推开到
    // 最小间距(LR 布局的主轴是 x,只调 x 不动 y;同层的节点纵向错开不受影响)。
    // 兜底用:正常情况下层级布局 + levelSeparation 已保证间距,任何意外路径
    // (物理过早收敛、节点尺寸变化等)造成的重叠都在这里被推开。
    const resolveOverlaps = () => {
      if (!network.value) return false
      const pos = network.value.getPositions()
      const boxes = []
      for (const id of Object.keys(pos)) {
        const body = network.value.body.nodes[id]
        boxes.push({
          id,
          x: pos[id].x,
          y: pos[id].y,
          w: (body && body.width) || 180,
          h: (body && body.height) || 88
        })
      }
      if (boxes.length < 2) return false
      boxes.sort((a, b) => a.x - b.x)
      const GAP = 48
      let moved = false
      for (let i = 1; i < boxes.length; i++) {
        const prev = boxes[i - 1]
        const cur = boxes[i]
        // 纵向不相交的盒子(同层错开)不需要横向间隔
        const yOverlap = Math.abs(prev.y - cur.y) < (prev.h + cur.h) / 2 + 24
        if (!yOverlap) continue
        const minDx = (prev.w + cur.w) / 2 + GAP
        if (cur.x - prev.x < minDx) {
          cur.x = prev.x + minDx
          moved = true
        }
      }
      if (moved) {
        for (const b of boxes) network.value.moveNode(b.id, b.x, b.y)
      }
      return moved
    }

    // 初始布局稳定后:关物理引擎与层级布局,后续编辑不再整体重排;
    // 先推开可能存在的重叠,再适配视图(带最小缩放下限),让载入后的图自动填满画布
    const freezeLayout = () => {
      if (!network.value || physicsFrozen.value) return
      physicsFrozen.value = true
      network.value.setOptions({ physics: { enabled: false }, layout: { hierarchical: { enabled: false } } })
      resolveOverlaps()
      fitWithMinScale()
      capturePositions()
    }

    // 适配视图,但缩放不低于 --sv-min-scale:大图塞不下就保持可读的最小缩放、
    // 视图居中在图中心,允许用户平移看两端;不为塞满整条链把节点文字缩没
    const fitWithMinScale = () => {
      if (!network.value) return
      network.value.fit({ animation: false })
      const minScale = numVar('--sv-min-scale', 0.75)
      if (network.value.getScale() < minScale) {
        const center = network.value.getViewPosition()
        network.value.moveTo({ position: center, scale: minScale, animation: false })
      }
    }

    // ---------- 选择同步与多选增强 ----------
    // 选择状态变化(select/deselect 都会带出完整清单;多选靠 interaction.multiselect)
    // 提升到 setup 作用域:框选/范围选等程序化选中后也要走同一份同步
    const syncSelection = () => {
      if (!network.value) return
      const ids = network.value.getSelectedNodes()
      selectedIds.value = ids
      emit('selectionChange', ids)
      if (ids.length === 1) {
        // Shift+点击的 tap 也会走到这里:按下时带 Shift 的选中不做范围选锚点
        if (!downHadShift) rangeAnchorId = ids[0]
        emit('nodeSelect', nodes.value.get(ids[0]))
      } else {
        emit('nodeDeselect')
      }
    }

    // Shift+点击范围选的锚点(最近一次不带 Shift 的单选节点)
    let rangeAnchorId = null
    // pointerdown 时 Shift 是否按下:tap 先于 DOM click 触发,锚点判定要用按下瞬间的状态
    let downHadShift = false
    // 上次 pointerdown 的屏幕坐标:区分"点击"与"拖拽"(位移小于阈值才算点击)
    let lastDownPoint = null
    // 空白拖拽框选 / 中键平移的会话状态(框选拦截在捕获阶段,vis 的空白拖拽默认是平移)
    let boxState = null
    let boundPointerEl = null

    // 画布内坐标(与 vis 的 pointer.DOM 同一坐标系):容器相对坐标 + hit test
    const hitAt = (clientX, clientY) => {
      const rect = networkContainer.value.getBoundingClientRect()
      const p = { x: clientX - rect.left, y: clientY - rect.top }
      const nodeId = network.value.getNodeAt(p)
      const edgeId = nodeId !== undefined ? undefined : network.value.getEdgeAt(p)
      return { p, nodeId, edgeId }
    }

    // 空白处按下左键:自己画选框(替换 vis 的默认平移);additive = Ctrl/Cmd 按住时在原选中上累加。
    // 位移极小的抬起按"点空白"处理,补上 vis tap 里的清除选中。
    const startBoxSelect = (start, additive) => {
      const el = networkContainer.value
      const overlay = document.createElement('div')
      overlay.className = 'sv-box-select'
      el.appendChild(overlay)
      boxState = { additive: !!additive, startX: start.x, startY: start.y, endX: start.x, endY: start.y, overlay }
      const onMove = (ev) => {
        if (!boxState) return
        const rect = el.getBoundingClientRect()
        boxState.endX = ev.clientX - rect.left
        boxState.endY = ev.clientY - rect.top
        overlay.classList.add('active')
        overlay.style.left = Math.min(boxState.startX, boxState.endX) + 'px'
        overlay.style.top = Math.min(boxState.startY, boxState.endY) + 'px'
        overlay.style.width = Math.abs(boxState.endX - boxState.startX) + 'px'
        overlay.style.height = Math.abs(boxState.endY - boxState.startY) + 'px'
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        const state = boxState
        boxState = null
        overlay.remove()
        if (!state || !network.value) return
        if (Math.abs(state.endX - state.startX) < 4 && Math.abs(state.endY - state.startY) < 4) {
          // 位移极小 = 空白处单击:清空选中
          network.value.unselectAll()
          syncSelection()
          return
        }
        // 节点中心落在框内即选中
        const pos = network.value.getPositions()
        const x1 = Math.min(state.startX, state.endX)
        const x2 = Math.max(state.startX, state.endX)
        const y1 = Math.min(state.startY, state.endY)
        const y2 = Math.max(state.startY, state.endY)
        const picked = []
        for (const id of Object.keys(pos)) {
          const domPos = network.value.canvasToDOM(pos[id])
          if (domPos.x >= x1 && domPos.x <= x2 && domPos.y >= y1 && domPos.y <= y2) picked.push(id)
        }
        let finalIds = picked
        if (state.additive) {
          const set = new Set(network.value.getSelectedNodes())
          for (const id of picked) set.add(id)
          finalIds = [...set]
        }
        network.value.selectNodes(finalIds, false)
        syncSelection()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }

    // 中键拖拽平移(空白左键拖拽改成框选后,平移挪到中键;滚轮缩放不变)
    const startMiddlePan = (e) => {
      const scale = network.value.getScale()
      const startView = network.value.getViewPosition()
      const startX = e.clientX
      const startY = e.clientY
      const onMove = (ev) => {
        if (!network.value) return
        network.value.moveTo({
          position: { x: startView.x - (ev.clientX - startX) / scale, y: startView.y - (ev.clientY - startY) / scale },
          animation: false
        })
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }

    // 捕获阶段的画布 pointerdown:拦截空白左键(框选)与中键(平移),
    // 其余(节点/边上的左键、右键菜单)原样交给 vis-network
    const onCanvasPointerDown = (e) => {
      if (!network.value) return
      if (e.button === 1) {
        // 中键:preventDefault 挡浏览器滚轮滑动,stopPropagation 不让 vis 把它当拖节点
        // (连线模式下也允许中键平移,横幅不挡导航)
        e.preventDefault()
        e.stopPropagation()
        startMiddlePan(e)
        return
      }
      if (e.button !== 0) return
      // 连线模式的左键(选起点/终点、点空白取消)整体交给 vis 与既有 click 逻辑
      if (props.connectMode) return
      downHadShift = e.shiftKey
      lastDownPoint = { x: e.clientX, y: e.clientY }
      const { p, nodeId, edgeId } = hitAt(e.clientX, e.clientY)
      if (nodeId === undefined && edgeId === undefined && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        startBoxSelect(p, e.ctrlKey || e.metaKey)
      }
    }

    // Shift+点击 = 范围选:从锚点到该节点,按画布 x 位置排序取连续一段(LR 链式布局的自然"范围")
    const shiftRangeSelect = (endId) => {
      const pos = network.value.getPositions()
      const ordered = Object.keys(pos)
        .map((id) => ({ id, x: pos[id].x, y: pos[id].y }))
        .sort((a, b) => (a.x - b.x) || (a.y - b.y))
      const anchor = rangeAnchorId !== null && rangeAnchorId in pos ? rangeAnchorId : endId
      const idxA = ordered.findIndex((n) => n.id === anchor)
      const idxB = ordered.findIndex((n) => n.id === endId)
      if (idxA === -1 || idxB === -1) return
      const range = ordered.slice(Math.min(idxA, idxB), Math.max(idxA, idxB) + 1).map((n) => n.id)
      network.value.selectNodes(range, false)
      syncSelection()
    }

    // 捕获阶段的 DOM click:vis 的 tap 在 mouseup 就已把选中替换成被点节点,
    // 这里随后按 Shift+点击把范围恢复成锚点..该节点的连续段
    const onCanvasClickCapture = (e) => {
      if (!network.value || !e.shiftKey || e.button !== 0 || props.connectMode) return
      if (lastDownPoint && Math.hypot(e.clientX - lastDownPoint.x, e.clientY - lastDownPoint.y) > 5) return
      const { nodeId } = hitAt(e.clientX, e.clientY)
      if (nodeId === undefined) return
      e.preventDefault()
      e.stopPropagation()
      shiftRangeSelect(nodeId)
    }

    // 原生监听只绑一次(换文件时画布实例销毁重建,但容器元素不变)
    const bindCanvasPointerHelpers = () => {
      const el = networkContainer.value
      if (!el || boundPointerEl === el) return
      boundPointerEl = el
      el.addEventListener('pointerdown', onCanvasPointerDown, true)
      el.addEventListener('click', onCanvasClickCapture, true)
    }

    const initNetwork = () => {
      if (networkContainer.value && !network.value) {
        // markRaw:vis-network 9 大量使用私有字段,包上 Vue 的 reactive 代理后
        // 这些方法会抛错(选中节点后侧栏打不开就是这个问题);画布对象本就不该响应式化
        network.value = markRaw(new Network(
          networkContainer.value,
          { nodes: nodes.value, edges: edges.value },
          networkOptions
        ))

        network.value.on('select', syncSelection)
        network.value.on('deselectNode', syncSelection)
        bindCanvasPointerHelpers()

        // 双击子图节点:进入子图内部编辑(App 收到 request-enter 后换视图层)
        network.value.on('doubleClick', (params) => {
          if (params.nodes.length > 0) {
            const node = nodes.value.get(params.nodes[0])
            if (node && node.type === 'NIRGraph') {
              emit('action', { kind: 'request-enter', name: node.id })
            }
          }
        })

        // 初始层级布局稳定后冻结,编辑不再晃动
        network.value.on('stabilizationIterationsDone', freezeLayout)
        network.value.on('stabilized', freezeLayout)

        // 测试钩子:暴露 vis-network 实例给浏览器自动化(selectNodes/oncontext
        // 等调用);正常使用不受影响
        if (typeof window !== 'undefined') window.__spikevisNetwork = network.value

        // 左键点击:连线模式下选起点/终点
        network.value.on('click', (params) => {
          if (props.connectMode) {
            if (params.nodes.length > 0) {
              const id = params.nodes[0]
              if (!connectSource.value) {
                connectSource.value = id
              } else if (connectSource.value !== id) {
                emit('action', { kind: 'connect', src: connectSource.value, dst: id })
                connectSource.value = '' // 连完清空起点,便于继续连下一条
              }
            } else {
              connectSource.value = '' // 点空白取消起点
            }
          }
        })

        // 右键:vis-network 9 的 oncontext 参数只带 pointer,不含 node/edge,
        // 要自己用 getNodeAt/getEdgeAt 做 hit test(pointer.DOM 是画布容器内坐标);
        // 节点优先:边线会穿过节点盒子,节点中心同时命中两者时应弹节点菜单
        network.value.on('oncontext', (params) => {
          const domPoint = params.pointer.DOM
          const nodeId = network.value.getNodeAt(domPoint)
          const edgeId = nodeId !== undefined ? undefined : network.value.getEdgeAt(domPoint)
          contextMenu.value = {
            visible: true,
            x: domPoint.x,
            y: domPoint.y,
            targetType: nodeId !== undefined ? 'node' : (edgeId !== undefined ? 'edge' : 'blank'),
            targetId: nodeId !== undefined ? nodeId : (edgeId !== undefined ? edgePairOf(edgeId) : null)
          }
        })
      }
    }

    // 由 vis 边 id 找回文档里的 (源, 目标) 对
    const edgePairOf = (edgeId) => {
      const e = edges.value.get(edgeId)
      return e ? [e.from, e.to] : null
    }

    // 右键命中的节点类型(子图节点才显示"展开到当前层")
    const targetNodeType = computed(() => {
      if (contextMenu.value.targetType !== 'node') return ''
      const node = nodes.value.get(contextMenu.value.targetId)
      return node ? node.type : ''
    })
    // Input/Output 是模型端口:不给剪枝入口(与侧栏的动作按钮一致)
    const targetPrunable = computed(() => !['Input', 'Output'].includes(targetNodeType.value))

    const closeContextMenu = () => {
      if (contextMenu.value.visible) contextMenu.value.visible = false
    }

    const emitAction = (action) => {
      closeContextMenu()
      emit('action', action)
    }

    const startConnectFrom = (name) => {
      closeContextMenu()
      connectSource.value = name
      emit('action', { kind: 'request-connect-mode' })
    }

    const cancelConnect = () => {
      connectSource.value = ''
      emit('action', { kind: 'request-connect-mode-off' })
    }

    // 为新节点挑会话位置:优先会话存储(撤销/重做恢复),否则按已定位邻居的
    // 均值错开摆放,再不行放视图中心(物理引擎已冻结,新节点不会自己散开)
    const pickPositions = (adds, graphData) => {
      const adjacency = new Map()
      for (const [a, b] of graphData.edges || []) {
        if (!adjacency.has(a)) adjacency.set(a, [])
        if (!adjacency.has(b)) adjacency.set(b, [])
        adjacency.get(a).push(b)
        adjacency.get(b).push(a)
      }
      const center = network.value ? network.value.getViewPosition() : { x: 0, y: 0 }
      adds.forEach((item, i) => {
        if (positionStore.has(posKey(item.id))) return
        const known = (adjacency.get(item.id) || []).filter((nid) => positionStore.has(posKey(nid)))
        let base = center
        if (known.length > 0) {
          let sx = 0
          let sy = 0
          for (const nid of known) {
            sx += positionStore.get(posKey(nid)).x
            sy += positionStore.get(posKey(nid)).y
          }
          base = { x: sx / known.length, y: sy / known.length }
        }
        const spread = adds.length > 1 ? (i - (adds.length - 1) / 2) * 90 : 0
        item.x = base.x + spread
        item.y = base.y + 90
      })
    }

    // 载入图数据。reset = true 表示换了文件(sessionKey 变了):清空重来,
    // 重新跑层级布局;否则差量更新——保留没动的节点位置,只增删改有变化的项。
    const loadGraphData = (graphData, reset = false) => {
      const changedSet = new Set(props.changedNames)
      const issueSet = new Set(props.issueNodes)
      const issueEdgeSet = new Set(props.issueEdges)
      // 有问题边的端点也标红
      for (const key of issueEdgeSet) {
        const [a, b] = key.split('->')
        issueSet.add(a)
        issueSet.add(b)
      }

      const nodeData = []
      Object.entries(graphData.nodes).forEach(([nodeId, node]) => {
        const isIssue = issueSet.has(nodeId)
        const isChanged = changedSet.has(nodeId)
        const baseColor = getNodeColor(node.type)
        let color = baseColor
        if (isChanged) {
          color = { ...baseColor, border: themeColor('--sv-node-border-changed') }
        }
        if (isIssue) {
          const issueBg = themeColor('--sv-bg-node-issue')
          const issueBorder = themeColor('--sv-node-border-issue')
          color = {
            background: issueBg,
            border: issueBorder,
            highlight: { background: issueBg, border: issueBorder },
            hover: { background: issueBg, border: issueBorder }
          }
        }
        const marks = []
        if (isIssue) marks.push(t('canvas.markIssue'))
        if (isChanged) marks.push(t('canvas.markChanged'))
        nodeData.push({
          id: nodeId,
          // 画布显示:卡片式多行标签(类别色类型标题 + 节点名 + 形状小字)
          label: nodeDisplayLabel(node),
          type: node.type,
          inputText: node.inputText || t('canvas.unknown'),
          outputText: node.outputText || t('canvas.unknown'),
          params: node.params || [],
          metadataText: node.metadataText || {},
          childCount: node.childCount || 0,
          font: nodeFont(node.type),
          color,
          // 边框宽度:改动加粗,问题更粗
          borderWidth: isIssue ? 4 : (isChanged ? 3 : 2),
          title: marks.length > 0 ? `${nodeId}(${marks.join(', ')})` : nodeId
        })
      })

      // 边 id 用"源->目标":差量更新时边不因顺序变化而重建
      const edgeData = []
      const issueEdgeColor = themeColor('--sv-edge-issue')
      graphData.edges.forEach((edge) => {
        const key = `${edge[0]}->${edge[1]}`
        const isIssue = issueEdgeSet.has(key)
        edgeData.push({
          id: key,
          from: edge[0],
          to: edge[1],
          color: isIssue ? { color: issueEdgeColor, highlight: issueEdgeColor, hover: issueEdgeColor } : undefined,
          width: isIssue ? 3 : 2,
          title: isIssue ? t('canvas.edgeIssueTooltip') : undefined
        })
      })

      if (reset) {
        positionStore.clear()
        physicsFrozen.value = false
        nodes.value.clear()
        edges.value.clear()
        if (network.value) {
          // 换了文件:整个销毁重建画布实例。根因:同一实例上 setOptions 把
          // layout/physics 关了再开存在竞态——clear 空数据集时物理立刻"稳定"
          // 触发一次冻结,之后重新打开物理的第二次 stabilized 又被冻结守卫
          // 跳过,布局没重跑,节点被纯物理收敛挤成一团(实测 3 节点中心距从
          // 280 压到 138)。销毁重建让初始层级布局确定性地跑一遍。
          network.value.destroy()
          network.value = null
        }
        pickPositionsInitial(nodeData)
        nodes.value.add(nodeData)
        edges.value.add(edgeData)
        // 层级布局在数据加入时同步给出初始位置;重叠检测与视图适配放在
        // nextTick(实例重建完成之后)确定性执行,不依赖物理稳定事件
        // (实测同一会话里 stabilized 事件的时序不可靠)。fit 带最小缩放下限。
        nextTick(() => {
          if (!network.value) return
          resolveOverlaps()
          fitWithMinScale()
          capturePositions()
        })
        return
      }

      // 差量更新:已有节点 update(不传 x/y,vis 保留原坐标),新增的按会话位置摆
      const existingIds = new Set(nodes.value.getIds())
      const desiredIds = new Set(nodeData.map((n) => n.id))
      const adds = []
      for (const item of nodeData) {
        if (existingIds.has(item.id)) {
          nodes.value.update(item)
        } else {
          adds.push(item)
        }
      }
      const removals = [...existingIds].filter((id) => !desiredIds.has(id))
      pickPositions(adds, graphData)
      if (adds.length > 0) nodes.value.add(adds)
      if (removals.length > 0) nodes.value.remove(removals)

      const existingEdgeIds = new Set(edges.value.getIds())
      const desiredEdgeIds = new Set(edgeData.map((e) => e.id))
      const edgeAdds = []
      for (const e of edgeData) {
        if (existingEdgeIds.has(e.id)) {
          edges.value.update(e)
        } else {
          edgeAdds.push(e)
        }
      }
      const staleEdges = [...existingEdgeIds].filter((id) => !desiredEdgeIds.has(id))
      if (edgeAdds.length > 0) edges.value.add(edgeAdds)
      if (staleEdges.length > 0) edges.value.remove(staleEdges)

      // 有节点被删时清掉悬空选中:vis 不会因节点从数据集移除而自动取消选中,
      // 残留的旧 id 会让"Delete 再删一次"这类多选动作扑空报错
      if (removals.length > 0) {
        network.value.unselectAll()
        syncSelection()
      }

      nextTick(capturePositions)
    }

    // 整体重排路径:全部交给层级布局,不预设坐标
    const pickPositionsInitial = (nodeData) => {
      for (const item of nodeData) {
        delete item.x
        delete item.y
      }
    }

    // 根据节点类别生成卡片配色:统一深色卡面 + 类别色标题(标题色放进 font.bold),
    // 边框、悬停、选中态走主题变量。
    const getNodeColor = (nodeType) => {
      return {
        background: themeColor('--sv-bg-node'),
        border: themeColor('--sv-node-border'),
        highlight: {
          background: themeColor('--sv-bg-node-selected'),
          border: themeColor('--sv-node-border-selected')
        },
        hover: {
          background: themeColor('--sv-bg-node-hover'),
          border: themeColor('--sv-node-border-hover')
        }
      }
    }
    const categoryTitleColor = (nodeType) => themeColor(CATEGORY_VAR[CATEGORY_OF[nodeType] || 'other'])

    // 卡片小字:子图显示子节点数,其余显示第一个带 shape 的参数(通道数/形状)
    const nodeMetaText = (node) => {
      if (node.type === 'NIRGraph') return t('canvas.childCount', { n: node.childCount || 0 })
      const shaped = (node.params || []).find((p) => Array.isArray(p.shape) && p.shape.length > 0)
      return shaped ? `[${shaped.shape.join(', ')}]` : ''
    }

    // 画布节点标签:第一行类型名(类别色粗体)做标题,第二行节点名,小字放形状/子图信息
    const nodeDisplayLabel = (node) => {
      const meta = nodeMetaText(node)
      return meta
        ? `<b>${node.type}</b>\n${node.id}\n<code>${meta}</code>`
        : `<b>${node.type}</b>\n${node.id}`
    }

    // 节点级字体:标题行粗体按类别着色,节点名次之,小字行等宽略小
    const nodeFont = (nodeType) => ({
      multi: 'html',
      size: Number(cssVar('--sv-node-font-name')) || 15,
      face: themeColor('--sv-font'),
      color: themeColor('--sv-text-regular'),
      bold: { size: Number(cssVar('--sv-node-font-title')) || 16, face: themeColor('--sv-font'), color: categoryTitleColor(nodeType), mod: 'bold' },
      mono: { size: Number(cssVar('--sv-node-font-meta')) || 13, face: themeColor('--sv-font-mono'), color: themeColor('--sv-text-secondary'), mod: 'monospace' }
    })

    const openFileBrowser = () => {
      fileInput.value.click()
    }

    // 按扩展名分流:.json 走旧版查看,.nir 走核心读入
    const readFileAny = async (file) => {
      const lower = file.name.toLowerCase()
      if (lower.endsWith('.json')) {
        const text = await file.text()
        return loadJsonModel(text, file.name)
      }
      return openNirFile(file)
    }

    const handleFileSelect = async (event) => {
      const file = event.target.files[0]
      if (file) {
        try {
          const nirData = await readFileAny(file)
          emit('fileDrop', { file, data: nirData })
        } catch (error) {
          console.error('文件解析失败:', error)
          ElMessage.error(error.message || t('msg.parseFailed'))
        }
      }
      // 清空input值,允许重复选择同一文件
      event.target.value = ''
    }

    const handleDragOver = (e) => {
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.classList.add('drag-over')
    }

    const handleDragLeave = (e) => {
      e.preventDefault()
      e.stopPropagation()
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX
      const y = e.clientY
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        e.currentTarget.classList.remove('drag-over')
      }
    }

    const handleDrop = async (e) => {
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.classList.remove('drag-over')
      const files = e.dataTransfer.files
      if (files.length > 0) {
        const file = files[0]
        try {
          const nirData = await readFileAny(file)
          emit('fileDrop', { file, data: nirData })
        } catch (error) {
          console.error('文件解析失败:', error)
          ElMessage.error(error.message || t('msg.parseFailed'))
        }
      } else {
        ElMessage.warning(t('msg.invalidFile'))
      }
    }

    const exportImage = () => {
      if (network.value && networkContainer.value) {
        const canvas = networkContainer.value.querySelector('canvas')
        if (canvas) {
          const link = document.createElement('a')
          link.download = 'nir-graph.png'
          link.href = canvas.toDataURL()
          link.click()
        }
      }
    }

    // 连线模式开关或被禁用时,清掉内部起点
    watch(() => props.connectMode, (active) => {
      if (!active) connectSource.value = ''
    })

    // 模型或标记变化:换了文件(sessionKey 变)或换了视图层(viewKey 变)整体重排,
    // 否则差量更新保持位置
    watch(() => [props.modelData, props.changedNames, props.issueNodes, props.issueEdges, props.viewKey],
      (newData) => {
        if (newData[0]) {
          const reset = lastSessionKey !== props.sessionKey || lastViewKey !== props.viewKey
          lastSessionKey = props.sessionKey
          lastViewKey = props.viewKey
          loadGraphData(newData[0], reset)
          nextTick(() => {
            if (!network.value && networkContainer.value) {
              initNetwork()
            }
          })
        }
      }, { immediate: true })

    watch(() => props.hasModel, (hasModel) => {
      if (hasModel && !network.value && networkContainer.value) {
        nextTick(() => {
          initNetwork()
        })
      }
    })

    onMounted(() => {
      // 初始化时不需要立即创建网络,等待数据加载
    })

    return {
      networkContainer,
      fileInput,
      exportImage,
      openFileBrowser,
      handleFileSelect,
      handleDragOver,
      handleDragLeave,
      handleDrop,
      contextMenu,
      closeContextMenu,
      emitAction,
      startConnectFrom,
      cancelConnect,
      connectSource,
      selectedIds,
      targetNodeType,
      targetPrunable,
      t
    }
  }
}
</script>

<style scoped>
.network-canvas {
  width: 100%;
  height: 100%;
  position: relative;
  margin: 0;
  padding: 0;
}

.drop-zone {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 空状态与画布同底,叠加细网格 */
  background-color: var(--sv-bg-canvas);
  background-image:
    linear-gradient(var(--sv-grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--sv-grid-line) 1px, transparent 1px);
  background-size: var(--sv-grid-size) var(--sv-grid-size);
  transition: background-color 0.2s ease;
  cursor: pointer;
  margin: 0;
  padding: 0;
}

.drop-zone:hover,
.drop-zone.drag-over {
  background-color: var(--sv-bg-panel);
}

.drop-content {
  text-align: center;
  color: var(--sv-text-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: var(--sv-font);
}

.logo-text {
  font-size: 60px;
  font-weight: 400;
  color: var(--sv-text-secondary);
  letter-spacing: 0.5px;
}

.logo-icon {
  width: 60px;
  height: 60px;
  color: var(--sv-primary-hover);
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-icon svg {
  width: 100%;
  height: 100%;
}

.open-button {
  background: var(--sv-bg-node);
  border: 1px solid var(--sv-border-strong);
  border-radius: var(--sv-radius);
  padding: 12px 24px;
  font-size: 14px;
  color: var(--sv-text-regular);
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
  font-family: var(--sv-font);
  box-shadow: var(--sv-shadow-panel);
}

.open-button:hover {
  background: var(--sv-bg-node-hover);
  border-color: var(--sv-border-strong);
}

.open-button:active {
  transform: translateY(1px);
}

.network-container {
  width: 100%;
  height: 100%;
  position: relative;
  /* 深色画布 + 细网格(vis-network 的 canvas 透明,网格从这里透出) */
  background-color: var(--sv-bg-canvas);
  background-image:
    linear-gradient(var(--sv-grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--sv-grid-line) 1px, transparent 1px);
  background-size: var(--sv-grid-size) var(--sv-grid-size);
  margin: 0;
  padding: 0;
}

/* 空白处拖拽框选的矩形(脚本里动态创建;按下中键平移时不出现) */
.sv-box-select {
  position: absolute;
  z-index: 1200;
  border: 1px dashed var(--sv-primary-hover);
  /* 主题色 8% 透明填充;不支持 color-mix 的浏览器回退为纯虚线框 */
  background: transparent;
  background: color-mix(in srgb, var(--sv-primary-hover) 8%, transparent);
  pointer-events: none;
  display: none;
}

.sv-box-select.active {
  display: block;
}

.connect-banner {
  position: absolute;
  /* 挂在画布底部上方:顶部是状态条/面包屑浮层,顶部横幅会压住它们(与 toast 同区,略高一点) */
  bottom: 96px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1500;
  background: var(--sv-bg-panel);
  border: 1px solid var(--sv-primary);
  border-radius: var(--sv-radius);
  padding: 8px 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--sv-primary-hover);
  font-size: 14px;
  box-shadow: var(--sv-shadow-pop);
}

.banner-button {
  background: var(--sv-bg-node);
  border: 1px solid var(--sv-border-strong);
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
  color: var(--sv-text-regular);
  font-size: 14px;
  font-family: var(--sv-font);
}

.banner-button:hover {
  background: var(--sv-bg-node-hover);
  color: var(--sv-text-primary);
}

.context-menu {
  position: absolute;
  z-index: 2000;
  background: var(--sv-bg-overlay);
  border: 1px solid var(--sv-border-strong);
  border-radius: var(--sv-radius);
  box-shadow: var(--sv-shadow-pop);
  min-width: 160px;
  overflow: hidden;
  padding: 4px 0;
}

.context-item {
  padding: 8px 16px;
  cursor: pointer;
  font-size: 14px;
  color: var(--sv-text-regular);
}

.context-item:hover {
  background: var(--sv-bg-node-hover);
  color: var(--sv-text-primary);
}

.context-item.danger {
  color: var(--sv-danger);
}
</style>
