import { BrowserWindow, type Rectangle } from 'electron'

const SHADOW_MARGIN = 30
const SHADOW_SETTLE_DELAY = 80
const SHADOW_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
      .shadow {
        position: absolute;
        inset: ${SHADOW_MARGIN}px;
        border-radius: 12px;
        box-shadow: 0 0 2px rgba(22, 32, 26, .16), 0 4px 20px rgba(22, 32, 26, .20);
      }
    </style>
  </head>
  <body><div class="shadow"></div></body>
</html>`

interface WindowShadowController {
  shadow: BrowserWindow
  sync(): void
  showBehind(): void
}

const controllers = new WeakMap<BrowserWindow, WindowShadowController>()

function shadowBounds(bounds: Rectangle): Rectangle {
  return {
    x: bounds.x - SHADOW_MARGIN,
    y: bounds.y - SHADOW_MARGIN,
    width: bounds.width + SHADOW_MARGIN * 2,
    height: bounds.height + SHADOW_MARGIN * 2,
  }
}

export function attachWindowShadow(window: BrowserWindow): void {
  if (process.platform !== 'win32' || window.isDestroyed() || controllers.has(window)) return

  const shadow = new BrowserWindow({
    ...shadowBounds(window.getContentBounds()),
    useContentSize: true,
    backgroundColor: '#00000000',
    transparent: true,
    frame: false,
    thickFrame: false,
    roundedCorners: false,
    hasShadow: false,
    focusable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  shadow.setMenuBarVisibility(false)
  shadow.setIgnoreMouseEvents(true)

  let ready = false
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  const hide = () => {
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = null
    if (!shadow.isDestroyed()) shadow.hide()
  }
  // Separate native windows repaint asynchronously. Keep the shadow offscreen
  // until both surfaces have settled instead of showing a detached old edge.
  const hideUntilSettled = () => {
    hide()
    settleTimer = setTimeout(() => {
      settleTimer = null
      if (!window.isDestroyed() && window.isFocused()) controller.showBehind()
    }, SHADOW_SETTLE_DELAY)
  }

  const controller: WindowShadowController = {
    shadow,
    sync() {
      if (window.isDestroyed() || shadow.isDestroyed()) return
      const target = shadowBounds(window.getContentBounds())
      const current = shadow.getContentBounds()
      if (current.x === target.x && current.y === target.y
        && current.width === target.width && current.height === target.height) return
      hideUntilSettled()
      shadow.setContentBounds(target, false)
      shadow.webContents.invalidate()
    },
    showBehind() {
      if (!ready || window.isDestroyed() || shadow.isDestroyed()) return
      if (window.isMinimized() || window.isMaximized() || window.isFullScreen() || !window.isVisible()) {
        hide()
        return
      }
      this.sync()
      if (settleTimer) return
      shadow.showInactive()
      // Raise both windows as a pair. Moving only the main window leaves the
      // shadow behind other applications; moveAbove(shadow) can instead demote
      // the main window to the shadow's previous Z-order position. The shadow
      // cannot take focus or mouse input, so moving it first and the main window
      // second keeps the pair together without changing keyboard focus.
      shadow.moveTop()
      window.moveTop()
    },
  }
  controllers.set(window, controller)

  const sync = () => controller.sync()
  const showBehind = () => controller.showBehind()

  window.on('will-move', hideUntilSettled)
  window.on('will-resize', hideUntilSettled)
  window.on('move', sync)
  window.on('resize', sync)
  window.on('moved', sync)
  window.on('resized', sync)
  window.on('focus', showBehind)
  window.on('show', showBehind)
  window.on('restore', showBehind)
  window.on('hide', hide)
  window.on('minimize', hide)
  window.on('maximize', hide)
  window.on('unmaximize', showBehind)
  window.on('enter-full-screen', hide)
  window.on('leave-full-screen', showBehind)
  window.once('closed', () => {
    hide()
    controllers.delete(window)
    if (!shadow.isDestroyed()) shadow.destroy()
  })

  shadow.webContents.once('did-finish-load', () => {
    ready = true
    showBehind()
  })
  void shadow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SHADOW_HTML)}`)
}

export function syncWindowShadow(window: BrowserWindow): void {
  controllers.get(window)?.sync()
}

export function showWindowShadow(window: BrowserWindow): void {
  controllers.get(window)?.showBehind()
}
