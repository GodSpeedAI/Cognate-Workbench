// Seccomp filter for a contained spawn with no network (SEA-Forge #114, review H4 and its delta-2 class fix). A network
// namespace isolates TCP, UDP and abstract unix sockets, but a pathname unix socket is a filesystem object (a host daemon
// listening on one under the read-only workspace bind stays reachable) and some families (AF_VSOCK) are not scoped to the
// namespace at all. Denying known-bad families one at a time cannot be made safe, so for `network: none` socket creation is
// an ALLOWLIST enforced by the kernel.
//
// A hand-assembled classic BPF program (no dependency), loaded through bubblewrap `--seccomp FD`:
//   * the architecture is checked first: x86_64 and aarch64 only; any other architecture, the x32 syscall ABI of x86_64
//     (bit 30 set) and the legacy untagged x32 range 512-547 (pre-5.4 kernels) kill the process, because a syscall number
//     from another table would defeat every check below;
//   * socket(domain, ...) is allowed only for AF_INET and AF_INET6 (an empty network namespace holds both, with only an
//     unshared lo) and AF_NETLINK with protocol NETLINK_ROUTE (0), which glibc's getaddrinfo uses and which is scoped to the
//     network namespace; every other family or netlink protocol fails with EACCES;
//   * socketpair is allowed only for AF_UNIX with a base type (type & 0xf, ignoring SOCK_NONBLOCK|SOCK_CLOEXEC) of
//     SOCK_STREAM or SOCK_SEQPACKET: a connected pair cannot change peers, whereas a datagram endpoint can sendto() a host
//     socket path. Anything else is EACCES;
//   * io_uring_setup fails with EPERM, because IORING_OP_SOCKET and IORING_OP_CONNECT would otherwise create and use a
//     socket without going through socket();
//   * everything else is allowed.
// The filter bytes are part of the execution profile (id and sha256), so SEA-Forge approves the filter itself.
import { createHash } from "node:crypto";

export const AUDIT_ARCH_X86_64 = 0xc000003e;
export const AUDIT_ARCH_AARCH64 = 0xc00000b7;
export const X32_SYSCALL_BIT = 0x40000000;
/** x86_64 numbers 512-547 reach the x32 handlers on kernels before 5.4 even without the x32 bit. */
export const X32_LEGACY_FIRST = 512;
export const X32_LEGACY_AFTER = 548;
export const SECCOMP_RET_KILL_PROCESS = 0x80000000;
export const SECCOMP_RET_ALLOW = 0x7fff0000;
export const SECCOMP_RET_ERRNO = 0x00050000;
export const EPERM = 1;
export const EACCES = 13;
export const AF = { UNSPEC: 0, UNIX: 1, INET: 2, INET6: 10, NETLINK: 16, PACKET: 17, KEY: 15, ALG: 38, VSOCK: 40, TIPC: 30, BLUETOOTH: 31, CAN: 29, XDP: 44 } as const;
export const SOCK = { STREAM: 1, DGRAM: 2, RAW: 3, RDM: 4, SEQPACKET: 5 } as const;
export const NETLINK_ROUTE = 0;
export const SYSCALLS = { x86_64: { socket: 41, socketpair: 53 }, aarch64: { socket: 198, socketpair: 199 }, io_uring_setup: 425 } as const;
export const FILTER_ID = "socket-allowlist-v2";

const BPF_LD_W_ABS = 0x20;
const BPF_ALU_AND_K = 0x54;
const BPF_JMP_JEQ_K = 0x15;
const BPF_JMP_JGE_K = 0x35;
const BPF_RET_K = 0x06;
const OFFSET_NR = 0;
const OFFSET_ARCH = 4;
const OFFSET_ARG0 = 16;
const OFFSET_ARG1 = 24;
const OFFSET_ARG2 = 32;

type Item =
  | { readonly op: "label"; readonly name: string }
  | { readonly op: "ld"; readonly offset: number }
  | { readonly op: "and"; readonly k: number }
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
    else if (item.op === "and") emit(BPF_ALU_AND_K, 0, 0, item.k);
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

/** The per-architecture block: dispatch on the syscall number (already loaded) to the shared socket and socketpair checks. */
const dispatch = (nr: { readonly socket: number; readonly socketpair: number }): Item[] => [
  { op: "jeq", k: nr.socket, yes: "socket", no: NEXT },
  { op: "jeq", k: nr.socketpair, yes: "pair", no: NEXT },
  { op: "jeq", k: SYSCALLS.io_uring_setup, yes: "uring", no: "allow" },
];

export function noUnixSocketFilter(): SeccompFilter {
  const bytes = assemble([
    { op: "ld", offset: OFFSET_ARCH },
    { op: "jeq", k: AUDIT_ARCH_X86_64, yes: "x86", no: NEXT },
    { op: "jeq", k: AUDIT_ARCH_AARCH64, yes: "arm", no: "kill" },
    { op: "label", name: "x86" },
    { op: "ld", offset: OFFSET_NR },
    { op: "jge", k: X32_SYSCALL_BIT, yes: "kill", no: NEXT },
    { op: "jge", k: X32_LEGACY_AFTER, yes: "x86main", no: NEXT },
    { op: "jge", k: X32_LEGACY_FIRST, yes: "kill", no: "x86main" },
    { op: "label", name: "x86main" },
    ...dispatch(SYSCALLS.x86_64),
    { op: "label", name: "arm" },
    { op: "ld", offset: OFFSET_NR },
    ...dispatch(SYSCALLS.aarch64),
    // socket(domain, type, protocol)
    { op: "label", name: "socket" },
    { op: "ld", offset: OFFSET_ARG0 },
    { op: "jeq", k: AF.INET, yes: "allow", no: NEXT },
    { op: "jeq", k: AF.INET6, yes: "allow", no: NEXT },
    { op: "jeq", k: AF.NETLINK, yes: "netlink", no: "eacces" },
    { op: "label", name: "netlink" },
    { op: "ld", offset: OFFSET_ARG2 },
    { op: "jeq", k: NETLINK_ROUTE, yes: "allow", no: "eacces" },
    // socketpair(domain, type, protocol, sv)
    { op: "label", name: "pair" },
    { op: "ld", offset: OFFSET_ARG0 },
    { op: "jeq", k: AF.UNIX, yes: NEXT, no: "eacces" },
    { op: "ld", offset: OFFSET_ARG1 },
    { op: "and", k: 0xf },
    { op: "jeq", k: SOCK.STREAM, yes: "allow", no: NEXT },
    { op: "jeq", k: SOCK.SEQPACKET, yes: "allow", no: "eacces" },
    { op: "label", name: "eacces" },
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
