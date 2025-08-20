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
        <span>载入新文件</span>
      </div>
      
      <div class="menu-item" @click="showAbout">
        <svg viewBox="0 0 24 24" fill="currentColor" class="item-icon">
          <path d="M13,9H18.5L13,3.5V9M6,2H14L20,8V20A2,2 0 0,1 18,22H6C4.89,22 4,21.1 4,20V4C4,2.89 4.89,2 6,2M11,15V12H9V15H7L12,20L17,15H15V12H13V15H11Z"/>
        </svg>
        <span>关于</span>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'FunctionMenu',
  data() {
    return {
      isOpen: false
    }
  },
  methods: {
    toggleMenu() {
      this.isOpen = !this.isOpen
    },
    
    loadNewFile() {
      this.$emit('load-file')
      this.isOpen = false
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
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
  
  &:hover {
    background: #f8f9fa;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
  
  &.active {
    background: #e3f2fd;
    border-color: #2196f3;
  }
}

.menu-icon {
  width: 24px;
  height: 24px;
  color: #333;
  transition: transform 0.3s ease;
}

.menu-button.active .menu-icon {
  transform: rotate(90deg);
}

.menu-panel {
  position: absolute;
  top: 56px;
  left: 0;
  width: 200px;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  transform-origin: top left;
  transform: scaleY(0);
  opacity: 0;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  
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
  transition: background-color 0.2s ease;
  color: #333;
  
  &:hover {
    background: #f5f5f5;
  }
  
  &:first-child {
    border-radius: 8px 8px 0 0;
  }
  
  &:last-child {
    border-radius: 0 0 8px 8px;
  }
  
  &:only-child {
    border-radius: 8px;
  }
}

.item-icon {
  width: 20px;
  height: 20px;
  margin-right: 12px;
  color: #666;
}

.menu-item span {
  font-size: 14px;
  font-weight: 500;
}
</style>
