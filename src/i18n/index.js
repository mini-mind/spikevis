/**
 * 轻量中英切换：字典 + 响应式 locale，不引入 i18n 库。
 *
 * 用法：
 *   import { t, tv, locale, setLocale, tOp, tNote } from '../i18n/index.js'
 *   t('menu.openFile')                       // 普通界面文案
 *   t('status.invalid', { n: 2 })            // 带占位符 {n}
 *   tv(issue)                                // 核心层结构化文案：优先 code+params，回退原文
 *   tOp('LIF')                               // 算子短名（缺类型时回退类型名本身）
 *   tNote('LIF')                             // 类型一句话说明（缺类型时回退空串）
 *
 * 语言选择记在 localStorage（键 spikevis.locale），默认中文。
 * locale 是 ref：模板里调 t() 会建立依赖，切换即全局刷新。
 */
import { ref } from 'vue'
import { dict as zhDict } from './locales/zh.js'
import { dict as enDict } from './locales/en.js'

const DICTS = { zh: zhDict, en: enDict }
const STORAGE_KEY = 'spikevis.locale'

function initialLocale() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh'
  } catch (e) {
    return 'zh' // localStorage 不可用（隐私模式等）时退回默认
  }
}

/** 当前语言（'zh' | 'en'），响应式 */
export const locale = ref(initialLocale())

export function setLocale(value) {
  const next = value === 'en' ? 'en' : 'zh'
  locale.value = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch (e) {
    /* 存不进就算了，本次会话内仍生效 */
  }
  syncDocument(next)
}
// 同步 <html lang> 与 <title>；node 环境（无 document）跳过
function syncDocument(lang) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'en')
  document.title = t('app.title')
}
// 初始化时同步一次
syncDocument(locale.value)

/** 按点路径查字典；查不到回退中文，再查不到返回键本身 */
function lookup(dictObj, key) {
  const parts = key.split('.')
  let cur = dictObj
  for (const p of parts) {
    if (cur === undefined || cur === null) return undefined
    cur = cur[p]
  }
  return typeof cur === 'string' ? cur : undefined
}

/** 占位符替换：'{name}' <- params.name */
function fmt(text, params) {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (m, name) =>
    params[name] === undefined || params[name] === null ? m : String(params[name])
  )
}

/** 翻译界面文案；params 替换 {name} 占位符 */
export function t(key, params) {
  const value = lookup(DICTS[locale.value], key) ?? lookup(zhDict, key)
  return value === undefined ? key : fmt(value, params)
}

/** 翻译并带显式回退：字典缺该键时返回 fallback（给核心层传来的兜底文案用） */
export function tOr(key, fallback) {
  const value = lookup(DICTS[locale.value], key) ?? lookup(zhDict, key)
  return value === undefined ? fallback : value
}

/**
 * 翻译核心层结构化文案。核心对象带 { code, params, <原文> } 时按当前语言出模板，
 * 没有对应模板（或就是裸字符串）时原样返回核心层的中文/英文原文。
 * 适用的原文键名依次尝试：message / reason / note / detail / label / warnings。
 */
export function tv(item, field) {
  if (item === null || item === undefined) return ''
  if (typeof item === 'string') return item
  if (item.code) {
    const tpl = lookup(DICTS[locale.value], item.code) ?? lookup(zhDict, item.code)
    if (tpl !== undefined) return fmt(tpl, item.params)
  }
  if (field) return item[field] ?? ''
  return item.message ?? item.reason ?? item.note ?? item.detail ?? item.label ?? ''
}

/** 历史栈标签：结构化 { code, params, label } 或字符串 */
export function tLabel(labelItem) {
  return tv(labelItem, 'label')
}

/**
 * 翻译核心层抛出的 Error。prune 的拒绝错误带 error.structured =
 * { code, params, list }（list 是逐条结构化文案），按当前语言重建整句；
 * 其余错误原样返回 message。
 */
export function tvError(error) {
  if (error && error.structured && error.structured.code) {
    const { code, params, list } = error.structured
    if (Array.isArray(list) && list.length > 0) {
      return t(code, { ...params, reasons: list.map((item) => tv(item)).join('; ') })
    }
    return t(code, params)
  }
  return error && error.message ? error.message : ''
}

/** 算子短名：缺该类型的条目时回退类型名本身 */
export function tOp(type) {
  const key = `opLabels.${type}`
  const value = lookup(DICTS[locale.value], key) ?? lookup(zhDict, key)
  return value === undefined ? type : value
}

/** 节点类型的一句话说明：缺该类型时回退空串 */
export function tNote(type) {
  const key = `typeNotes.${type}`
  return lookup(DICTS[locale.value], key) ?? lookup(zhDict, key) ?? ''
}
