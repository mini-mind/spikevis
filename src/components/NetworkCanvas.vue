<template>
  <div class="network-canvas">
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
           Open Model...
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
  </div>
</template>

<script>
import { ref, onMounted, nextTick, watch } from 'vue'
import { Network } from 'vis-network'
import { DataSet } from 'vis-data'
import { UploadFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { readNIRFile } from '../utils/nirParser'

export default {
  name: 'NetworkCanvas',
  components: {
    UploadFilled
  },
  props: {
    modelData: {
      type: Object,
      default: null
    },
    hasModel: {
      type: Boolean,
      default: false
    }
  },
  emits: ['nodeSelect', 'nodeDeselect', 'fileDrop', 'openFile'],
  setup(props, { emit }) {
    const networkContainer = ref(null)
    const network = ref(null)
    const nodes = ref(new DataSet())
    const edges = ref(new DataSet())
    const fileInput = ref(null)

    // 网络选项
    const networkOptions = {
      nodes: {
        shape: 'box',
        font: {
          size: 14,
          face: 'Arial'
        },
        borderWidth: 2,
        shadow: true,
        color: {
          border: '#2B7CE9',
          background: '#97C2FC',
          highlight: {
            border: '#2B7CE9',
            background: '#D2E5FF'
          }
        }
      },
      edges: {
        width: 2,
        color: {
          color: '#848484',
          highlight: '#848484',
          hover: '#848484'
        },
        smooth: {
          type: 'continuous'
        },
        arrows: {
          to: {
            enabled: true,
            scaleFactor: 0.5
          }
        }
      },
      physics: {
        enabled: true,
        hierarchicalRepulsion: {
          nodeDistance: 150
        },
        solver: 'hierarchicalRepulsion'
      },
      layout: {
        hierarchical: {
          enabled: true,
          direction: 'UD',
          sortMethod: 'directed'
        }
      },
      interaction: {
        hover: true,
        tooltipDelay: 200
      }
    }

    // 初始化网络
    const initNetwork = () => {
      if (networkContainer.value) {
        network.value = new Network(
          networkContainer.value,
          { nodes: nodes.value, edges: edges.value },
          networkOptions
        )

        // 监听节点选择事件
        network.value.on('selectNode', (params) => {
          const nodeId = params.nodes[0]
          const node = nodes.value.get(nodeId)
          emit('nodeSelect', node)
        })

        // 监听取消选择事件
        network.value.on('deselectNode', () => {
          emit('nodeDeselect')
        })
      }
    }

    // 加载图数据
    const loadGraphData = (graphData) => {
      // 清空现有数据
      nodes.value.clear()
      edges.value.clear()

      // 添加节点
      const nodeData = []
      const edgeData = []

      // 处理节点
      Object.entries(graphData.nodes).forEach(([nodeId, node]) => {
        const nodeConfig = {
          id: nodeId,
          label: `${nodeId}\n(${node.type})`,
          type: node.type,
          inputType: node.input_type ? JSON.stringify(node.input_type) : 'N/A',
          outputType: node.output_type ? JSON.stringify(node.output_type) : 'N/A',
          metadata: node.metadata || {},
          // 根据节点类型设置颜色
          color: getNodeColor(node.type),
          // 保存原始节点的所有参数，用于侧边栏显示
          ...node
        }
        nodeData.push(nodeConfig)
      })

      // 处理边
      graphData.edges.forEach((edge, index) => {
        const edgeConfig = {
          id: index,
          from: edge[0],
          to: edge[1]
        }
        edgeData.push(edgeConfig)
      })

      // 更新数据
      nodes.value.add(nodeData)
      edges.value.add(edgeData)
    }

    // 根据节点类型获取颜色
    const getNodeColor = (nodeType) => {
      const colorMap = {
        'Input': { background: '#E1F5FE', border: '#0288D1' },
        'Output': { background: '#F3E5F5', border: '#7B1FA2' },
        'LIF': { background: '#E8F5E8', border: '#388E3C' },
        'LI': { background: '#E8F5E8', border: '#388E3C' },
        'IF': { background: '#E8F5E8', border: '#388E3C' },
        'I': { background: '#E8F5E8', border: '#388E3C' },
        'CubaLIF': { background: '#E8F5E8', border: '#388E3C' },
        'CubaLI': { background: '#E8F5E8', border: '#388E3C' },
        'Linear': { background: '#FFF3E0', border: '#F57C00' },
        'Affine': { background: '#FFF3E0', border: '#F57C00' },
        'Conv1d': { background: '#FFF3E0', border: '#F57C00' },
        'Conv2d': { background: '#FFF3E0', border: '#F57C00' },
        'SumPool2d': { background: '#FFF3E0', border: '#F57C00' },
        'AvgPool2d': { background: '#FFF3E0', border: '#F57C00' },
        'Flatten': { background: '#FFF3E0', border: '#F57C00' },
        'Scale': { background: '#FFF3E0', border: '#F57C00' },
        'Threshold': { background: '#FFF3E0', border: '#F57C00' },
        'Delay': { background: '#FFF3E0', border: '#F57C00' }
      }

      return colorMap[nodeType] || { background: '#F5F5F5', border: '#9E9E9E' }
    }

    // 打开文件浏览器
    const openFileBrowser = () => {
      fileInput.value.click()
    }

    // 处理文件选择
    const handleFileSelect = async (event) => {
      const file = event.target.files[0]
      if (file) {
        try {
          ElMessage.success('正在解析文件...')
          const nirData = await readNIRFile(file)
          emit('fileDrop', { file, data: nirData })
        } catch (error) {
          console.error('文件解析失败:', error)
          ElMessage.error(error.message || '文件解析失败')
        }
      }
      // 清空input值，允许重复选择同一文件
      event.target.value = ''
    }

    // 拖拽处理
    const handleDragOver = (e) => {
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.classList.add('drag-over')
    }

    const handleDragLeave = (e) => {
      e.preventDefault()
      e.stopPropagation()
      // 只有当鼠标真正离开拖拽区域时才移除样式
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
      console.log('拖拽文件:', files)
      
      if (files.length > 0) {
        const file = files[0]
        try {
          ElMessage.success('正在解析文件...')
          const nirData = await readNIRFile(file)
          emit('fileDrop', { file, data: nirData })
        } catch (error) {
          console.error('文件解析失败:', error)
          ElMessage.error(error.message || '文件解析失败')
        }
      } else {
        ElMessage.warning('请拖拽有效的文件')
      }
    }

    // 导出图片方法
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

    // 监听模型数据变化
    watch(() => props.modelData, (newData) => {
      if (newData) {
        loadGraphData(newData)
        // 确保网络已初始化
        nextTick(() => {
          if (!network.value && networkContainer.value) {
            initNetwork()
          }
        })
      }
    }, { immediate: true })

    // 监听hasModel变化
    watch(() => props.hasModel, (hasModel) => {
      if (hasModel && !network.value && networkContainer.value) {
        nextTick(() => {
          initNetwork()
        })
      }
    })

    onMounted(() => {
      // 初始化时不需要立即创建网络，等待数据加载
    })

    // 暴露方法给父组件
    return {
      networkContainer,
      fileInput,
      exportImage,
      openFileBrowser,
      handleFileSelect,
      handleDragOver,
      handleDragLeave,
      handleDrop
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
  background: #f8f9fa;
  transition: all 0.3s ease;
  cursor: pointer;
  margin: 0;
  padding: 0;
}

.drop-zone:hover,
.drop-zone.drag-over {
  background: #e9ecef;
}

.drop-content {
  text-align: center;
  color: #495057;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.logo-text {
  font-size: 60px;
  font-weight: 400;
  color: #6c757d;
  letter-spacing: 0.5px;
}

.logo-icon {
  width: 60px;
  height: 60px;
  color: #495057;
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-icon svg {
  width: 100%;
  height: 100%;
}

.open-button {
  background: white;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  padding: 12px 24px;
  font-size: 16px;
  color: #495057;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.open-button:hover {
  border-color: #adb5bd;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}

.open-button:active {
  transform: translateY(1px);
}

.network-container {
  width: 100%;
  height: 100%;
  background: #fff;
  margin: 0;
  padding: 0;
}
</style>
