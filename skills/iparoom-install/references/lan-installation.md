# 内网 HTTPS、签名和设备证据

当缺少证书、目标设备无法安装、需要配置内网反代，或需要确认真机结果时读取本页。

## TLS 与局域网

安装页、manifest 和 IPA 的地址都应可从目标设备访问。服务可只在内网，不需要公网入口。Wi-Fi 客户端隔离、VPN 路由和多网卡可能使 agent 能访问而手机不能；应在目标设备 Safari 中读取页面结果。

内网 TLS 的证书必须覆盖实际访问的 IP/域名（Subject Alternative Name），且设备信任完整证书链。浏览器临时跳过警告不是 OTA 信任。使用已有组织 CA 时沿用组织的分发方式。CLI/MCP 默认生成持久化本机 CA；配置在 `~/.iparoom/config.yaml`，CA 在 `~/.iparoom/certificates`；`IPAROOM_USER_DATA_DIR` 指定 userdata 父目录，二者统一放在其 `.iparoom` 下。不要擅自写入设备或系统信任存储。安装入口 `certificateInstallUrl` 为仅分发公开 CA 的 HTTP 页，SHA-256 指纹应与启动 JSON 的 `caFingerprint` 一致；`caCertificatePath` 可交给校验脚本。

手动安装根证书后，在 iPhone/iPad「设置 → 通用 → 关于本机 → 证书信任设置」启用该根证书的完全信任。通过 Configurator/MDM 安装的信任规则可能不同。只交付根证书，不交付 CA 私钥或服务端私钥。[Apple 根证书信任说明](https://support.apple.com/en-us/102390)

CLI 的 Node TLS 信任可通过 `NODE_EXTRA_CA_CERTS=/path/root.crt` 配置。校验脚本用 `--ca /path/root.crt`；这只能证明 agent 主机的 TLS 链验证通过，不能证明手机信任已设置。

## 使用仓库的 Caddy 配置

仅在用户选择 Docker/常驻服务且仓库存在这些文件时使用。编辑 `~/.iparoom/config.yaml`：设置 `server.adminToken`、设备可解析的 `server.hostname`、公开端口 `server.port`、证书端口 `https.caPort`。`server.host` 默认 `0.0.0.0`；`https.enabled` 默认 true。不要输出 YAML 中的 Token。

```sh
pnpm docker up -d --build
pnpm docker logs --tail 50
```

启动入口从 YAML 派生 Compose 配置；HTTPS overlay 不公开后端 HTTP 端口，另提供证书专用 HTTP 端口（`https.caPort: 0` 时为 8080）。默认 HTTPS 主端口为 `server.port: 3000`。要求 Compose 2.24.4+；独立命令可设置 `IPAROOM_DOCKER_COMMAND=/path/to/docker-compose`。Caddy 公开根位于 `.iparoom/caddy/data/caddy/pki/authorities/local/root.crt`，CA 私钥不挂载到应用。Caddy 与 native OpenSSL CA 独立，必须匹配当前服务指纹。旧 Docker 卷要先备份迁移，保留原 CA；不要擅自删除或创建替代已信任的 CA。已有反代时优先使用它，不重复启动另一套。

不要把 Caddy 数据卷中的证书私钥提取给直接文件命令；常驻服务可以用 `iparoom upload`。使用外部证书时，直接模式的 `--cert/--key` 需要用户/项目提供的服务端证书，可用 `--ca` 指定公开根并验证链；默认模式自动签发，不需要这些参数，用匹配 SAN 的 `--hostname` 配置访问域名，用 `--host/--port` 配置监听。

## 签名与排障

IPA Room 不签名或重签名，也不验证代码签名。它从 embedded.mobileprovision 推断签名类型和到期时间。

- Ad Hoc / Development：目标 UDID 应在描述文件中；如果缺少设备，应在项目支持的 Apple 签名流程中注册设备并重新导出，不能通过改 manifest 解决。
- Enterprise：受 Apple Enterprise Program 限制，首次启动可能需要信任开发者；较新 iOS 的手动安装可能要求重启完成描述文件信任。按设备实际提示和当前 Apple 说明操作，不声称整个流程完全离线。
- App Store：使用 TestFlight/App Store，不通过修改类型或 Bundle ID 强制 OTA。
- Unknown / 过期：获取有效导出包后重新交付；已有页面不证明包可安装。

若提示“无法安装/下载”，先检查目标设备能否打开安装页、TLS 信任、manifest 中的软件包 URL、IPA 下载和实际签名/设备条件。区分网络失败、证书失败、下载失败和安装验证失败。[Apple 无线分发与排障说明](https://support.apple.com/en-gb/guide/deployment/depce7cefc4d/1/web)

## 完成条件

| 证据                                                      | 能说明什么                         |
| --------------------------------------------------------- | ---------------------------------- |
| 页面/manifest/下载可访问，SHA-256 一致                    | 分发路径和文件完整性已验证         |
| agent 主机使用 CA 成功请求 HTTPS                          | 此主机的 HTTPS 信任已验证          |
| 设备 Safari 能打开页面并无证书问题                        | 此设备可访问页面；还需观察安装结果 |
| 点击安装按钮                                              | 安装请求已触发，未证明安装完成     |
| 设备安装列表/应用详情对应版本，或用户确认本次构建安装完成 | 目标设备安装已验证，记录来源       |
| 设备启动应用并读回状态/画面                               | 启动已验证；不自动等于功能验收     |

没有设备操作能力时，完成可验证的分发工作并给出链接，安装与启动状态保持“未验证”。必要时向用户收集实际设备结果，不要求他们再次授权已明确要求的分发工作。

## Surge Ponte

用可靠的 Surge CLI status Ponte 身份，或用户提供的 `--ponte-hostname` / `IPAROOM_PONTE_HOSTNAME` 设置 `.sgponte` 域名。不要从 macOS 电脑名称猜测 Ponte 名称，也不要读取 Surge 密钥。已知 Ponte 域名纳入服务证书 SAN，默认优先用于链接；显式 hostname 优先，LAN IP SAN 仍保留。域名能被证书覆盖不等于目标设备有 Ponte 权限或路由；真实连接需单独验证。Surge CLI 不报告身份时回退 LAN 地址并说明限制。
