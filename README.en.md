<div align="center">
  <img src="./src/lib/assets/logo.svg" alt="IPA Room Logo" width="88" height="88" />
  <h1>IPA Room</h1>
  <p><strong>From build to device, with ease.</strong></p>
  <p>Self-hosted iOS build distribution on your LAN, for browsers, the command line, and AI agents.</p>
  <p>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-345ef0?style=flat-square" alt="License: Apache 2.0" /></a>
    <img src="https://img.shields.io/badge/Node.js-24%2B-168361?style=flat-square" alt="Node.js 24+" />
    <img src="https://img.shields.io/badge/Svelte-5-ff3e00?style=flat-square" alt="Svelte 5" />
  </p>
  <p><a href="./README.md">简体中文</a> · <a href="./README.en.md">English</a></p>
  <p><a href="#quick-start">Quick start</a> · <a href="#cli">CLI</a> · <a href="#independent-mcp">MCP</a> · <a href="#lan-deployment">Deployment</a> · <a href="#development-and-contributing">Contributing</a></p>
</div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/dashboard-dark.png" />
  <img src="./docs/assets/dashboard-light.png" alt="IPA Room build repository with floating navigation, search, signing filters, and sharing" />
</picture>
<p align="center"><sub>Screenshots use example builds. The dashboard supports dark appearance, mobile layouts, and keyboard navigation.</sub></p>

<details>
  <summary>View the mobile installation page</summary>
  <p align="center"><img src="./docs/assets/mobile-install.png" alt="Mobile installation page with build details, installation action, and release notes" width="320" /></p>
</details>

## Why IPA Room

IPA Room brings build management, share links, and LAN hosting into one workspace, taking an Xcode-exported IPA to an installation page on your test device.

The CLI and MCP return an `installUrl` that opens a standalone page for that build (`/s/<token>`), without entering the repository or signing in. Build details and installation/download actions are server-rendered and work with JavaScript disabled; the share page has no link back to the dashboard. Statistics and signing metadata use plain text, with fewer status dots and colored labels.

| Capability       | What you can do                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Build repository | Upload IPAs, read version and provisioning metadata, and find builds by app, version, or signing type                            |
| Link sharing     | Share installation pages and QR codes, rotate or revoke links, and offer iOS OTA with trusted HTTPS                              |
| Standalone CLI   | Start a temporary distribution page with one command, upload to a persistent server, export Xcode archives, or integrate with CI |
| MCP and skill    | Give agents distribution tools over stdio / Streamable HTTP and a companion installation and verification skill                  |
| LAN hosting      | Keep IPA files and SQLite on your server, with Docker and Caddy internal HTTPS support                                           |
| Modern dashboard | Floating navigation, a focused build list, a CA installation shortcut, and mobile and system dark appearance support             |

Built with **SvelteKit · Svelte 5 · Bits UI · SCSS · Node.js · SQLite**.

## Quick start

Requires Node.js 24+ and pnpm 12.

```sh
git clone https://github.com/backrunner/iparoom.git
cd iparoom
pnpm install
pnpm cli config
# Edit ~/.iparoom/config.yaml; set a random server.adminToken (at least 24 characters).
pnpm dev
```

Install the CA from the certificate-only HTTP URL printed at startup, compare its SHA-256 fingerprint with the terminal, then open the HTTPS LAN URL (for example https://192.168.1.10:5173) and sign in with the configured admin token. Management APIs require a session or Bearer token. Sessions expire after seven days and are invalidated by token rotation.

For production, build the application before starting the server:

```sh
pnpm build
pnpm start
```

`pnpm dev`, `pnpm start`, CLI and MCP share `~/.iparoom/config.yaml`. Defaults bind all IPv4 interfaces. `server.devPort` and `server.port` control native development and persistent ports. `server.hostname` selects the name/IP in links; otherwise discovery prefers an explicit or reliably reported Ponte identity, then LAN IPv4. `server.baseUrl` sets a reverse proxy origin. Restart after changes; raw `node build` is an HTTP backend requiring its own listening/forwarded-origin environment.

## Configuration and user data

The first launch creates `~/.iparoom/config.yaml`; `iparoom config` (or `pnpm cli config` from source) creates it and prints the path. All persisted settings live in this YAML file. See the complete [`config.example.yaml`](./config.example.yaml); a minimal example:

```yaml
version: 1
server:
  hostname: 192.168.1.10
  port: 8443
  adminToken: 'replace-with-a-random-token-at-least-24-characters'
https:
  enabled: true
  caPort: 8080
share:
  openBrowser: false
```

Omitted fields use defaults. The file and private keys are mode 0600; `.iparoom` is mode 0700. Managed certificates live in `~/.iparoom/certificates`; SQLite and persistent IPAs default to `~/.iparoom/data`. Relative certificate/storage paths resolve within `.iparoom`, independently of the working directory. Temporary share data is removed at session end.

`IPAROOM_USER_DATA_DIR=/path/to/userdata` selects `/path/to/userdata/.iparoom/config.yaml`, certificates and default data. It selects the **parent userdata directory**. Explicit CLI flags override environment variables, which override YAML, which overrides defaults. Native ports use `server.port` / `server.devPort`; temporary shares use `share.port`, HTTP MCP uses `mcp.port`. `PORT` temporarily overrides the native server port. Restart the corresponding service, CLI or MCP after editing; running processes do not automatically switch ports or certificates.

First-time creation migrates legacy `~/.config/iparoom/config.json` credentials and managed CA. Native `pnpm dev/start` and `pnpm docker` also migrate known IPA Room fields from the project's old `.env`. Old files are retained as backups; subsequent launches read YAML and do not write the old directory. The migrated CA retains its fingerprint, so device root trust remains valid. Legacy `IPAROOM_CONFIG_DIR` / `IPAROOM_CERT_DIR` identify migration sources only. Existing YAML is never overwritten by legacy settings.

## CLI

Build and install the standalone package, including the compiled web server:

```sh
pnpm pack:cli
npm install -g ./dist/iparoom-cli-0.1.0.tgz
iparoom ./MyApp.ipa
```

The direct-file command runs from any directory. It listens on all IPv4 interfaces, selects a private LAN address for links and an available port, imports the IPA, opens its installation page, and prints its URL and terminal QR code. No server setup or login is needed. Press Ctrl+C to stop the temporary server and remove its private IPA copy; the original file stays untouched. Share links stop working when the process exits. This mode ignores project `.env` files and saved remote credentials.

```sh
iparoom "/path/App with spaces.ipa" --notes "Regression build"
iparoom ./exports --no-open --json
iparoom ./MyApp.ipa --hostname ipa.lan --port 8443 --cert ./server.crt --key ./server.key --ca ./root.crt
```

HTTPS is enabled by default using a persistent local CA. The top-right Install CA entry downloads a root-certificate profile. Device trust and eligible app signing are still required. Use `--http` for explicit HTTP downloads. `--host` defaults to `0.0.0.0`, or can select a local IPv4. `--hostname` sets the advertised DNS name/IP; devices must resolve it to the server. Certificate hostname/key mismatches are rejected; `--port` defaults to 0 for automatic allocation. `--no-open` suppresses browser launch. `--json` prints startup metadata without the terminal QR code. Node.js 24+ is required. Xcode is only required for archive export, not serving exported IPA files. The package has not been published to npm.

To use an existing persistent server:

```sh
iparoom login --server https://192.168.1.10:8443
iparoom upload ./exports/MyApp.ipa --notes "Regression build"
iparoom export ./MyApp.xcarchive --options ./ExportOptions.plist --output ./exports
iparoom list --json
iparoom info <id> --json
iparoom share <id> --revoke
iparoom share <id> # Rotate the share link.
iparoom delete <id> --yes
iparoom logout
```

Login prompts for a hidden token. CI can inject `IPAROOM_SERVER` and `IPAROOM_TOKEN` and skip login. Credentials are stored in `client` fields of `~/.iparoom/config.yaml` with mode 0600. Login/logout update credentials while preserving other settings and comments. JSON goes to stdout, diagnostics and Xcode logs to stderr. Failures exit with code 1. Directory upload requires exactly one IPA. Tokens are never CLI arguments; authenticated requests do not follow redirects.

From source, use `pnpm cli ...`. For `npm link`, first run `pnpm build:cli`. `export` refuses output directories that already contain an IPA to prevent stale uploads; use a fresh export directory. It invokes `xcodebuild -exportArchive`; Xcode manages accounts, certificates, provisioning, and ExportOptions.plist.

## Independent MCP

The package exposes both `iparoom mcp` and the standalone `iparoom-mcp` executable. It starts its own temporary IPA web server, without an existing service or remote login. Default stdio sends only MCP protocol messages to stdout and logs to stderr.

```sh
iparoom-mcp --hostname ipa.lan --port 8443 --cert ./server.crt --key ./server.key --ca ./root.crt
```

Generic agent configuration (managed HTTPS is the default):

```json
{
  "mcpServers": {
    "iparoom": {
      "command": "iparoom-mcp",
      "args": []
    }
  }
}
```

Tools: `iparoom_create_install_link` accepts a local `path` and optional `notes`; `iparoom_list_builds` lists session builds; `iparoom_get_install_link` reads existing links by `id`; `iparoom_revoke_share` revokes them; `iparoom_server_status` reports endpoints and binding. Results include structured metadata, URLs, SHA-256, and unverified device-installation status. One process supports multiple IPAs. The path belongs to the MCP host, not the remote caller's computer.

`--host` defaults to `0.0.0.0`; `--hostname` sets all advertised page, manifest and IPA URLs. `--port` controls the IPA server and defaults to an available port. EOF, SIGINT or SIGTERM closes the servers and deletes temporary copies; original IPAs are preserved. Keep MCP running while testers use its links. No browser opens automatically.

For LAN clients, use stateless Streamable HTTP:

```sh
# Inject IPAROOM_MCP_TOKEN (at least 24 characters) through the environment.
iparoom-mcp --transport http --hostname ipa.lan --mcp-port 3001
```

Connect to `https://ipa.lan:3001/mcp` with `Authorization: Bearer <IPAROOM_MCP_TOKEN>`. `--mcp-port` is independent of the IPA web port. Both ports use the same HTTPS certificate by default. Trust the root using `NODE_EXTRA_CA_CERTS`; `--http` explicitly opts into HTTP. Host/Origin checks and a 64 KiB JSON limit apply. Stdio requires no MCP token. Independent CLI/MCP modes do not load project `.env` files; read the shared userdata YAML, with flags/environment available for temporary overrides. HTTP still provides download-only IPA delivery; OTA requires trusted HTTPS and eligible signing.

### Add it to an agent client

After installing the CLI package, add a user-level stdio MCP:

```sh
codex mcp add iparoom -- iparoom-mcp
claude mcp add --scope user --transport stdio iparoom -- iparoom-mcp
gemini mcp add --scope user --transport stdio iparoom iparoom-mcp
```

GUI clients may not inherit your terminal's nvm/PATH. In that case, use an absolute Node 24+ path as `command` and the installed package's absolute `bin/iparoom-mcp.mjs` path in `args`, followed by hostname/certificate flags when needed. Refresh MCP or start a new client session and verify all five tools. Gemini enables servers only in trusted directories; retain existing tool approval and directory trust settings.

## Agent skill

The companion [`iparoom-install`](./skills/iparoom-install/SKILL.md) skill guides agents through Xcode export, direct/persistent LAN distribution, internal HTTPS trust, file integrity checks, and device installation evidence.

```sh
iparoom skill install
iparoom skill install --path /path/to/agent/skills --json
# Install directly from the source repository:
pnpm skill:install
```

The default destination is `$CODEX_HOME/skills` or `~/.codex/skills`. `--path` selects the parent skills directory. Invoke `$iparoom-install` in a new skill-enabled agent task; automatic discovery stays enabled. The bundled Python 3 stdlib script checks pages, HEAD/Range downloads, HTTPS plist manifests, and SHA-256. It does not equate delivery with device installation. Identical installs are idempotent; differing local skills are preserved rather than overwritten.

## CA and HTTPS

`pnpm dev`, `pnpm start`, standalone CLI, and MCP default to managed HTTPS. Initial issuance requires system OpenSSL. The persistent CA uses RSA 3072 / SHA-256 and a ten-year lifetime; 90-day server certificates use RSA 2048 / SHA-256, `CA:FALSE`, `serverAuth`, and SANs for the advertised hostname, LAN IP, localhost / 127.0.0.1, and any known Ponte identity. Leaves renew near expiry on the next startup without changing the CA. An expiring CA or mismatched key is rejected rather than silently replaced.

Managed CA files live in userdata under `.iparoom/certificates`, defaulting to `~/.iparoom/certificates`. `IPAROOM_USER_DATA_DIR` moves configuration, certificates and default storage together. Directory permissions are 0700, private keys 0600. Keys are excluded from pages, profiles, IPA storage, and packages. Issuance is locked across processes. After an abnormal exit, remove the reported `.issuance-lock` only after confirming no issuance process is running. Keep the CA key with backups; selecting different userdata without retaining the CA requires devices to trust a new root.

For first-time trust, open the printed HTTP `/ca` URL in device Safari, compare its SHA-256 fingerprint with the terminal, and download the `.mobileconfig`. Install under Settings → General → VPN & Device Management, then enable full trust under General → About → Certificate Trust Settings. Return to the HTTPS build link. The profile contains only a public root, without private keys, SCEP, or management enrollment. The HTTP bootstrap never serves login, admin APIs, IPA files, or directory listings. Set `https.caPort` in YAML, or override with `--ca-port` / `IPAROOM_CA_PORT`.

CLI/MCP JSON includes `certificateInstallUrl`, `caCertificatePath`, `caFingerprint`, `managedCertificates`, and Ponte discovery results. `--http` opts into HTTP; persistent local startup accepts YAML `https.enabled: false`, a temporary `IPAROOM_HTTPS=0` override, or an explicit HTTP base URL. Existing certificates use `--cert/--key`; adding `--ca` verifies the chain and exposes its public root for installation. YAML equivalents are `https.certificate`, `https.privateKey`, and `https.caCertificate`; the corresponding environment variables remain available for temporary overrides. Publicly trusted certificates need no custom CA installation entry.

### Surge Ponte

Discovery reads only Surge CLI `--raw status` and requires an explicitly reported Ponte identity; it never guesses from the macOS computer name or reads Surge profiles/keys. Some Surge versions do not report a Ponte identity through this interface; discovery then falls back to LAN IP. Set YAML `ponte.hostname: my-mac.sgponte`, `IPAROOM_PONTE_HOSTNAME`, or `--ponte-hostname my-mac.sgponte` when the real domain is known. It becomes the default share hostname, while LAN IP SANs remain available. Explicit hostname/base URL settings take precedence; disable automatic selection with `--no-ponte` / `IPAROOM_PONTE=0`.

Surge resolves `.sgponte`, so clients need an enabled, authorized Ponte connection; ordinary DNS does not serve these domains. `pnpm docker` discovers Ponte on the host; containers cannot query Surge themselves. Set YAML `server.hostname` to the actual Ponte domain when needed. TLS/network tests do not establish real-device Ponte connectivity or device CA trust.

References: [Surge Ponte](https://manual.nssurge.com/features/ponte.html), [Apple root certificate trust](https://support.apple.com/en-us/102390).

## LAN deployment

Docker reads the same `~/.iparoom/config.yaml`. Requires Node.js 24+, installed project dependencies and Docker Compose 2.24.4+ (`!reset` support). Run from the repository:

```sh
pnpm docker up -d --build
pnpm docker logs --tail 50
pnpm docker down
```

Managed HTTPS uses Caddy internal TLS. `server.port` is the public port (default 3000); `https.caPort` controls the certificate-only HTTP bootstrap (0 falls back to 8080). `server.host` controls binding. Set `server.hostname` to a device-reachable IP/name, such as `192.168.1.10`, and set a random `server.adminToken`. Default endpoints are `https://192.168.1.10:3000` and `http://192.168.1.10:8080/ca`. Any `server.baseUrl` must match hostname, public port and HTTPS mode.

`https.enabled: false` runs HTTP management/downloads only, without OTA. Re-run `pnpm docker up -d --build` after edits; the wrapper adds `--force-recreate` so atomic editor/CLI saves are rebound to the new YAML file. A plain container restart cannot refresh a bind mount of a replaced file. Set `IPAROOM_DOCKER_COMMAND=/path/to/docker-compose` for a standalone Compose executable.

The canonical YAML is mounted read-only into the app container. Persistent data maps to `storage.dataDir`. Caddy CA/runtime data live in `~/.iparoom/caddy/data`, runtime configuration in `~/.iparoom/caddy/config`. CA private keys are not mounted into the app; it fetches only the public root over the internal network. Caddy and native OpenSSL use independent CAs, so verify the corresponding fingerprint at first installation. Previous Docker named volumes are retained, not automatically moved: back them up and copy old IPA/SQLite data into the new storage directory, and old Caddy `/data` into `.iparoom/caddy/data` to preserve its trusted root.

After Caddy generates its CA, open HTTP `/ca` in device Safari or use the top-right Install CA entry. Install the profile, enable full trust under Settings → General → About → Certificate Trust Settings, then open HTTPS. Only public roots are distributed.

Node clients can trust the matching CA without changing system trust:

```sh
pnpm docker cp caddy:/data/caddy/pki/authorities/local/root.crt "$HOME/.iparoom/caddy-root.crt"
NODE_EXTRA_CA_CERTS="$HOME/.iparoom/caddy-root.crt" \
  pnpm cli login --server https://192.168.1.10:3000
```

For organizational certificates/proxies, use native `pnpm start` with supplied TLS files or an HTTP backend with `server.baseUrl`. Certificates must match the device-visible hostname/IP. Deploy one instance and back up configuration, certificates, SQLite and IPA files. Wi-Fi client isolation can prevent connectivity. Token rotation invalidates existing sessions.

References: [Caddy local HTTPS](https://caddyserver.com/docs/automatic-https#local-https), [Apple certificate trust](https://support.apple.com/en-us/102390).

## Installation boundaries

OTA requires device-reachable LAN HTTPS with a certificate trusted by iOS. Open the installation page in iPhone/iPad Safari on the same LAN. Hosting remains private, although some signing validation may still require device access to Apple services. Ad Hoc and development provisioning usually require the device UDID in the profile; enterprise use is governed by Apple's Enterprise Program. App Store packages should be distributed through TestFlight or the App Store.

Provisioning metadata is a hint, not cryptographic signature verification. The service does not sign or re-sign applications. Expired, unknown, App Store, or HTTP-only builds show download access without an OTA button. A distribution URL does not create a remote LLDB connection; live debugging still requires an Xcode-supported device connection.

For a path without web HTTPS, download the IPA over LAN HTTP to a Mac and install it on an authorized connected device with Xcode / Device Hub or Apple Configurator. See the bilingual [device installation options](./skills/iparoom-install/references/nonhttps-installation.md). Automatic `iparoom devices` / `iparoom install` commands are proposed and not yet implemented.

Share URLs provide access to anyone who possesses them. Revocation and rotation invalidate the old page, manifest, and download URLs for future requests. Downloads already in progress and apps already installed are unaffected.

Tests use synthetic IPA fixtures, including binary Info.plist files. They verify API, CLI, browser, manifests, download integrity, byte ranges, and revocation. Fixtures are not signed installable apps; real-device OTA validation needs a valid signed IPA, trusted LAN HTTPS, and an eligible device.

See [Apple wireless distribution](https://support.apple.com/en-gb/guide/deployment/depce7cefc4d/1/web), [SvelteKit Node deployment](https://svelte.dev/docs/kit/adapter-node), and [Chinese API/configuration documentation](./README.md).

## Development and contributing

[Issues](https://github.com/backrunner/iparoom/issues) and pull requests are welcome. Install dependencies with the quick-start instructions. For changes to the interface, CLI, or distribution behavior, update both language versions of the documentation and describe your validation in the PR.

```sh
pnpm check
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm format:check
```

Browser tests use synthetic IPAs and cover uploads, search, signing filters, share-link management, downloads, and mobile layouts. Device installation results need separate verification.

## License

Copyright 2026 IPA Room contributors.

Licensed under the [Apache License 2.0](./LICENSE). The CLI distribution includes the same complete license.
