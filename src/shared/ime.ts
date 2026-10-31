/**
 * 输入法（IME）组字状态与"回车是否该提交"的纯函数判定。
 *
 * 中文、日文输入法在选词时按回车属于输入法本身（`isComposing`），部分浏览器与输入法组合只把
 * `keyCode` 置为 229。这两条路径都必须让给输入法，否则拼音会被当成指令发送出去。
 */
export interface ImeAwareKeyEvent {
  key?: string
  shiftKey?: boolean
  isComposing?: boolean
  keyCode?: number
}

/** 事件是否正在被输入法组字占用：回车、方向键与 Esc 此时都不归界面所有。 */
export function isImeComposing(event: ImeAwareKeyEvent): boolean {
  return Boolean(event.isComposing) || event.keyCode === 229
}

/** 只有非组字状态下的裸回车才提交；Shift+Enter 换行、组字中的回车选词。 */
export function submitsOnEnter(event: ImeAwareKeyEvent): boolean {
  return event.key === 'Enter' && !event.shiftKey && !isImeComposing(event)
}
