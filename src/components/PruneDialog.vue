<template>
  <el-dialog
    :model-value="visible"
    title="通道剪枝"
    width="600px"
    :close-on-click-modal="false"
    @close="$emit('close')"
  >
    <template v-if="!info">
      <el-empty description="节点不存在" />
    </template>

    <template v-else-if="info.kind === 'blocker'">
      <el-alert type="info" :closable="false" :title="`节点 ${nodeName}（${info.type}）没有可剪的通道维`" />
      <p class="hint">{{ info.reason }}</p>
    </template>

    <template v-else>
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="节点">{{ nodeName }}</el-descriptions-item>
        <el-descriptions-item label="类型">{{ info.type }}</el-descriptions-item>
        <el-descriptions-item label="输入通道数">{{ info.inWidth ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="输出通道数">{{ info.outWidth ?? '-' }}</el-descriptions-item>
      </el-descriptions>
      <p class="hint">{{ info.note }}</p>

      <el-form label-width="110px" size="small">
        <!-- 只有 Linear/Affine/Conv 需要选方向;tied 节点两个方向等价 -->
        <el-form-item v-if="info.kind === 'weight'" label="剪枝方向">
          <el-radio-group v-model="axis">
            <el-radio label="out">输出通道（weight 行{{ info.hasBias ? ' + bias' : '' }}，向下游传播）</el-radio>
            <el-radio label="in">输入通道（weight 列，向上游传播）</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="保留方式">
          <el-radio-group v-model="mode">
            <el-radio label="explicit">保留下标</el-radio>
            <el-radio label="first">保留前 N 个</el-radio>
            <el-radio label="last">保留后 N 个</el-radio>
            <el-radio label="stride">每隔 K 个取一个</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="mode === 'explicit'" label="保留下标">
          <el-input v-model="explicitText" placeholder="逗号分隔,如 0,2,4" />
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
        <div class="preview-title">预览（共 {{ plan.pruned.length }} 处裁剪）</div>
        <div v-for="(p, i) in plan.pruned" :key="`p${i}`" class="preview-line">
          {{ p.name }}: {{ p.detail }}
        </div>
        <template v-if="plan.manual.length > 0">
          <div class="preview-title manual-title">需要人工处理（{{ plan.manual.length }} 个，传播到它们停止）</div>
          <div v-for="(m, i) in plan.manual" :key="`m${i}`" class="preview-line manual">
            {{ m.name }}（{{ m.type }}）: {{ m.reason }}
          </div>
        </template>
        <template v-if="plan.errors.length > 0">
          <div class="preview-title error-title">无法执行</div>
          <div v-for="(e, i) in plan.errors" :key="`e${i}`" class="preview-line error">{{ e }}</div>
        </template>
      </div>
    </template>

    <template #footer>
      <el-button @click="$emit('close')">取消</el-button>
      <el-button type="primary" :disabled="!plan || !plan.ok" @click="confirm">执行剪枝</el-button>
    </template>
  </el-dialog>
</template>

<script>
import { ref, computed, watch } from 'vue'
import { channelInfo, planPruneChannels } from '../core/nir/index.js'

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
    }
  },
  emits: ['close', 'confirm'],
  setup(props, { emit }) {
    const axis = ref('out')
    const mode = ref('explicit')
    const explicitText = ref('')
    const countN = ref(1)
    const strideK = ref(2)

    const info = computed(() => {
      if (!props.doc || !props.nodeName) return null
      try {
        return channelInfo(props.doc, [props.nodeName])
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
      if (!props.doc || !props.nodeName) return { pruned: [], manual: [], errors: ['未选择节点'], ok: false }
      try {
        return planPruneChannels(props.doc, [{ path: [props.nodeName], axis: axis.value, keep: keep.value }])
      } catch (e) {
        return { pruned: [], manual: [], errors: [e.message], ok: false }
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
  }
}
</script>

<style scoped>
.hint {
  font-size: 14px;
  color: var(--sv-text-secondary);
  margin: 8px 0;
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
