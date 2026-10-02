import { X509Certificate, createHash } from 'node:crypto';
import * as plist from 'plist';

export function rootCertificate(pem) {
  if (String(pem).includes('PRIVATE KEY'))
    throw new Error('CA download must contain only a public certificate.');
  const root = new X509Certificate(pem);
  if (!root.ca || !root.checkIssued(root) || !root.verify(root.publicKey))
    throw new Error('CA must be a self-signed root certificate.');
  if (Date.parse(root.validFrom) > Date.now() || Date.parse(root.validTo) <= Date.now())
    throw new Error('CA certificate is not currently valid.');
  return root;
}
export function certificateInfo(pem) {
  const root = rootCertificate(pem);
  return {
    name: root.subject.match(/(?:^|\n)CN=([^\n]+)/)?.[1] || 'IPA Room CA',
    fingerprint: root.fingerprint256,
    expiresAt: root.validTo
  };
}
export function certificateProfile(pem) {
  const root = rootCertificate(pem);
  const id = createHash('sha256').update(root.raw).digest('hex');
  const uuid = (suffix) => {
    const h = createHash('sha256')
      .update(id + suffix)
      .digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`.toUpperCase();
  };
  const name = certificateInfo(pem).name;
  return plist.build({
    PayloadType: 'Configuration',
    PayloadVersion: 1,
    PayloadIdentifier: `room.ipa.ca.${id}`,
    PayloadUUID: uuid('profile'),
    PayloadDisplayName: name,
    PayloadDescription: 'IPA Room HTTPS root certificate',
    PayloadRemovalDisallowed: false,
    PayloadContent: [
      {
        PayloadType: 'com.apple.security.root',
        PayloadVersion: 1,
        PayloadIdentifier: `room.ipa.ca.${id}.root`,
        PayloadUUID: uuid('root'),
        PayloadDisplayName: name,
        PayloadCertificateFileName: 'iparoom-root.cer',
        PayloadContent: root.raw
      }
    ]
  });
}
export function certificateAsset(pem, name) {
  if (name === 'root.crt')
    return {
      body: rootCertificate(pem).toString(),
      type: 'application/x-x509-ca-cert',
      filename: 'iparoom-root.crt'
    };
  if (name === 'iparoom.mobileconfig')
    return {
      body: certificateProfile(pem),
      type: 'application/x-apple-aspen-config',
      filename: name
    };
  if (name === 'info.json')
    return { body: JSON.stringify(certificateInfo(pem)), type: 'application/json' };
  return null;
}
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
export function certificatePage(pem, { qr = '', origin = '' } = {}) {
  const info = certificateInfo(pem);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>安装 CA · IPA Room</title><style>
  :root{color-scheme:light dark;font-family:system-ui,-apple-system,sans-serif;color:#20242d;background:#f7f8fa}*{box-sizing:border-box}body{margin:0;padding:28px 20px}header{display:flex;align-items:center;gap:12px;max-width:720px;margin:0 auto 48px;font-weight:650;font-size:20px}main{max-width:560px;margin:auto;background:#fff;border:1px solid #e4e6eb;border-radius:16px;padding:32px}h1{font-size:25px;letter-spacing:-.5px;margin:0 0 12px}p,li{font-size:14px;line-height:1.75;color:#606673}ol{padding-left:21px}a{color:#345ef0;text-decoration:none}a.primary{display:block;background:#345ef0;color:white;text-align:center;padding:12px;border-radius:9px;font-weight:600;margin:24px 0 16px}dl{border-top:1px solid #e4e6eb;margin-top:28px;padding-top:20px;font-size:12px}dt{color:#606673;margin-bottom:7px}dd{margin:0 0 16px;overflow-wrap:anywhere;font-family:ui-monospace,monospace}aside{margin:28px auto;text-align:center;font-size:12px;color:#606673}aside img{display:block;margin:0 auto 12px;width:160px;height:160px}@media(prefers-color-scheme:dark){:root{background:#14171c;color:#edf0f4}main{background:#1c2027;border-color:#303640}p,li,dt,aside{color:#a2aab8}dl{border-color:#303640}}@media(max-width:480px){header{margin-bottom:28px}main{padding:24px}}
  </style></head><body><header><svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" aria-hidden="true" viewBox="0 0 48 48" fill="none">
  <defs>
    <linearGradient id="room" x1="7" y1="4" x2="40" y2="46" gradientUnits="userSpaceOnUse">
      <stop stop-color="#4975ff" />
      <stop offset="1" stop-color="#3152df" />
    </linearGradient>
  </defs>
  <rect width="48" height="48" rx="14" fill="url(#room)" />
  <path
    d="M23.5 35H17a4 4 0 0 1-4-4V17a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v3.5"
    stroke="white"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
  <path d="m18 14.5 5 2.5v16l-5 2V14.5Z" fill="white" fill-opacity=".2" />
  <path
    d="m26 32 8-8m-5.5 0H34v5.5"
    stroke="#c4f4e2"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>IPA Room</header><main><h1>安装 CA 证书</h1><p>安装一次，信任这台服务器签发的 HTTPS 连接。</p><a class="primary" href="/ca/iparoom.mobileconfig">下载 CA 配置文件</a><ol><li>在 iPhone / iPad 的 Safari 中下载，前往「设置 → 通用 → VPN 与设备管理」安装描述文件。</li><li>在「设置 → 通用 → 关于本机 → 证书信任设置」中，为 ${escape(info.name)} 开启完全信任。</li><li>返回构建安装链接。</li></ol><a href="/ca/root.crt">下载根证书 .crt</a><dl><dt>证书</dt><dd>${escape(info.name)}</dd><dt>SHA-256 指纹</dt><dd>${escape(info.fingerprint)}</dd><dt>有效期至</dt><dd>${escape(info.expiresAt)}</dd></dl><p>仅在指纹与启动终端一致时安装。此配置文件只包含公开根证书。</p></main>${qr ? `<aside><img src="${escape(qr)}" alt="在设备上打开 CA 安装页的二维码"><span>${escape(origin)}/ca</span></aside>` : ''}</body></html>`;
}
