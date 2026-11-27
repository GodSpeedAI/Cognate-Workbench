// #114 H4: the no-AF_UNIX seccomp filter, evaluated by a small classic-BPF interpreter written here (independent of
// the assembler under test). Every denial is paired with the allowed neighbour that proves the branch discriminates.
import { describe, expect, test } from "bun:test";
import { AF_UNIX, AUDIT_ARCH_AARCH64, AUDIT_ARCH_X86_64, EACCES, EPERM, SECCOMP_RET_ALLOW, SECCOMP_RET_ERRNO, SECCOMP_RET_KILL_PROCESS, SYSCALLS, X32_SYSCALL_BIT, noUnixSocketFilter } from "../src/capabilities/containedSeccomp.ts";

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
  for (let steps = 0; steps < 64; steps++) {
    const code = program.readUInt16LE(pc * 8); const jt = program[pc * 8 + 2]!; const jf = program[pc * 8 + 3]!; const k = program.readUInt32LE(pc * 8 + 4);
    if (code === 0x20) { a = word(k); pc += 1; }
    else if (code === 0x15) pc += 1 + (a === k ? jt : jf);
    else if (code === 0x35) pc += 1 + (a >= k ? jt : jf);
    else if (code === 0x06) return k;
    else throw new Error(`unmodelled opcode ${code}`);
  }
  throw new Error("filter did not terminate");
}
const filter = noUnixSocketFilter();
const sys = (arch: number, nr: number, ...args: number[]): number => run(filter.bytes, { arch, nr, args });
const EACCES_RET = SECCOMP_RET_ERRNO | EACCES;
const EPERM_RET = SECCOMP_RET_ERRNO | EPERM;

describe("no-unix-socket seccomp filter", () => {
  for (const [name, arch, socket] of [["x86_64", AUDIT_ARCH_X86_64, SYSCALLS.x86_64.socket], ["aarch64", AUDIT_ARCH_AARCH64, SYSCALLS.aarch64.socket]] as const) {
    test(`${name}: socket(AF_UNIX) is EACCES; INET, INET6, NETLINK and other syscalls are allowed; io_uring_setup is EPERM`, () => {
      expect(sys(arch, socket, AF_UNIX, 1, 0)).toBe(EACCES_RET);
      expect(sys(arch, socket, AF_UNIX, 2049, 0)).toBe(EACCES_RET);   // SOCK_* flags do not matter
      for (const family of [2, 10, 16, 17, 0]) expect(sys(arch, socket, family, 1, 0)).toBe(SECCOMP_RET_ALLOW); // positive controls
      for (const other of [0, 1, 3, 56, 59, 231, SYSCALLS.io_uring_setup + 1, socket + 1, socket - 1]) expect(sys(arch, other, AF_UNIX)).toBe(SECCOMP_RET_ALLOW);
      expect(sys(arch, SYSCALLS.io_uring_setup, 8, 0)).toBe(EPERM_RET);
    });
  }
  test("socketpair stays allowed: it creates no filesystem path (x86_64 53, aarch64 199)", () => {
    expect(sys(AUDIT_ARCH_X86_64, 53, AF_UNIX, 1, 0)).toBe(SECCOMP_RET_ALLOW);
    expect(sys(AUDIT_ARCH_AARCH64, 199, AF_UNIX, 1, 0)).toBe(SECCOMP_RET_ALLOW);
  });
  test("any other architecture, and the x32 syscall ABI, is killed before a syscall number is trusted", () => {
    for (const arch of [0x40000003 /* i386 */, 0x40000028 /* arm */, 0xc0000015 /* ppc64 */, 0, 0xffffffff]) expect(sys(arch, 41, AF_UNIX)).toBe(SECCOMP_RET_KILL_PROCESS);
    expect(sys(AUDIT_ARCH_X86_64, X32_SYSCALL_BIT | 41, AF_UNIX)).toBe(SECCOMP_RET_KILL_PROCESS);   // x32 socket
    expect(sys(AUDIT_ARCH_X86_64, X32_SYSCALL_BIT | 425, 0)).toBe(SECCOMP_RET_KILL_PROCESS);        // x32 io_uring_setup
    expect(sys(AUDIT_ARCH_X86_64, 0, 0)).toBe(SECCOMP_RET_ALLOW);                                    // control: a plain x86_64 read
  });
  test("the filter is deterministic and identified by its digest", () => {
    expect(noUnixSocketFilter().sha256).toBe(filter.sha256);
    expect(filter.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(filter.bytes.length).toBeLessThanOrEqual(64 * 8);
  });
});
