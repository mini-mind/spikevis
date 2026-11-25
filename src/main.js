import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
/* 全局主题（深色默认）：在 Element Plus 样式之后引入，用变量覆盖对齐 */
import './styles/theme.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'

const app = createApp(App)

// 注册Element Plus图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

// 中文 locale:对话框按钮、空状态等内置文案统一中文
app.use(ElementPlus, { locale: zhCn })
app.mount('#app')
