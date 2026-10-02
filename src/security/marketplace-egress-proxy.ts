import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import {
  resolveSafeMarketplaceAddresses,
  type AddressResolver,
} from "./external-url.js";

type PinnedConnector = (address: string, port: number) => Promise<Duplex>;

interface EgressProxyOptions {
  resolve?: AddressResolver;
  connectToAddress?: PinnedConnector;
}

function connectToAddress(address: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: address, port });
    socket.setTimeout(10_000, () => socket.destroy(new Error("EGRESS_PROXY_UPSTREAM_TIMEOUT")));
    const onError = (error: Error) => {
      socket.off("connect", onConnect);
      reject(error);
    };
    const onConnect = () => {
      socket.off("error", onError);
      socket.setTimeout(0);
      resolve(socket);
    };
    socket.once("error", onError);
    socket.once("connect", onConnect);
  });
}

function parseConnectTarget(authority: string): { hostname: string; port: number } | undefined {
  if (!authority || authority.length > 1024 || /[%/@?#\s]/.test(authority)) return undefined;
  try {
    const url = new URL(`https://${authority}`);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
    const port = url.port ? Number(url.port) : 443;
    if (
      url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash
      || port !== 443
    ) {
      return undefined;
    }
    return { hostname, port };
  } catch {
    return undefined;
  }
}

function respond(socket: Duplex, status: number, text: string): void {
  if (!socket.destroyed) {
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
}

export class MarketplaceEgressProxy {
  private server?: Server;
  private readonly sockets = new Set<Duplex>();

  constructor(
    private readonly options: EgressProxyOptions = {},
  ) {}

  async start(): Promise<string> {
    if (this.server) throw new Error("EGRESS_PROXY_ALREADY_STARTED");
    const server = createServer();
    server.maxConnections = 64;
    server.on("connect", (request, client, head) => {
      this.sockets.add(client);
      const timeout = setTimeout(() => respond(client, 504, "Gateway Timeout"), 10_000);
      client.once("close", () => {
        clearTimeout(timeout);
        this.sockets.delete(client);
      });
      client.on("error", () => client.destroy());
      void this.forward(request.url, client, head, timeout);
    });
    server.on("request", (_request, response) => {
      response.writeHead(405, { connection: "close" }).end();
    });
    server.on("clientError", (_error, socket) => respond(socket, 400, "Bad Request"));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    }).catch((error: unknown) => {
      this.server = undefined;
      throw error;
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("EGRESS_PROXY_INVALID_ADDRESS");
    return `http://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  private async forward(
    authority: string | undefined,
    client: Duplex,
    head: Buffer,
    timeout: NodeJS.Timeout,
  ): Promise<void> {
    if (!authority || client.destroyed) {
      respond(client, 403, "Forbidden");
      return;
    }
    const target = parseConnectTarget(authority);
    if (!target) {
      respond(client, 403, "Forbidden");
      return;
    }
    const addresses = await resolveSafeMarketplaceAddresses(
      target.hostname,
      this.options.resolve,
    );
    if (!addresses) {
      respond(client, 403, "Forbidden");
      return;
    }
    if (client.destroyed) return;

    const connector = this.options.connectToAddress ?? connectToAddress;
    let upstream: Duplex | undefined;
    for (const address of addresses) {
      try {
        upstream = await connector(address, target.port);
        break;
      } catch {
        continue;
      }
    }
    if (!upstream) {
      respond(client, 502, "Bad Gateway");
      return;
    }
    if (client.destroyed) {
      upstream.destroy();
      return;
    }

    clearTimeout(timeout);
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream?.destroy());
    upstream.once("close", () => client.destroy());
    client.once("close", () => upstream?.destroy());
    if (head.length) upstream.write(head);
    client.pipe(upstream);
    upstream.pipe(client);
  }
}
