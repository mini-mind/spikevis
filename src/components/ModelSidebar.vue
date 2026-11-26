<template>
  <div class="model-sidebar" :class="{ 'sidebar-visible': isVisible }">
    <div class="sidebar-content">
      <template v-if="selectedNode">
        <!-- 分区 1:类型与名称(标题区,一眼知道在看什么) -->
        <div class="head-block">
          <div class="type-line">
            <span class="type-dot" :class="`cat-${categoryOf(selectedNode.type)}`"></span>
            <span class="type-name">{{ selectedNode.type }}</span>
            <span class="type-label">{{ tOp(selectedNode.type) }}</span>
          </div>
          <h3 class="node-name">{{ selectedNode.id }}</h3>
          <div v-if="typeNoteText" class="type-note">{{ typeNoteText }}</div>
          <div class="shape-line">
            <span class="shape-item"><span class="shape-key">{{ t('sidebar.inShape') }}</span>{{ shapeText(selectedNode.inputText) }}</span>
            <span class="shape-item"><span class="shape-key">{{ t('sidebar.outShape') }}</span>{{ shapeText(selectedNode.outputText) }}</span>
          </div>
          <div v-if="nodeIssues.length > 0" class="issue-box">
            <div class="issue-title">{{ t('sidebar.issues') }}</div>
            <div v-for="(issue, i) in nodeIssues" :key="i" class="issue-line">{{ issue }}</div>
          </div>
        </div>

        <!-- 节点操作(Input/Output 是模型端口,不提供剪枝入口) -->
        <div class="node-actions">
          <el-button size="small" @click="$emit('action', { kind: 'request-rename', name: selectedNode.id })">{{ t('sidebar.rename') }}</el-button>
          <el-button v-if="!isPortNode" size="small" @click="$emit('action', { kind: 'request-prune', name: selectedNode.id })">{{ t('sidebar.prune') }}</el-button>
          <el-button
            v-if="selectedNode.type === 'NIRGraph'"
            size="small"
            type="primary"
            plain
            @click="$emit('action', { kind: 'request-enter', name: selectedNode.id })"
          >{{ t('subgraph.enterSidebar') }}</el-button>
          <el-button
            v-if="selectedNode.type === 'NIRGraph'"
            size="small"
            @click="$emit('action', { kind: 'request-ungroup', name: selectedNode.id })"
          >{{ t('sidebar.ungroup') }}</el-button>
          <el-button size="small" type="danger" plain @click="$emit('action', { kind: 'request-remove', name: selectedNode.id })">{{ t('sidebar.remove') }}</el-button>
        </div>

        <!-- 分区 2:可编辑参数(统计行属于各自参数块,窄屏可换行不截断) -->
        <div v-if="selectedNode.params && selectedNode.params.length > 0" class="section">
          <div class="section-title">{{ t('sidebar.params') }}</div>
          <div v-for="param in editableParams" :key="param.key" class="param-block">
            <div class="param-label">
              {{ paramLabelText(param) }}
              <span class="param-meta">{{ dtypeText(param) }}</span>
            </div>

            <!-- 字符串字段(padding 等) -->
            <el-input
              v-if="param.isString"
              :model-value="stringOf(param)"
              size="small"
              @change="(v) => editString(param, v)"
            />

            <!-- 数值标量 -->
            <el-input-number
              v-else-if="param.isScalarNumeric"
              :model-value="scalarOf(param)"
              :step="0.1"
              size="small"
              class="param-input"
              @change="(v) => editScalar(param, v)"
            />

            <!-- 整数元组/形状(stride、Input 形状等):文本输入 "1, 2" -->
            <el-input
              v-else-if="param.kind === 'int' || param.kind === 'shape'"
              :model-value="(param.elements || []).join(', ')"
              size="small"
              :placeholder="t('sidebar.intArrayPlaceholder')"
              @change="(v) => editIntArray(param, v)"
            />

            <!-- 数值数组:小数组逐个编辑,大数组只给统计与整体缩放 -->
            <template v-else-if="param.elements">
              <div class="array-value">{{ previewList(param.elements) }}</div>
              <div class="param-editors">
                <el-input-number
                  v-model="uniformDrafts[param.key]"
                  size="small"
                  :placeholder="t('sidebar.setAllPlaceholder')"
                  class="param-input"
                />
                <el-button size="small" @click="editUniform(param)">{{ t('sidebar.setAll') }}</el-button>
              </div>
              <div class="param-editors">
                <el-input
                  v-model="indexDrafts[param.key]"
                  size="small"
                  :placeholder="t('sidebar.indicesPlaceholder')"
                />
                <el-button size="small" @click="editIndices(param)">{{ t('sidebar.setIndices') }}</el-button>
              </div>
              <div class="param-editors">
                <el-input-number
                  v-model="scaleDrafts[param.key]"
                  size="small"
                  :placeholder="t('sidebar.scalePlaceholder')"
                  class="param-input"
                />
                <el-button size="small" @click="editScale(param)">{{ t('sidebar.scale') }}</el-button>
              </div>
            </template>

            <template v-else-if="param.stats">
              <div class="array-value large">{{ t('sidebar.bigArray', { shape: param.shape.join(', '), count: param.stats.count }) }}</div>
              <!-- 统计行:flex 可换行,窄侧栏放不下时换行而不是截断 -->
              <div class="stats-row">
                <span class="stat-cell"><span class="stat-name">min</span><span class="stat-num">{{ formatNum(param.stats.min) }}</span></span>
                <span class="stat-cell"><span class="stat-name">max</span><span class="stat-num">{{ formatNum(param.stats.max) }}</span></span>
                <span class="stat-cell"><span class="stat-name">mean</span><span class="stat-num">{{ formatNum(param.stats.mean) }}</span></span>
              </div>
              <div class="param-editors">
                <el-input-number v-model="scaleDrafts[param.key]" size="small" :placeholder="t('sidebar.scalePlaceholder')" class="param-input" />
                <el-button size="small" @click="editScale(param)">{{ t('sidebar.scaleAll') }}</el-button>
              </div>
            </template>

            <!-- 预览兜底(未知数据集) -->
            <div v-else class="array-value">{{ param.preview }}</div>
          </div>
        </div>

        <!-- 分区 3:元数据(次要信息,默认折叠) -->
        <div class="section">
          <el-collapse class="meta-collapse">
            <el-collapse-item :title="t('sidebar.metadata')">
              <div class="meta-hint">{{ t('sidebar.metadataHint') }}</div>
              <div v-for="(value, key) in selectedNode.metadataText" :key="key" class="meta-row">
                <span class="meta-key">{{ key }}</span>
                <span class="meta-value">{{ value }}</span>
                <el-button size="small" text type="danger" @click="removeMeta(key)">{{ t('sidebar.removeMeta') }}</el-button>
              </div>
              <div class="param-editors">
                <el-input v-model="newMetaKey" size="small" :placeholder="t('sidebar.key')" class="meta-key-input" />
                <el-input v-model="newMetaValue" size="small" :placeholder="t('sidebar.value')" />
                <el-button size="small" @click="addMeta">{{ t('sidebar.add') }}</el-button>
              </div>
            </el-collapse-item>
          </el-collapse>
        </div>
      </template>
      <div v-else class="no-selection">
        <el-empty :description="t('sidebar.empty')" />
      </div>
    </div>
  </div>
</template>

<script>
import { reactive, ref, computed, watch } from 'vue'
import { t, tOr, tOp, tNote } from '../i18n/index.js'

// 节点类别:标题行颜色按类别区分(与 NetworkCanvas 的 CATEGORY_OF 一致)
const CATEGORY_OF = {
  Input: 'io', Output: 'io',
  LIF: 'neuron', LI: 'neuron', IF: 'neuron', I: 'neuron', CubaLIF: 'neuron', CubaLI: 'neuron',
  Linear: 'synapse', Affine: 'synapse', Conv1d: 'synapse', Conv2d: 'synapse',
  SumPool2d: 'shape', AvgPool2d: 'shape', Flatten: 'shape', Scale: 'shape', Threshold: 'shape', Delay: 'shape',
  NIRGraph: 'graph'
}

export default {
  name: 'ModelSidebar',
  props: {
    isVisible: {
      type: Boolean,
      default: false
    },
    selectedNode: {
      type: Object,
      default: null
    },
    // 该节点的校验问题文字(App 已按当前语言出好)
    nodeIssues: {
      type: Array,
      default: () => []
    },
    // 当前所在的子图路径(进入子图编辑用):参数编辑动作的 path = basePath + 节点名
    basePath: {
      type: Array,
      default: () => []
    }
  },
  emits: ['action'],
  setup(props, { emit }) {
    // 选中节点在文档里的完整路径(当前层前缀 + 局部名)
    const nodePath = () => [...props.basePath, props.selectedNode.id]
    // 各参数的草稿输入(整体设值/缩放)
    const uniformDrafts = reactive({})
    const indexDrafts = reactive({})
    const scaleDrafts = reactive({})
    const newMetaKey = ref('')
    const newMetaValue = ref('')

    // 只渲染可编辑参数;子节点数之类的展示项除外
    const editableParams = computed(() =>
      (props.selectedNode ? props.selectedNode.params : []).filter((p) => p.key !== '__children')
    )

    // 类型说明与类别色点(语言切换即时刷新)
    const typeNoteText = computed(() =>
      props.selectedNode ? [tOp(props.selectedNode.type), tNote(props.selectedNode.type)].filter(Boolean).join(' · ') : ''
    )
    const categoryOf = (type) => CATEGORY_OF[type] || 'other'

    // Input/Output 是模型端口:不提供剪枝入口(端口通道数定义图的边界)
    const isPortNode = computed(() =>
      props.selectedNode ? ['Input', 'Output'].includes(props.selectedNode.type) : false
    )

    // 参数名:按字段 key 从字典取当前语言,缺条目回退 io 层带来的正典 label;
    // 非标准字段渲染成 "名字（非标准字段）"
    const paramLabelText = (param) => {
      if (param.nonStandard) return `${param.key}（${t('sidebar.customField')}）`
      return tOr(`paramLabels.${param.key}`, param.label)
    }
    // 形状文本:'?' 是 io 层的语言无关占位符,这里本地化成"未知"
    const shapeText = (text) => (!text || text === '?' ? t('canvas.unknown') : text)

    // 换选中节点时清掉草稿
    watch(() => props.selectedNode && props.selectedNode.id, () => {
      Object.keys(uniformDrafts).forEach((k) => delete uniformDrafts[k])
      Object.keys(indexDrafts).forEach((k) => delete indexDrafts[k])
      Object.keys(scaleDrafts).forEach((k) => delete scaleDrafts[k])
      newMetaKey.value = ''
      newMetaValue.value = ''
    })

    const act = (action) => emit('action', action)

    const stringOf = (param) => {
      // 预览文本去掉 shape 尾注
      return param.preview.split(' shape=')[0]
    }
    const scalarOf = (param) => {
      const n = Number(param.preview.split(' shape=')[0])
      return Number.isFinite(n) ? n : 0
    }
    const dtypeText = (param) => `${param.dtype}` + (param.shape && param.shape.length ? `[${param.shape.join(',')}]` : '')
    const formatNum = (x) => (x === null || x === undefined ? '-' : Math.round(x * 1e4) / 1e4)
    const previewList = (elements) => {
      if (elements.length <= 16) return `[${elements.map(formatNum).join(', ')}]`
      return `[${elements.slice(0, 8).map(formatNum).join(', ')}, ... ${elements.slice(-4).map(formatNum).join(', ')}] (${elements.length})`
    }

    const editScalar = (param, v) => {
      if (v === undefined || v === null) return
      act({ kind: 'setScalar', path: nodePath(), field: param.key, value: v })
    }
    const editString = (param, v) => act({ kind: 'setString', path: nodePath(), field: param.key, value: v })
    const editIntArray = (param, text) => {
      const values = String(text).split(/[,;\s]+/).map((s) => s.trim()).filter((s) => s !== '').map(Number)
      if (values.length === 0 || values.some((n) => !Number.isFinite(n))) return
      act({ kind: 'setIntArray', path: nodePath(), field: param.key, values })
    }
    const editUniform = (param) => {
      if (uniformDrafts[param.key] === undefined) return
      act({ kind: 'setUniform', path: nodePath(), field: param.key, value: uniformDrafts[param.key] })
      uniformDrafts[param.key] = undefined
    }
    const editScale = (param) => {
      if (scaleDrafts[param.key] === undefined) return
      act({ kind: 'scaleField', path: nodePath(), field: param.key, factor: scaleDrafts[param.key] })
      scaleDrafts[param.key] = undefined
    }
    const editIndices = (param) => {
      const text = indexDrafts[param.key]
      if (!text) return
      const pairs = String(text).split(/[,;]+/).map((piece) => {
        const m = piece.split(':')
        if (m.length !== 2) return null
        const index = Number(m[0].trim())
        const value = Number(m[1].trim())
        return Number.isFinite(index) && Number.isFinite(value) ? { index, value } : null
      }).filter(Boolean)
      if (pairs.length === 0) return
      act({ kind: 'setFieldIndices', path: nodePath(), field: param.key, pairs })
      indexDrafts[param.key] = ''
    }
    const removeMeta = (key) => act({ kind: 'setMetadata', path: nodePath(), key, value: null })
    const addMeta = () => {
      if (!newMetaKey.value) return
      const raw = newMetaValue.value
      const asNum = Number(raw)
      const value = raw !== '' && Number.isFinite(asNum) ? asNum : raw
      act({ kind: 'setMetadata', path: nodePath(), key: newMetaKey.value, value })
      newMetaKey.value = ''
      newMetaValue.value = ''
    }

    return {
      uniformDrafts, indexDrafts, scaleDrafts, newMetaKey, newMetaValue,
      editableParams, typeNoteText, categoryOf, isPortNode, paramLabelText, shapeText,
      stringOf, scalarOf, dtypeText, formatNum, previewList,
      editScalar, editString, editIntArray, editUniform, editScale, editIndices,
      removeMeta, addMeta, t, tOp
    }
  }
}
</script>

<style scoped>
/* 侧栏:宽度自适应,窄屏占满减 32px;滑入滑出用 transform(不依赖定宽的 right 值) */
.model-sidebar {
  position: fixed;
  top: 0;
  right: 0;
  width: min(360px, calc(100vw - 32px));
  height: 100vh;
  background-color: var(--sv-bg-panel);
  border-left: 1px solid var(--sv-border-strong);
  box-shadow: var(--sv-inset-highlight), var(--sv-shadow-panel);
  z-index: 1000;
  transform: translateX(calc(100% + 16px));
  transition: transform 0.28s ease;
  display: flex;
  flex-direction: column;
}

.model-sidebar.sidebar-visible {
  transform: translateX(0);
}

.sidebar-content {
  padding: 18px;
  flex: 1;
  overflow-y: auto;
  min-width: 0; /* 内容(等宽长数字串)可收缩,不把侧栏撑破 */
}

/* ===== 分区 1:类型与名称 ===== */
.head-block {
  border-bottom: 1px solid var(--sv-border);
  padding-bottom: 12px;
  margin-bottom: 12px;
}

.type-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.type-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex: none;
}

.cat-io { background: var(--sv-cat-io); }
.cat-neuron { background: var(--sv-cat-neuron); }
.cat-synapse { background: var(--sv-cat-synapse); }
.cat-shape { background: var(--sv-cat-shape); }
.cat-graph { background: var(--sv-cat-graph); }
.cat-other { background: var(--sv-cat-other); }

.type-name {
  font-family: var(--sv-font-mono);
  font-weight: 600;
  font-size: 14px;
  color: var(--sv-text-regular);
  word-break: break-all;
}

.type-label {
  color: var(--sv-text-secondary);
  font-size: 14px;
}

.node-name {
  margin: 6px 0 4px;
  font-size: 18px;
  font-weight: 700;
  color: var(--sv-text-primary);
  word-break: break-all;
  line-height: 1.35;
}

.type-note {
  font-size: 14px;
  color: var(--sv-text-secondary);
  line-height: 1.5;
}

/* 输入/输出形状:一行两项,窄屏换行 */
.shape-line {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-family: var(--sv-font-mono);
  font-size: 14px;
  color: var(--sv-text-regular);
}

.shape-item {
  display: flex;
  gap: 6px;
  align-items: baseline;
  min-width: 0;
  word-break: break-all;
}

.shape-key {
  color: var(--sv-text-secondary);
  flex: none;
}

/* 校验问题:红字块 */
.issue-box {
  margin-top: 10px;
  border: 1px solid var(--sv-node-border-issue);
  border-radius: var(--sv-radius-sm);
  padding: 8px 10px;
}

.issue-title {
  color: var(--sv-danger);
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 4px;
}

.issue-line {
  color: var(--sv-danger);
  font-size: 14px;
  line-height: 1.5;
  word-break: break-all;
}

/* ===== 操作按钮行:可换行,窄屏不挤 ===== */
.node-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

/* ===== 分区标题:小标签 + 左侧类别色条 ===== */
.section {
  margin-bottom: 12px;
  min-width: 0;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--sv-text-secondary);
  padding-left: 8px;
  border-left: 3px solid var(--sv-border-strong);
  margin-bottom: 8px;
}

/* ===== 参数块 ===== */
.param-block {
  border: 1px solid var(--sv-border);
  border-radius: var(--sv-radius);
  padding: 10px 12px;
  margin-bottom: 8px;
  background-color: var(--sv-bg-input);
  min-width: 0;
}

.param-label {
  font-size: 14px;
  color: var(--sv-text-primary);
  margin-bottom: 6px;
  font-weight: 600;
  word-break: break-all;
}

.param-meta {
  color: var(--sv-text-secondary);
  font-weight: 400;
  font-size: 14px;
  margin-left: 6px;
  font-family: var(--sv-font-mono);
}

.param-editors {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  align-items: center;
  min-width: 0;
}

/* 输入控件可收缩:窄侧栏放不下时缩宽换行,不溢出 */
.param-editors .el-input,
.param-editors .el-input-number {
  max-width: 100%;
  min-width: 0;
}

.param-input {
  width: 130px;
}

/* 小屏(侧栏占满屏宽时)参数输入放宽 */
@media (max-width: 720px) {
  .param-input {
    width: 160px;
  }
}

.array-value {
  font-family: var(--sv-font-mono);
  font-size: 14px;
  /* 等宽数字对齐;长数字串允许断行不溢出 */
  font-variant-numeric: tabular-nums;
  color: var(--sv-text-regular);
  word-break: break-all;
  overflow-wrap: anywhere;
}

.array-value.large {
  color: var(--sv-text-secondary);
}

/* 大数组的 min/max/mean 统计行:flex 可换行(窄侧栏放不下时换行而不是截断),
   名称列定宽右对齐,数值等宽字体按小数点对齐(formatNum 统一 4 位小数) */
.stats-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
  margin-top: 4px;
}

.stat-cell {
  font-family: var(--sv-font-mono);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: var(--sv-text-regular);
  display: flex;
  gap: 6px;
  align-items: baseline;
  flex: none;
}

.stat-name {
  color: var(--sv-text-secondary);
  flex: none;
  width: 38px;
  text-align: left;
}

/* 数值右对齐 + 定宽:小数点对齐(formatNum 统一 4 位小数);超宽时随行换行 */
.stat-num {
  flex: none;
  min-width: 72px;
  text-align: right;
}

/* ===== 分区 3:元数据(折叠面板) ===== */
.meta-collapse {
  border-top: 1px solid var(--sv-border);
  border-bottom: 1px solid var(--sv-border);
  --el-collapse-border-color: var(--sv-border);
}

.meta-collapse .el-collapse-item__header {
  font-size: 14px;
  font-weight: 600;
  color: var(--sv-text-secondary);
  background: transparent;
}

.meta-hint {
  font-size: 14px;
  color: var(--sv-text-muted);
  margin-bottom: 8px;
}

/* 元数据行三列:键 | 值(可换行,允许收缩) | 删除按钮,互不重叠 */
.meta-row {
  display: grid;
  grid-template-columns: minmax(72px, auto) minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
  margin-bottom: 4px;
  font-size: 14px;
}

.meta-key {
  color: var(--sv-text-secondary);
  font-weight: 600;
  word-break: break-all;
  padding-top: 2px;
}

.meta-value {
  color: var(--sv-text-regular);
  word-break: break-all;
  overflow-wrap: anywhere;
  font-family: var(--sv-font-mono);
  line-height: 1.5;
}

.meta-key-input {
  width: 90px;
}

.no-selection {
  margin-bottom: 20px;
}
</style>
