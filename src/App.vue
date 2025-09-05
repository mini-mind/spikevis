<template>
  <div id="app">
    <!-- 功能菜单 -->
    <FunctionMenu
      @file-drop="handleFileDrop"
      @show-about="showAbout"
    />

    <!-- 主视图 - 充满整个页面 -->
    <div class="main-view">
      <NetworkCanvas 
        :model-data="modelData"
        :has-model="hasModel"
        @node-select="handleNodeSelect"
        @node-deselect="handleNodeDeselect"
        @file-drop="handleFileDrop"
        @open-file="loadFile"
        ref="networkCanvasRef"
      />
    </div>

    <!-- 右侧悬浮侧边栏 -->
    <ModelSidebar
      :is-visible="sidebarVisible"
      :selected-node="selectedNode"
    />



    <!-- 关于对话框 -->
    <AboutDialog
      :visible="aboutDialogVisible"
      @close="aboutDialogVisible = false"
    />
  </div>
</template>

<script>
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import NetworkCanvas from './components/NetworkCanvas.vue'
import ModelSidebar from './components/ModelSidebar.vue'

import FunctionMenu from './components/FunctionMenu.vue'
import AboutDialog from './components/AboutDialog.vue'

export default {
  name: 'App',
  components: {
    NetworkCanvas,
    ModelSidebar,

    FunctionMenu,
    AboutDialog
  },
  setup() {
    const networkCanvasRef = ref(null)

    const aboutDialogVisible = ref(false)
    const modelData = ref(null)
    const modelInfo = ref(null)
    const selectedNode = ref(null)
    const sidebarVisible = ref(false)

    // 计算是否有模型
    const hasModel = computed(() => !!modelData.value)

    // 示例数据
    const demoData = {
      nodes: {
        'input': {
          type: 'Input',
          input_type: { 'input': [784] },
          output_type: { 'output': [784] },
          metadata: { 'name': 'input_layer' }
        },
        'hidden': {
          type: 'LIF',
          input_type: { 'input': [784] },
          output_type: { 'output': [100] },
          metadata: { 'name': 'hidden_layer' },
          tau: [20.0],
          v_threshold: [1.0]
        },
        'output': {
          type: 'Affine',
          input_type: { 'input': [100] },
          output_type: { 'output': [10] },
          metadata: { 'name': 'output_layer' },
          weight_shape: [10, 100],
          bias_shape: [10]
        },
        'out': {
          type: 'Output',
          input_type: { 'input': [10] },
          output_type: { 'output': [10] },
          metadata: { 'name': 'output_node' }
        }
      },
      edges: [
        ['input', 'hidden'],
        ['hidden', 'output'],
        ['output', 'out']
      ]
    }

    // 处理节点选择
    const handleNodeSelect = (node) => {
      selectedNode.value = node
      sidebarVisible.value = true
    }

    // 处理节点取消选择
    const handleNodeDeselect = () => {
      selectedNode.value = null
      sidebarVisible.value = false
    }

    // 处理文件拖拽
    const handleFileDrop = (fileData) => {
      if (fileData.data) {
        // 新的NIR解析器返回的数据
        loadNIRData(fileData.data)
      } else {
        // 兼容旧的JSON文件处理
        loadFileFromFile(fileData)
      }
    }

    // 触发文件加载
    const loadFile = () => {
        if (networkCanvasRef.value) {
            networkCanvasRef.value.openFileBrowser()
        }
    }

    // 加载示例数据
    const loadDemo = () => {
      modelData.value = demoData
      modelInfo.value = {
        nodeCount: Object.keys(demoData.nodes).length,
        edgeCount: demoData.edges.length,
        inputType: '{"input": [784]}',
        outputType: '{"output": [10]}'
      }
      ElMessage.success('示例数据加载成功')
    }

    // 加载NIR数据
    const loadNIRData = (nirData) => {
      try {
        if (nirData.nodes && nirData.edges) {
          modelData.value = nirData
          modelInfo.value = {
            nodeCount: Object.keys(nirData.nodes).length,
            edgeCount: nirData.edges.length,
            inputType: JSON.stringify(nirData.input_type || 'N/A'),
            outputType: JSON.stringify(nirData.output_type || 'N/A')
          }
          ElMessage.success('NIR文件加载成功')
        } else {
          ElMessage.error('NIR文件格式不正确，需要包含nodes和edges字段')
        }
      } catch (error) {
        console.error('加载NIR文件失败:', error)
        ElMessage.error('NIR文件解析失败，请检查文件格式')
      }
    }

    // 从文件加载数据（兼容旧格式）
    const loadFileFromFile = async (file) => {
      try {
        const text = await file.text()
        const graphData = JSON.parse(text)
        
        if (graphData.nodes && graphData.edges) {
          modelData.value = graphData
          modelInfo.value = {
            nodeCount: Object.keys(graphData.nodes).length,
            edgeCount: graphData.edges.length,
            inputType: JSON.stringify(graphData.input_type || 'N/A'),
            outputType: JSON.stringify(graphData.output_type || 'N/A')
          }
          ElMessage.success('文件加载成功')
        } else {
          ElMessage.error('文件格式不正确，需要包含nodes和edges字段')
        }
      } catch (error) {
        console.error('加载文件失败:', error)
        ElMessage.error('文件解析失败，请检查文件格式')
      }
    }



    // 导出图片
    const exportImage = () => {
      if (networkCanvasRef.value) {
        networkCanvasRef.value.exportImage()
      }
    }

    // 显示关于对话框
    const showAbout = () => {
      aboutDialogVisible.value = true
    }

    return {
      networkCanvasRef,
      aboutDialogVisible,
      modelData,
      modelInfo,
      selectedNode,
      sidebarVisible,
      hasModel,
      handleNodeSelect,
      handleNodeDeselect,
      handleFileDrop,
      loadFile,
      loadDemo,
      exportImage,
      showAbout
    }
  }
}
</script>

<style>
#app {
  height: 100vh;
  width: 100vw;
  font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', '微软雅黑', Arial, sans-serif;
  position: relative;
  overflow: hidden;
  margin: 0;
  padding: 0;
}

.main-view {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #f8f9fa;
  width: 100%;
  height: 100%;
}
</style>
