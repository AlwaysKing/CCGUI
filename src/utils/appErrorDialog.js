const APP_ERROR_DIALOG_EVENT = 'ccgui:app-error-dialog'

export function openAppErrorDialog(options = {}) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return
  }

  const {
    title = '操作失败',
    message = '操作未完成',
    detail = '',
    confirmText = '知道了'
  } = options || {}

  window.dispatchEvent(new CustomEvent(APP_ERROR_DIALOG_EVENT, {
    detail: {
      title: String(title || '操作失败'),
      message: String(message || '操作未完成'),
      detail: String(detail || ''),
      confirmText: String(confirmText || '知道了')
    }
  }))
}

export function addAppErrorDialogListener(handler) {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {}
  }

  const listener = (event) => {
    handler(event?.detail || {})
  }

  window.addEventListener(APP_ERROR_DIALOG_EVENT, listener)
  return () => window.removeEventListener(APP_ERROR_DIALOG_EVENT, listener)
}
