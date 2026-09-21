import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const app = read('src/App.tsx')
const mode = read('src/wheelchair/WheelchairMode.tsx')
const stage = app.slice(app.indexOf('className={`surface-stage'), app.indexOf('      {settingsOpen && ('))

// Structural contracts cannot verify native compositor pixels.
describe('wheelchair shared window shell', () => {
  it('uses one classic stage and hides retained classic hosts', () => {
    expect(app.match(/className={`surface-stage/g)).toHaveLength(1)
    expect(stage).toContain('<WheelchairMode')
    expect(stage).toContain('surface-host wheelchair-surface-host')
    for (const name of ['launcher', 'manager']) {
      expect(stage).toContain("navigation.surface === '" + name + "' && !wheelchairMode")
    }
    expect(app).not.toContain("position: 'fixed'")
    expect(mode).not.toContain('document.createElement')
  })

  it('keeps classic settings outside PR scope and the clipping stage', () => {
    expect(app.match(/<SettingsDialog/g)).toHaveLength(1)
    expect(stage).not.toContain('<SettingsDialog')
    expect(mode).not.toContain('<SettingsDialog')
    expect(stage).toContain('onOpenSettings={() => setSettingsOpen(true)}')
    expect(mode).toContain('onOpenSettings={onOpenSettings}')
    expect(mode).not.toContain('setWindowMode')
    expect(app).toContain('document.querySelector')
    expect(mode).toContain('document.querySelector')
  })

  it('confines every PR rule and animation to the wheelchair subtree', () => {
    const css = postcss.parse(read('src/wheelchair/wheelchair.css'))
    const top = css.nodes.filter(node => node.type !== 'comment')
    expect(top).toHaveLength(1)
    expect(top[0].type).toBe('atrule')
    expect((top[0] as postcss.AtRule).name).toBe('scope')
    expect((top[0] as postcss.AtRule).params).toBe('(.wheelchair-mode)')
    css.walkRules(rule => {
      expect(rule.selector).not.toMatch(/:root|#root|\.surface-stage|\bhtml\b/)
    })
  })

  it('retains four-corner clipping and transparent document and native backgrounds', () => {
    const css = postcss.parse(read('src/styles.css'))
    let shell: postcss.Rule | undefined
    css.walkRules('.surface-stage', rule => { shell = rule })
    const declarations = Object.fromEntries(shell!.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]))
    expect(declarations['border-radius']).toBe('12px')
    expect(declarations.overflow).toBe('hidden')
    css.walkRules(rule => {
      if (!rule.selector.split(',').some(selector => ['html', 'body', '#root'].includes(selector.trim()))) return
      rule.walkDecls(/background/, decl => { expect(decl.value).toBe('transparent') })
    })
    const shadow = read('electron/window-shadow.ts')
    expect(shadow).not.toContain('#171b18')
    expect(shadow.match(/background: [^;]+;/g)).toEqual(['background: transparent;'])
    expect(shadow).toContain('const SHADOW_MARGIN = 30')
    expect(shadow).toContain('border-radius: 12px')
    expect(read('electron/app-window.ts')).toContain("const WINDOW_BACKGROUND_COLOR = '#00000000'")
    expect(read('src/wheelchair/flip.css')).not.toMatch(/background\s*:/)
    for (const direction of ['down', 'up']) expect(read('src/wheelchair/flip.css')).toContain("data-vt-flip='" + direction + "'")
  })
})
