<template>
  <!-- 子图导航条:进入子图后显示层级面包屑 + 返回按钮;path 为空(根层)不显示 -->
  <div v-if="path && path.length > 0" class="subgraph-bar">
    <span class="bar-title">{{ t('subgraph.title') }}</span>
    <button class="crumb clickable" @click.stop="$emit('navigate', 0)">{{ t('subgraph.rootLevel') }}</button>
    <template v-for="(name, i) in path" :key="i">
      <span class="crumb-sep">/</span>
      <button
        v-if="i < path.length - 1"
        class="crumb clickable"
        @click.stop="$emit('navigate', i + 1)"
      >{{ name }}</button>
      <span v-else class="crumb current">{{ name }}</span>
    </template>
    <span class="bar-spacer"></span>
    <button class="back-button" @click.stop="$emit('navigate', path.length - 1)">{{ t('subgraph.backParent') }}</button>
    <button class="back-button" @click.stop="$emit('navigate', 0)">{{ t('subgraph.backRoot') }}</button>
  </div>
</template>

<script>
import { t } from '../i18n/index.js'

export default {
  name: 'SubgraphBar',
  props: {
    // 当前所在的子图路径(如 ['block', 'inner']);空数组 = 根层,不显示导航条
    path: {
      type: Array,
      default: () => []
    }
  },
  emits: ['navigate'],
  setup() {
    return { t }
  }
}
</script>

<style scoped>
/* 定位说明:本条不再自行 fixed 到左上角(旧摆法会和居中的状态条重叠),
 * 由 App.vue 的 .top-overlay 容器排到状态条正下方(第二行),容器负责居中与限宽。
 * 组件本身只管外观。 */
.subgraph-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--sv-bg-panel);
  border: 1px solid var(--sv-primary);
  border-radius: var(--sv-radius);
  padding: 8px 14px;
  font-size: 14px;
  color: var(--sv-text-regular);
  box-shadow: var(--sv-inset-highlight), var(--sv-shadow-panel);
  white-space: nowrap;
  max-width: 100%;
  overflow-x: auto;
}

.bar-title {
  color: var(--sv-text-secondary);
  margin-right: 4px;
}

.crumb {
  font-size: 14px;
  font-family: var(--sv-font-mono);
  color: var(--sv-text-regular);
  background: none;
  border: none;
  padding: 0;
}

.crumb.clickable {
  cursor: pointer;
  color: var(--sv-primary-hover);
  text-decoration: underline;
}

.crumb.clickable:hover {
  color: var(--sv-text-primary);
}

.crumb.current {
  color: var(--sv-warning-bright);
  font-weight: 600;
}

.crumb-sep {
  color: var(--sv-text-secondary);
}

.bar-spacer {
  width: 12px;
}

.back-button {
  background: var(--sv-bg-node);
  border: 1px solid var(--sv-border-strong);
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
  color: var(--sv-text-regular);
  font-size: 14px;
  font-family: var(--sv-font);
}

.back-button:hover {
  background: var(--sv-bg-node-hover);
  color: var(--sv-text-primary);
}
</style>
