# iparoom-cli

Node.js 24+ CLI for serving and uploading Xcode IPA builds on your LAN. The package includes the compiled SvelteKit web server and browser assets.

```sh
iparoom ./MyApp.ipa
iparoom ./exports --notes "Regression build" --no-open
iparoom ./MyApp.ipa --hostname ipa.lan --port 8443 --cert ./server.crt --key ./server.key
```

The direct-file command listens on all IPv4 interfaces and selects a private LAN address for links and a free port, imports the IPA, opens the installation page, and prints the URL and terminal QR code. No login, prior service setup, or project checkout is required. Press Ctrl+C to stop sharing and delete the temporary copy; the original IPA is unchanged. The command does not read project `.env` files or use remote login credentials. `--json` prints startup metadata without a QR code. `--no-open` suppresses browser launch.

HTTP provides the page and download. OTA requires an HTTPS certificate matching the advertised hostname and trusted by the test device. `--cert` and `--key` enable HTTPS. Device provisioning and signing restrictions still apply. `--host` defaults to `0.0.0.0`; `--hostname` sets the DNS name/IP in links independently. The hostname must resolve to this host on test devices, and HTTPS requires a matching certificate/key.

For an existing persistent server:

```sh
iparoom login --server https://192.168.1.10:8443
iparoom upload ./exports/MyApp.ipa --notes "Test build"
iparoom export ./MyApp.xcarchive --options ./ExportOptions.plist --output ./exports
iparoom list --json
iparoom share <id> --revoke
iparoom delete <id> --yes
```

Login prompts for a hidden token. CI can set `IPAROOM_SERVER` and `IPAROOM_TOKEN` and use `--json` without login. Credentials are stored with mode 0600 under `~/.config/iparoom/`; `IPAROOM_CONFIG_DIR` overrides the location. JSON goes to stdout; diagnostics and Xcode logs to stderr. Failures exit with status 1. Directory arguments require exactly one IPA. `share` rotates the link by default; `--revoke` disables it.

From the source repository, run `pnpm pack:cli` then `npm install -g ./dist/iparoom-cli-0.1.0.tgz`. For development linking, run `pnpm build:cli` before `npm link` in this package. This package is prepared locally and has not yet been published to npm.

## Companion agent skill

```sh
iparoom skill install
iparoom skill install --path /path/to/agent/skills --json
```

Installs the bundled `iparoom-install` skill into `$CODEX_HOME/skills` or `~/.codex/skills` by default. Use `$iparoom-install` in a new agent task to guide LAN IPA delivery and device-result verification. Automatic skill discovery is enabled. A Python 3 stdlib helper checks pages, manifests, ranged/full downloads, and SHA-256 without claiming device installation. Identical installations are idempotent; differing existing skills are left untouched.

## Independent MCP

```sh
iparoom mcp --hostname ipa.lan
iparoom-mcp --hostname ipa.lan --port 8443 --cert ./server.crt --key ./server.key
# Inject IPAROOM_MCP_TOKEN (at least 24 characters) for network MCP access:
iparoom-mcp --transport http --hostname ipa.lan --mcp-port 3001
```

Stdio is the default. In an agent MCP configuration, use command `iparoom-mcp` and an `args` array for these flags. Tools: `iparoom_create_install_link` (`path`, optional `notes`), `iparoom_list_builds`, `iparoom_get_install_link` (`id`), `iparoom_revoke_share` (`id`), and `iparoom_server_status`. The server starts its own temporary IPA web service and supports multiple files without login. File paths refer to the MCP host. Results contain structured build metadata, URLs and SHA-256, without claiming device installation.

HTTP MCP accepts authenticated stateless POST requests at `http://ipa.lan:3001/mcp`, with `Authorization: Bearer <IPAROOM_MCP_TOKEN>`. Certificate flags enable HTTPS on both MCP and IPA web servers. `--port` is the IPA web port (default: available port); `--mcp-port` is the network MCP port. Both bind `0.0.0.0` by default. EOF (stdio), Ctrl+C or SIGTERM cleans up temporary data and invalidates session links. Diagnostics go to stderr; stdio stdout is reserved for MCP messages. Keep the process running while its links are in use. Independent commands ignore project `.env`; inject environment configuration when launching them.
