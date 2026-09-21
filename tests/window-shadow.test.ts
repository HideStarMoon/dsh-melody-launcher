import { EventEmitter } from 'node:events'
import type { BrowserWindow, Rectangle } from 'electron'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachWindowShadow, showWindowShadow, syncWindowShadow } from '../electron/window-shadow'

const mocks = vi.hoisted(() => ({ createWindow: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: mocks.createWindow }))

class TestWindow extends EventEmitter {
  bounds: Rectangle = { x: 100, y: 100, width: 900, height: 560 }
  visible = true
  minimized = false
  maximized = false
  focused = true
  destroyed = false
  webContents = Object.assign(new EventEmitter(), { invalidate: vi.fn() })
  isDestroyed = () => this.destroyed
  isVisible = () => this.visible
  isMinimized = () => this.minimized
  isMaximized = () => this.maximized
  isFullScreen = () => false
  isFocused = () => this.focused
  getContentBounds = () => ({ ...this.bounds })
  getBounds = () => ({ ...this.bounds, width: this.bounds.width + 8, height: this.bounds.height + 8 })
  setContentBounds = vi.fn((bounds: Rectangle) => { this.bounds = { ...bounds } })
  setMenuBarVisibility = vi.fn()
  setIgnoreMouseEvents = vi.fn()
  loadURL = vi.fn(async () => undefined)
  hide = vi.fn(() => { this.visible = false })
  showInactive = vi.fn(() => { this.visible = true })
  moveTop = vi.fn()
  destroy = vi.fn(() => { this.destroyed = true })
}

const asWindow = (window: TestWindow) => window as unknown as BrowserWindow
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
let main: TestWindow
let shadow: TestWindow

beforeAll(() => { Object.defineProperty(process, 'platform', { value: 'win32' }) })
afterAll(() => { Object.defineProperty(process, 'platform', platform) })
beforeEach(() => {
  vi.useFakeTimers()
  main = new TestWindow()
  mocks.createWindow.mockImplementation(function (options: Rectangle) {
    shadow = new TestWindow()
    shadow.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }
    shadow.visible = false
    return shadow
  })
  attachWindowShadow(asWindow(main))
})
afterEach(() => {
  main.emit('closed')
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('native window shadow', () => {
  it('aligns the shadow with the content rectangle and waits for its first page', () => {
    showWindowShadow(asWindow(main))
    expect(shadow.showInactive).not.toHaveBeenCalled()
    expect(shadow.bounds).toEqual({ x: 70, y: 70, width: 960, height: 620 })
    shadow.webContents.emit('did-finish-load')
    expect(shadow.visible).toBe(true)
    expect(shadow.moveTop.mock.invocationCallOrder[0]).toBeLessThan(main.moveTop.mock.invocationCallOrder[0])
  })

  it('hides stale edges throughout a resize and restores only the final geometry', () => {
    shadow.webContents.emit('did-finish-load')
    main.emit('will-resize')
    expect(shadow.visible).toBe(false)
    main.bounds = { x: 50, y: 60, width: 1100, height: 720 }
    main.emit('resize')
    vi.advanceTimersByTime(50)
    main.bounds = { x: 40, y: 50, width: 1200, height: 780 }
    syncWindowShadow(asWindow(main))
    vi.advanceTimersByTime(50)
    expect(shadow.visible).toBe(false)
    vi.runAllTimers()
    expect(shadow.visible).toBe(true)
    expect(shadow.bounds).toEqual({ x: 10, y: 20, width: 1260, height: 840 })
    expect(shadow.webContents.invalidate).toHaveBeenCalledTimes(2)
  })

  it('tracks a move on a negative-coordinate monitor without a lingering shadow', () => {
    shadow.webContents.emit('did-finish-load')
    main.emit('will-move')
    main.bounds = { ...main.bounds, x: -1500, y: 200 }
    main.emit('move')
    main.emit('moved')
    expect(shadow.visible).toBe(false)
    vi.runAllTimers()
    expect(shadow.visible).toBe(true)
    expect(shadow.bounds).toEqual({ x: -1530, y: 170, width: 960, height: 620 })
  })

  it('does not raise a background window when the delayed repaint finishes', () => {
    shadow.webContents.emit('did-finish-load')
    main.emit('will-move')
    main.focused = false
    vi.runAllTimers()
    expect(shadow.visible).toBe(false)
    main.focused = true
    main.emit('focus')
    expect(shadow.visible).toBe(true)
  })

  it('keeps the shadow hidden while minimized or maximized and restores it normally', () => {
    shadow.webContents.emit('did-finish-load')
    main.emit('will-resize')
    main.minimized = true
    main.emit('minimize')
    vi.runAllTimers()
    expect(shadow.visible).toBe(false)
    main.minimized = false
    main.emit('restore')
    expect(shadow.visible).toBe(true)
    main.maximized = true
    main.emit('maximize')
    main.emit('focus')
    expect(shadow.visible).toBe(false)
    main.maximized = false
    main.emit('unmaximize')
    expect(shadow.visible).toBe(true)
  })

  it('clears deferred work and destroys the shadow when its owner closes', () => {
    main.emit('will-resize')
    main.destroyed = true
    main.emit('closed')
    expect(vi.getTimerCount()).toBe(0)
    expect(shadow.destroy).toHaveBeenCalledTimes(1)
    expect(() => vi.runAllTimers()).not.toThrow()
  })
})
