<template>
  <el-dialog
    v-model="dialogVisible"
    :title="t('about.title')"
    width="480px"
    :before-close="handleClose"
  >
    <div class="about-content">
      <!-- 一句话说这是什么 -->
      <div class="hero">
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
        <div>
          <h2>NIR Visualizer</h2>
          <p class="version">{{ t('about.version') }}</p>
        </div>
      </div>
      <p class="tagline">{{ t('about.tagline') }}</p>

      <!-- 链接：仓库门面的两个入口 -->
      <div class="links">
        <a href="https://github.com/neuromorphs/NIR" target="_blank" rel="noopener">{{ t('about.nirHome') }}</a>
        <a href="https://raw.githubusercontent.com/neuromorphs/NIR/refs/heads/main/nir/serialization.py" target="_blank" rel="noopener">{{ t('about.nirSpec') }}</a>
      </div>

      <!-- 次要信息：功能与支持类型,默认折叠 -->
      <el-collapse class="details">
        <el-collapse-item :title="t('about.details')">
          <ul class="feature-list">
            <li>{{ t('about.featureFiles') }}</li>
            <li>{{ t('about.featureGraph') }}</li>
            <li>{{ t('about.featureParams') }}</li>
            <li>{{ t('about.featureExport') }}</li>
          </ul>
          <div class="node-types">
            <div v-for="cat in categories" :key="cat.key" class="node-category">
              <h4>{{ t(cat.labelKey) }}</h4>
              <span>{{ cat.types }}</span>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>

    <template #footer>
      <span class="dialog-footer">
        <el-button @click="handleClose">{{ t('common.close') }}</el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script>
import { t } from '../i18n/index.js'

export default {
  name: 'AboutDialog',
  props: {
    visible: {
      type: Boolean,
      default: false
    }
  },
  emits: ['close'],
  data() {
    return {
      // 支持的节点类型清单(类型名是 NIR 官方类名,不翻译)
      categories: [
        { key: 'neuron', labelKey: 'about.catNeuron', types: 'LIF, LI, IF, I, CubaLIF, CubaLI' },
        { key: 'linear', labelKey: 'about.catLinear', types: 'Linear, Affine' },
        { key: 'conv', labelKey: 'about.catConv', types: 'Conv1d, Conv2d' },
        { key: 'pool', labelKey: 'about.catPool', types: 'SumPool2d, AvgPool2d' },
        { key: 'other', labelKey: 'about.catOther', types: 'Input, Output, Flatten, Scale, Threshold, Delay' },
        { key: 'graph', labelKey: 'about.catGraph', types: 'NIRGraph' },
      ]
    }
  },
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
    t,
    handleClose() {
      this.$emit('close')
    }
  }
}
</script>

<style scoped>
.about-content {
  padding: 4px 0 0;
}

.hero {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 12px;
}

.logo-icon {
  width: 40px;
  height: 40px;
  color: var(--sv-primary-hover);
  flex: none;
}

.logo-icon svg {
  width: 100%;
  height: 100%;
}

.hero h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--sv-text-primary);
}

.version {
  margin: 2px 0 0;
  color: var(--sv-text-secondary);
  font-size: 14px;
}

.tagline {
  margin: 0 0 14px;
  color: var(--sv-text-regular);
  line-height: 1.6;
}

.links {
  display: flex;
  gap: 16px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.links a {
  color: var(--sv-primary-hover);
  text-decoration: none;
  font-size: 14px;
}

.links a:hover {
  text-decoration: underline;
}

.details {
  border-top: 1px solid var(--sv-border);
  --el-collapse-border-color: var(--sv-border);
}

.feature-list {
  margin: 0 0 12px;
  padding-left: 18px;
  color: var(--sv-text-regular);
}

.feature-list li {
  margin-bottom: 6px;
  line-height: 1.5;
}

.node-types {
  display: grid;
  gap: 8px;
}

.node-category {
  padding: 8px 10px;
  background: var(--sv-bg-node);
  border-radius: var(--sv-radius-sm);
  border-left: 3px solid var(--sv-primary);
}

.node-category h4 {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--sv-text-primary);
}

.node-category span {
  font-size: 14px;
  color: var(--sv-text-secondary);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
