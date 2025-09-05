<template>
  <div class="nir-logo" :style="{ width: size + 'px', height: size + 'px' }">
    <svg :width="size" :height="size" viewBox="0 0 24 24" fill="currentColor">
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
</template>

<script>
export default {
  name: 'NirLogo',
  props: {
    size: {
      type: Number,
      default: 32
    },
    color: {
      type: String,
      default: '#2196f3'
    }
  }
}
</script>

<style scoped>
.nir-logo {
  display: inline-block;
  color: v-bind(color);
}

.nir-logo svg {
  width: 100%;
  height: 100%;
}
</style>
