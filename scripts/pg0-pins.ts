// The pinned pg0 release. Every digest was checked against the upstream v0.15.2 GitHub release asset
// digests; pg0 publishes bare binaries without signatures, so the sha256 pins are the trust anchor.
export const PG0_VERSION = "0.15.2";

// asset name suffix (`pg0-<key>`) -> sha256 of the released binary
export const PG0_DIGESTS: Readonly<Record<string, string>> = {
  "linux-x86_64-gnu": "06c4678ff7b461dba8ed1f95c5e202ead3b57b70f549a22c17a94985121c0bf5",
  // Verified: aarch64 ELF, highest GLIBC symbol version 2.34 (Ubuntu 22.04 ships 2.35).
  "linux-aarch64-gnu": "08bf6f5e04bc456fac2f8e76bfec5705c55f0b079f11b56efa5b1f6869e20f76",
  "darwin-aarch64": "29e9f0a2230d7c785af60482813fd5ee8d0c4e4c0561e9bdae3254e350252479",
  "darwin-x86_64": "2521f6344c29804b68e7074c05c335dfe826ef67b4a0185065750edc56ecd54e",
  "windows-x86_64.exe": "8894575679886fef41e176608da16f4448fdeea4cc60c02380422adc147260b7",
};

export function pg0Url(key: string): string {
  return `https://github.com/vectorize-io/pg0/releases/download/v${PG0_VERSION}/pg0-${key}`;
}
