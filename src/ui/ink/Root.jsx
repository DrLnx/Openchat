// Decides whether you see onboarding or the chat, and owns the client so the
// app below never has to think about a half-configured profile.

import React, { useState, useCallback, useEffect } from 'react'
import { Box, Text } from 'ink'

import { Onboarding } from './Onboarding.jsx'
import { App } from './App.jsx'
import { Client } from '../../core/client.js'
import { Identity, saveIdentity, restoreFromMnemonic, loadIdentity } from '../../core/identity.js'
import { readConfig, writeConfig, setCurrentProfile } from '../../core/store.js'
import { SEED_BYTES } from '../../protocol/constants.js'
import backend from '../../core/crypto-node.js'

export function Root ({ profile, dir, needsOnboarding, bootstrap, host }) {
  const [phase, setPhase] = useState(needsOnboarding ? 'onboarding' : 'starting')
  const [pending, setPending] = useState(null)
  const [error, setError] = useState(null)
  const [client, setClient] = useState(null)

  const start = useCallback(async () => {
    const next = new Client({ dir, profile, bootstrap, host })
    await next.ready()
    await next.restore()
    await setCurrentProfile(profile).catch(() => {})
    setClient(next)
    setPhase('ready')
  }, [dir, profile, bootstrap, host])

  useEffect(() => {
    if (phase !== 'starting') return
    start().catch((err) => {
      setError(err.message)
      setPhase('failed')
    })
  }, [phase, start])

  // Root owns the client, so Root closes it. Without this the swarm and its
  // cores outlive the UI — the process simply never exits.
  useEffect(() => {
    if (!client) return
    return () => { client.close().catch(() => {}) }
  }, [client])

  const onDone = useCallback(async ({ mode, nick, phrase }) => {
    try {
      setError(null)

      if (mode === 'restore') {
        const identity = await restoreFromMnemonic(phrase, { dir, nick: nick || undefined })
        const config = await readConfig(dir)
        config.nick = identity.nick
        config.onboarded = true
        await writeConfig(config, dir)
        setPhase('starting')
        return
      }

      const identity = new Identity({ seed: backend.randomBytes(SEED_BYTES), nick })
      await saveIdentity(identity, dir)

      const config = await readConfig(dir)
      config.nick = nick
      config.onboarded = true
      await writeConfig(config, dir)

      // Show the phrase before going any further — it is the only copy.
      setPending({ phrase: identity.mnemonic })
    } catch (err) {
      setError(err.message)
    }
  }, [dir])

  const onAcknowledge = useCallback(() => {
    setPending(null)
    setPhase('starting')
  }, [])

  if (phase === 'onboarding') {
    return (
      <Onboarding
        profile={profile}
        onDone={onDone}
        onAcknowledge={onAcknowledge}
        pending={pending}
        error={error}
      />
    )
  }

  if (phase === 'failed') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="red">openchat could not start: {error}</Text>
      </Box>
    )
  }

  if (phase !== 'ready' || !client) {
    return <Box paddingX={1}><Text dimColor>starting…</Text></Box>
  }

  return <App client={client} profile={profile} />
}

export { loadIdentity }
