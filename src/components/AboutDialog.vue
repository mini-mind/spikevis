<template>
  <el-dialog 
    v-model="dialogVisible" 
    title="关于 NIR Visualizer" 
    width="500px"
    :before-close="handleClose"
  >
    <div class="about-content">
      <div class="logo-section">
        <div class="logo">
          <span class="logo-text">NIR</span>
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
          <span class="logo-text">VISUALIZER</span>
        </div>
        <h2>NIR Visualizer</h2>
        <p class="version">版本 1.0.0</p>
      </div>
      
      <div class="description">
        <p>NIR Visualizer 是一个用于可视化 NIR (Neural Intermediate Representation) 模型的开源工具。</p>
        <p>支持多种 NIR 节点类型的可视化展示，包括神经元模型、卷积层、池化层等。</p>
      </div>
      
      <div class="features">
        <h3>主要功能</h3>
        <ul>
          <li>支持 .nir、.h5、.hdf5、.json 格式的 NIR 文件</li>
          <li>交互式网络图可视化</li>
          <li>详细的节点参数展示</li>
          <li>拖拽文件上传</li>
          <li>网络图导出</li>
        </ul>
      </div>
      
      <div class="supported-nodes">
        <h3>支持的节点类型</h3>
        <div class="node-types">
          <div class="node-category">
            <h4>神经元模型</h4>
            <span>LIF, LI, IF, I, CubaLIF, CubaLI</span>
          </div>
          <div class="node-category">
            <h4>线性层</h4>
            <span>Linear, Affine</span>
          </div>
          <div class="node-category">
            <h4>卷积层</h4>
            <span>Conv1d, Conv2d</span>
          </div>
          <div class="node-category">
            <h4>池化层</h4>
            <span>SumPool2d, AvgPool2d</span>
          </div>
          <div class="node-category">
            <h4>其他</h4>
            <span>Input, Output, Flatten, Scale, Threshold, Delay</span>
          </div>
        </div>
      </div>
      
      <div class="links">
        <h3>相关链接</h3>
        <div class="link-item">
          <a href="https://github.com/neuromorphs/NIR" target="_blank" rel="noopener">
            NIR 项目主页
          </a>
        </div>
        <div class="link-item">
          <a href="https://raw.githubusercontent.com/neuromorphs/NIR/refs/heads/main/nir/serialization.py" target="_blank" rel="noopener">
            NIR 序列化规范
          </a>
        </div>
      </div>
    </div>
    
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="handleClose">关闭</el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script>
export default {
  name: 'AboutDialog',
  props: {
    visible: {
      type: Boolean,
      default: false
    }
  },
  emits: ['close'],
  computed: {
    dialogVisible: {
      get() {
        return this.visible
      },
      set(value) {
        if (!value) {
          this.$emit('close')
        }
      }
    }
  },
  methods: {
    handleClose() {
      this.$emit('close')
    }
  }
}
</script>

<style scoped>
.about-content {
  padding: 20px 0;
}

.logo-section {
  text-align: center;
  margin-bottom: 30px;
}

.logo {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 16px;
}

.logo-text {
  font-size: 18px;
  font-weight: 600;
  color: #333;
  letter-spacing: 0.5px;
}

.logo-icon {
  width: 32px;
  height: 32px;
  color: #2196f3;
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-icon svg {
  width: 100%;
  height: 100%;
}

.logo-section h2 {
  margin: 0 0 8px 0;
  font-size: 24px;
  font-weight: 700;
  color: #333;
}

.version {
  margin: 0;
  color: #666;
  font-size: 14px;
}

.description {
  margin-bottom: 30px;
  line-height: 1.6;
}

.description p {
  margin: 0 0 12px 0;
  color: #555;
}

.features {
  margin-bottom: 30px;
}

.features h3 {
  margin: 0 0 16px 0;
  font-size: 18px;
  font-weight: 600;
  color: #333;
}

.features ul {
  margin: 0;
  padding-left: 20px;
  color: #555;
}

.features li {
  margin-bottom: 8px;
  line-height: 1.5;
}

.supported-nodes {
  margin-bottom: 30px;
}

.supported-nodes h3 {
  margin: 0 0 16px 0;
  font-size: 18px;
  font-weight: 600;
  color: #333;
}

.node-types {
  display: grid;
  gap: 12px;
}

.node-category {
  padding: 12px;
  background: #f8f9fa;
  border-radius: 6px;
  border-left: 4px solid #2196f3;
}

.node-category h4 {
  margin: 0 0 6px 0;
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.node-category span {
  font-size: 13px;
  color: #666;
}

.links {
  margin-bottom: 20px;
}

.links h3 {
  margin: 0 0 16px 0;
  font-size: 18px;
  font-weight: 600;
  color: #333;
}

.link-item {
  margin-bottom: 8px;
}

.link-item a {
  color: #2196f3;
  text-decoration: none;
  font-size: 14px;
}

.link-item a:hover {
  text-decoration: underline;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
