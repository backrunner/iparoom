# 内网 HTTPS、签名和设备证据

当缺少证书、目标设备无法安装、需要配置内网反代，或需要确认真机结果时读取本页。

## TLS 与局域网

安装页、manifest 和 IPA 的地址都应可从目标设备访问。服务可只在内网，不需要公网入口。Wi-Fi 客户端隔离、VPN 路由和多网卡可能使 agent 能访问而手机不能；应在目标设备 Safari 中读取页面结果。

内网 TLS 的证书必须覆盖实际访问的 IP/域名（Subject Alternative Name），且设备信任完整证书链。浏览器临时跳过警告不是 OTA 信任。使用已有组织 CA 时沿用组织的分发方式。自己建立内网 CA 是可选方案，不要擅自写入设备或系统信任存储。

手动安装根证书后，在 iPhone/iPad「设置 → 通用 → 关于本机 → 证书信任设置」启用该根证书的完全信任。通过 Configurator/MDM 安装的信任规则可能不同。只交付根证书，不交付 CA 私钥或服务端私钥。[Apple 根证书信任说明](https://support.apple.com/en-us/102390)

CLI 的 Node TLS 信任可通过 `NODE_EXTRA_CA_CERTS=/path/root.crt` 配置。校验脚本用 `--ca /path/root.crt`；这只能证明 agent 主机的 TLS 链验证通过，不能证明手机信任已设置。

## 使用仓库的 Caddy 配置

仅在用户选择 Docker/常驻服务且仓库存在这些文件时使用。`.env` 设置 `IPAROOM_ADMIN_TOKEN` 和设备可解析的 `IPAROOM_HOSTNAME`；`IPAROOM_LAN_HOST` 默认 `0.0.0.0`，可限制到本机 IPv4；不要输出该文件中的 Token。根域名设置使用 `IPAROOM_BASE_URL`，旧名 `IPAROOM_PUBLIC_URL` 仅为兼容，不代表公网。

```sh
docker compose -f compose.yaml -f compose.https.yaml up -d --build
mkdir -p certs
docker compose -f compose.yaml -f compose.https.yaml cp \
  caddy:/data/caddy/pki/authorities/local/root.crt ./certs/iparoom-root.crt
```

Caddy 启动并生成证书后再复制根证书。overlay 以本地 CA 签发，将入口设为 `https://<IPAROOM_HOSTNAME>:8443`，不公开后端 HTTP 端口；要求 Docker Compose 支持 `!reset`（2.24.4+）。环境只有独立 `docker-compose` 命令时可用其等价形式。已有反代时优先使用它，不重复启动另一套。

不要把 Caddy 数据卷中的证书私钥提取给直接文件命令；常驻服务可以用 `iparoom upload`。直接模式的 `--cert/--key` 需要用户/项目提供的服务端证书，用匹配 SAN 的 `--hostname` 配置访问域名，用 `--host/--port` 配置监听。

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
