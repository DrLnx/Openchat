// The fuzzy finder. One component behind every `<leader>f` binding: rooms,
// DMs, people, commands, keymaps, accounts, and the messages in front of you.
//
// It is Telescope's shape because Telescope's shape is right: type to narrow,
// the matched characters light up so you can see *why* something matched,
// arrows or Ctrl-J/K to move, enter to take it. Everything a picker shows comes
// in as a plain list of rows, so adding a new finder is a list, not a widget.

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { Text, useInput } from 'ink'

import { Float, FloatRow, FloatRule, FloatFill } from './Float.jsx'
import { rank, segments } from '../model/fuzzy.js'
import { floatLayout, hitTest, scrollTo } from '../model/layout.js'
import { useMouse, useMouseCapture } from './mouse.js'

const FOOTER = [
  { keys: '↑↓', label: 'move' },
  { keys: '⏎', label: 'open' },
  { keys: '⇥', label: 'insert' },
  { keys: 'esc', label: 'close' }
]

/**
 * @param {object} props
 * @param {object} props.theme
 * @param {{ rows: number, columns: number }} props.terminal
 * @param {string} props.title
 * @param {PickerItem[]} props.items
 * @param {(item: PickerItem, query: string) => void} props.onSubmit
 * @param {() => void} props.onCancel
 * @param {(item: PickerItem|null, query: string) => void} [props.onSecondary] tab
 * @param {(query: string) => void} [props.onEmpty]  enter with nothing matched
 *
 * @typedef {object} PickerItem
 * @property {string} id
 * @property {string} label
 * @property {string} [hint]     right-hand column
 * @property {string} [detail]   extra text that is searched but not shown
 * @property {string} [icon]
 * @property {string} [color]
 * @property {any} [data]
 */
export function Picker ({
  theme, terminal, title, icon, items, placeholder = 'type to filter',
  onSubmit, onCancel, onSecondary, onEmpty, footer = FOOTER, allowFreeText = false
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [offset, setOffset] = useState(0)

  // The label is what you are aiming at, so it is matched fuzzily. The hint is
  // supporting text, matched as a substring. `detail` is usually a public key,
  // matched as a prefix — see the note in ui/model/fuzzy.js about why fuzzy
  // matching a 64-character hex string matches everything.
  const matches = useMemo(() => rank(items, query, {
    key: (item) => [
      item.label,
      { text: item.hint ?? '', match: 'substring' },
      { text: item.detail ?? '', match: item.detailMatch || 'prefix' }
    ]
  }), [items, query])

  const layout = useMemo(
    () => floatLayout(terminal, { items: Math.max(matches.length, 1), maxRows: 22 }),
    [terminal, matches.length]
  )

  // A narrowing list must not leave the cursor pointing past the end of it.
  useEffect(() => {
    setSelected((current) => (current >= matches.length ? 0 : current))
  }, [matches.length])

  useEffect(() => {
    setOffset((current) => scrollTo(current, selected, layout.listRows, matches.length))
  }, [selected, layout.listRows, matches.length])

  const move = useCallback((step) => {
    setSelected((current) => {
      if (matches.length === 0) return 0
      return (current + step + matches.length) % matches.length
    })
  }, [matches.length])

  const take = useCallback(() => {
    const match = matches[selected]
    if (match) return onSubmit(match.item, query)
    if (allowFreeText && query.trim()) return onEmpty?.(query.trim())
  }, [matches, selected, onSubmit, onEmpty, query, allowFreeText])

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) return onCancel()
    if (key.return) return take()
    if (key.tab) return onSecondary?.(matches[selected]?.item ?? null, query)

    if (key.downArrow || (key.ctrl && input === 'j') || (key.ctrl && input === 'n')) return move(1)
    if (key.upArrow || (key.ctrl && input === 'k') || (key.ctrl && input === 'p')) return move(-1)
    if (key.pageDown) return move(layout.listRows)
    if (key.pageUp) return move(-layout.listRows)

    if (key.backspace || key.delete) return setQuery((q) => q.slice(0, -1))
    if (key.ctrl && input === 'u') return setQuery('')
    if (key.ctrl && input === 'w') return setQuery((q) => q.replace(/\s*\S+\s*$/, ''))
    if (key.ctrl || key.meta) return

    // eslint-disable-next-line no-control-regex
    if (input && !/^[\u0000-\u001f\u007f]+$/.test(input)) setQuery((q) => q + input)
  })

  useMouseCapture(true)

  // Held in a ref so the subscription is not torn down and rebuilt on every
  // keystroke — the picker re-renders constantly while you type.
  const state = useRef({ layout, offset, count: matches.length })
  state.current = { layout, offset, count: matches.length }

  const onMouse = useCallback((event) => {
    const { layout: geometry, offset: at, count } = state.current

    if (event.type === 'wheel') {
      move(event.direction * 3)
      return
    }

    if (event.type !== 'press' || event.button !== 'left') return

    const index = hitTest(geometry, event, at, count)
    if (index === null) {
      // A click outside the frame dismisses it, the way clicking off a float
      // does in an editor.
      if (event.y < geometry.top || event.y > geometry.top + geometry.height) onCancel()
      return
    }

    // One click both moves and takes: a picker is a menu, and asking for a
    // second click to confirm what you just clicked on is a dialog box.
    setSelected(index)
    const match = matches[index]
    if (match) onSubmit(match.item, query)
  }, [matches, move, onCancel, onSubmit, query])

  useMouse(onMouse)

  const visible = matches.slice(offset, offset + layout.listRows)
  const inner = layout.width - 4

  return (
    <Float
      theme={theme}
      layout={layout}
      title={title}
      icon={icon}
      count={matches.length ? `${selected + 1}/${matches.length}` : '0'}
      footer={footer}
    >
      <FloatRow theme={theme} layout={layout}>
        <Text color={theme.accent}>{theme.icons.search} </Text>
        <Text>{query}</Text>
        <Text color={theme.accent} inverse={query.length === 0}>{query ? '▌' : ' '}</Text>
        {query === '' ? <Text color={theme.subtle}>{placeholder}</Text> : ''}
      </FloatRow>

      <FloatRule theme={theme} layout={layout} />

      {visible.map((match, i) => (
        <Row
          key={match.item.id}
          theme={theme}
          layout={layout}
          inner={inner}
          match={match}
          selected={offset + i === selected}
        />
      ))}

      {matches.length === 0 && (
        <FloatRow theme={theme} layout={layout}>
          <Text color={theme.dim}>
            {allowFreeText && query.trim()
              ? <Text><Text color={theme.accent}>⏎</Text> use "{query.trim()}" as typed</Text>
              : 'nothing matches'}
          </Text>
        </FloatRow>
      )}

      <FloatFill
        theme={theme}
        layout={layout}
        rows={layout.listRows - Math.max(visible.length, matches.length === 0 ? 1 : 0)}
      />
    </Float>
  )
}

function Row ({ theme, layout, inner, match, selected }) {
  const { item, positions, field } = match
  const parts = segments(item.label, field === 0 ? positions : [])
  const hint = item.hint ?? ''

  const marker = selected ? `${theme.icons.selected} ` : '  '
  const badge = item.icon ? `${item.icon} ` : ''
  const used = marker.length + badge.length + item.label.length + hint.length
  const gap = Math.max(1, inner - used)

  return (
    <FloatRow theme={theme} layout={layout} background={selected ? theme.selection : undefined}>
      <Text color={selected ? theme.accent : theme.subtle}>{marker}</Text>
      {badge ? <Text color={item.color || theme.dim}>{badge}</Text> : ''}
      {parts.map((part, i) => (
        <Text
          key={i}
          bold={part.match || selected}
          color={part.match ? theme.accent2 : (item.color || (selected ? theme.fg : undefined))}
        >
          {part.text}
        </Text>
      ))}
      <Text>{' '.repeat(gap)}</Text>
      <Text color={theme.dim}>{hint}</Text>
    </FloatRow>
  )
}

/** A picker for one free-text answer — `/new <name>`, an invite string. */
export function Prompt ({ theme, terminal, title, icon, placeholder, help, onSubmit, onCancel }) {
  const [value, setValue] = useState('')
  const layout = useMemo(() => floatLayout(terminal, { items: 1, minRows: 7, maxRows: 7 }), [terminal])

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) return onCancel()
    if (key.return) return value.trim() ? onSubmit(value.trim()) : onCancel()
    if (key.backspace || key.delete) return setValue((v) => v.slice(0, -1))
    if (key.ctrl && input === 'u') return setValue('')
    if (key.ctrl && input === 'w') return setValue((v) => v.replace(/\s*\S+\s*$/, ''))
    if (key.ctrl || key.meta || key.tab) return
    // eslint-disable-next-line no-control-regex
    if (input && !/^[\u0000-\u001f\u007f]+$/.test(input)) setValue((v) => v + input)
  })

  useMouseCapture(true)

  return (
    <Float
      theme={theme}
      layout={layout}
      title={title}
      icon={icon}
      footer={[{ keys: '⏎', label: 'confirm' }, { keys: 'esc', label: 'cancel' }]}
    >
      <FloatRow theme={theme} layout={layout}>
        <Text color={theme.accent}>{theme.icons.selected} </Text>
        <Text>{value}</Text>
        <Text color={theme.accent} inverse={value.length === 0}>{value ? '▌' : ' '}</Text>
        {value === '' ? <Text color={theme.subtle}>{placeholder}</Text> : ''}
      </FloatRow>

      <FloatRule theme={theme} layout={layout} />

      <FloatRow theme={theme} layout={layout}>
        <Text color={theme.dim}>{help}</Text>
      </FloatRow>

      <FloatFill theme={theme} layout={layout} rows={layout.listRows - 1} />
    </Float>
  )
}
