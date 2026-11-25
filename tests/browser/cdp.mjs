// Minimal Chrome DevTools Protocol client over --remote-debugging-pipe.
//
// Port-based remote debugging is refused in this environment, so the browser
// harness talks to Chrome over the pipe transport instead: fd 3 is written to
// Chrome, fd 4 is read from Chrome, and messages are NUL-terminated JSON.
// Responses are `{ id, result }` / `{ id, error }`; this client unwraps them.

import { spawn } from 'node:child_process'

export function launchChrome (chromePath, args, options = {}) {
  return spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-pipe',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    ...args
  ], {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    ...options
  })
}

export function connectCdp (proc) {
  const writeStream = proc.stdio[3]
  const readStream = proc.stdio[4]

  if (!writeStream || !readStream) {
    throw new Error('Chrome was not started with the pipe transport')
  }

  let nextId = 0
  const pending = new Map()
  const listeners = []
  let buffer = ''

  readStream.on('data', chunk => {
    buffer += chunk.toString('utf8')

    let index = buffer.indexOf('\u0000')
    while (index !== -1) {
      const raw = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      index = buffer.indexOf('\u0000')

      if (!raw) {
        continue
      }

      let message
      try {
        message = JSON.parse(raw)
      } catch (e) {
        continue
      }

      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) {
          reject(new Error(`${message.error.message} (${message.error.code})`))
        } else {
          resolve(message.result)
        }
      } else if (message.method) {
        listeners.forEach(listener => listener(message))
      }
    }
  })

  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    const payload = { id, method, params }
    if (sessionId) {
      payload.sessionId = sessionId
    }
    writeStream.write(JSON.stringify(payload) + '\u0000')

    const timeout = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`CDP timeout for ${method}`))
      }
    }, 30000)
    timeout.unref()
  })

  const onEvent = listener => listeners.push(listener)

  return {
    send,
    onEvent,
    close: () => {
      try {
        writeStream.end()
      } catch (e) {
        // Already closed.
      }
    }
  }
}

export async function findPageTarget (cdp) {
  const { targetInfos } = await cdp.send('Target.getTargets')
  return targetInfos.find(target => target.type === 'page' && !target.url.startsWith('chrome://'))
}

export async function attachToPage (cdp, targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  return sessionId
}

export function createEvaluator (cdp, sessionId) {
  return async expression => {
    const response = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    }, sessionId)

    if (response.exceptionDetails) {
      throw new Error('Page exception: ' + (response.exceptionDetails.text || JSON.stringify(response.exceptionDetails)))
    }

    return response.result ? response.result.value : undefined
  }
}
