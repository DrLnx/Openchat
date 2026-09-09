// The account switcher.
//
// An account is a username and a keypair in a directory. Nothing is shared
// between two of them — not the rooms, not the contacts, not the settings — so
// switching is a genuine change of identity rather than a profile picker, and
// the two accounts you run in two terminals cannot be linked by anything this
// program does.
//
// That is the whole reason this window exists rather than being a shell flag:
// having a second identity should cost one keypress, or people will not bother.

import React, { useState, useMemo, useCallback, useRef } from 'react'
import { Text, useInput } from 'ink'

import { Float, FloatRow, FloatRule, FloatFill } from './Float.jsx'
import { floatLayout, hitTest, scrollTo } from '../model/layout.js'
import { useMouse, useMouseCapture } from './mouse.js'

const FOOTER = [
  { keys: '⏎', label: 'switch' },
  { keys: 'n', label: 'new' },
  { keys: 'esc', label: 'close' }
]

/**
 * @param {object} props
 * @param {import('../../core/accounts.js').Account[]} props.accounts
 * @param {(profile: string) => void} props.onSwitch
 * @param {() => void} props.onCreate
 * @param {() => void} props.onCancel
 */
export function Accounts ({ theme, screen, accounts, showKeys, onSwitch, onCreate, onCancel, backdrop }) {
  const [selected, setSelected] = useState(0)
  const [offset, setOffset] = useState(0)

  const layout = useMemo(
    () => floatLayout(screen, { items: Math.max(accounts.length, 1), maxRows: 18, width: 74 }),
    [screen, accounts.length]
  )

  const move = useCallback((step) => {
    setSelected((current) => {
      if (accounts.length === 0) return 0
      const next = (current + step + accounts.length) % accounts.length
      setOffset((at) => scrollTo(at, next, layout.listRows, accounts.length))
      return next
    })
  }, [accounts.length, layout.listRows])

  const take = useCallback((index = selected) => {
    const account = accounts[index]
    if (!account) return
    if (account.current) return onCancel()
    onSwitch(account.profile)
  }, [accounts, selected, onSwitch, onCancel])

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c') || input === 'q') return onCancel()
    if (key.return) return take()
    if (key.downArrow || input === 'j') return move(1)
    if (key.upArrow || input === 'k') return move(-1)
    if (input === 'n') return onCreate()
  })

  useMouseCapture(true)

  const state = useRef({ layout, offset, count: accounts.length })
  state.current = { layout, offset, count: accounts.length }

  const onMouse = useCallback((event) => {
    const { layout: geometry, offset: at, count } = state.current
    if (event.type === 'wheel') return move(event.direction)
    if (event.type !== 'press' || event.button !== 'left') return

    const index = hitTest(geometry, event, at, count)
    if (index === null) {
      if (event.y < geometry.top || event.y > geometry.top + geometry.height) onCancel()
      return
    }
    setSelected(index)
    take(index)
  }, [move, take, onCancel])

  useMouse(onMouse)

  const visible = accounts.slice(offset, offset + layout.listRows)

  return (
    <Float
      theme={theme}
      layout={layout}
      title='Accounts'
      icon={theme.icons.account}
      count={`${accounts.length}`}
      footer={FOOTER}
      backdrop={backdrop}
    >
      <FloatRow theme={theme} layout={layout}>
        <Text color={theme.dim}>each one is its own keypair — nothing is shared between them</Text>
      </FloatRow>

      <FloatRule theme={theme} layout={layout} />

      {visible.map((account, i) => (
        <AccountRow
          key={account.profile}
          theme={theme}
          layout={layout}
          account={account}
          showKeys={showKeys}
          selected={offset + i === selected}
        />
      ))}

      <FloatFill theme={theme} layout={layout} rows={layout.listRows - visible.length} />
    </Float>
  )
}

function AccountRow ({ theme, layout, account, showKeys, selected }) {
  const inner = layout.width - 4
  const marker = selected ? `${theme.icons.selected} ` : '  '
  const name = account.profile
  const nick = account.nick || 'not set up yet'
  const key = account.publicKey
    ? (showKeys ? account.publicKey : `${account.publicKey.slice(0, 12)}…`)
    : ''

  const right = account.current
    ? 'in use'
    : `${account.rooms} ${account.rooms === 1 ? 'room' : 'rooms'}`

  const left = `${name}  ${nick}  ${key}`
  const gap = Math.max(1, inner - marker.length - 2 - left.length - right.length)

  return (
    <FloatRow theme={theme} layout={layout} background={selected ? theme.selection : undefined}>
      <Text color={selected ? theme.accent : theme.subtle}>{marker}</Text>
      <Text color={account.current ? theme.green : theme.subtle}>
        {account.current ? theme.icons.unread : theme.icons.sep}{' '}
      </Text>
      <Text bold color={selected ? theme.fg : theme.dim}>{name}</Text>
      <Text color={theme.subtle}>{'  '}</Text>
      <Text color={account.ready ? theme.accent2 : theme.yellow}>{nick}</Text>
      <Text color={theme.subtle}>{'  '}{key}</Text>
      <Text>{' '.repeat(gap)}</Text>
      <Text color={account.current ? theme.green : theme.subtle}>{right}</Text>
    </FloatRow>
  )
}
