# 不依赖网页 HTTPS 的安装 / Installation without web HTTPS

## 可行路径

| 路径                                                                  | 网页 HTTPS                                             | 当前状态                    |
| --------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------- |
| Safari 扫码、itms-services OTA                                        | 需要设备信任的 HTTPS                                   | IPA Room 已实现             |
| Mac 下载 IPA，Xcode / Device Hub 或 Apple Configurator 安装到目标设备 | IPA 传输可用局域网 HTTP；设备使用配对连接              | 可用现有 Apple 工具手动完成 |
| IPA Room CLI 自动调用 devicectl                                       | IPA 传输可用 HTTP；设备使用 USB 或受支持的无线配对连接 | 设计方案，尚未实现          |

HTTP 下载只把文件送到主机；手机 Safari 下载 IPA 不会直接安装。网页 OTA 的 HTTPS 要求不能通过修改 manifest 或 itms-services 链接取消。

无需网页 HTTPS 时，先明确安装主机和目标设备。Mac 上的 Xcode / Device Hub 必须能够发现并配对目标设备，或通过 Apple Configurator 连接目标设备。配对和设备信任由用户在设备上授权；无线支持取决于本机 Xcode 与设备条件。仍需有效签名、符合描述文件的设备以及适用时已开启的 Developer Mode。服务所在的机器可以与安装用的 Mac 不同。

## USB、虚拟 USB 与没有局域网的情况

IPA 已在安装用的 Mac 上且真机通过 USB 可用时，可以直接走 Xcode / Device Hub 或 Configurator，不需要网页服务，也不需要手机与服务器处于同一局域网。

USB over IP（例如 VirtualHere）是把远端主机上实际连接的 USB 设备转发给客户端，仍需要真实设备、远端宿主机及两端可达的网络。`usbmux` / CoreDevice 隧道同样需要可连接、已授权的设备端点；它们不会创建一台可安装真机 IPA 的虚拟 iPhone。IPA Room 尚未集成或验证这些远端桥接方式，不能把第三方隧道启动成功报告为应用安装成功。

先用 `xcrun devicectl list devices` 检查设备；需要排障时用 `xcrun devicectl device info details --device <identifier> --timeout 10`。设备信息可能来自缓存，即使命令退出码为 0，`unavailable` 也不能作为已连接证据。没有可用真机或用户提供的远端设备端点时，继续完成网页分发和完整性检查，交付下载/安装页，保留真机安装未验证的状态，不添加假定可用的自动安装命令。Simulator 只能验证对应模拟器构建，不能替代真机 IPA 安装证据。

## Agent 可执行的现有流程

1. IPA 已在安装主机上时直接使用这个文件。需要跨主机交付时，使用现有 `iparoom App.ipa --json --no-open`、MCP 或 `iparoom upload` 得到实际下载 URL，保持分享会话存活。通过 `verify-share.py --full` 核对传输；HTTP 不使用 `--require-ota`。
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

If the IPA is already on a Mac with a connected USB device, no web service or shared LAN is needed. USB over IP forwards a real device attached to a remote host; it still requires that host, an authorized device connection and reachable network endpoints. CoreDevice/usbmux tunnels also need a real reachable endpoint. These bridges are not integrated or verified by IPA Room. Cached device information and a successful command exit do not establish connectivity when the device is `unavailable`. With no available physical device or supplied remote endpoint, complete web delivery and keep installation unverified; Simulator results do not validate a physical-device IPA installation.

The proposed `devices` and `install` commands would use a local Mac bridge. `devicectl device install app` accepts an extracted `.app` bundle, not an IPA. The implementation needs bounded safe extraction preserving bundle permissions and legitimate symlinks, explicit device selection, timeouts, JSON error handling, installation readback, and temporary-file cleanup. A future browser bridge must authenticate installation jobs. This proposal is not real-device installation evidence.

## Primary sources

- [Apple: proprietary app web distribution and HTTPS](https://support.apple.com/en-lamr/guide/deployment/depce7cefc4d/1/web/1.0)
- [Apple: registered devices, pairing and IPA installation](https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices)
- [Apple: installing apps with Configurator](https://support.apple.com/en-ie/guide/deployment/depb45db6241/web)
- [Apple: Xcode command-line tools](https://developer.apple.com/documentation/xcode/xcode-command-line-tool-reference)
- Local reference checked: `xcrun devicectl help device install app` and `xcrun devicectl help manage pair`.
- [VirtualHere: USB over IP client and server model](https://www.virtualhere.com/)
- [pymobiledevice3: iOS developer service tunnels and device connectivity](https://github.com/doronz88/pymobiledevice3/blob/master/docs/guides/ios17-tunnels.md)
