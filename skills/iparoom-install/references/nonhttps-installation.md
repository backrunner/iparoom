# 不依赖网页 HTTPS 的安装 / Installation without web HTTPS

## 可行路径

| 路径                                                                  | 网页 HTTPS                                             | 当前状态                    |
| --------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------- |
| Safari 扫码、itms-services OTA                                        | 需要设备信任的 HTTPS                                   | IPA Room 已实现             |
| Mac 下载 IPA，Xcode / Device Hub 或 Apple Configurator 安装到目标设备 | IPA 传输可用局域网 HTTP；设备使用配对连接              | 可用现有 Apple 工具手动完成 |
| IPA Room CLI 自动调用 devicectl                                       | IPA 传输可用 HTTP；设备使用 USB 或受支持的无线配对连接 | 设计方案，尚未实现          |

HTTP 下载只把文件送到主机；手机 Safari 下载 IPA 不会直接安装。网页 OTA 的 HTTPS 要求不能通过修改 manifest 或 itms-services 链接取消。

无需网页 HTTPS 时，先明确安装主机和目标设备。Mac 上的 Xcode / Device Hub 必须能够发现并配对目标设备，或通过 Apple Configurator 连接目标设备。配对和设备信任由用户在设备上授权；无线支持取决于本机 Xcode 与设备条件。仍需有效签名、符合描述文件的设备以及适用时已开启的 Developer Mode。服务所在的机器可以与安装用的 Mac 不同。

## Agent 可执行的现有流程

1. 使用现有 `iparoom App.ipa --json --no-open` 或 `iparoom upload` 得到实际下载 URL，保持分享会话存活。通过 `verify-share.py --full` 核对传输；HTTP 不使用 `--require-ota`。
2. 在能够访问目标设备的 Mac 下载该 IPA，核对下载文件的 SHA-256 与本次构建记录。不要把页面截图当作安装证据。
3. 使用本机 Xcode / Device Hub 或 Apple Configurator 的添加应用功能选择这个 IPA，明确选择目标设备。有受授权的 GUI 控制就操作并读回状态；缺少目标设备访问时交付下载地址及具体操作步骤。
4. 读取目标设备的已安装应用信息，确认 Bundle ID、版本/构建号；用户要求启动时另行验证启动结果。保留系统返回的签名、设备锁定、配对或描述文件错误。

## 后续 CLI 设计，以下命令目前不存在

```sh
# Proposed only — do not execute as existing IPA Room commands.
iparoom devices --json
iparoom install ./App.ipa --device <identifier> --json
```

建议先实现本地 Mac 设备桥接：安全解包唯一 `Payload/*.app`，保留签名、可执行权限和合法 bundle 符号链接；限制解压路径和大小。调用参数数组形式的 `xcrun devicectl device install app --device <identifier> <app-path>`，设置超时并读取 JSON 结果。通过设备应用列表确认本次安装，清理临时解包内容。

本机 `xcrun devicectl help device install app` 明确要求 `.app` bundle，不能直接传 IPA。发现设备不能等同已授权安装，不自行重签名或卸载旧应用来绕过错误。第一阶段只接受本地 IPA；未来远端 URL 输入应校验来源、重定向、大小和 SHA-256。浏览器向 Mac 设备桥下发任务需要另设配对及管理认证，不公开匿名设备安装接口。

## English

Web OTA still requires device-trusted HTTPS. A separate device-installation path can download an IPA over LAN HTTP to a Mac and install it with Xcode / Device Hub or Apple Configurator. The Mac must have an authorized connection to the target device; Xcode supports cable or wireless pairing where available. Signing, provisioning eligibility, and applicable Developer Mode requirements remain in force. Downloading an IPA in Safari does not install it.

Agents can use the existing IPA Room download flow, verify SHA-256, install that file with Apple's tools on the selected device, and separately confirm the installed bundle/version and launch. This is a manual Apple-tool workflow; IPA Room has no automatic device-install command yet.

The proposed `devices` and `install` commands would use a local Mac bridge. `devicectl device install app` accepts an extracted `.app` bundle, not an IPA. The implementation needs bounded safe extraction preserving bundle permissions and legitimate symlinks, explicit device selection, timeouts, JSON error handling, installation readback, and temporary-file cleanup. A future browser bridge must authenticate installation jobs. This proposal is not real-device installation evidence.

## Primary sources

- [Apple: proprietary app web distribution and HTTPS](https://support.apple.com/en-lamr/guide/deployment/depce7cefc4d/1/web/1.0)
- [Apple: registered devices, pairing and IPA installation](https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices)
- [Apple: installing apps with Configurator](https://support.apple.com/en-ie/guide/deployment/depb45db6241/web)
- [Apple: Xcode command-line tools](https://developer.apple.com/documentation/xcode/xcode-command-line-tool-reference)
- Local reference checked: `xcrun devicectl help device install app` and `xcrun devicectl help manage pair`.
