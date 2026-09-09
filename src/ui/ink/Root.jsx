// Decides whether you see onboarding or the chat, owns the client so the app
// below never has to think about a half-configured account, and is the only
// thing that can swap one account for another.
//
// Switching accounts is a real teardown: the swarm closes, the cores close, and
// a new client comes up against a different keypair. Nothing is carried across
// — which is the point. Two accounts on one machine should have no more in
// common than two accounts on two machines.

import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { Box, Text } from 'ink'

import { Onboarding } from './Onboarding.jsx'
import { App } from './App.jsx'
import { createTheme } from './theme.js'
import { read as readSettings } from '../model/settings.js'
import { Client } from '../../core/client.js'
import { Identity, saveIdentity, loadIdentity, hasIdentity } from '../../core/identity.js'
import { readConfig, writeConfig, setCurrentProfile, profileDir, sanitizeProfile } from '../../core/store.js'
import { createAccount, suggestProfile } from '../../core/accounts.js'
import { onShutdown } from '../../core/shutdown.js'
import { SEED_BYTES } from '../../protocol/constants.js'
import backend from '../../core/crypto-node.js'

export function Root ({ profile: initialProfile, dir: initialDir, needsOnboarding, bootstrap, host, version }) {
  const [profile, setProfile] = useState(initialProfile)
  const [dir, setDir] = useState(initialDir)
  const [phase, setPhase] = useState(needsOnboarding ? 'onboarding' : 'starting')
  const [pending, setPending] = useState(null)
  const [error, setError] = useState(null)
  const [client, setClient] = useState(null)
  const [settings, setSettings] = useState({})

  const theme = useMemo(() => createTheme(settings), [settings])

  const start = useCallback(async () => {
    const next = new Client({ dir, profile, bootstrap, host })
    await next.ready()
    await next.restore()
    await setCurrentProfile(profile).catch(() => {})
    setSettings(readSettings(next.config))
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
    const release = onShutdown(() => client.close())
    return () => {
      release()
      client.close().catch(() => {})
    }
  }, [client])

  const onDone = useCallback(async ({ nick }) => {
    try {
      setError(null)

      const identity = new Identity({ seed: backend.randomBytes(SEED_BYTES), nick })
      await saveIdentity(identity, dir)

      const config = await readConfig(dir)
      config.nick = nick
      config.onboarded = true
      await writeConfig(config, dir)

      // Show the phrase before going any further — it is the only copy.
      setPending({ phrase: identity.mnemonic, publicKey: identity.publicKeyHex })
    } catch (err) {
      setError(err.message)
    }
  }, [dir])

  const onAcknowledge = useCallback(() => {
    setPending(null)
    setPhase('starting')
  }, [])

  /** Tear this account down and bring another one up in its place. */
  const onSwitchAccount = useCallback(async (name) => {
    const target = sanitizeProfile(name)
    if (target === profile) return

    setPhase('switching')
    try {
      if (client) await client.close()
    } catch { /* a client that will not close cleanly must not block the switch */ }

    setClient(null)
    const nextDir = profileDir(target)
    setProfile(target)
    setDir(nextDir)
    setPending(null)
    setError(null)
    setPhase((await hasIdentity(nextDir)) ? 'starting' : 'onboarding')
  }, [client, profile])

  /**
   * Make an account from inside the app: generate its key, show the phrase, and
   * switch into it. The username is only a directory name — the account is the
   * keypair, and every keypair in openchat is generated where it is used.
   */
  const onCreateAccount = useCallback(async ({ profile: name, nick }) => {
    try {
      const target = sanitizeProfile(name || (await suggestProfile(nick || 'account')))
      const account = await createAccount({ profile: target, nick })

      if (client) await client.close().catch(() => {})
      setClient(null)
      setProfile(account.profile)
      setDir(account.dir)
      setError(null)

      setPending({ phrase: account.mnemonic, publicKey: account.publicKey })
      setPhase('onboarding')
    } catch (err) {
      setError(err.message)
      setPhase(client ? 'ready' : 'onboarding')
    }
  }, [client])

  if (phase === 'onboarding') {
    return (
      <Onboarding
        theme={theme}
        profile={profile}
        onDone={onDone}
        onAcknowledge={onAcknowledge}
        pending={pending}
        error={error}
      />
    )
  }

  if (phase === 'failed') {
    // Multi-line on purpose: the failures worth explaining — an account already
    // open in another terminal, most of all — need a sentence about what to do,
    // not just a sentence about what went wrong.
    const [first, ...rest] = String(error).split('\n')

    return (
      <Box flexDirection='column' paddingX={2} paddingY={1}>
        <Text color={theme.red}>{theme.icons.error} openchat could not start</Text>
        <Box marginTop={1} flexDirection='column'>
          <Text color={theme.fg}>{first}</Text>
          {rest.map((line, i) => (
            <Text key={i} color={line.startsWith('openchat ') ? theme.accent : theme.dim}>{line}</Text>
          ))}
        </Box>
      </Box>
    )
  }

  if (phase !== 'ready' || !client) {
    return (
      <Box paddingX={1}>
        <Text color={theme.dim}>
          <Text color={theme.accent}>{theme.icons.welcome} </Text>
          {phase === 'switching' ? `switching to ${profile}…` : `opening ${profile}…`}
        </Text>
      </Box>
    )
  }

  return (
    <App
      key={client.dir}
      client={client}
      profile={profile}
      version={version}
      onSwitchAccount={onSwitchAccount}
      onCreateAccount={onCreateAccount}
    />
  )
}

export { loadIdentity }
