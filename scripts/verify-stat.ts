/**
 * 零依赖本地验证:用假的 fastloadjs 加载器对象验证统计绑定生命周期。
 *
 * 运行:
 *   node scripts/verify-stat.ts
 * (Node >= 22.18 / 23+ 可直接执行 TS;也可用 `pnpm test` 跑完整组件测试)
 *
 * 覆盖:正常切换、连续快速切换、面板卸载,以及音频轨识别。
 */
import assert from 'node:assert/strict'
import { StatSession, resolveTrackIndexes } from '../src/components/player/statSession.ts'

type Cb = (...args: any[]) => void

interface FakeLoader {
  listen(ev: string, cb: Cb): unknown
  remove(ev?: string, cb?: Cb): unknown
  emit(ev: string, ...args: unknown[]): void
  removedEvents: string[]
}

/** 行为对齐 public/fastload.min.js 的事件表 + remove(event, cb) */
function fakeLoader(): FakeLoader {
  const map: Record<string, Cb[]> = {}
  const l: FakeLoader = {
    removedEvents: [],
    listen(ev, cb) {
      ;(map[ev] ??= []).push(cb)
      return l
    },
    remove(ev, cb) {
      if (ev) l.removedEvents.push(ev)
      if (ev && cb && map[ev]) {
        const i = map[ev].indexOf(cb)
        if (i >= 0) map[ev].splice(i, 1)
      }
      return l
    },
    emit(ev, ...args) {
      for (const cb of [...(map[ev] ?? [])]) cb(...args)
    },
  }
  return l
}

/** 只有 listen、没有任何解绑方法的极简假加载器,专测代次守卫 */
function bareLoader() {
  const map: Record<string, Cb[]> = {}
  return {
    listen(ev: string, cb: Cb) {
      ;(map[ev] ??= []).push(cb)
    },
    emit(ev: string, ...args: unknown[]) {
      for (const cb of [...(map[ev] ?? [])]) cb(...args)
    },
  }
}

function spySink() {
  const calls = { stat: 0, video: 0, audio: 0 }
  return {
    calls,
    rtcStat() {
      calls.stat++
    },
    cardEvent(kind: 'video' | 'audio') {
      calls[kind]++
    },
  }
}

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

async function main() {
  console.log('track classification:')
  await check('视频双轨 [video,audio] 正确归位', () => {
    assert.deepEqual(
      resolveTrackIndexes(
        [{ mimeCodec: 'video/mp4' }, { mimeCodec: 'audio/mp4' }],
        2,
        false,
      ),
      { video: 0, audio: 1 },
    )
  })
  await check('音频模式单加载器归音频卡(不错绑视频卡)', () => {
    assert.deepEqual(resolveTrackIndexes([{ mimeCodec: 'audio/webm' }], 1, true), { audio: 0 })
    assert.deepEqual(resolveTrackIndexes([{}], 1, true), { audio: 0 })
  })

  console.log('normal switch:')
  await check('新一代只接收新加载器事件,旧加载器被 remove 解绑', () => {
    const session = new StatSession()
    const sink = spySink()
    const oldL = fakeLoader()
    const newL = fakeLoader()

    session.restart()
    session.bind(oldL as never, 'video', sink)
    oldL.emit('http.start', { no: 1 })
    assert.equal(sink.calls.video, 1)

    session.restart()
    session.bind(newL as never, 'video', sink)
    assert.ok(oldL.removedEvents.includes('http.start'))
    assert.ok(oldL.removedEvents.includes('rtc.stat'))

    oldL.emit('http.start', { no: 2 })
    assert.equal(sink.calls.video, 1, '旧加载器事件不得再写入')

    newL.emit('http.start', { no: 3 })
    assert.equal(sink.calls.video, 2)
  })

  console.log('rapid switches:')
  await check('连续三次切换(无 remove 的假加载器),仅最后一代可写', () => {
    const session = new StatSession()
    const sink = spySink()
    const gens = [bareLoader(), bareLoader(), bareLoader()]
    for (const g of gens) {
      session.restart()
      session.bind(g as never, 'video', sink)
    }
    gens[0].emit('http.start')
    gens[1].emit('rtc.done')
    gens[0].emit('rtc.stat')
    gens[1].emit('http.done')
    assert.deepEqual(sink.calls, { stat: 0, video: 0, audio: 0 })

    gens[2].emit('rtc.stat')
    gens[2].emit('http.start')
    assert.equal(sink.calls.stat, 1)
    assert.equal(sink.calls.video, 1)
  })

  console.log('unmount:')
  await check('dispose 调用 remove 且之后事件不再写入、不抛错', () => {
    const session = new StatSession()
    const sink = spySink()
    const l = fakeLoader()
    session.restart()
    session.bind(l as never, 'audio', sink)
    session.dispose()
    assert.ok(l.removedEvents.length > 0)
    assert.doesNotThrow(() => {
      l.emit('http.start')
      l.emit('rtc.stat')
    })
    assert.equal(sink.calls.audio, 0)
    assert.equal(sink.calls.stat, 0)
  })

  await check('无 remove 方法时 dispose 守卫同样拦截残留回调', () => {
    const session = new StatSession()
    const sink = spySink()
    const l = bareLoader()
    session.restart()
    session.bind(l as never, 'audio', sink)
    session.dispose()
    assert.doesNotThrow(() => l.emit('rtc.progress'))
    assert.equal(sink.calls.audio, 0)
  })

  console.log(`\nall ${passed} checks passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
