# TRAX 磁带皮肤背景循环 —— 参考实现

本目录是磁带皮肤 `skin.json` 引擎的一份**零依赖参考实现**，修复"背景循环只按墙钟推进"的问题：循环相位完全由**当前播放位置**推导，暂停、切歌、拖动进度条、换肤四种操作在下一帧立即正确，不需要任何纠正步骤。

> 上游 `traxpsp/traxpsp` 仓库只发布文档（应用本体闭源，见 README 末尾 "The source is not published"），
> 因此这里以可运行、可测试的 Node.js 模块形式给出完整引擎逻辑，严格按 `SKINS.html` 描述的格式与行为实现，
> 可直接逐函数移植到 PSP/Vita 的 C 渲染代码中。

## 背景循环的计时模型（核心改动）

旧实现持有一个墙钟累加器，渲染时用"经过的真实时间"求相位，于是：

- 暂停后真实时间还在走 → 颜色继续变；
- 切歌不动这个累加器 → 新曲不从头开始；
- 拖动进度条只改播放位置、不改累加器 → 颜色要等下一次自然推进才碰巧对上。

新实现**不持有任何时间状态**。每一帧都回答同一个纯函数问题：

```
背景色 = f(皮肤配置, 当前播放状态)
播放状态 = { status: playing | paused | stopped, positionSeconds }
```

### 相位公式

```
phase      = positionSeconds / seconds        // seconds 默认 6，范围 1–3600
segment    = floor(phase)                     // 第几段（颜色 i → 颜色 i+1）
t          = phase - segment                  // 段内进度 0..1
fade 模式  = 在 colors[segment mod n] 与 colors[(segment+1) mod n] 间按 t 线性插值
step 模式  = 直接取 colors[segment mod n]
```

播放位置天然满足全部生命周期要求，无需任何事件回调去"重置/纠正"相位：

| 操作 | 播放位置发生什么 | 背景的结果 |
|---|---|---|
| 暂停 | `positionSeconds` 冻结 | `while=playing` 直接回首色；`while=always` 在同一位置求值，颜色保持不变 |
| 停止 | 位置归零、状态 stopped | `playing` 回首色；`always` 保持在位置 0 对应的首色 |
| 切歌 | 新曲 `play()` 把位置置 0 | 相位自然归零，从首色开始 |
| 拖动进度条 | `seek()` 立刻改写位置 | 下一帧即按新位置求值，立即跳到对应颜色，可前可后 |
| 换肤 | 重新读盘得到新配置；相位不存在皮肤上 | 新皮肤用**当前播放位置**现算，而不是从 0 开始 |

`while` 语义：

- `playing`（默认）：状态不是 `playing` 时一律返回 `colors[0]`；
- `always`：暂停/停止时在冻结的位置上继续求值，于是"保留已到达的颜色"，且不会随墙钟继续走。

## 模块结构

```
src/
  color.js       #RRGGBB 严格解析、非法色判定、线性插值与格式化
  skin.js        skin.json 解析：容错、默认值、上限截断（32KB/8 区/4 行/6 片段/47 字节/6 色）
  background.js  纯函数背景求值：相位公式、fade/step、while=playing/always
  player.js      播放状态机：位置只在 playing 时推进，play/pause/resume/stop/seek/tick
  label.js       文字区域：字段拼接、缺字段省略分隔符、字号三次 12% 收缩与 "..." 截断
  deck.js        SkinLibrary（每次选择都重读 skin.json）+ 逐帧 renderDeckFrame
  index.js       统一导出
test/            node:test 自动化测试，56 个用例，覆盖验收点 A1–A7
demo/            本地样例（见下）
```

## 解析与容错规则（与 SKINS.html 一致）

- `background` 接受单色字符串或对象；对象键：`colors`（最多 6）、`seconds`（1–3600，默认 6）、
  `blend`（`fade`/`step`，默认 `fade`）、`while`（`playing`/`always`，默认 `playing`）。
- 颜色只接受精确的 `#RRGGBB`；`#FFF`、颜色名、透明度等一律忽略，等同于该项不存在。
- 全部颜色非法 → 没有可用颜色 → 黑色平面背景。
- 非法 JSON（或 JSON 合法但不是对象）→ 皮肤照常加载，但无文字区域、背景为黑。
- 未知键忽略；每个上限按"读到上限为止、其余丢弃"处理，而不是拒绝整个文件。
- 文字区域、字段拼接、缺字段省略、字号收缩与截断逻辑独立于背景，本次未改变其行为。

## 本地验证

```bash
npm test          # 56 个自动化测试（node 内置 test runner，无第三方依赖）
npm run demo      # 脚本化演示：暂停/切歌/拖动/换肤/容错，逐行打印颜色
npm run serve     # http://127.0.0.1:8123/ 浏览器交互页：可暂停、可拖动、可换肤
```

`demo/SKINS/` 下准备了六个皮肤：三色 fade（playing）、四色 fade（always）、六色 step、
单色平面、全非法颜色、损坏 JSON，对应文档中的各种形态。

### 验收点对照

| 验收点 | 覆盖位置 |
|---|---|
| A1 fade 随播放位置在相邻色间插值 | `test/background.test.js`、`test/lifecycle.test.js` |
| A2 暂停/停止时 while=playing 回首色，always 保持 | `test/background.test.js`、`test/player.test.js` |
| A3 切歌相位归零 | `test/player.test.js`、`test/lifecycle.test.js` |
| A4 拖动后相位立即对应新位置 | `test/background.test.js`、`test/player.test.js` |
| A5 换肤重读 skin.json 且相位从当前位置续接 | `test/deck.test.js`、`test/lifecycle.test.js` |
| A6 非法颜色忽略、非法 JSON 黑底无文字 | `test/skin.test.js`、`test/deck.test.js` |
| A7 文字区域/拼接/省略/收缩截断行为不变 | `test/label.test.js`、`test/skin.test.js` |

## 移植到 C 渲染端的要点

1. 删掉背景模块里的墙钟累加器/相位缓存；每帧从播放器已有的播放位置（进度条同一个值）计算相位。
2. 切歌（加载新曲）处把位置置 0 —— 引擎通常已有此状态，背景不再需要单独的 reset 钩子。
3. 暂停/停止分支按 `while` 二选一：首色，或在冻结位置上求值。
4. 换肤处理函数每次都重新解析 `skin.json`，且不要把相位存进皮肤对象；相位只来自播放位置。
5. 颜色插值用整数或定点运算即可（PSP 上避免浮点），公式与 `src/background.js` 完全相同。
