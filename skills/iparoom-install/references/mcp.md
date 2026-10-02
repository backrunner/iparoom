# MCP 与访问 hostname

已连接 IPA Room MCP 时优先用现有工具，不再重复启动 CLI 或登录其他服务。可用工具：

- `iparoom_create_install_link`：`path` 是 MCP 主机上的 IPA 绝对路径，或包含唯一 IPA 的目录；可选 `notes`。会创建临时副本，返回 `build` 和服务状态。
- `iparoom_list_builds`：列出这个进程的构建。
- `iparoom_get_install_link`：通过 `id` 读取现有链接，不轮换。
- `iparoom_revoke_share`：通过 `id` 撤销分享；只在任务要求时使用。
- `iparoom_server_status`：读取监听地址、hostname、网页端口、MCP 地址与临时生命周期。

工具路径属于服务主机，不是 HTTP MCP 调用者的电脑。没有远端文件时先按任务的构建交付方式把 IPA 放到服务主机；不要传本地文件路径并假定远端可读取。工具返回 `isError` 时处理实际错误；修正路径、IPA 或参数后可继续使用同一会话。

独立启动示例：

```sh
iparoom-mcp --hostname ipa.lan --port 8443 --cert /path/server.crt --key /path/server.key --ca /path/root.crt
# 等价入口
iparoom mcp --hostname ipa.lan --port 8443 --cert /path/server.crt --key /path/server.key --ca /path/root.crt
```

默认 stdio，可由 agent 的 MCP 客户端作为子进程启动；stdout 专供协议，日志在 stderr。不要把 stdio 命令作为普通终端后台任务后假定已有 MCP 工具连接。使用客户端支持的 MCP 配置，或在真正的 MCP 客户端中连接。

```json
{
  "mcpServers": {
    "iparoom": {
      "command": "iparoom-mcp",
      "args": [
        "--hostname",
        "ipa.lan",
        "--port",
        "8443",
        "--cert",
        "/path/server.crt",
        "--key",
        "/path/server.key"
      ]
    }
  }
}
```

网络模式：`iparoom-mcp --transport http --hostname ipa.lan --mcp-port 3001`。通过启动环境提供至少 24 字符的 `IPAROOM_MCP_TOKEN`；客户端访问 `/mcp` 时使用 Bearer Header，不把 Token 放进 URL、命令参数或交付文本。HTTP 为无状态 Streamable HTTP，接受 POST；用真正 MCP 初始化/工具调用验证，而不是只凭 HTTP 200。默认 MCP 和 IPA 网页端口都使用本机 CA 的 HTTPS。stdio 不需要该 Token。

`--host` 控制监听，默认 `0.0.0.0`；`--hostname` 控制所有安装页、manifest 和 IPA URL，二者独立。hostname 是启动配置，不能在每次工具调用中重新指定。证书必须包含这个域名/IP；目标设备的内网 DNS 或 hosts 必须把它解析到运行服务的机器。运行于 `0.0.0.0` 不代表可以在浏览器访问这个地址。未指定 hostname 时优先使用可靠报告或明确配置的 Ponte 域名，否则使用私有 IPv4；无内网接口时只能使用 loopback 地址。

持久化配置在 `~/.iparoom/config.yaml`，支持 `server.host/hostname`、`share.port`、`mcp.transport/port/token`；编辑后重启。可用环境变量和显式参数临时覆盖；`IPAROOM_USER_DATA_DIR` 指定 userdata 父目录。独立 CLI/MCP 不读取当前项目 `.env`。`--port` 是 IPA 网页端口，默认空闲端口；`--mcp-port` 只用于 HTTP MCP。原有常驻服务可用 `IPAROOM_BASE_URL` 设置含协议/端口的完整访问根地址。

MCP 一个进程支持多个 IPA，工具返回结构化元信息及实际链接。HTTP 的 `build.otaUrl` 为 null，不能宣称可 OTA。将返回结果保存为 JSON，使用同一 skill 的 `verify-share.py --input /path/share.json --full` 检查传输；需要 OTA 时使用受信任 CA 与 `--require-ota`。服务器的 `deviceInstallation: not-verified` 必须以真机证据补足，不能被工具调用成功替代。

保持 MCP 会话存活供测试者使用链接。stdio EOF、SIGINT 或 SIGTERM 会关闭服务并清理所有临时副本；MCP 客户端关闭/任务结束可能使分享失效。需要跨会话保留构建时改用已配置的常驻服务和 `upload`，不要交付一个已经结束的 MCP 会话链接。原始 IPA 不会被清理流程删除。

默认本机 CA HTTPS 与 CLI 一致。状态及创建链接结果带 `certificateInstallUrl`、`caCertificatePath`、`caFingerprint` 和 Ponte 检测结果。用公开根验证网络链，再由设备安装配置文件并开启完全信任。HTTP MCP 传输也默认 HTTPS，Node 客户端用 `NODE_EXTRA_CA_CERTS`；`--http` 才切换到 HTTP。
