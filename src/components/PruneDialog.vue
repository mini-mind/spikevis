<template>
  <el-dialog
    :model-value="visible"
    :title="t('prune.title')"
    width="600px"
    :close-on-click-modal="false"
    @close="$emit('close')"
  >
    <template v-if="!info">
      <el-empty :description="t('prune.noNode')" />
    </template>

    <template v-else-if="info.kind === 'blocker'">
      <el-alert type="info" :closable="false" :title="t('prune.blockerTitle', { name: nodeName, type: info.type })" />
      <p class="hint">{{ tvField(info.reasonX, info.reason) }}</p>
    </template>

    <template v-else>
      <!-- 一行带过节点与通道数,替代原来的四格描述表 -->
      <p class="hint lead">
        {{ nodeName }} · {{ info.type }} · {{ t('prune.inWidth') }} {{ info.inWidth ?? '-' }} · {{ t('prune.outWidth') }} {{ info.outWidth ?? '-' }}
      </p>
      <p class="hint">{{ tvField(info.noteX, info.note) }}</p>

      <el-form label-width="110px" size="small">
        <!-- 只有 Linear/Affine/Conv 需要选方向;tied 节点两个方向等价 -->
        <el-form-item v-if="info.kind === 'weight'" :label="t('prune.axis')">
          <el-radio-group v-model="axis">
            <el-radio label="out">{{ t('prune.axisOut', { bias: info.hasBias ? t('prune.withBias') : '' }) }}</el-radio>
            <el-radio label="in">{{ t('prune.axisIn') }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="t('prune.mode')">
          <el-radio-group v-model="mode">
            <el-radio label="explicit">{{ t('prune.modeExplicit') }}</el-radio>
            <el-radio label="first">{{ t('prune.modeFirst') }}</el-radio>
            <el-radio label="last">{{ t('prune.modeLast') }}</el-radio>
            <el-radio label="stride">{{ t('prune.modeStride') }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="mode === 'explicit'" :label="t('prune.keepIndices')">
          <el-input v-model="explicitText" :placeholder="t('prune.keepPlaceholder')" />
        </el-form-item>
        <el-form-item v-if="mode === 'first' || mode === 'last'" label="N">
          <el-input-number v-model="countN" :min="1" :max="Math.max(1, width)" />
        </el-form-item>
        <el-form-item v-if="mode === 'stride'" label="K">
          <el-input-number v-model="strideK" :min="1" :max="Math.max(1, width)" />
        </el-form-item>
      </el-form>

      <!-- 预览:将裁剪哪些节点、哪些节点需要人工处理 -->
      <div class="preview">
        <div class="preview-title">{{ t('prune.preview', { n: plan.pruned.length }) }}</div>
        <div v-for="(p, i) in plan.pruned" :key="`p${i}`" class="preview-line">
          {{ p.name }}: {{ tvField(p.detailX, p.detail) }}
        </div>
        <template v-if="plan.manual.length > 0">
          <div class="preview-title manual-title">{{ t('prune.manual', { n: plan.manual.length }) }}</div>
          <div v-for="(m, i) in plan.manual" :key="`m${i}`" class="preview-line manual">
            {{ m.name }}（{{ m.type }}）: {{ tvField(m.reasonX, m.reason) }}
          </div>
        </template>
        <template v-if="plan.errors.length > 0">
          <div class="preview-title error-title">{{ t('prune.errors') }}</div>
          <div v-for="(e, i) in plan.errors" :key="`e${i}`" class="preview-line error">
            {{ tvAt(plan.errorX, i, e) }}
          </div>
        </template>
      </div>
    </template>

    <template #footer>
      <el-button @click="$emit('close')">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :disabled="!plan || !plan.ok" @click="confirm">{{ t('prune.execute') }}</el-button>
    </template>
  </el-dialog>
</template>

<script>
import { ref, computed, watch } from 'vue'
import { channelInfo, planPruneChannels } from '../core/nir/index.js'
import { t, tv } from '../i18n/index.js'

export default {
  name: 'PruneDialog',
  props: {
    visible: {
      type: Boolean,
      default: false
    },
    // 核心文档(不可变);预览用核心纯函数现算
    doc: {
      type: Object,
      default: null
    },
    nodeName: {
      type: String,
      default: ''
    },
    // 当前所在的子图路径(进入子图编辑用):节点完整路径 = basePath + nodeName
    basePath: {
      type: Array,
      default: () => []
    }
  },
  emits: ['close', 'confirm'],
  setup(props, { emit }) {
    const axis = ref('out')
    const mode = ref('explicit')
    const explicitText = ref('')
    const countN = ref(1)
    const strideK = ref(2)

    // 节点在文档里的完整路径(当前层前缀 + 局部名)
    const fullPath = () => [...props.basePath, props.nodeName]

    const info = computed(() => {
      if (!props.doc || !props.nodeName) return null
      try {
        return channelInfo(props.doc, fullPath())
      } catch (e) {
        return null
      }
    })

    // 当前方向上的通道数(决定保留下标的有效范围)
    const width = computed(() => {
      if (!info.value || info.value.kind === 'blocker') return 0
      return axis.value === 'out' ? info.value.outWidth : info.value.inWidth
    })

    const keep = computed(() => {
      const w = width.value
      if (!Number.isInteger(w) || w <= 0) return []
      const range = (from, to, step) => {
        const arr = []
        for (let i = from; i < to; i += step) arr.push(i)
        return arr
      }
      if (mode.value === 'first') return range(0, Math.min(countN.value, w), 1)
      if (mode.value === 'last') return range(w - Math.min(countN.value, w), w, 1)
      if (mode.value === 'stride') return range(0, w, Math.max(1, strideK.value))
      // explicit:手工解析,解析失败返回空(预览会显示错误)
      return explicitText.value
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter((s) => s !== '')
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 0)
    })

    // 计划现算(文档不可变,computed 安全);spec 非法时 planPruneChannels 抛错则显示空计划
    const plan = computed(() => {
      if (!props.doc || !props.nodeName) return { pruned: [], manual: [], errors: [t('prune.noNode')], errorX: [], ok: false }
      try {
        return planPruneChannels(props.doc, [{ path: fullPath(), axis: axis.value, keep: keep.value }])
      } catch (e) {
        return { pruned: [], manual: [], errors: [e.message], errorX: [], ok: false }
      }
    })

    // 每次打开重置;方向/计数缺省值按节点通道数给合理初值
    watch(() => props.visible, (v) => {
      if (v) {
        axis.value = 'out'
        mode.value = 'explicit'
        explicitText.value = ''
        countN.value = 1
        strideK.value = 2
      }
    })
    watch(() => [props.nodeName, width.value], () => {
      countN.value = Math.min(countN.value || 1, Math.max(1, width.value))
    })

    const confirm = () => {
      if (!plan.value.ok) return
      emit('confirm', { axis: axis.value, keep: keep.value })
    }

    return {
      axis, mode, explicitText, countN, strideK, info, width, keep, plan, confirm
    }
  },
  methods: {
    t,
    // 结构化文案优先出当前语言,缺模板时回退核心层原文
    tvField(item, fallback) {
      const text = item ? tv(item) : ''
      return text || (fallback ?? '')
    },
    tvAt(list, i, fallback) {
      const item = Array.isArray(list) ? list[i] : null
      return item ? tv(item) : fallback
    }
  }
}
</script>

<style scoped>
.hint {
  font-size: 14px;
  color: var(--sv-text-secondary);
  margin: 8px 0;
}

/* 首行:节点 · 类型 · 通道数一行小字(等宽),替代描述表 */
.hint.lead {
  font-family: var(--sv-font-mono);
  color: var(--sv-text-regular);
  margin-top: 4px;
}

.preview {
  border: 1px solid var(--sv-border);
  border-radius: var(--sv-radius);
  padding: 10px 12px;
  max-height: 220px;
  overflow-y: auto;
  font-size: 14px;
  background-color: var(--sv-bg-input);
}

.preview-title {
  font-weight: 600;
  color: var(--sv-text-primary);
  margin-bottom: 4px;
}

.manual-title {
  margin-top: 8px;
  color: var(--sv-warning-bright);
}

.error-title {
  margin-top: 8px;
  color: var(--sv-danger);
}

.preview-line {
  font-family: var(--sv-font-mono);
  font-size: 14px;
  color: var(--sv-text-regular);
  word-break: break-all;
  overflow-wrap: anywhere;
}

.preview-line.manual {
  color: var(--sv-warning-bright);
}

.preview-line.error {
  color: var(--sv-danger);
}
</style>
