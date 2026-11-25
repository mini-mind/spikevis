<template>
  <el-dialog
    :model-value="visible"
    title="新建节点"
    width="420px"
    :close-on-click-modal="false"
    @close="$emit('close')"
  >
    <el-form label-width="90px" size="small">
      <el-form-item label="算子类型">
        <el-select v-model="type" style="width: 100%" @change="typeChanged">
          <el-option v-for="t in typeOptions" :key="t" :label="`${t}（${typeLabel(t)}）`" :value="t" />
        </el-select>
      </el-form-item>
      <el-form-item label="节点名">
        <el-input v-model="name" placeholder="留空自动命名" />
      </el-form-item>

      <!-- 按类型的形状参数 -->
      <el-form-item v-if="needs('channels')" :label="type === 'Input' || type === 'Output' ? '形状' : '通道数'">
        <template v-if="type === 'Input' || type === 'Output'">
          <el-input v-model="shapeText" placeholder="逗号分隔,如 128 或 2, 8, 8" />
        </template>
        <template v-else>
          <el-input-number v-model="channels" :min="1" :step="1" style="width: 140px" />
        </template>
      </el-form-item>

      <template v-if="needs('linear')">
        <el-form-item label="输入维度">
          <el-input-number v-model="inSize" :min="1" :step="1" style="width: 140px" />
        </el-form-item>
        <el-form-item label="输出维度">
          <el-input-number v-model="outSize" :min="1" :step="1" style="width: 140px" />
        </el-form-item>
      </template>

      <el-form-item v-if="needs('kernel')" label="核大小 K">
        <el-input-number v-model="kernel" :min="1" :step="1" style="width: 140px" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('close')">取消</el-button>
      <el-button type="primary" @click="confirm">创建</el-button>
    </template>
  </el-dialog>
</template>

<script>
import { ref, watch } from 'vue'
import { getOperatorInfo } from '../core/nir/index.js'

// 界面上可建的类型:官方可序列化清单里去掉子图(子图编辑不在本轮范围)
const TYPE_OPTIONS = [
  'Input', 'Output', 'Linear', 'Affine', 'Scale', 'Threshold', 'Delay',
  'LIF', 'LI', 'IF', 'I', 'CubaLIF', 'CubaLI',
  'Conv1d', 'Conv2d', 'SumPool2d', 'AvgPool2d', 'Flatten',
]

export default {
  name: 'NewNodeDialog',
  props: {
    visible: {
      type: Boolean,
      default: false
    }
  },
  emits: ['close', 'create'],
  setup(props, { emit }) {
    const type = ref('LIF')
    const name = ref('')
    const shapeText = ref('128')
    const channels = ref(16)
    const inSize = ref(16)
    const outSize = ref(8)
    const kernel = ref(3)

    const typeOptions = TYPE_OPTIONS
    const typeLabel = (t) => {
      const info = getOperatorInfo(t)
      return info ? info.label : t
    }

    // 每种类型需要的形状参数
    const needs = (what) => {
      if (what === 'channels') return ['Input', 'Output', 'LIF', 'LI', 'IF', 'I', 'CubaLIF', 'CubaLI', 'Scale', 'Threshold', 'Delay'].includes(type.value)
      if (what === 'linear') return ['Linear', 'Affine', 'Conv1d', 'Conv2d'].includes(type.value)
      if (what === 'kernel') return ['Conv1d', 'Conv2d'].includes(type.value)
      return false
    }

    const typeChanged = () => {
      name.value = '' // 名字由 App 按当前文档自动建议
    }

    // 每次打开重置
    watch(() => props.visible, (v) => {
      if (v) {
        name.value = ''
        shapeText.value = '128'
        channels.value = 16
        inSize.value = 16
        outSize.value = 8
        kernel.value = 3
      }
    })

    const confirm = () => {
      const payload = { type: type.value }
      if (name.value.trim()) payload.name = name.value.trim()
      if (needs('channels')) {
        if (type.value === 'Input' || type.value === 'Output') {
          const shape = shapeText.value.split(/[,;\s]+/).map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0)
          if (shape.length === 0) return
          payload.shape = shape
        } else {
          payload.shape = [channels.value]
        }
      }
      if (needs('linear')) {
        payload.inSize = inSize.value
        payload.outSize = outSize.value
      }
      if (needs('kernel')) payload.kernel = kernel.value
      emit('create', payload)
    }

    return {
      type, name, shapeText, channels, inSize, outSize, kernel,
      typeOptions, typeLabel, needs, typeChanged, confirm
    }
  }
}
</script>
