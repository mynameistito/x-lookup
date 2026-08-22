const WEB_BOT_AUTH_PUBLIC_KEY = {
  crv: "Ed25519",
  kid: "A4VcfoUqs9uP7HA1CA1JuHrVW-0TmF3Sk649366PFME",
  kty: "OKP",
  x: "eu8wA0lJmTeKL-0U06d315aCrtGIK2bP1eFH0TewVVE",
} as const;

/** Public signing keys used by agents to identify this site. */
export const webBotAuthDirectory = (): string =>
  JSON.stringify({ keys: [WEB_BOT_AUTH_PUBLIC_KEY] });
