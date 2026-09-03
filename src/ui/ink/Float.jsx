// The chrome every floating window shares: a titled frame, a rule under the
// prompt, and a row of key hints along the bottom.
//
// It is drawn by hand rather than with a bordered <Box> for one reason that
// matters and one that does not. The one that matters: the app has to know the
// exact screen row of every line inside the frame so a mouse click can be
// mapped back to it, and that is only true if the frame's height is decided
// here rather than by a layout pass. The one that does not: a title and a
// counter set into the top border is what Telescope looks like, and no border
// style gives you that.

import React from 'react'
import { Box, Text } from 'ink'

/**
 * @param {object} props
 * @param {object} props.theme
 * @param {object} props.layout    from ui/model/layout.js
 * @param {string} props.title
 * @param {string} [props.icon]
 * @param {string} [props.count]   set into the top border on the right
 * @param {{ keys: string, label: string }[]} [props.footer]
 * @param {React.ReactNode} props.children  exactly layout.height - 2 rows
 */
export function Float ({ theme, layout, title, icon, count, footer = [], focused = true, children }) {
  const edge = focused ? theme.borderFocus : theme.border
  const inner = layout.width - 2

  // The top border is measured rather than guessed: the title, the optional
  // icon and the counter all vary in width, and a rule one character out turns
  // the whole frame into a wrapped mess. Lay out everything that is not the
  // rule, then make the rule whatever is left over.
  const head = `${icon ? `${icon} ` : ''}${title}`
  const tail = count ? visibleWidth(count) + 2 : 0
  const fill = Math.max(0, layout.width - 5 - visibleWidth(head) - tail)

  return (
    <Box flexDirection='column' width={layout.width} marginLeft={layout.left - 1} flexShrink={0}>
      <Text color={edge}>
        <Text>{'\u256d\u2500'}</Text>
        <Text color={theme.accent2} bold>{head}</Text>
        <Text>{` ${rule(fill)}`}</Text>
        {count ? <Text>{' '}<Text color={theme.dim}>{count}</Text>{' '}</Text> : null}
        <Text>{'\u2500\u256e'}</Text>
      </Text>

      {children}

      <Box width={layout.width}>
        <Text color={edge}>{'│ '}</Text>
        <Box width={inner - 2} overflow='hidden'>
          <Text wrap='truncate-end'>
            {footer.map((hint, i) => (
              <Text key={hint.keys}>
                {i > 0 ? <Text color={theme.subtle}> {theme.icons.sep} </Text> : ''}
                <Text color={theme.accent}>{hint.keys}</Text>
                <Text color={theme.dim}> {hint.label}</Text>
              </Text>
            ))}
          </Text>
        </Box>
        <Text color={edge}>{' │'}</Text>
      </Box>

      <Text color={edge}>{`╰${rule(inner)}╯`}</Text>
    </Box>
  )
}

/** One content row inside the frame, with the side borders drawn for you. */
export function FloatRow ({ theme, layout, children, focused = true, background }) {
  const edge = focused ? theme.borderFocus : theme.border

  return (
    <Box width={layout.width}>
      <Text color={edge}>│</Text>
      <Box width={layout.width - 2} paddingX={1} overflow='hidden'>
        <Text wrap='truncate-end' backgroundColor={background}>{children}</Text>
      </Box>
      <Text color={edge}>│</Text>
    </Box>
  )
}

/** The horizontal rule that separates the prompt from the results. */
export function FloatRule ({ theme, layout, focused = true }) {
  const edge = focused ? theme.borderFocus : theme.border
  return <Text color={edge}>{`├${rule(layout.width - 2)}┤`}</Text>
}

/** Filler rows, so a short list still leaves the frame its declared height. */
export function FloatFill ({ theme, layout, rows, focused = true }) {
  if (rows <= 0) return null
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <FloatRow key={`fill-${i}`} theme={theme} layout={layout} focused={focused}>{' '}</FloatRow>
      ))}
    </>
  )
}

function rule (n) {
  return '─'.repeat(Math.max(0, n))
}

// Close enough for the box drawing: the strings in a title are short, and the
// only wide characters that turn up are the optional Nerd Font glyphs, which
// terminals render in two cells.
function visibleWidth (text) {
  let width = 0
  for (const ch of String(text ?? '')) {
    const code = ch.codePointAt(0)
    width += (code >= 0xe000 && code <= 0xf8ff) || code >= 0x1f300 ? 2 : 1
  }
  return width
}
