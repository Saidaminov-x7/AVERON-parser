import assert from "node:assert/strict";
import { connect } from "node:net";
import { PassThrough } from "node:stream";
import test from "node:test";
import { MarketplaceEgressProxy } from "../src/security/marketplace-egress-proxy.js";

async function connectThroughProxy(proxyUrl: string, authority: string): Promise<string> {
  const proxy = new URL(proxyUrl);
  const socket = connect(Number(proxy.port), proxy.hostname);
  return new Promise((resolve, reject) => {
    let response = "";
    socket.setEncoding("utf8");
    socket.setTimeout(3000, () => socket.destroy(new Error("PROXY_RESPONSE_TIMEOUT")));
    socket.once("error", reject);
    socket.on("data", (chunk: string) => {
      response += chunk;
      if (response.includes("\r\n\r\n")) {
        socket.end();
        resolve(response);
      }
    });
    socket.once("connect", () => socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`));
  });
}

test("dials the vetted DNS answer directly and resolves only once per browser connection", async () => {
  let resolutionCount = 0;
  const dialed: Array<{ address: string; port: number }> = [];
  const proxy = new MarketplaceEgressProxy({
    resolve: async () => {
      resolutionCount += 1;
      return resolutionCount === 1 ? ["93.184.216.34"] : ["127.0.0.1"];
    },
    connectToAddress: async (address, port) => {
      dialed.push({ address, port });
      return new PassThrough();
    },
  });
  const proxyUrl = await proxy.start();

  try {
    const response = await connectThroughProxy(proxyUrl, "detail.1688.com:443");
    assert.match(response, /^HTTP\/1\.1 200 Connection Established/);
    assert.equal(resolutionCount, 1);
    assert.deepEqual(dialed, [{ address: "93.184.216.34", port: 443 }]);
  } finally {
    await proxy.close();
  }
});

test("rejects a public-to-public-to-private redirect chain at the private connection", async () => {
  let resolutionCount = 0;
  const dialed: string[] = [];
  const proxy = new MarketplaceEgressProxy({
    resolve: async () => {
      resolutionCount += 1;
      return resolutionCount < 3
        ? ["93.184.216.34"]
        : ["169.254.169.254"];
    },
    connectToAddress: async (address) => {
      dialed.push(address);
      return new PassThrough();
    },
  });
  const proxyUrl = await proxy.start();

  try {
    for (let hop = 0; hop < 2; hop += 1) {
      assert.match(
        await connectThroughProxy(proxyUrl, "detail.1688.com:443"),
        /^HTTP\/1\.1 200 Connection Established/,
      );
    }
    assert.match(
      await connectThroughProxy(proxyUrl, "detail.1688.com:443"),
      /^HTTP\/1\.1 403 Forbidden/,
    );
    assert.equal(resolutionCount, 3);
    assert.deepEqual(dialed, ["93.184.216.34", "93.184.216.34"]);
  } finally {
    await proxy.close();
  }
});

test("rejects direct private, loopback, metadata, and non-HTTPS tunnel targets", async () => {
  let dialCount = 0;
  const proxy = new MarketplaceEgressProxy({
    resolve: async () => ["93.184.216.34"],
    connectToAddress: async () => {
      dialCount += 1;
      return new PassThrough();
    },
  });
  const proxyUrl = await proxy.start();

  try {
    for (const authority of [
      "127.0.0.1:443",
      "169.254.169.254:443",
      "[::1]:443",
      "detail.1688.com:80",
    ]) {
      assert.match(
        await connectThroughProxy(proxyUrl, authority),
        /^HTTP\/1\.1 403 Forbidden/,
        authority,
      );
    }
    assert.equal(dialCount, 0);
  } finally {
    await proxy.close();
  }
});
