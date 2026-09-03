// Settings, floating over the conversation.
//
// Every row is generated from the schema in ui/model/settings.js, so this file
// never has to know what a setting *is* — only how to draw a row and which key
// changes one. Changes are written through as they are made rather than behind
// an OK button: there is nothing here that needs a transaction, and a settings
// panel you have to remember to confirm is a settings panel you will forget to
// confirm.

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { Text, useInput } from 'ink'

import { Float, FloatRow, FloatRule, FloatFill } from './Float.jsx'
import { SETTINGS, SECTIONS, cycle, display } from '../model/settings.js'
import { floatLayout, hitTest, scrollTo } from '../model/layout.js'
import { useMouse, useMouseCapture } from './mouse.js'

const FOOTER = [
  { keys: '↑↓', label: 'move' },
  { keys: '←→', label: 'change' },
  { keys: '⏎', label: 'toggle' },
  { keys: 'esc', label: 'close' }
]

/** Section headings and settings, in one flat list the cursor walks. */
function rowsFor () {
  const rows = []
  for (const section of SECTIONS) {
    rows.push({ kind: 'section', id: `section:${section}`, label: section })
    for (const setting of SETTINGS) {
      if (setting.section === section) rows.push({ kind: 'setting', id: setting.key, setting })
    }
  }
  return rows
}

export function SettingsPanel ({ theme, terminal, values, profile, onChange, onCancel }) {
  const rows = useMemo(rowsFor, [])
  const [selected, setSelected] = useState(1)
  const [offset, setOffset] = useState(0)

  const layout = useMemo(
    () => floatLayout(terminal, { items: rows.length, maxRows: 24, width: 72 }),
    [terminal, rows.length]
  )

  useEffect(() => {
    setOffset((current) => scrollTo(current, selected, layout.listRows, rows.length))
  }, [selected, layout.listRows, rows.length])

  // Headings are scenery, not destinations — the cursor steps over them.
  const move = useCallback((step) => {
    setSelected((current) => {
      let next = current
      for (let i = 0; i < rows.length; i++) {
        next = (next + step + rows.length) % rows.length
        if (rows[next].kind === 'setting') return next
      }
      return current
    })
  }, [rows])

  const change = useCallback((step) => {
    const row = rows[selected]
    if (row?.kind !== 'setting') return
    onChange(row.setting.key, cycle(row.setting, values[row.setting.key], step))
  }, [rows, selected, values, onChange])

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c') || input === 'q') return onCancel()
    if (key.downArrow || input === 'j' || (key.ctrl && input === 'n')) return move(1)
    if (key.upArrow || input === 'k' || (key.ctrl && input === 'p')) return move(-1)
    if (key.rightArrow || input === 'l' || key.return || input === ' ') return change(1)
    if (key.leftArrow || input === 'h') return change(-1)
  })

  useMouseCapture(true)

  const state = useRef({ layout, offset, rows })
  state.current = { layout, offset, rows }

  const onMouse = useCallback((event) => {
    const { layout: geometry, offset: at, rows: list } = state.current

    if (event.type === 'wheel') {
      move(event.direction)
      return
    }
    if (event.type !== 'press' || event.button !== 'left') return

    const index = hitTest(geometry, event, at, list.length)
    if (index === null) {
      if (event.y < geometry.top || event.y > geometry.top + geometry.height) onCancel()
      return
    }
    if (list[index].kind !== 'setting') return

    setSelected(index)
    // Clicking the value cycles it; clicking the label only selects, so you can
    // read a row without changing it by accident.
    if (event.x > geometry.left + geometry.width - 22) {
      onChange(list[index].setting.key, cycle(list[index].setting, values[list[index].setting.key], 1))
    }
  }, [move, onCancel, onChange, values])

  useMouse(onMouse)

  const visible = rows.slice(offset, offset + layout.listRows)
  const current = rows[selected]

  return (
    <Float
      theme={theme}
      layout={layout}
      title='Settings'
      icon={theme.icons.account}
      count={profile}
      footer={FOOTER}
    >
      <FloatRow theme={theme} layout={layout}>
        <Text color={theme.dim}>
          {current?.kind === 'setting' ? current.setting.help : 'per account, saved as you change them'}
        </Text>
      </FloatRow>

      <FloatRule theme={theme} layout={layout} />

      {visible.map((row, i) => (
        row.kind === 'section'
          ? (
            <FloatRow key={row.id} theme={theme} layout={layout}>
              <Text color={theme.accent2} bold>{row.label.toUpperCase()}</Text>
            </FloatRow>
            )
          : (
            <SettingRow
              key={row.id}
              theme={theme}
              layout={layout}
              setting={row.setting}
              value={values[row.setting.key]}
              selected={offset + i === selected}
            />
            )
      ))}

      <FloatFill theme={theme} layout={layout} rows={layout.listRows - visible.length} />
    </Float>
  )
}

function SettingRow ({ theme, layout, setting, value, selected }) {
  const inner = layout.width - 4
  const shown = display(setting, value)
  const marker = selected ? `${theme.icons.selected} ` : '  '

  // An enum reads better as the choices it has, with the current one lit up,
  // than as one word you have to press keys at to discover.
  const choices = setting.type === 'enum' && setting.values.length <= 4 && selected
  const right = choices ? setting.values.join('/') : shown
  const gap = Math.max(1, inner - marker.length - setting.label.length - right.length - 3)

  return (
    <FloatRow theme={theme} layout={layout} background={selected ? theme.selection : undefined}>
      <Text color={selected ? theme.accent : theme.subtle}>{marker}</Text>
      <Text bold={selected} color={selected ? theme.fg : theme.dim}>{setting.label}</Text>
      <Text>{' '.repeat(gap)}</Text>
      {choices
        ? setting.values.map((option, i) => (
          <Text key={option}>
            {i > 0 ? <Text color={theme.subtle}>/</Text> : ''}
            <Text color={option === value ? theme.green : theme.subtle} bold={option === value}>
              {option}
            </Text>
          </Text>
        ))
        : (
          <Text color={valueColor(theme, setting, value)} bold>
            {shown}
          </Text>
          )}
      <Text color={theme.subtle}>{selected ? ' ‹›' : '   '}</Text>
    </FloatRow>
  )
}

function valueColor (theme, setting, value) {
  if (setting.type === 'boolean') return value ? theme.green : theme.subtle
  return theme.accent
}
