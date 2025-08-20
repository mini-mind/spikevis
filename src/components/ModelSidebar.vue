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
          </el-descriptions-item>
          <el-descriptions-item label="输入类型">
            {{ selectedNode.inputType }}
          </el-descriptions-item>
          <el-descriptions-item label="输出类型">
            {{ selectedNode.outputType }}
          </el-descriptions-item>
        </el-descriptions>

        <!-- 节点特定参数 -->
        <div v-if="getNodeParameters(selectedNode).length > 0" class="node-parameters">
          <h4>节点参数</h4>
          <el-descriptions :column="1" border>
            <el-descriptions-item 
              v-for="param in getNodeParameters(selectedNode)" 
              :key="param.key"
              :label="param.label"
            >
              <span v-if="param.type === 'array'" class="array-value">
                {{ formatArray(param.value) }}
              </span>
              <span v-else-if="param.type === 'object'" class="object-value">
                {{ formatObject(param.value) }}
              </span>
              <span v-else class="simple-value">
                {{ param.value }}
              </span>
            </el-descriptions-item>
          </el-descriptions>
        </div>

        <!-- 元数据 -->
        <div v-if="selectedNode.metadata && Object.keys(selectedNode.metadata).length > 0" class="node-metadata">
          <h4>元数据</h4>
          <el-descriptions :column="1" border>
            <el-descriptions-item 
              v-for="(value, key) in selectedNode.metadata" 
              :key="key"
              :label="key"
            >
              {{ value }}
            </el-descriptions-item>
          </el-descriptions>
        </div>
      </div>
      <div v-else class="no-selection">
        <el-empty description="点击节点查看详情" />
      </div>
    </div>
  </div>
</template>

<script>
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
    }
  },
  methods: {
    // 根据节点类型获取特定参数
    getNodeParameters(node) {
      const params = []
      
      switch (node.type) {
        case 'Affine':
          if (node.weight) params.push({ key: 'weight', label: '权重', value: node.weight, type: 'array' })
          if (node.bias) params.push({ key: 'bias', label: '偏置', value: node.bias, type: 'array' })
          break
          
        case 'Conv1d':
        case 'Conv2d':
          if (node.input_shape) params.push({ key: 'input_shape', label: '输入形状', value: node.input_shape, type: 'array' })
          if (node.weight) params.push({ key: 'weight', label: '权重', value: node.weight, type: 'array' })
          if (node.stride) params.push({ key: 'stride', label: '步长', value: node.stride, type: 'array' })
          if (node.padding) params.push({ key: 'padding', label: '填充', value: node.padding, type: 'array' })
          if (node.dilation) params.push({ key: 'dilation', label: '扩张', value: node.dilation, type: 'array' })
          if (node.groups) params.push({ key: 'groups', label: '分组', value: node.groups, type: 'simple' })
          if (node.bias) params.push({ key: 'bias', label: '偏置', value: node.bias, type: 'array' })
          break
          
        case 'SumPool2d':
        case 'AvgPool2d':
          if (node.kernel_size) params.push({ key: 'kernel_size', label: '核大小', value: node.kernel_size, type: 'array' })
          if (node.stride) params.push({ key: 'stride', label: '步长', value: node.stride, type: 'array' })
          if (node.padding) params.push({ key: 'padding', label: '填充', value: node.padding, type: 'array' })
          break
          
        case 'Delay':
          if (node.delay) params.push({ key: 'delay', label: '延迟', value: node.delay, type: 'simple' })
          break
          
        case 'Flatten':
          if (node.start_dim) params.push({ key: 'start_dim', label: '起始维度', value: node.start_dim, type: 'simple' })
          if (node.end_dim) params.push({ key: 'end_dim', label: '结束维度', value: node.end_dim, type: 'simple' })
          break
          
        case 'I':
          if (node.r) params.push({ key: 'r', label: '电阻', value: node.r, type: 'array' })
          break
          
        case 'IF':
          if (node.r) params.push({ key: 'r', label: '电阻', value: node.r, type: 'array' })
          if (node.v_reset) params.push({ key: 'v_reset', label: '重置电压', value: node.v_reset, type: 'array' })
          if (node.v_threshold) params.push({ key: 'v_threshold', label: '阈值电压', value: node.v_threshold, type: 'array' })
          break
          
        case 'LI':
          if (node.tau) params.push({ key: 'tau', label: '时间常数', value: node.tau, type: 'array' })
          if (node.r) params.push({ key: 'r', label: '电阻', value: node.r, type: 'array' })
          if (node.v_leak) params.push({ key: 'v_leak', label: '泄漏电压', value: node.v_leak, type: 'array' })
          break
          
        case 'Linear':
          if (node.weight) params.push({ key: 'weight', label: '权重', value: node.weight, type: 'array' })
          break
          
        case 'LIF':
          if (node.tau) params.push({ key: 'tau', label: '时间常数', value: node.tau, type: 'array' })
          if (node.r) params.push({ key: 'r', label: '电阻', value: node.r, type: 'array' })
          if (node.v_leak) params.push({ key: 'v_leak', label: '泄漏电压', value: node.v_leak, type: 'array' })
          if (node.v_reset) params.push({ key: 'v_reset', label: '重置电压', value: node.v_reset, type: 'array' })
          if (node.v_threshold) params.push({ key: 'v_threshold', label: '阈值电压', value: node.v_threshold, type: 'array' })
          break
          
        case 'CubaLI':
          if (node.tau_mem) params.push({ key: 'tau_mem', label: '膜时间常数', value: node.tau_mem, type: 'array' })
          if (node.tau_syn) params.push({ key: 'tau_syn', label: '突触时间常数', value: node.tau_syn, type: 'array' })
          if (node.r) params.push({ key: 'r', label: '电阻', value: node.r, type: 'array' })
          if (node.v_leak) params.push({ key: 'v_leak', label: '泄漏电压', value: node.v_leak, type: 'array' })
          if (node.w_in) params.push({ key: 'w_in', label: '输入权重', value: node.w_in, type: 'array' })
          break
          
        case 'CubaLIF':
          if (node.tau_mem) params.push({ key: 'tau_mem', label: '膜时间常数', value: node.tau_mem, type: 'array' })
          if (node.tau_syn) params.push({ key: 'tau_syn', label: '突触时间常数', value: node.tau_syn, type: 'array' })
          if (node.r) params.push({ key: 'r', label: '电阻', value: node.r, type: 'array' })
          if (node.v_leak) params.push({ key: 'v_leak', label: '泄漏电压', value: node.v_leak, type: 'array' })
          if (node.v_reset) params.push({ key: 'v_reset', label: '重置电压', value: node.v_reset, type: 'array' })
          if (node.v_threshold) params.push({ key: 'v_threshold', label: '阈值电压', value: node.v_threshold, type: 'array' })
          if (node.w_in) params.push({ key: 'w_in', label: '输入权重', value: node.w_in, type: 'array' })
          break
          
        case 'Scale':
          if (node.scale) params.push({ key: 'scale', label: '缩放因子', value: node.scale, type: 'array' })
          break
          
        case 'Threshold':
          if (node.threshold) params.push({ key: 'threshold', label: '阈值', value: node.threshold, type: 'array' })
          break
      }
      
      return params
    },
    
    // 格式化数组显示
    formatArray(arr) {
      if (!arr) return 'N/A'
      if (Array.isArray(arr)) {
        if (arr.length <= 10) {
          return `[${arr.join(', ')}]`
        } else {
          return `[${arr.slice(0, 5).join(', ')}...${arr.slice(-5).join(', ')}] (${arr.length}个元素)`
        }
      }
      return String(arr)
    },
    
    // 格式化对象显示
    formatObject(obj) {
      if (!obj) return 'N/A'
      try {
        return JSON.stringify(obj, null, 2)
      } catch {
        return String(obj)
      }
    }
  }
}
</script>

<style scoped>
.model-sidebar {
  position: fixed;
  top: 0;
  right: -320px;
  width: 320px;
  height: 100vh;
  background-color: #fff;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
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
  color: #333;
  font-size: 16px;
  font-weight: 600;
}

.sidebar-content h4 {
  margin-top: 20px;
  margin-bottom: 10px;
  color: #555;
  font-size: 14px;
  font-weight: 600;
}

.node-details {
  margin-bottom: 20px;
}

.node-parameters,
.node-metadata {
  margin-top: 15px;
}

.no-selection {
  margin-bottom: 20px;
}

.array-value {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #666;
}

.object-value {
  font-family: 'Courier New', monospace;
  font-size: 11px;
  color: #666;
  white-space: pre-wrap;
  word-break: break-all;
}

.simple-value {
  color: #333;
}
</style>
