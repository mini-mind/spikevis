/**
 * 撤销/重做历史栈（最小实现）。
 *
 * 文档不可变，历史栈只存引用，代价极小：
 *   past: 已提交文档的数组（栈顶 = 当前前一版）
 *   future: undo 之后可以 redo 的数组
 *
 * 用法：
 *   const h = createHistory(initialDoc);
 *   h.commit(nextDoc, '改了 weight');   // 前进（push 当前，替换 current）
 *   h.undo() -> doc | null             // 退一步，被退掉的进 future
 *   h.redo() -> doc | null
 *   h.reset(doc)                       // 清空历史，重置为 doc
 *   h.canUndo() / h.canRedo()
 */

export function createHistory(initialDoc, { limit = 200 } = {}) {
  let current = initialDoc;
  let past = [];
  let future = [];

  return {
    get current() {
      return current;
    },
    canUndo() {
      return past.length > 0;
    },
    canRedo() {
      return future.length > 0;
    },
    /** 提交新版本；label 本轮只是语义标注，下一轮编辑界面可用它显示操作名 */
    commit(nextDoc, label = '') {
      past.push({ doc: current, label });
      if (past.length > limit) past.shift();
      future = [];
      current = nextDoc;
      return current;
    },
    undo() {
      if (past.length === 0) return null;
      const entry = past.pop();
      future.push({ doc: current, label: entry.label });
      current = entry.doc;
      return current;
    },
    redo() {
      if (future.length === 0) return null;
      const entry = future.pop();
      past.push({ doc: current, label: entry.label });
      current = entry.doc;
      return current;
    },
    /** 最近一次提交的标注（给 UI 显示"可撤销什么"） */
    lastLabel() {
      return past.length > 0 ? past[past.length - 1].label : '';
    },
    /** 下一次 redo 会重做的操作名（给 UI 显示"可重做什么"） */
    nextRedoLabel() {
      return future.length > 0 ? future[future.length - 1].label : '';
    },
    reset(doc) {
      current = doc;
      past = [];
      future = [];
    },
  };
}
