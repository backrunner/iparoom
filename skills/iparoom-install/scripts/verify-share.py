#!/usr/bin/env python3
"""Verify IPA Room delivery without claiming a device installation. Python 3 stdlib only."""
import argparse
import hashlib
import html
import json
import plistlib
import re
import ssl
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def install_url(value):
    parts = urlsplit(value)
    if (parts.scheme not in ('http', 'https') or not parts.hostname
            or parts.username or parts.password or parts.query or parts.fragment
            or not re.fullmatch(r'/s/[a-f0-9]{48}', parts.path)):
        raise ValueError('Expected an HTTP(S) IPA Room /s/<token> installation URL')
    return value


def bounded_read(response, limit):
    data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Response exceeds metadata size limit')
    return data


def verify(args):
    report = {'ok': False, 'deviceInstallation': 'not-verified',
              'deviceCertificateTrust': 'not-verified', 'codeSignature': 'not-verified'}
    try:
        build = {}
        if args.input:
            raw = Path(args.input).read_bytes()
            if len(raw) > 1048576:
                raise ValueError('CLI result JSON exceeds 1 MiB')
            build = json.loads(raw)['build']
            if not isinstance(build, dict):
                raise ValueError('CLI result must contain a build object')
            page_url = install_url(build['installUrl'])
        else:
            page_url = install_url(args.url)
        download_url, manifest_url = page_url + '/download', page_url + '/manifest.plist'
        if build:
            if build.get('downloadUrl') != download_url or build.get('manifestUrl') != manifest_url:
                raise ValueError('CLI links do not match the installation page origin/path')
        report['installUrl'] = page_url
        context = ssl.create_default_context(cafile=args.ca)
        opener = build_opener(NoRedirect(), HTTPSHandler(context=context))

        def fetch(url, method='GET', headers=None):
            return opener.open(Request(url, method=method, headers=headers or {}), timeout=args.timeout)

        with fetch(page_url) as response:
            if response.status != 200:
                raise ValueError('Installation page did not return HTTP 200')
            page = bounded_read(response, 1048576).decode('utf-8')
            if 'IPA Room' not in page or (build.get('bundleId') and html.escape(build['bundleId'], quote=False) not in page):
                raise ValueError('Installation page does not match IPA Room/build metadata')
        report['pageVerified'] = True
        with fetch(download_url, method='HEAD') as response:
            if response.status != 200 or response.headers.get_content_type() != 'application/octet-stream':
                raise ValueError('IPA HEAD response is invalid')
            size = int(response.headers.get('Content-Length', '-1'))
            if size <= 0 or size > args.max_bytes:
                raise ValueError('IPA size is missing, empty, or exceeds --max-bytes')
            if build.get('size') is not None and size != build['size']:
                raise ValueError('IPA Content-Length does not match CLI metadata')
        with fetch(download_url, headers={'Range': 'bytes=0-3'}) as response:
            if response.status != 206 or response.headers.get('Content-Range') != f'bytes 0-3/{size}':
                raise ValueError('IPA byte-range response is invalid')
            if bounded_read(response, 4) != b'PK\x03\x04':
                raise ValueError('IPA does not have the ZIP header')
        report.update(downloadVerified=True, size=size, rangeVerified=True)
        if urlsplit(page_url).scheme == 'https':
            with fetch(manifest_url) as response:
                if response.status != 200:
                    raise ValueError('OTA manifest did not return HTTP 200')
                manifest = plistlib.loads(bounded_read(response, 1048576))
            items = manifest.get('items', [])
            if len(items) != 1:
                raise ValueError('Manifest must describe exactly one application')
            item = items[0]
            assets = [asset for asset in item.get('assets', []) if asset.get('kind') == 'software-package']
            metadata = item.get('metadata', {})
            if len(assets) != 1 or assets[0].get('url') != download_url or metadata.get('kind') != 'software':
                raise ValueError('Manifest IPA URL or application kind is invalid')
            if build and (metadata.get('bundle-identifier') != build.get('bundleId')
                          or metadata.get('bundle-version') != build.get('buildNumber')):
                raise ValueError('Manifest bundle identifier/build number does not match CLI metadata')
            report.update(httpsVerifiedFromThisHost=True, otaManifestVerified=True)
        else:
            try:
                with fetch(manifest_url) as response:
                    raise ValueError('HTTP unexpectedly exposes an OTA manifest')
            except HTTPError as error:
                if error.code != 409:
                    raise
            report.update(httpsVerifiedFromThisHost=False, otaManifestVerified=False)
        if args.full:
            expected = build.get('sha256')
            if expected is not None and not re.fullmatch(r'[a-f0-9]{64}', expected):
                raise ValueError('CLI SHA-256 is invalid')
            digest, count, started = hashlib.sha256(), 0, time.monotonic()
            with fetch(download_url) as response:
                if response.status != 200:
                    raise ValueError('Full download did not return HTTP 200')
                while True:
                    chunk = response.read(1048576)
                    if not chunk:
                        break
                    count += len(chunk)
                    if count > args.max_bytes or count > size or time.monotonic() - started > args.total_timeout:
                        raise ValueError('Full download exceeds size/time limit')
                    digest.update(chunk)
            if count != size:
                raise ValueError('Full download is truncated')
            actual = digest.hexdigest()
            if expected and actual != expected:
                raise ValueError('IPA SHA-256 does not match CLI metadata')
            report.update(sha256=actual, sha256MatchesCli=actual == expected if expected else None,
                          fullDownloadVerified=True)
        if build:
            blockers = []
            if build.get('signing') not in ('development', 'ad-hoc', 'enterprise'):
                blockers.append('Unsupported or unknown provisioning type')
            expires = build.get('profileExpiresAt')
            if expires and datetime.fromisoformat(expires.replace('Z', '+00:00')) <= datetime.now(timezone.utc):
                blockers.append('Provisioning profile is expired')
            report['provisioningHintBlockers'] = blockers
        if args.require_ota and not report['otaManifestVerified']:
            raise ValueError('HTTP provides download only; OTA needs device-trusted LAN HTTPS')
        if args.require_ota and report.get('provisioningHintBlockers'):
            raise ValueError('; '.join(report['provisioningHintBlockers']))
        report['ok'] = True
        report['delivery'] = 'https-manifest-and-download' if report['otaManifestVerified'] else 'http-download-only'
    except (OSError, ValueError, KeyError, TypeError, plistlib.InvalidFileException) as error:
        report['error'] = str(error)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--input', help='Saved iparoom --json output')
    source.add_argument('--url', help='IPA Room installation page URL (no CLI metadata comparison)')
    parser.add_argument('--ca', help='Trusted root CA certificate PEM')
    parser.add_argument('--full', action='store_true', help='Stream entire IPA and compare CLI SHA-256 if supplied')
    parser.add_argument('--require-ota', action='store_true', help='Require a verified HTTPS manifest; never proves device installation')
    parser.add_argument('--max-bytes', type=int, default=1073741824)
    parser.add_argument('--timeout', type=float, default=15, help='Network operation timeout in seconds')
    parser.add_argument('--total-timeout', type=float, default=300, help='Full download time budget in seconds')
    args = parser.parse_args()
    if args.max_bytes <= 0 or args.timeout <= 0 or args.total_timeout <= 0:
        parser.error('Size and timeout limits must be positive')
    report = verify(args)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
