import React from 'react'
import { Box, Text } from 'ink'

import { colorForAuthor, displayName, shortKey } from '../model/format.js'

const STATUS_MARK = { online: '●', typing: '◐', offline: '○' }

export function Sidebar ({ rooms, activeKey, members, self }) {
  return (
    <Box flexDirection="column" width={24} flexShrink={0} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold dimColor>ROOMS</Text>
      {rooms.length === 0 && <Text dimColor>(none)</Text>}
      {rooms.map((room) => {
        const active = room.key === activeKey
        return (
          <Text key={room.key} color={active ? 'cyan' : undefined}>
            {active ? '▸ ' : '  '}
            {room.name || shortKey(room.key)}
            {room.unread > 0 ? ` (${room.unread})` : ''}
          </Text>
        )
      })}

      <Box marginTop={1}><Text bold dimColor>MEMBERS</Text></Box>
      {members.length === 0 && <Text dimColor>(just you)</Text>}
      {members.map((member) => (
        <Text key={member.publicKey}>
          <Text color={member.status === 'online' ? 'green' : 'gray'}>
            {STATUS_MARK[member.status] || '○'}{' '}
          </Text>
          <Text color={colorForAuthor(member.publicKey)}>
            {displayName(member, member.publicKey)}
          </Text>
          {member.publicKey === self?.publicKey && <Text dimColor> (you)</Text>}
        </Text>
      ))}
    </Box>
  )
}
