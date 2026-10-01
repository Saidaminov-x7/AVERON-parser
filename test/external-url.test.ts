import test from "node:test";
import assert from "node:assert/strict";
import {
  isSafeMarketplaceRequestUrl,
  isSupported1688ProductUrl,
} from "../src/security/external-url.js";

const publicResolver = async () => ["93.184.216.34"];

test("allows approved HTTPS marketplace hosts resolving to public addresses", async () => {
  assert.equal(
    await isSafeMarketplaceRequestUrl("https://detail.1688.com/offer/123.html", publicResolver),
    true,
  );
  assert.equal(
    await isSafeMarketplaceRequestUrl("https://cbu01.alicdn.com/image.jpg", publicResolver),
    true,
  );
});

test("blocks localhost, private IPs, and cloud metadata destinations", async () => {
  assert.equal(await isSafeMarketplaceRequestUrl("https://localhost/", publicResolver), false);
  assert.equal(await isSafeMarketplaceRequestUrl("https://127.0.0.1/", publicResolver), false);
  assert.equal(await isSafeMarketplaceRequestUrl("https://[::1]/", publicResolver), false);
  assert.equal(await isSafeMarketplaceRequestUrl("https://[fe80::1]/", publicResolver), false);
  assert.equal(await isSafeMarketplaceRequestUrl("http://10.1.2.3/", publicResolver), false);
  assert.equal(await isSafeMarketplaceRequestUrl("http://169.254.169.254/latest/meta-data/", publicResolver), false);
});

test("blocks marketplace hostnames resolving to private or link-local addresses", async () => {
  const privateResolver = async () => ["192.168.1.4"];
  const metadataResolver = async () => ["169.254.169.254"];

  assert.equal(
    await isSafeMarketplaceRequestUrl("https://detail.1688.com/offer/123.html", privateResolver),
    false,
  );
  assert.equal(
    await isSafeMarketplaceRequestUrl("https://detail.1688.com/offer/123.html", metadataResolver),
    false,
  );
});

test("blocks unsupported protocols, credentials, arbitrary hosts, and nonstandard ports", async () => {
  assert.equal(await isSafeMarketplaceRequestUrl("file:///etc/passwd", publicResolver), false);
  assert.equal(await isSafeMarketplaceRequestUrl("http://detail.1688.com/offer/123.html", publicResolver), false);
  assert.equal(await isSafeMarketplaceRequestUrl("https://user:pass@detail.1688.com/", publicResolver), false);
  assert.equal(await isSafeMarketplaceRequestUrl("https://attacker.example/", publicResolver), false);
  assert.equal(await isSafeMarketplaceRequestUrl("https://detail.1688.com:8443/", publicResolver), false);
});

test("redirect targets are checked by the same request guard", async () => {
  assert.equal(
    await isSafeMarketplaceRequestUrl("http://169.254.169.254/latest/meta-data/", publicResolver),
    false,
  );
});

test("product detail URLs must use the canonical HTTPS 1688 offer route", () => {
  assert.equal(isSupported1688ProductUrl("https://detail.1688.com/offer/123.html"), true);
  assert.equal(isSupported1688ProductUrl("https://attacker.1688.com/offer/123.html"), false);
  assert.equal(isSupported1688ProductUrl("https://detail.1688.com/offer/123.html@evil.example"), false);
  assert.equal(isSupported1688ProductUrl("http://detail.1688.com/offer/123.html"), false);
});
