// Headless-Chrome driver for tests/browser/index.html.
//
// Serves the repository over a local static HTTP server (127.0.0.1 only),
// launches one Chrome instance with a fresh profile, reads the results the
// page publishes on window.__results, then kills only that Chrome process.
//
// Chrome is driven over --remote-debugging-pipe (see cdp.mjs); port-based
// remote debugging is unavailable in this environment.
//
// Usage: node tests/browser/driver.mjs

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChrome, connectCdp, findPageTarget, attachToPage, createEvaluator } from './cdp.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..', '..')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
}

function startServer () {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0])
    const filePath = path.join(repo, urlPath)

    if (!filePath.startsWith(repo) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404).end('not found')
      return
    }

    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    })
    fs.createReadStream(filePath).pipe(res)
  })

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

function findChrome () {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH
  }

  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ]
  return candidates.find(candidate => fs.existsSync(candidate))
}

async function main () {
  const chromePath = findChrome()
  if (!chromePath) {
    console.error('No Chrome/Edge installation found; skipping browser verification.')
    process.exit(2)
  }

  const { server, port: httpPort } = await startServer()
  const profileDir = path.join(repo, '..', 'temp', 'browser-profile-' + process.pid)
  fs.rmSync(profileDir, { recursive: true, force: true })
  fs.mkdirSync(profileDir, { recursive: true })

  // Open the test page directly so it is the page target Chrome creates.
  const chrome = launchChrome(chromePath, [
    `--user-data-dir=${profileDir}`,
    `http://127.0.0.1:${httpPort}/tests/browser/index.html`
  ])

  let exitCode = 1
  try {
    const cdp = connectCdp(chrome)

    let target = null
    for (let i = 0; i < 120; i++) {
      try {
        target = await findPageTarget(cdp)
        if (target && target.url.includes('tests/browser')) {
          break
        }
      } catch (e) {
        // Chrome is still starting.
      }
      await sleep(250)
    }

    if (!target) {
      throw new Error('Chrome never exposed the test page over CDP')
    }

    const sessionId = await attachToPage(cdp, target.targetId)
    const evaluate = createEvaluator(cdp, sessionId)

    const pageLog = []
    cdp.onEvent(message => {
      if (message.sessionId !== sessionId) {
        return
      }
      if (message.method === 'Runtime.consoleAPICalled') {
        const text = (message.params.args || [])
          .map(arg => (arg.value !== undefined ? String(arg.value) : arg.description))
          .join(' ')
        pageLog.push(`[console.${message.params.type}] ${text}`)
      } else if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails
        pageLog.push('[exception] ' + (details.exception ? details.exception.description : details.text))
      }
    })

    await cdp.send('Runtime.enable', {}, sessionId).catch(() => {})

    let done = false
    let payload = '[]'
    for (let i = 0; i < 240; i++) {
      done = await evaluate('Boolean(window.__done)').catch(() => false)
      payload = await evaluate('JSON.stringify(window.__results || [])').catch(() => '[]')
      if (done) {
        break
      }
      await sleep(250)
    }

    const results = JSON.parse(payload || '[]')
    const pageMessages = await evaluate('JSON.stringify(window.__log || [])').catch(() => '[]')

    if (!done || results.length === 0) {
      console.error(done ? 'Browser harness produced no results' : 'Browser harness did not finish in time')
      for (const line of JSON.parse(pageMessages || '[]')) {
        console.error(line)
      }
      for (const line of pageLog) {
        console.error(line)
      }
      exitCode = 1
    } else {
      for (const result of results) {
        console.log(`${result.ok ? 'ok  ' : 'FAIL'} - ${result.name}${result.ok || !result.detail ? '' : ' :: ' + result.detail}`)
      }
      for (const line of JSON.parse(pageMessages || '[]')) {
        console.error(line)
      }
      const failed = results.filter(result => !result.ok)
      if (failed.length > 0) {
        console.error(`\n${failed.length} of ${results.length} browser checks failed`)
        exitCode = 1
      } else {
        console.log(`\n${results.length} browser checks passed (real Tone.js + MediaRecorder)`)
        exitCode = 0
      }
    }

    cdp.close()
  } finally {
    // Kill only the Chrome process started above.
    try {
      if (chrome.exitCode === null) {
        chrome.kill()
      }
    } catch (e) {
      // Already gone.
    }
    server.close()
    await sleep(400)
    fs.rmSync(profileDir, { recursive: true, force: true })
  }

  process.exit(exitCode)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
