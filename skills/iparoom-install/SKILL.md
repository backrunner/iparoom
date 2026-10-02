---
name: iparoom-install
description: 使用 IPA Room 将 Xcode 导出的 IPA 分发到局域网 iPhone/iPad 测试设备。适用于 CLI/MCP 生成 IPA 安装链接、上传常驻服务、配置证书 hostname 及检查安装结果；不用于 App Store/TestFlight 发布或远程 LLDB 调试。
---

# IPA Room 局域网安装

完成用户授权的构建、导出、分发与安装验证。服务只需在局域网可达，不需要公网域名、隧道或路由器端口映射。安装入口可用和真机安装成功是不同结果。

## 选择入口

先检查 `node --version`、`iparoom --help`、项目构建/签名约定及用户提供的 IPA、Archive、设备和内网服务信息。CLI 需要 Node.js 24+，默认自动签发 HTTPS 需要 OpenSSL。不要扫描或显示 Token、证书私钥、Keychain 密钥；使用已配置的凭据与签名机制。

- **不使用网页 HTTPS、且有可访问设备的 Mac：** 读取 [设备连接安装](references/nonhttps-installation.md)，使用 HTTP 交付 IPA 后通过现有 Apple 工具安装；IPA Room 的自动设备安装命令尚未实现，不杜撰 `iparoom install`。
- **已连接 IPA Room MCP 或需要独立 MCP：** 使用 `iparoom_create_install_link`；读取 [MCP 与 hostname](references/mcp.md)，理解会话寿命、服务主机文件路径及 HTTP MCP 认证。
- **已有 IPA、临时分享：** 使用直接文件入口，无需预先启动服务器或登录。
- **用户指定常驻服务或需要保留版本：** 使用 `upload`；已有有效会话/环境凭据就继续，不要求重复登录。
- **只有 Archive/源码：** 根据项目约定构建并导出。`iparoom export` 是“导出后上传到常驻服务”，不会独立启动页面。临时分享应先用项目导出流程或 `xcodebuild -exportArchive` 得到 IPA，再使用直接文件入口。

目录参数必须包含唯一 IPA；多个候选时明确选择目标，不用文件时间猜测版本。模拟器 .app 不能替代签名真机 IPA。使用项目的 ExportOptions.plist、证书和描述文件，不自行改变开发者账号或签名类型。

CLI 不存在时，使用用户提供的安装包或源码仓库：源码可 `pnpm pack:cli` 后安装 `dist/iparoom-cli-0.1.0.tgz`，或 `pnpm build:cli` 后通过仓库 CLI 运行。不要假定包已发布到 npm。

## 临时启动

```sh
iparoom "/absolute/path/App.ipa" --json --no-open
```

在受管理的长运行终端会话中启动，记录进程/会话和启动 JSON；等待完整 JSON 后再使用其中的 `build.installUrl`、`downloadUrl`、`manifestUrl`、`otaUrl`、版本、构建号、签名提示、SHA-256。不要杜撰端口、Token 或分享路径，也不要把二维码输出当作 JSON。

若用户要自动打开桌面页面，可省略 `--no-open`。CLI 默认监听 `0.0.0.0`（所有 IPv4 网卡），优先使用可靠报告或明确配置的 Ponte 域名，否则选择私有 IPv4 作为链接地址并分配空闲端口。用 `--host <本机 IPv4>` 限制监听；用 `--hostname <设备可解析的域名>` 指定链接和证书域名；需要固定端口时用 `--port`。不要把 `0.0.0.0` 当作访问链接。网页、CLI 与 MCP 共用 userdata 下的 `.iparoom/config.yaml`（默认 `~/.iparoom`）；用 `iparoom config` 定位，用户可直接编辑后重启，`IPAROOM_USER_DATA_DIR` 指定父目录。直接文件模式不读取当前项目 `.env`，也不使用远程 CLI 登录；不要通过登录解决它的启动问题。

**默认由持久化本机 CA 签发 HTTPS。** 读取启动 JSON 的 `certificateInstallUrl`、`caCertificatePath`、`caFingerprint`；设备首次通过 HTTP 证书专用入口下载 `.mobileconfig`，安装后开启根证书完全信任，校对指纹。CA 不随临时 IPA 删除，不自动修改系统或设备信任。校验脚本的 `--ca` 使用 JSON 中的公开根证书路径。`--http` 显式选择仅下载的 HTTP。已有、与访问 hostname 匹配且被设备信任的证书可继续使用：

```sh
iparoom "/absolute/path/App.ipa" --hostname ipa.lan --port 8443 \
  --cert "/path/server.crt" --key "/path/server.key" --ca "/path/root.crt" --json --no-open
```

证书示例路径不是预置资产。缺少设备信任时先准备 CA 入口，读取 [内网证书与设备操作](references/lan-installation.md)，明确需要的证书或设备信任步骤，不把 HTTP 下载链接称为可在线安装。不要使用 `curl -k` 或关闭 TLS 校验来证明就绪。

## 常驻服务

```sh
iparoom upload "/absolute/path/App.ipa" --notes "本次测试说明" --json
iparoom info <build-id> --json
```

用 `--server <内网根地址>` 指定服务，或使用已保存配置/`IPAROOM_SERVER`。管理认证通过现有登录或 `IPAROOM_TOKEN` 提供，不写入命令参数、交付链接或日志。只有确实缺少凭据时才请求用户提供受支持的配置方式。内网 CA 可通过 `NODE_EXTRA_CA_CERTS=/path/root.crt` 提供给 Node。

有 Archive 和配置好的常驻服务时：

```sh
iparoom export "/path/App.xcarchive" --options "/path/ExportOptions.plist" \
  --output "/path/new-export-directory" --notes "本次测试说明" --json
```

使用新导出目录，避免把旧 IPA 当成本次构建。导出失败时保留 Xcode 的实际错误；不要声称 archive 成功即完成分发导出。失败的签名、描述文件或设备条件需要处理原因，不重复尝试相同无效构建。

## 验证交付与设备

将启动/上传 JSON 保存到会话临时文件，运行 skill 自带脚本（路径相对于本 SKILL.md）：

```sh
python3 scripts/verify-share.py --input /path/share.json --full
# 在线安装交付检查；--ca 是 HTTPS 的根 CA，不是私钥。
python3 scripts/verify-share.py --input /path/share.json --ca /path/root.crt --full --require-ota
```

脚本检查页面、HEAD/Range 下载、HTTPS manifest 与构建元信息；`--full` 流式核对整个 IPA 的 SHA-256。HTTP 模式可通过下载检查，但 `--require-ota` 会失败。脚本在 agent 所在主机通过 TLS 不表示 iPhone 已信任 CA，也不验证应用代码签名。仅有 URL 时可用 `--url <安装页地址>`，但此时不能核对 CLI 构建元信息或宣称 SHA-256 匹配。

确认手机与服务器可互通，链接不是 localhost。让用户在目标 iPhone/iPad 的 Safari 打开安装页并点击安装；agent 有受授权的设备 UI 时可操作并读回结果，没有设备访问时提供具体链接和操作步骤，并保持安装结果未验证。仅下载 IPA 不会触发 OTA。

对 JSON 中的签名类型、到期时间、设备数量只作提示：Ad Hoc/开发签名通常要求目标 UDID 在描述文件中；App Store 类型应走 TestFlight/App Store；未知或过期签名不能据此宣称可安装。需要安装排障或设备证据时读取 [内网证书与设备操作](references/lan-installation.md)。

安装成功的证据应对应目标设备、Bundle ID 和版本/构建号，例如设备安装列表/应用详情，或用户明确确认本次构建已安装。还要验证启动或具体调试操作时，分别读取证据；IPA Room 不提供远程 LLDB 连接。不得用测试 fixture、浏览器截图、manifest 200 或 CLI 退出码替代真机安装证据。

## 生命周期与交付

临时入口前台运行期间分享有效。交付给用户时保持服务存活，说明停止方式和临时性质；不要为了结束 agent 回合就关闭服务。用户要求结束分享或临时任务确已完成后，仅停止自己启动的进程（Ctrl+C/SIGTERM）。正常停止会清理临时副本，不删除原 IPA。后续回合先重新检查服务存活，不复用已关闭的链接。

常驻服务按任务需求撤销：`iparoom share <build-id> --revoke`。`iparoom share <build-id>` **会轮换链接**，不是只读查看；获取现有链接用 `info`。删除构建用 `delete <build-id> --yes`，只在用户要求删除时执行。

交付时简明报告应用版本、真实内网安装页、已验证的交付检查、服务生命周期，以及设备安装/启动分别是否已验证。缺少的实际条件要具体说明，不把“分发准备完成”报告为“真机安装完成”。
