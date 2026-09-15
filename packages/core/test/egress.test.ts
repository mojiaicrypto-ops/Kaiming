/**
 * WP-12 W6 — the controlled egress (policy + real proxy).
 *
 * The container-level proof lives in `.agentdev/work/WP-12/w6-egress-drill.mjs` (real
 * containers, real `npm install`, real denials). This file guards the same contract at the
 * unit level so a regression is caught without Docker: the two fixed denials, the
 * default-open verdict, and a real round trip through {@link EgressProxy} for both proxy
 * shapes (absolute-URI and `CONNECT`).
 */
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EGRESS_REFUSED_MARKER,
  EgressProxy,
  NetworkPolicy,
  createEgressPolicy,
  isMetadataAddress,
} from '@agentdev/core';

describe('controlled egress (W6)', () => {
  let target: Server;
  let targetPort: number;
  let daemonStandIn: Server;
  let daemonPort: number;
  let proxy: EgressProxy;
  let proxyPort: number;

  beforeEach(async () => {
    target = createServer((request: IncomingMessage, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        response.end('redirecting');
        return;
      }
      response.end('TARGET-OK');
    });
    await new Promise<void>((done) => target.listen(0, '127.0.0.1', done));
    targetPort = (target.address() as AddressInfo).port;

    daemonStandIn = createServer((_request, response) => response.end('DAEMON-REACHED'));
    await new Promise<void>((done) => daemonStandIn.listen(0, '127.0.0.1', done));
    daemonPort = (daemonStandIn.address() as AddressInfo).port;

    const policy = createEgressPolicy({ daemonPorts: () => [daemonPort] });
    proxy = new EgressProxy({ policy, log: () => undefined });
    proxyPort = (await proxy.listen(0)).port;
  });

  afterEach(async () => {
    await proxy.close();
    await new Promise<void>((done) => target.close(() => done()));
    await new Promise<void>((done) => daemonStandIn.close(() => done()));
  });

  /** One absolute-URI request through the proxy, exactly as a client would send it. */
  function viaProxy(url: string): Promise<{ status: number; body: string; location?: string }> {
    return new Promise((done) => {
      const parsed = new URL(url);
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port: proxyPort,
          method: 'GET',
          path: url,
          headers: { host: parsed.host },
        },
        (response) => {
          let body = '';
          response.on('data', (chunk) => {
            body += String(chunk);
          });
          response.on('end', () =>
            done({
              status: response.statusCode ?? 0,
              body,
              ...(response.headers.location === undefined
                ? {}
                : { location: response.headers.location }),
            }),
          );
        },
      );
      request.on('error', () => done({ status: 0, body: '' }));
      request.end();
    });
  }

  it('opens loopback/private by default and denies only metadata and the bound ports', async () => {
    expect((await viaProxy(`http://127.0.0.1:${String(targetPort)}/ok`)).body).toBe('TARGET-OK');

    const daemon = await viaProxy(`http://127.0.0.1:${String(daemonPort)}/control`);
    expect(daemon.status).toBe(403);
    expect(daemon.body).toContain(EGRESS_REFUSED_MARKER);
    expect(daemon.body).toContain('daemon itself is listening on');

    // The bypass spellings `w1-implementation.md` §7.4 names are the same refusal.
    const alias = await viaProxy(`http://host.docker.internal:${String(daemonPort)}/control`);
    expect(alias.status).toBe(403);
    expect(alias.body).toContain('daemon itself is listening on');

    const metadata = await viaProxy('http://169.254.169.254/latest/meta-data/');
    expect(metadata.status).toBe(403);
    expect(metadata.body).toContain('metadata');

    const google = await viaProxy('http://metadata.google.internal/computeMetadata/v1/');
    expect(google.status).toBe(403);
  });

  it('denies a name whose DNS answer is a metadata address', async () => {
    const policy = new NetworkPolicy({
      resolver: {
        resolve: (host) =>
          host === 'metadata.test'
            ? Promise.resolve({ ok: true, addresses: ['169.254.169.254'] })
            : Promise.resolve({ ok: true, addresses: ['93.184.216.34'] }),
      },
    });
    const scoped = new EgressProxy({ policy, log: () => undefined });
    const port = (await scoped.listen(0)).port;
    try {
      const denied = await new Promise<number>((done) => {
        const request = httpRequest(
          {
            host: '127.0.0.1',
            port,
            path: 'http://metadata.test/latest/',
            headers: { host: 'metadata.test' },
          },
          (response) => {
            response.resume();
            done(response.statusCode ?? 0);
          },
        );
        request.on('error', () => done(0));
        request.end();
      });
      expect(denied).toBe(403);
    } finally {
      await scoped.close();
    }
  });

  it('re-checks a redirect at the hop it lands on', async () => {
    const first = await viaProxy(`http://127.0.0.1:${String(targetPort)}/redirect`);
    expect(first.status).toBe(302);
    expect(first.location).toBe('http://169.254.169.254/latest/meta-data/');
    const second = await viaProxy(first.location ?? '');
    expect(second.status).toBe(403);
    expect(second.body).toContain('metadata');
  });

  it('tunnels CONNECT to an allowed target and refuses one to metadata', async () => {
    const established = await new Promise<{ status: number; body: string }>((done) => {
      const request = httpRequest({
        host: '127.0.0.1',
        port: proxyPort,
        method: 'CONNECT',
        path: `127.0.0.1:${String(targetPort)}`,
      });
      request.on('connect', (response, socket) => {
        socket.write(`GET /tunnelled HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
        let body = '';
        socket.on('data', (chunk) => {
          body += String(chunk);
        });
        socket.on('end', () => done({ status: response.statusCode ?? 0, body }));
      });
      request.on('error', () => done({ status: 0, body: '' }));
      request.end();
    });
    expect(established.status).toBe(200);
    expect(established.body).toContain('TARGET-OK');

    const refused = await new Promise<number>((done) => {
      const request = httpRequest({
        host: '127.0.0.1',
        port: proxyPort,
        method: 'CONNECT',
        path: '169.254.169.254:443',
      });
      request.on('connect', (response) => {
        response.socket?.destroy();
        done(response.statusCode ?? 0);
      });
      request.on('error', () => done(0));
      request.end();
    });
    expect(refused).toBe(403);
  });

  it('recognises the metadata address family including NAT64 and IPv4-mapped forms', () => {
    expect(isMetadataAddress('169.254.169.254')).toBe(true);
    expect(isMetadataAddress('100.100.100.200')).toBe(true);
    expect(isMetadataAddress('fd00:ec2::254')).toBe(true);
    expect(isMetadataAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isMetadataAddress('64:ff9b::a9fe:a9fe')).toBe(true);
    expect(isMetadataAddress('169.254.169.253')).toBe(true);
    expect(isMetadataAddress('8.8.8.8')).toBe(false);
    expect(isMetadataAddress('127.0.0.1')).toBe(false);
    expect(isMetadataAddress('10.0.0.5')).toBe(false);
  });
});
