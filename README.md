# IPA Room

[English](./README.en.md)

基于 **SvelteKit + Svelte 5 + Bits UI + SCSS** 的局域网自托管 iOS 测试构建分发应用，配套 Node.js CLI。上传 Xcode 导出的 IPA，得到可分享的安装页、二维码、HTTPS IPA URL 和 `itms-services` OTA 安装链接。

## 本地运行

要求 Node.js 24+、pnpm 12。

```sh
pnpm install
cp .env.example .env
# 在 .env 中设置随机的 IPAROOM_ADMIN_TOKEN（至少 24 字符）
pnpm dev
```

运行后终端会显示本机局域网地址，例如 http://192.168.1.10:5173；在同一局域网的电脑或手机上打开它，用配置的 Token 登录。管理员会话有效期 7 天；API 使用 Bearer Token。未配置有效 Token 时，管理接口拒绝请求。HTTP 可以上传和下载。iOS OTA 需要设备可访问、证书被 iOS 信任的 HTTPS；服务可以只在局域网运行，无需对公网开放。

```sh
pnpm check
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm start
```

`pnpm dev` 和 `pnpm start` 会读取 `.env`，自动选择本机私有 IPv4（排除常见 VPN/容器接口），只监听该地址；没有内网接口时退回 127.0.0.1。默认端口分别为 5173 和 3000，可用 `PORT` 修改。多网卡时通过 `IPAROOM_LAN_HOST` 指定本机内网 IP。`IPAROOM_BASE_URL` 留空时自动生成内网分享地址，设置为固定内网域名或 HTTPS 反代地址时使用配置值。不要使用手机无法访问的 localhost 作为分享地址。

主机地址改变后请重新启动并使用新链接/二维码。直接运行 `node build` 时需自行注入 `HOST`、`ORIGIN` 和 `IPAROOM_BASE_URL`。

## CLI

### 一行启动页面

先安装携带网页服务的 CLI 包：

```sh
pnpm pack:cli
npm install -g ./dist/iparoom-cli-0.1.0.tgz
```

之后在任意目录执行：

```sh
iparoom ./MyApp.ipa
iparoom "/path/App with spaces.ipa" --notes "本周测试构建"
iparoom ./exports --no-open
```

无需提前启动服务、配置 Token 或登录。CLI 自动选择本机内网 IPv4 和空闲端口，导入 IPA，打开这个构建的安装页，并在终端显示局域网链接与二维码。目录参数需包含唯一的 IPA。命令保持前台运行，按 Ctrl+C 正常停止后关闭服务并删除临时副本；原始 IPA 不受影响。关闭后这次临时链接不可用。此模式不读取当前目录 `.env`，也不使用已保存的远程登录凭据。

默认 HTTP 提供页面与 IPA 下载。需要 iOS OTA 时传入匹配监听地址、且被测试设备信任的证书：

```sh
iparoom ./MyApp.ipa --host 192.168.1.10 --port 8443 \
  --cert ./server.crt --key ./server.key
```

`--host` 必须是本机地址；`--port` 默认 0（自动选择空闲端口）；`--no-open` 禁止自动打开浏览器；`--json` 输出启动结果且不打印终端二维码。独立包包含编译后的 SvelteKit 页面与服务代码，只需 Node.js 24+，无需安装 Xcode 来分享已导出的 IPA。CLI 尚未发布到 npm，当前使用本地 tarball 安装。

### 上传到常驻服务

已有局域网服务时，可以保留构建历史、撤销链接与管理版本：

```sh
iparoom login --server https://192.168.1.10:8443
# 交互式输入管理 Token（隐藏输入）；非交互环境用 IPAROOM_TOKEN。
iparoom upload ./exports/MyApp.ipa --notes "本周测试版本"
iparoom upload ./exports --json
iparoom list
iparoom info <build-id> --json
iparoom share <build-id> --revoke
iparoom share <build-id>  # 生成新链接，旧链接失效
iparoom delete <build-id> --yes
iparoom logout
```

仓库中可用 `pnpm cli ...`。源码链接安装需要先 `pnpm build:cli`，再执行 `cd packages/cli && npm link`。

### Xcode Archive 导出与上传

```sh
iparoom export ./MyApp.xcarchive \
  --options ./ExportOptions.plist \
  --output ./exports \
  --notes "回归测试"
```

CLI 使用参数数组调用 `xcodebuild -exportArchive`，成功后上传。输出目录若已有 IPA 会拒绝导出，请为本次构建使用新目录，防止误上传旧包。导出选项应使用项目自身或 Xcode Organizer 生成的 ExportOptions.plist；证书、账号和描述文件由本机 Xcode 管理。本服务不签名、不重签名、不采集开发者账号。

### CI

将 `IPAROOM_SERVER` 和 `IPAROOM_TOKEN` 注入流水线，使用 `iparoom upload ./exports --json`。JSON 写入 stdout，进度与 Xcode 日志写入 stderr，失败退出码为 1。Token 不放在命令参数中；本地登录配置保存在 `~/.config/iparoom/config.json`，权限为 0600。可用 `IPAROOM_CONFIG_DIR` 覆盖配置目录。CLI 不跟随重定向，避免携带认证到重定向目标。

## Agent Skill

配套 skill [`iparoom-install`](./skills/iparoom-install/SKILL.md) 指导 agent 完成 Xcode 导出、局域网临时分享/常驻上传、内网 HTTPS 与设备信任、文件完整性检查和真机结果确认。

```sh
# 安装包携带 skill；默认安装到 $CODEX_HOME/skills 或 ~/.codex/skills
iparoom skill install
# 自定义的是 skills 父目录
iparoom skill install --path /path/to/agent/skills --json
# 从源码直接安装
pnpm skill:install
```

在支持 skills 的 agent 新任务中使用：`使用 $iparoom-install 把 ./App.ipa 安装到局域网测试 iPhone，检查安装入口和实际安装结果。`

skill 启用默认自动发现，附带 Python 3 标准库校验脚本（无需 pip）：验证页面、HEAD/Range、HTTPS plist manifest 与 SHA-256。HTTP 校验不会声称 OTA 可用，网络验证不会声称真机安装完成。相同版本重复安装可直接成功；目标目录已有不同内容时保留原 skill 并提示审查，不自动覆盖本地定制。

## 局域网配置和部署

| 变量                     | 用途                                     | 默认值                     |
| ------------------------ | ---------------------------------------- | -------------------------- |
| IPAROOM_ADMIN_TOKEN      | 网页/API 管理凭据，至少 24 字符          | 必填                       |
| IPAROOM_LAN_HOST         | 本机内网 IPv4，指定监听地址；Docker 必填 | 本地启动自动检测           |
| IPAROOM_BASE_URL         | 设备能访问的内网 HTTP(S) 根地址          | 本地启动自动生成           |
| IPAROOM_DATA_DIR         | SQLite 和 IPA 文件目录                   | ./data                     |
| IPAROOM_MAX_UPLOAD_BYTES | 应用层流式上传上限                       | 1073741824（1 GiB）        |
| BODY_SIZE_LIMIT          | adapter-node 请求体上限                  | 启动脚本默认与应用上限一致 |
| ORIGIN                   | SvelteKit 访问根地址                     | 启动脚本/Compose 自动设置  |

旧变量 `IPAROOM_PUBLIC_URL` 仍兼容，但优先使用 `IPAROOM_BASE_URL`；它的旧名称不代表需要公网。以下示例中的 `192.168.1.10` 应替换为服务器真实内网 IP，建议使用 DHCP 地址保留。设备与服务器必须互通，Wi-Fi 的客户端隔离可能阻止连接。

### HTTP：管理与下载

在 `.env` 中设置：

```dotenv
IPAROOM_LAN_HOST=192.168.1.10
IPAROOM_BASE_URL=http://192.168.1.10:3000
```

```sh
docker compose up -d --build
```

打开 `http://192.168.1.10:3000`。端口绑定指定的内网网卡；HTTP 不提供 OTA 按钮。

### HTTPS：iOS 在线安装

提供 Caddy 内网 CA 配置，不依赖公网域名、端口映射或公共 ACME 签发。保留上述 `.env`，HTTPS overlay 会自动把访问根地址覆盖为 `https://192.168.1.10:8443`，并关闭后端 HTTP 的主机端口，只暴露指定内网地址的 8443。

```sh
docker compose -f compose.yaml -f compose.https.yaml up -d --build
mkdir -p certs
docker compose -f compose.yaml -f compose.https.yaml cp \
  caddy:/data/caddy/pki/authorities/local/root.crt ./certs/iparoom-root.crt
```

Caddy 启动并生成证书后再导出根证书（需要支持 `!reset` 标签的 Docker Compose 2.24.4+）。通过 AirDrop、Apple Configurator 或 MDM 将 **root.crt** 安装到测试设备；手动安装后到「设置 → 通用 → 关于本机 → 证书信任设置」开启该根证书的完全信任。随后在 Safari 打开 `https://192.168.1.10:8443`。只分发根证书，保留 CA 私钥与数据卷在服务器。

CLI 所在的 Mac 也需要信任根证书，可以仅为 Node 指定 CA 文件：

```sh
NODE_EXTRA_CA_CERTS=./certs/iparoom-root.crt \
  pnpm cli login --server https://192.168.1.10:8443
NODE_EXTRA_CA_CERTS=./certs/iparoom-root.crt \
  pnpm cli upload ./exports/MyApp.ipa
```

已有组织内网 CA 时，可使用组织证书和反向代理，并设置相应的 `IPAROOM_BASE_URL`。证书需要匹配设备实际访问的 IP 或内网域名，不能仅在浏览器里忽略证书错误。

单实例部署，SQLite 使用 WAL，文件与数据卷需持久化并备份。最多两个并发上传，流式写入并计算 SHA-256。修改管理 Token 会使已有会话失效。首版支持单管理员与本地存储。

参考：[Caddy 内网 HTTPS](https://caddyserver.com/docs/automatic-https#local-https)、[Apple 根证书信任设置](https://support.apple.com/en-us/102390)。

## 安装与调试边界

- 在同一局域网的 iPhone / iPad Safari 中打开安装页，或扫描二维码。
- 服务仅在内网托管；某些签名的首次验证仍可能需要设备访问 Apple 服务，内网托管不等于完全离线安装。
- Ad Hoc / Development 签名通常要求设备 UDID 已在描述文件中；企业分发受 Apple Enterprise Program 的授权限制。
- App Store 导出包不适用这里的 OTA 安装，请使用 TestFlight / App Store。
- 签名类型与到期时间从 embedded.mobileprovision 读取，仅是提示，服务不验证证书链、代码签名或设备可安装性。未知签名、过期描述文件、HTTP 配置和 App Store 包不展示 OTA 按钮，仍可下载 IPA。
- 远程分发 IPA 不是远程连接 LLDB。断点、实时日志等调试仍需 Xcode 支持的设备连接方式。
- 分享 URL 是持有即访问的随机能力链接，持有者能下载整个构建。撤销/旋转同时使旧安装页、manifest、下载 URL 对后续请求失效；已开始的下载或设备上已安装的应用不受影响。

参考：[Apple 无线分发说明](https://support.apple.com/en-gb/guide/deployment/depce7cefc4d/1/web)、[SvelteKit Node 部署](https://svelte.dev/docs/kit/adapter-node)。

## API

所有 `/api/builds*` 请求都需要管理会话或 `Authorization: Bearer <token>`。

| 方法     | 路径                     | 行为                                                                  |
| -------- | ------------------------ | --------------------------------------------------------------------- |
| POST     | /api/builds              | 原始 IPA 字节流；X-IPAROOM-Notes 为 encodeURIComponent 编码的更新说明 |
| GET      | /api/builds              | 构建列表，包含分享链接                                                |
| GET      | /api/builds/:id          | 元信息与链接                                                          |
| DELETE   | /api/builds/:id          | 删除构建和文件                                                        |
| POST     | /api/builds/:id/share    | JSON `{ "enabled": true/false }`；true 生成新链接，false 撤销         |
| GET      | /s/:token                | 安装页，不需要登录                                                    |
| GET      | /s/:token/manifest.plist | OTA manifest，只允许 HTTPS 配置                                       |
| GET/HEAD | /s/:token/download       | IPA 下载，支持单段 Range                                              |

测试使用合成 IPA 验证上传/解析/manifest/下载/CLI/UI；合成包不包含有效代码签名，不能作为真机安装证据。实际 OTA 安装需要你导出的有效签名 IPA、受信任的局域网 HTTPS 和受支持的测试设备。
