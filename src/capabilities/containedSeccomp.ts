// Seccomp filter for a contained spawn with no network (SEA-Forge #114, review finding H4). A network namespace
// isolates TCP, UDP and abstract unix sockets, but a pathname unix socket is a filesystem object: a host daemon
// listening on one under the read-only workspace bind stays reachable. A sandbox that may not create an AF_UNIX
// socket cannot connect to it, so the kernel enforces what the mount view cannot.
//
// A hand-assembled classic BPF program (no dependency), loaded through bubblewrap `--seccomp FD`:
//   * the architecture is checked first: x86_64 and aarch64 only; any other architecture, and the x32 syscall
//     ABI of x86_64, kills the process (a syscall number from another table would defeat every check below);
//   * socket(AF_UNIX, ...) fails with EACCES;
//   * io_uring_setup fails with EPERM, because IORING_OP_SOCKET and IORING_OP_CONNECT would otherwise create and
//     use a socket without going through socket();
//   * everything else is allowed. socketpair stays allowed: it creates no filesystem path.
// The filter bytes are part of the execution profile (id and sha256), so SEA-Forge approves the filter itself.
import { createHash } from "node:crypto";

export const AUDIT_ARCH_X86_64 = 0xc000003e;
export const AUDIT_ARCH_AARCH64 = 0xc00000b7;
export const X32_SYSCALL_BIT = 0x40000000;
export const SECCOMP_RET_KILL_PROCESS = 0x80000000;
export const SECCOMP_RET_ALLOW = 0x7fff0000;
export const SECCOMP_RET_ERRNO = 0x00050000;
export const EPERM = 1;
export const EACCES = 13;
export const AF_UNIX = 1;
export const SYSCALLS = { x86_64: { socket: 41 }, aarch64: { socket: 198 }, io_uring_setup: 425 } as const;
export const FILTER_ID = "no-unix-socket-v1";

const BPF_LD_W_ABS = 0x20;
const BPF_JMP_JEQ_K = 0x15;
const BPF_JMP_JGE_K = 0x35;
const BPF_RET_K = 0x06;
const OFFSET_NR = 0;
const OFFSET_ARCH = 4;
const OFFSET_ARG0 = 16;

type Item =
  | { readonly op: "label"; readonly name: string }
  | { readonly op: "ld"; readonly offset: number }
  | { readonly op: "jeq" | "jge"; readonly k: number; readonly yes: string; readonly no: string }
  | { readonly op: "ret"; readonly value: number };
const NEXT = "next";

/** Assemble the program: labels resolve to relative jumps, so the layout is checked rather than hand-counted. */
function assemble(items: readonly Item[]): Buffer {
  const at = new Map<string, number>();
  let count = 0;
  for (const item of items) { if (item.op === "label") at.set(item.name, count); else count += 1; }
  const out = Buffer.alloc(count * 8);
  let index = 0;
  const emit = (code: number, jt: number, jf: number, k: number): void => {
    out.writeUInt16LE(code, index * 8); out.writeUInt8(jt, index * 8 + 2); out.writeUInt8(jf, index * 8 + 3); out.writeUInt32LE(k >>> 0, index * 8 + 4);
    index += 1;
  };
  const jump = (label: string): number => {
    const target = label === NEXT ? index + 1 : at.get(label);
    if (target === undefined) throw new Error(`seccomp: unknown label ${label}`);
    const delta = target - (index + 1);
    if (delta < 0 || delta > 255) throw new Error(`seccomp: jump to ${label} out of range`);
    return delta;
  };
  for (const item of items) {
    if (item.op === "label") continue;
    if (item.op === "ld") emit(BPF_LD_W_ABS, 0, 0, item.offset);
    else if (item.op === "ret") emit(BPF_RET_K, 0, 0, item.value);
    else emit(item.op === "jeq" ? BPF_JMP_JEQ_K : BPF_JMP_JGE_K, jump(item.yes), jump(item.no), item.k);
  }
  return out;
}

export interface SeccompFilter {
  readonly id: string;
  readonly sha256: string;
  /** `struct sock_filter[]`, little-endian: the bytes bubblewrap reads from `--seccomp FD`. */
  readonly bytes: Buffer;
}

export function noUnixSocketFilter(): SeccompFilter {
  const bytes = assemble([
    { op: "ld", offset: OFFSET_ARCH },
    { op: "jeq", k: AUDIT_ARCH_X86_64, yes: "x86", no: NEXT },
    { op: "jeq", k: AUDIT_ARCH_AARCH64, yes: "arm", no: "kill" },
    { op: "label", name: "x86" },
    { op: "ld", offset: OFFSET_NR },
    { op: "jge", k: X32_SYSCALL_BIT, yes: "kill", no: NEXT },
    { op: "jeq", k: SYSCALLS.x86_64.socket, yes: "socket", no: NEXT },
    { op: "jeq", k: SYSCALLS.io_uring_setup, yes: "uring", no: "allow" },
    { op: "label", name: "arm" },
    { op: "ld", offset: OFFSET_NR },
    { op: "jeq", k: SYSCALLS.aarch64.socket, yes: "socket", no: NEXT },
    { op: "jeq", k: SYSCALLS.io_uring_setup, yes: "uring", no: "allow" },
    { op: "label", name: "socket" },
    { op: "ld", offset: OFFSET_ARG0 },
    { op: "jeq", k: AF_UNIX, yes: NEXT, no: "allow" },
    { op: "ret", value: SECCOMP_RET_ERRNO | EACCES },
    { op: "label", name: "uring" },
    { op: "ret", value: SECCOMP_RET_ERRNO | EPERM },
    { op: "label", name: "allow" },
    { op: "ret", value: SECCOMP_RET_ALLOW },
    { op: "label", name: "kill" },
    { op: "ret", value: SECCOMP_RET_KILL_PROCESS },
  ]);
  return { id: FILTER_ID, sha256: createHash("sha256").update(bytes).digest("hex"), bytes };
}
