<template>
  <div class="function-menu">
    <!-- 主按钮 -->
    <div class="menu-button" @click="toggleMenu" :class="{ 'active': isOpen }">
      <svg viewBox="0 0 24 24" fill="currentColor" class="menu-icon">
        <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
      </svg>
    </div>

    <!-- 菜单面板 -->
    <div class="menu-panel" :class="{ 'expanded': isOpen }">
      <div class="menu-item" @click="loadNewFile">
        <svg viewBox="0 0 24 24" fill="currentColor" class="item-icon">
          <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
        </svg>
        <span>{{ t('menu.openFile') }}</span>
      </div>

      <div class="menu-item" :class="{ 'menu-item-disabled': !hasDoc }" @click="hasDoc && newItem()">
        <svg viewBox="0 0 24 24" fill="currentColor" class="item-icon">
          <path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20M13,7H11V11H7V13H11V17H13V13H17V11H13V7Z"/>
        </svg>
        <span>{{ t('menu.newNode') + (hasDoc ? '' : t('menu.newNodeNeedsModel')) }}</span>
      </div>

      <div class="menu-item" :class="{ 'menu-item-active': connectMode }" @click="$emit('toggle-connect')">
        <svg viewBox="0 0 24 24" fill="currentColor" class="item-icon">
          <path d="M18.5,13A3.5,3.5 0 0,1 15,16.5H13V18.5A2.5,2.5 0 0,1 10.5,21H8A2.5,2.5 0 0,1 5.5,18.5V16A2.5,2.5 0 0,1 8,13.5H10V10.5H8A2.5,2.5 0 0,1 5.5,8V5.5A2.5,2.5 0 0,1 8,3H10.5A2.5,2.5 0 0,1 13,5.5V7.5H15A3.5,3.5 0 0,1 18.5,11V13Z"/>
        </svg>
        <span>{{ connectMode ? t('menu.connectModeOff') : t('menu.connectMode') }}</span>
      </div>

      <div class="menu-item" :class="{ 'menu-item-disabled': !canUndo }" @click="canUndo && undo()">
        <svg viewBox="0 0 24 24" fill="currentColor" class="item-icon">
          <path d="M12.5,8C9.85,8 7.45,9 5.6,10.6L2,7V16H11L7.38,12.38C8.77,11.22 10.54,10.5 12.5,10.5C16.04,10.5 19.05,12.81 20.1,16L22.61,15.16C21.24,11 17.25,8 12.5,8Z"/>
        </svg>
        <span>{{ undoText }}</span>
      </div>

      <div class="menu-item" :class="{ 'menu-item-disabled': !canRedo }" @click="canRedo && redo()">
        <svg viewBox="0 0 24 24" fill="currentColor" class="item-icon">
          <path d="M11.5,8C14.15,8 16.55,9 18.4,10.6L22,7V16H13L16.62,12.38C15.23,11.22 13.46,10.5 11.5,10.5C7.96,10.5 4.95,12.81 3.9,16L1.39,15.16C2.76,11 6.75,8 11.5,8Z"/>
        </svg>
        <span>{{ redoText }}</span>
      </div>

      <div class="menu-item" :class="{ 'menu-item-disabled': !hasDoc }" @click="hasDoc && exportNir()">
        <svg viewBox="0 0 24 24" fill="currentColor" class="item-icon">
          <path d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z"/>
        </svg>
        <span>{{ hasDoc ? t('menu.exportNir') : t('menu.exportNirNeedsModel') }}</span>
      </div>

      <div class="menu-item" :class="{ 'menu-item-disabled': !hasDoc }" @click="hasDoc && exportJson()">
        <svg viewBox="0 0 24 24" fill="currentColor" class="item-icon">
          <path d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z"/>
        </svg>
        <span>{{ t('menu.exportJson') }}</span>
      </div>

      <div class="menu-item" @click="toggleLocale">
        <svg viewBox="0 0 24 24" fill="currentColor" class="item-icon">
          <path d="M12.87,15.07L10.33,12.56L10.36,12.53C12.1,10.59 13.12,8.36 13.5,7H16V5H10V3H8V5H2V7H11.57C11.18,8.24 10.36,9.94 9.12,11.5C8.32,10.5 7.62,9.42 7.07,8.5H5.07C5.75,9.79 6.63,11.14 7.67,12.44L3.38,16.7L4.79,18.11L9.06,13.84L11.75,16.53L12.87,15.07M17.5,10H15.5L11,22H13L14.12,19H18.88L20,22H22L17.5,10M14.88,17L16.5,12.67L18.12,17H14.88Z"/>
        </svg>
        <span>{{ t('menu.language') }}</span>
      </div>

      <div class="menu-item" @click="showAbout">
        <svg viewBox="0 0 24 24" fill="currentColor" class="item-icon">
          <path d="M13,9H18.5L13,3.5V9M6,2H14L20,8V20A2,2 0 0,1 18,22H6C4.89,22 4,21.1 4,20V4C4,2.89 4.89,2 6,2M11,15V12H9V15H7L12,20L17,15H15V12H13V15H11Z"/>
        </svg>
        <span>{{ t('menu.about') }}</span>
      </div>
    </div>

    <!-- 隐藏的文件输入 -->
    <input
      ref="fileInput"
      type="file"
      accept=".nir,.json"
      style="display: none"
      @change="handleFileSelect"
    />
  </div>
</template>

<script>
import { ElMessage } from 'element-plus'
import { openNirFile } from '../io/nirIO.js'
import { loadJsonModel } from '../io/jsonLoader.js'
// 轻量 i18n：t 读响应式 locale,模板里直接调;切换语言全界面即时刷新
import { t, tLabel, locale, setLocale } from '../i18n/index.js'

export default {
  name: 'FunctionMenu',
  props: {
    // 是否有可操作的文档
    hasDoc: {
      type: Boolean,
      default: false
    },
    canUndo: {
      type: Boolean,
      default: false
    },
    canRedo: {
      type: Boolean,
      default: false
    },
    // 历史栈标签:结构化 { label, code, params } 或字符串(旧条目)
    undoLabel: {
      type: [Object, String],
      default: ''
    },
    redoLabel: {
      type: [Object, String],
      default: ''
    },
    connectMode: {
      type: Boolean,
      default: false
    }
  },
  emits: ['fileDrop', 'show-about', 'export-nir', 'export-json', 'new-node', 'undo', 'redo', 'toggle-connect'],
  data() {
    return {
      isOpen: false
    }
  },
  computed: {
    undoText() {
      const label = tLabel(this.undoLabel)
      return label
        ? t('menu.undoLabel', { label })
        : t('menu.undoPlain')
    },
    redoText() {
      const label = tLabel(this.redoLabel)
      return label
        ? t('menu.redoLabel', { label })
        : t('menu.redoPlain')
    }
  },
  methods: {
    // 模板里可直接调 t()
    t,
    toggleMenu() {
      this.isOpen = !this.isOpen
    },
    toggleLocale() {
      setLocale(locale.value === 'zh' ? 'en' : 'zh')
      this.isOpen = false
    },

    loadNewFile() {
      this.$refs.fileInput.click()
      this.isOpen = false
    },

    async handleFileSelect(event) {
      const file = event.target.files[0]
      if (file) {
        try {
          const lower = file.name.toLowerCase()
          const nirData = lower.endsWith('.json')
            ? loadJsonModel(await file.text(), file.name)
            : await openNirFile(file)
          this.$emit('fileDrop', { file, data: nirData })
        } catch (error) {
          console.error('文件解析失败:', error)
          ElMessage.error(error.message || t('msg.parseFailed'))
        }
      }
      // 清空input值,允许重复选择同一文件
      event.target.value = ''
    },

    newItem() {
      this.isOpen = false
      this.$emit('new-node')
    },

    undo() {
      this.isOpen = false
      this.$emit('undo')
    },

    redo() {
      this.isOpen = false
      this.$emit('redo')
    },

    exportNir() {
      this.isOpen = false
      this.$emit('export-nir')
    },

    exportJson() {
      this.isOpen = false
      this.$emit('export-json')
    },

    showAbout() {
      this.$emit('show-about')
      this.isOpen = false
    }
  }
}
</script>

<style scoped lang="scss">
.function-menu {
  position: fixed;
  top: 20px;
  left: 20px;
  z-index: 2000;
}

.menu-button {
  width: 48px;
  height: 48px;
  background: var(--sv-bg-panel);
  border: 1px solid var(--sv-border-strong);
  border-radius: var(--sv-radius);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  /* ComfyUI floating-panel 质感:顶缘 1px 高光 + 面板投影 */
  box-shadow: var(--sv-inset-highlight), var(--sv-shadow-panel);
  transition: background-color 0.15s ease;

  &:hover {
    background: var(--sv-bg-node-hover);
  }

  &.active {
    background: var(--sv-bg-node-hover);
    border-color: var(--sv-primary);
  }
}

.menu-icon {
  width: 24px;
  height: 24px;
  color: var(--sv-text-regular);
  transition: transform 0.3s ease;
}

.menu-button.active .menu-icon {
  transform: rotate(90deg);
  color: var(--sv-primary-hover);
}

.menu-panel {
  position: absolute;
  top: 56px;
  left: 0;
  width: 280px;
  background: var(--sv-bg-overlay);
  border: 1px solid var(--sv-border-strong);
  border-radius: var(--sv-radius-lg);
  box-shadow: var(--sv-inset-highlight), var(--sv-shadow-pop);
  overflow: hidden;
  transform-origin: top left;
  transform: scaleY(0);
  opacity: 0;
  transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);

  &.expanded {
    transform: scaleY(1);
    opacity: 1;
  }
}

.menu-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  cursor: pointer;
  transition: background-color 0.15s ease;
  color: var(--sv-text-regular);

  &:hover {
    background: var(--sv-bg-node-hover);
    color: var(--sv-text-primary);
  }

  &:first-child {
    border-radius: var(--sv-radius-lg) var(--sv-radius-lg) 0 0;
  }

  &:last-child {
    border-radius: 0 0 var(--sv-radius-lg) var(--sv-radius-lg);
  }

  &:only-child {
    border-radius: var(--sv-radius-lg);
  }
}

.menu-item-active {
  background: var(--sv-bg-node-hover);
  color: var(--sv-primary-hover);
}

.item-icon {
  width: 20px;
  height: 20px;
  margin-right: 12px;
  color: var(--sv-text-secondary);
}

.menu-item span {
  font-size: 14px;
  font-weight: 500;
}

.menu-item-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
