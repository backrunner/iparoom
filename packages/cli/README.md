# iparoom-cli

Node.js 24+ and OpenSSL CLI for serving and uploading Xcode IPA builds on your LAN. The package includes the compiled SvelteKit web server and browser assets.

```sh
iparoom ./MyApp.ipa
iparoom ./exports --notes "Regression build" --no-open
iparoom ./MyApp.ipa --hostname ipa.lan --port 8443 --cert ./server.crt --key ./server.key --ca ./root.crt
```

The direct-file command listens on all IPv4 interfaces and selects a private LAN address for links and a free port, imports the IPA, opens the installation page, and prints the URL and terminal QR code. No login, prior service setup, or project checkout is required. Press Ctrl+C to stop sharing and delete the temporary copy; the original IPA is unchanged. The command does not read project `.env` files or use remote login credentials. `--json` prints startup metadata without a QR code. `--no-open` suppresses browser launch.

Both CLI and MCP installation links open a standalone, server-rendered page for the selected build at `/s/<token>`. No dashboard or login step is required, and the build information and download/installation actions are available with JavaScript disabled.

HTTPS is the default. A persistent local CA signs 90-day server certificates covering the hostname, LAN IP, and loopback. The top-right Install CA entry points to a certificate-only HTTP bootstrap: download the `.mobileconfig`, install it, and enable full certificate trust in iOS settings. Compare its SHA-256 fingerprint with the terminal. Private keys are never distributed. Use `--http` for HTTP downloads, or `--cert/--key` and optional `--ca` for existing certificates. Device provisioning and signing restrictions still apply. `--host` defaults to `0.0.0.0`; `--hostname` sets the DNS name/IP in links independently. The hostname must resolve to this host on test devices, and HTTPS requires a matching certificate/key.

For an existing persistent server:

```sh
iparoom login --server https://192.168.1.10:8443
iparoom upload ./exports/MyApp.ipa --notes "Test build"
iparoom export ./MyApp.xcarchive --options ./ExportOptions.plist --output ./exports
iparoom list --json
iparoom share <id> --revoke
iparoom delete <id> --yes
```

Login prompts for a hidden token. CI can set `IPAROOM_SERVER` and `IPAROOM_TOKEN` and use `--json` without login. Credentials live in `client` fields of `~/.iparoom/config.yaml` with mode 0600. Login/logout preserve other fields and comments. JSON goes to stdout; diagnostics and Xcode logs to stderr. Failures exit with status 1. Directory arguments require exactly one IPA. `share` rotates the link by default; `--revoke` disables it.

From the source repository, run `pnpm pack:cli` then `npm install -g ./dist/iparoom-cli-0.1.0.tgz`. For development linking, run `pnpm build:cli` before `npm link` in this package. This package is prepared locally and has not yet been published to npm.

## User configuration

Run `iparoom config` to create/locate `~/.iparoom/config.yaml`, then edit it directly and restart CLI/MCP. Website, CLI and MCP use this same file. For example:

```yaml
version: 1
server:
  hostname: ipa.lan
https:
  caPort: 8080
ponte:
  hostname: '' # Set the actual Surge identity when known.
share:
  openBrowser: false
mcp:
  transport: stdio
client:
  server: https://ipa.lan:3000
  token: '' # Login writes this field.
```

`IPAROOM_USER_DATA_DIR=/path/to/userdata` selects `/path/to/userdata/.iparoom/config.yaml`. Relative certificate/storage paths resolve under `.iparoom`. Explicit flags override environment, then YAML, then defaults. `share.port` controls temporary IPA sharing; `mcp.port` and `mcp.token` control HTTP MCP. Config/private key modes are 0600 and the root directory is 0700. All fields: [configuration example](https://github.com/backrunner/iparoom/blob/HEAD/config.example.yaml).

On first creation, legacy `~/.config/iparoom/config.json` credentials and CA are migrated without replacing the root. Backups are retained; subsequent launches use YAML. Legacy `IPAROOM_CONFIG_DIR` and `IPAROOM_CERT_DIR` select migration sources only. Existing YAML is preserved.

## Companion agent skill

```sh
iparoom skill install
iparoom skill install --path /path/to/agent/skills --json
```

Installs the bundled `iparoom-install` skill into `$CODEX_HOME/skills` or `~/.codex/skills` by default. Use `$iparoom-install` in a new agent task to guide LAN IPA delivery and device-result verification. Automatic skill discovery is enabled. A Python 3 stdlib helper checks pages, manifests, ranged/full downloads, and SHA-256 without claiming device installation. Identical installations are idempotent; differing existing skills are left untouched.

## Independent MCP

```sh
iparoom mcp --hostname ipa.lan
iparoom-mcp --hostname ipa.lan --port 8443 --cert ./server.crt --key ./server.key --ca ./root.crt
# Inject IPAROOM_MCP_TOKEN (at least 24 characters) for network MCP access:
iparoom-mcp --transport http --hostname ipa.lan --mcp-port 3001
```

Stdio is the default. In an agent MCP configuration, use command `iparoom-mcp` and an `args` array for these flags. Tools: `iparoom_create_install_link` (`path`, optional `notes`), `iparoom_list_builds`, `iparoom_get_install_link` (`id`), `iparoom_revoke_share` (`id`), and `iparoom_server_status`. The server starts its own temporary IPA web service and supports multiple files without login. File paths refer to the MCP host. Results contain structured build metadata, URLs and SHA-256, without claiming device installation.

HTTP MCP accepts authenticated stateless POST requests at `https://ipa.lan:3001/mcp`, with `Authorization: Bearer <IPAROOM_MCP_TOKEN>`. Both ports use HTTPS by default; use `NODE_EXTRA_CA_CERTS` to trust the root from Node clients. `--port` is the IPA web port (default: available port); `--mcp-port` is the network MCP port. Both bind `0.0.0.0` by default. EOF (stdio), Ctrl+C or SIGTERM cleans up temporary data and invalidates session links. Diagnostics go to stderr; stdio stdout is reserved for MCP messages. Keep the process running while its links are in use. Independent commands ignore project `.env`; persisted configuration comes from userdata YAML, with explicit flags/environment overrides available.

## License

Copyright 2026 IPA Room contributors. Licensed under the [Apache License 2.0](https://github.com/backrunner/iparoom/blob/HEAD/LICENSE). The complete license is included in the package as `LICENSE`.

## Managed CA and Ponte

CA files live in `~/.iparoom/certificates`, separate from temporary IPA data. `IPAROOM_USER_DATA_DIR` selects the userdata parent for configuration, certificates and default data together; `--ca-port` / `IPAROOM_CA_PORT` fixes the public bootstrap port. Stopping a session removes its IPA copy and closes both public servers, while preserving its CA. Keys are 0600, directory 0700; expired/invalid roots are never silently replaced. Initial managed issuance requires OpenSSL; existing certificate flags do not generate new keys.

JSON also returns `certificateInstallUrl`, `caCertificatePath`, `caFingerprint`, `managedCertificates`, `ponteHostname`, and `ponteDetection`. Verified HTTPS delivery is not proof of device CA trust or application installation.

Use `--ponte-hostname my-mac.sgponte` / `IPAROOM_PONTE_HOSTNAME` for the actual Surge Ponte domain. It is preferred when no explicit hostname is given and included in SAN alongside LAN addresses. Automatic discovery requires a Ponte identity reported by Surge CLI status; computer names are never guessed. `--no-ponte` disables discovery. Clients need authorized Surge Ponte connectivity to resolve `.sgponte`.
