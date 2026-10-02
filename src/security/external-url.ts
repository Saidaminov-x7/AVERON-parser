import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const marketplaceDomains = [
  "1688.com",
  "alibaba.com",
  "alicdn.com",
  "taobao.com",
  "tmall.com",
  "tbcdn.cn",
];

export type AddressResolver = (hostname: string) => Promise<readonly string[]>;

async function resolveAddresses(hostname: string): Promise<readonly string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map(({ address }) => address);
}

function ipv4Value(address: string): number | undefined {
  if (isIP(address) !== 4) return undefined;
  return address.split(".").reduce((value, octet) => (value * 256) + Number(octet), 0);
}

function ipv4InRange(address: string, network: number, prefix: number): boolean {
  const value = ipv4Value(address);
  return value !== undefined && (value >>> (32 - prefix)) === (network >>> (32 - prefix));
}

const nonPublicIpv4Ranges: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

function isPublicIpv4(address: string): boolean {
  return ipv4Value(address) !== undefined
    && !nonPublicIpv4Ranges.some(([network, prefix]) => ipv4InRange(address, network, prefix));
}

function ipv6Value(address: string): bigint | undefined {
  let value = address.toLowerCase();
  if (value.includes(".")) {
    const separator = value.lastIndexOf(":");
    if (separator < 0 || isIP(value.slice(separator + 1)) !== 4) return undefined;
    const octets = value.slice(separator + 1).split(".").map(Number);
    const high = ((octets[0]! << 8) | octets[1]!).toString(16);
    const low = ((octets[2]! << 8) | octets[3]!).toString(16);
    value = `${value.slice(0, separator)}:${high}:${low}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return undefined;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[\da-f]{1,4}$/.test(group))) return undefined;
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;

  const value = ipv6Value(address);
  if (value === undefined || value === 0n || value === 1n) return false;
  const inRange = (base: bigint, bits: bigint) => value >> (128n - bits) === base >> (128n - bits);
  return !(
    !inRange(0x2000n << 112n, 3n)
    || value >> 32n === 0xffffn
    || value >> 32n === 0n
    || inRange(0xfc00n << 112n, 7n)
    || inRange(0xfe80n << 112n, 10n)
    || inRange(0x2001n << 112n, 23n)
    || inRange(0x20010db8n << 96n, 32n)
    || inRange(0x2002n << 112n, 16n)
    || inRange(0x3fffn << 112n, 20n)
    || inRange(0x0064ff9bn << 96n, 96n)
    || inRange(0x0064ff9b0001n << 80n, 48n)
  );
}

function isMarketplaceDomain(hostname: string): boolean {
  return marketplaceDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

export function isSupported1688ProductUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname.toLowerCase() === "detail.1688.com"
      && /^\/offer\/\d+\.html$/.test(url.pathname);
  } catch {
    return false;
  }
}

export async function isSafeMarketplaceRequestUrl(
  value: string,
  resolve: AddressResolver = resolveAddresses,
): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const hostname = normalizeHostname(url.hostname);
  if (
    url.protocol !== "https:"
    || url.username.length > 0
    || url.password.length > 0
    || !isMarketplaceDomain(hostname)
    || (url.port !== "" && url.port !== "443")
  ) {
    return false;
  }

  return (await resolveSafeMarketplaceAddresses(hostname, resolve)) !== undefined;
}

function normalizeHostname(value: string): string {
  return value.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
}

export async function resolveSafeMarketplaceAddresses(
  value: string,
  resolve: AddressResolver = resolveAddresses,
): Promise<readonly string[] | undefined> {
  const hostname = normalizeHostname(value);
  if (!isMarketplaceDomain(hostname)) return undefined;

  try {
    const addresses = await resolve(hostname);
    return addresses.length > 0 && addresses.every(isPublicAddress) ? addresses : undefined;
  } catch {
    return undefined;
  }
}
