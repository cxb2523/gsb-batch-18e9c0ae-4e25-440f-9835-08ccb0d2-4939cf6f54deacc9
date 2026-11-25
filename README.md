# u2web

多源多线程下载的 P2P 视频分享站点。Vue 3 (`<script setup>`) + TypeScript + Tailwind CSS 4 + Vite,
播放引擎为 [fastloadjs](https://github.com/suconghou/fastloadjs)(MSE DASH + WebRTC P2P)。

DEMO https://u2web.pages.dev/

## 快速开始

```bash
pnpm install        # 或 npm install
pnpm dev            # 本地开发 http://localhost:5173
pnpm build          # 类型检查 + 生产构建 (dist/)
pnpm typecheck      # 仅 vue-tsc 类型检查
pnpm test           # vitest:假 fastloadjs 加载器验证统计面板生命周期
pnpm verify:stat    # 零依赖 node 脚本:正常/连续切换/卸载 + 音轨识别
```

### 统计面板联动验证

切换清晰度或视频 id 会重建播放引擎,`StatPanel` 通过 `loadersready` 拿到新一代
`loadItems/loaders/dispatchs`,由 `src/components/player/statSession.ts` 统一处理:

- 重建代次守卫:连续快速切换时只有最后一代加载器的回调能写入,旧代回调直接丢弃;
- 监听生命周期:绑定的每个事件都登记解绑,重建(`@init`/新 `loadersready`)与面板
  `onBeforeUnmount` 时调用加载器的 `remove(event, cb)`(兼容 `off/unlisten/removeListener`
  及 `listen` 返回退订函数);没有解绑方法的假加载器由代次守卫兜底;
- 视频/音频分轨:按 `LoadItem.mimeCodec` 与同序下标识别,音频模式单加载器归音频卡。

`tests/` 下用假的 fastloadjs 加载器对象覆盖正常切换、连续切换、卸载、音频错绑,
以及 PlayView 转发链路和 VPlayer 旧引擎迟到 `ready` 的作废。


## 部署

站点部署在 Cloudflare Pages(https://u2web.pages.dev/),Pages 项目绑定部署仓库
[suconghou/ustream-pages](https://github.com/suconghou/ustream-pages) 的 `master` 分支。

推送到 `master`/`main`(或手动触发 "Build and publish")时,GitHub Actions 自动构建并把 `dist/`
同步到部署仓库,由 Pages 完成发布。同步只覆盖构建产物,部署仓库中的 `functions/` 与 `README.MD`
会被保留,上一轮残留的指纹文件由 `rsync --delete` 清理。

需在仓库 Settings → Secrets 配置 `PAGES_TOKEN`(对 `suconghou/ustream-pages` 有写权限的 PAT),
否则发布步骤跳过,仅做构建校验。

部署到其他静态服务时,用 `VITE_BASE` 指定资源根地址:

```bash
VITE_BASE='https://assets.suconghou.cn/u2web/static/dist/' pnpm build
```

## 后端配置

默认后端地址在 `src/service/index.ts`,均可在站点"设置"页覆盖(存于 localStorage):

| 键 | 作用 | 说明 |
| --- | --- | --- |
| `apibaseurl` | 内容 API | 如 `https://your-api.example.com/video/api/v3` |
| `baseurl` | 视频解析服务 | 多源用 `;` 隔开,支持相对路径(同源部署) |
| `ws` | 信令服务器 | 留空则不启用 P2P |

多源示例:`/video;https://stream.pull.workers.dev/video` —— 当前域名与 cf workers 两个地址负载
均衡,首个地址权重更高,不可用后自动重试其他地址。

可用的后端项目:[videoproxy](https://github.com/suconghou/videoproxy)(Go 全功能)、
[u2proxyapi](https://github.com/suconghou/u2proxyapi)(Python)、
[u2worker](https://github.com/suconghou/u2worker)(cf workers 中转)、
[netlifyworker](https://github.com/suconghou/netlifyworker)(netlify 中转)、
[signalserver](https://github.com/suconghou/signalserver)(信令)。

后端部署在本机且希望走同源代理(免 CORS)时,取消 `vite.config.ts` 中 `server.proxy` 的注释并
把 `target` 指向实际地址。

## P2P

默认关闭,填写信令服务器后启用。同一信令服务器下,且播放同一资源(Chrome/Firefox 用 webm、
Safari 用 mp4)、同一清晰度时才相互分享;`level` 参数控制清晰度分组,分组越小越容易聚合。

## 嵌入播放页

独立的嵌入页 `/play`,通过 URL 参数配置,适合 iframe 引用:

```html
<iframe src="https://your-domain/play?v=视频ID&audio=false&level=0&nop2p=false&screenshot=true&playlist=播放列表ID"></iframe>
```

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `v` | 必填 | 视频 ID |
| `audio` | `false` | 音频模式(带播放列表面板) |
| `level` | `0` | 清晰度分组 `1`/`2`/`3` |
| `nop2p` | `false` | 关闭 P2P |
| `screenshot` | `true` | 截图按钮(快捷键 `s`,Safari 不支持 MSE 截图已屏蔽) |
| `playlist` | 空 | 播放列表 ID,`audio` 模式下自动连播 |

## 浏览器支持

播放依赖 MSE,需现代浏览器(Chrome/Firefox/Edge/Safari 桌面版;iOS 移动端 Safari 不支持,
iPadOS 13+ 支持)。

本项目仅作为学习使用,切勿用作其他用途。

更多说明可参考 https://blog.suconghou.cn/post/mse-p2p-player/
