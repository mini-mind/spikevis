<template>
  <div class="model-sidebar" :class="{ 'sidebar-visible': isVisible }">
    <div class="sidebar-content">
      <h3>节点详情</h3>
      <div v-if="selectedNode" class="node-details">
        <!-- 基本信息 -->
        <el-descriptions :column="1" border>
          <el-descriptions-item label="节点ID">
            {{ selectedNode.id }}
          </el-descriptions-item>
          <el-descriptions-item label="节点类型">
            {{ selectedNode.type }}
            <div v-if="typeNote(selectedNode.type)" class="type-note">{{ typeNote(selectedNode.type) }}</div>
          </el-descriptions-item>
          <el-descriptions-item label="输入形状">
            {{ selectedNode.inputText }}
          </el-descriptions-item>
          <el-descriptions-item label="输出形状">
            {{ selectedNode.outputText }}
          </el-descriptions-item>
          <el-descriptions-item v-if="nodeIssues.length > 0" label="校验问题">
            <div v-for="(issue, i) in nodeIssues" :key="i" class="issue-line">{{ issue }}</div>
          </el-descriptions-item>
        </el-descriptions>

        <!-- 节点操作 -->
        <div class="node-actions">
          <el-button size="small" @click="$emit('action', { kind: 'request-rename', name: selectedNode.id })">重命名</el-button>
          <el-button size="small" @click="$emit('action', { kind: 'request-prune', name: selectedNode.id })">通道剪枝</el-button>
          <el-button
            v-if="selectedNode.type === 'NIRGraph'"
            size="small"
            @click="$emit('action', { kind: 'request-ungroup', name: selectedNode.id })"
          >展开到当前层</el-button>
          <el-button size="small" type="danger" plain @click="$emit('action', { kind: 'request-remove', name: selectedNode.id })">删除节点</el-button>
        </div>

        <!-- 节点参数(可编辑) -->
        <div v-if="selectedNode.params && selectedNode.params.length > 0" class="node-parameters">
          <h4>节点参数</h4>
          <div v-for="param in editableParams" :key="param.key" class="param-block">
            <div class="param-label">
              {{ param.label }}
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
              placeholder="逗号分隔的整数,如 2, 2"
              @change="(v) => editIntArray(param, v)"
            />

            <!-- 数值数组:小数组逐个编辑,大数组只给统计与整体缩放 -->
            <template v-else-if="param.elements">
              <div class="array-value">{{ previewList(param.elements) }}</div>
              <div class="param-editors">
                <el-input-number
                  v-model="uniformDrafts[param.key]"
                  size="small"
                  placeholder="整体设为"
                  class="param-input"
                />
                <el-button size="small" @click="editUniform(param)">整体设值</el-button>
              </div>
              <div class="param-editors">
                <el-input
                  v-model="indexDrafts[param.key]"
                  size="small"
                  placeholder="按下标改,如 0:0.5, 3:2"
                />
                <el-button size="small" @click="editIndices(param)">改下标</el-button>
              </div>
              <div class="param-editors">
                <el-input-number
                  v-model="scaleDrafts[param.key]"
                  size="small"
                  placeholder="缩放倍数"
                  class="param-input"
                />
                <el-button size="small" @click="editScale(param)">缩放</el-button>
              </div>
            </template>

            <template v-else-if="param.stats">
              <div class="array-value large">
                形状 [{{ param.shape.join(', ')}},共 {{ param.stats.count }} 个元素,不逐个编辑]
              </div>
              <div class="stats-row">
                <span class="stat-cell"><span class="stat-name">min</span><span class="stat-num">{{ formatNum(param.stats.min) }}</span></span>
                <span class="stat-cell"><span class="stat-name">max</span><span class="stat-num">{{ formatNum(param.stats.max) }}</span></span>
                <span class="stat-cell"><span class="stat-name">mean</span><span class="stat-num">{{ formatNum(param.stats.mean) }}</span></span>
              </div>
              <div class="param-editors">
                <el-input-number v-model="scaleDrafts[param.key]" size="small" placeholder="缩放倍数" class="param-input" />
                <el-button size="small" @click="editScale(param)">整体缩放</el-button>
              </div>
            </template>

            <!-- 预览兜底(未知数据集) -->
            <div v-else class="array-value">{{ param.preview }}</div>
          </div>
        </div>

        <!-- 元数据(可编辑) -->
        <div class="node-metadata">
          <h4>元数据</h4>
          <div v-for="(value, key) in selectedNode.metadataText" :key="key" class="meta-row">
            <span class="meta-key">{{ key }}</span>
            <span class="meta-value">{{ value }}</span>
            <el-button size="small" text type="danger" @click="removeMeta(key)">删</el-button>
          </div>
          <div class="param-editors">
            <el-input v-model="newMetaKey" size="small" placeholder="键" class="meta-key-input" />
            <el-input v-model="newMetaValue" size="small" placeholder="值(字符串或数字)" />
            <el-button size="small" @click="addMeta">添加</el-button>
          </div>
        </div>
      </div>
      <div v-else class="no-selection">
        <el-empty description="点击节点查看与编辑" />
      </div>
    </div>
  </div>
</template>

<script>
import { reactive, ref, computed, watch } from 'vue'
import { getOperatorInfo } from '../core/nir/index.js'
import { TYPE_NOTES } from '../core/nir/typeNotes.js'

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
    // 该节点的校验问题文字(来自核心 validateDocument 的 issues)
    nodeIssues: {
      type: Array,
      default: () => []
    }
  },
  emits: ['action'],
  setup(props, { emit }) {
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

    // 换选中节点时清掉草稿
    watch(() => props.selectedNode && props.selectedNode.id, () => {
      Object.keys(uniformDrafts).forEach((k) => delete uniformDrafts[k])
      Object.keys(indexDrafts).forEach((k) => delete indexDrafts[k])
      Object.keys(scaleDrafts).forEach((k) => delete scaleDrafts[k])
      newMetaKey.value = ''
      newMetaValue.value = ''
    })

    const act = (action) => emit('action', action)

    // 类型中文说明:算子表短名 + typeNotes 一句话说明(类型名保留英文原名)
    const typeNote = (t) => {
      const info = getOperatorInfo(t)
      const label = info ? info.label : ''
      const note = TYPE_NOTES[t] || ''
      return [label, note].filter(Boolean).join(' · ')
    }

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
      act({ kind: 'setScalar', path: [props.selectedNode.id], field: param.key, value: v })
    }
    const editString = (param, v) => act({ kind: 'setString', path: [props.selectedNode.id], field: param.key, value: v })
    const editIntArray = (param, text) => {
      const values = String(text).split(/[,;\s]+/).map((s) => s.trim()).filter((s) => s !== '').map(Number)
      if (values.length === 0 || values.some((n) => !Number.isFinite(n))) return
      act({ kind: 'setIntArray', path: [props.selectedNode.id], field: param.key, values })
    }
    const editUniform = (param) => {
      if (uniformDrafts[param.key] === undefined) return
      act({ kind: 'setUniform', path: [props.selectedNode.id], field: param.key, value: uniformDrafts[param.key] })
      uniformDrafts[param.key] = undefined
    }
    const editScale = (param) => {
      if (scaleDrafts[param.key] === undefined) return
      act({ kind: 'scaleField', path: [props.selectedNode.id], field: param.key, factor: scaleDrafts[param.key] })
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
      act({ kind: 'setFieldIndices', path: [props.selectedNode.id], field: param.key, pairs })
      indexDrafts[param.key] = ''
    }
    const removeMeta = (key) => act({ kind: 'setMetadata', path: [props.selectedNode.id], key, value: null })
    const addMeta = () => {
      if (!newMetaKey.value) return
      const raw = newMetaValue.value
      const asNum = Number(raw)
      const value = raw !== '' && Number.isFinite(asNum) ? asNum : raw
      act({ kind: 'setMetadata', path: [props.selectedNode.id], key: newMetaKey.value, value })
      newMetaKey.value = ''
      newMetaValue.value = ''
    }

    return {
      uniformDrafts, indexDrafts, scaleDrafts, newMetaKey, newMetaValue,
      editableParams, stringOf, scalarOf, dtypeText, formatNum, previewList, typeNote,
      editScalar, editString, editIntArray, editUniform, editScale, editIndices,
      removeMeta, addMeta
    }
  }
}
</script>

<style scoped>
.model-sidebar {
  position: fixed;
  top: 0;
  right: -340px;
  width: 340px;
  height: 100vh;
  background-color: var(--sv-bg-panel);
  border-left: 1px solid var(--sv-border-strong);
  box-shadow: var(--sv-shadow-panel);
  z-index: 1000;
  transition: right 0.3s ease;
  display: flex;
  flex-direction: column;
}

.model-sidebar.sidebar-visible {
  right: 0;
}

.sidebar-content {
  padding: 20px;
  flex: 1;
  overflow-y: auto;
}

.sidebar-content h3 {
  margin-top: 0;
  margin-bottom: 15px;
  color: var(--sv-text-primary);
  font-size: 16px;
  font-weight: 600;
}

.sidebar-content h4 {
  margin-top: 20px;
  margin-bottom: 10px;
  color: var(--sv-text-secondary);
  font-size: 14px;
  font-weight: 600;
}

.node-details {
  margin-bottom: 20px;
}

.node-actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}

.node-parameters,
.node-metadata {
  margin-top: 15px;
}

.param-block {
  border: 1px solid var(--sv-border);
  border-radius: var(--sv-radius);
  padding: 10px 12px;
  margin-bottom: 8px;
  background-color: var(--sv-bg-input);
}

.param-label {
  font-size: 14px;
  color: var(--sv-text-primary);
  margin-bottom: 6px;
  font-weight: 600;
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
  gap: 6px;
  margin-top: 6px;
  align-items: center;
}

.param-input {
  width: 130px;
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

.issue-line {
  color: var(--sv-danger);
  font-size: 14px;
  margin-bottom: 4px;
  word-break: break-all;
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

.type-note {
  margin-top: 2px;
  font-size: 14px;
  color: var(--sv-text-secondary);
  line-height: 1.5;
}

.meta-key-input {
  width: 90px;
}

.no-selection {
  margin-bottom: 20px;
}
</style>
