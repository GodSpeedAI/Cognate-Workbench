// #114 H4 (delta-2 class fix): for `network: none` the seccomp filter ALLOW-LISTS socket families instead of denying known-bad
// ones. Evaluated by a small classic-BPF interpreter written here (independent of the assembler under test); every denial is
// paired with the allowed neighbour that proves the branch discriminates.
import { describe, expect, test } from "bun:test";
import { AF, AUDIT_ARCH_AARCH64, AUDIT_ARCH_X86_64, EACCES, EPERM, SECCOMP_RET_ALLOW, SECCOMP_RET_ERRNO, SECCOMP_RET_KILL_PROCESS, SOCK, SYSCALLS, X32_SYSCALL_BIT, noUnixSocketFilter } from "../src/capabilities/containedSeccomp.ts";

interface Data { nr: number; arch: number; args: number[] }
/** Evaluate struct sock_filter[] over a seccomp_data; returns the SECCOMP_RET_* value. */
function run(program: Buffer, data: Data): number {
  expect(program.length % 8).toBe(0);
  const word = (offset: number): number => {
    if (offset === 0) return data.nr >>> 0;
    if (offset === 4) return data.arch >>> 0;
    if (offset >= 16 && offset < 64 && (offset - 16) % 8 === 0) return (data.args[(offset - 16) / 8] ?? 0) >>> 0;
    throw new Error(`filter read an unmodelled offset ${offset}`);
  };
  let a = 0; let pc = 0;
  for (let steps = 0; steps < 128; steps++) {
    const code = program.readUInt16LE(pc * 8); const jt = program[pc * 8 + 2]!; const jf = program[pc * 8 + 3]!; const k = program.readUInt32LE(pc * 8 + 4);
    if (code === 0x20) { a = word(k); pc += 1; }
    else if (code === 0x54) { a = (a & k) >>> 0; pc += 1; }                  // BPF_ALU | BPF_AND | BPF_K
    else if (code === 0x15) pc += 1 + (a === k ? jt : jf);
    else if (code === 0x35) pc += 1 + (a >= k ? jt : jf);
    else if (code === 0x06) return k;
    else throw new Error(`unmodelled opcode ${code}`);
  }
  throw new Error("filter did not terminate");
}
const filter = noUnixSocketFilter();
const sys = (arch: number, nr: number, ...args: number[]): number => run(filter.bytes, { arch, nr, args });
const DENY = SECCOMP_RET_ERRNO | EACCES;
const ARCHES = [["x86_64", AUDIT_ARCH_X86_64, SYSCALLS.x86_64] as const, ["aarch64", AUDIT_ARCH_AARCH64, SYSCALLS.aarch64] as const];

describe("socket families are an allowlist", () => {
  for (const [name, arch, nr] of ARCHES) {
    test(`${name}: socket() allows AF_INET, AF_INET6 and NETLINK_ROUTE only; every other family and netlink protocol is EACCES`, () => {
      for (const family of [AF.INET, AF.INET6]) for (const type of [SOCK.STREAM, SOCK.DGRAM, SOCK.RAW, SOCK.STREAM | 0x80800]) expect(sys(arch, nr.socket, family, type, 0)).toBe(SECCOMP_RET_ALLOW); // controls
      expect(sys(arch, nr.socket, AF.NETLINK, SOCK.RAW, 0)).toBe(SECCOMP_RET_ALLOW);              // NETLINK_ROUTE, which getaddrinfo uses
      expect(sys(arch, nr.socket, AF.NETLINK, SOCK.RAW | 0x80000, 0)).toBe(SECCOMP_RET_ALLOW);
      for (const protocol of [1, 2, 9, 15, 16, 18, 31]) expect(sys(arch, nr.socket, AF.NETLINK, SOCK.RAW, protocol)).toBe(DENY);
      for (const family of [AF.UNIX, AF.VSOCK, AF.PACKET, AF.BLUETOOTH, AF.TIPC, AF.XDP, AF.KEY, AF.CAN, AF.ALG, AF.UNSPEC, 255, 0x7fffffff]) expect(sys(arch, nr.socket, family, SOCK.STREAM, 0)).toBe(DENY);
    });
    test(`${name}: socketpair() is allowed only for AF_UNIX stream and seqpacket (ignoring NONBLOCK|CLOEXEC); datagram and other families are EACCES`, () => {
      for (const type of [SOCK.STREAM, SOCK.SEQPACKET, SOCK.STREAM | 0x80800, SOCK.SEQPACKET | 0x800]) expect(sys(arch, nr.socketpair, AF.UNIX, type, 0)).toBe(SECCOMP_RET_ALLOW);
      for (const type of [SOCK.DGRAM, SOCK.DGRAM | 0x80800, SOCK.RAW, SOCK.RDM, 0, 6, 0x10]) expect(sys(arch, nr.socketpair, AF.UNIX, type, 0)).toBe(DENY);
      for (const family of [AF.INET, AF.INET6, AF.VSOCK, AF.NETLINK, AF.TIPC]) expect(sys(arch, nr.socketpair, family, SOCK.STREAM, 0)).toBe(DENY);
    });
    test(`${name}: io_uring_setup is EPERM; unrelated syscalls and the neighbours of the socket calls are allowed`, () => {
      expect(sys(arch, SYSCALLS.io_uring_setup, 8, 0)).toBe(SECCOMP_RET_ERRNO | EPERM);
      for (const other of [0, 1, 3, 56, 59, 231, SYSCALLS.io_uring_setup + 1, SYSCALLS.io_uring_setup - 1, nr.socket + 2, nr.socketpair + 1, nr.socket - 1]) expect(sys(arch, other, AF.UNIX, SOCK.DGRAM)).toBe(SECCOMP_RET_ALLOW);
    });
  }
  test("the datagram attack: socketpair(AF_UNIX, SOCK_DGRAM) is denied while the stream pair next to it works", () => {
    expect(sys(AUDIT_ARCH_X86_64, SYSCALLS.x86_64.socketpair, AF.UNIX, SOCK.DGRAM, 0)).toBe(DENY);
    expect(sys(AUDIT_ARCH_X86_64, SYSCALLS.x86_64.socketpair, AF.UNIX, SOCK.STREAM, 0)).toBe(SECCOMP_RET_ALLOW);
  });
});

describe("architecture and the x32 ABI", () => {
  test("any other architecture is killed before a syscall number is trusted", () => {
    for (const arch of [0x40000003 /* i386 */, 0x40000028 /* arm */, 0xc0000015 /* ppc64 */, 0, 0xffffffff]) expect(sys(arch, 41, AF.UNIX)).toBe(SECCOMP_RET_KILL_PROCESS);
  });
  test("x86_64 kills the x32-tagged numbers and, separately, the untagged legacy x32 range 512-547 (pre-5.4 kernels); native numbers around them are allowed", () => {
    for (const nr of [X32_SYSCALL_BIT | 41, X32_SYSCALL_BIT | 425, X32_SYSCALL_BIT, 0x7fffffff]) expect([nr, sys(AUDIT_ARCH_X86_64, nr, 0)]).toEqual([nr, SECCOMP_RET_KILL_PROCESS]); // tagged
    for (const nr of [512, 513, 520, 535, 546, 547]) expect([nr, sys(AUDIT_ARCH_X86_64, nr, 0)]).toEqual([nr, SECCOMP_RET_KILL_PROCESS]);                                   // untagged legacy
    for (const nr of [0, 1, 511, 548, 600, 0x3fffffff]) expect([nr, sys(AUDIT_ARCH_X86_64, nr, 0)]).toEqual([nr, SECCOMP_RET_ALLOW]);                 // controls
    expect(sys(AUDIT_ARCH_AARCH64, 520, 0)).toBe(SECCOMP_RET_ALLOW);                                  // the range is an x86_64 concern only
  });
  test("the filter is deterministic and identified by its digest", () => {
    expect(noUnixSocketFilter().sha256).toBe(filter.sha256);
    expect(filter.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(filter.bytes.length).toBeLessThanOrEqual(64 * 8);
    expect(filter.id).toBe("socket-allowlist-v2");
  });
});
