# Controlled fixture child for J-RLM-contained-port. It ATTEMPTS each forbidden effect on request and
# reports what it saw. The test never trusts these reports alone: every denial is also observed from
# the host (file hashes, listener counts, /proc). The same script runs uncontained as the positive control.
import json, os, signal, socket, sys, time

def say(**kw):
    sys.stdout.write(json.dumps(kw) + "\n"); sys.stdout.flush()

def attempt(fn):
    try: return {"ok": True, "value": fn()}
    except BaseException as e: return {"ok": False, "error": type(e).__name__, "errno": getattr(e, "errno", None)}

def write_file(path, text):
    with open(path, "w") as f: f.write(text)
    return "wrote"

def read_file(path):
    with open(path) as f: return f.read()

def tcp(host, port):
    s = socket.socket(); s.settimeout(2)
    try: s.connect((host, port)); s.sendall(b"HELLO-TCP"); return "connected"
    finally: s.close()

def udp(host, port):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(2)
    try: s.sendto(b"HELLO-UDP", (host, port)); return "sent"
    finally: s.close()

def unix(path, payload):
    s = socket.socket(socket.AF_UNIX); s.settimeout(2)
    try: s.connect(path); s.sendall(payload); return "connected"
    finally: s.close()

def flood(n):
    for _ in range(n):
        sys.stdout.write("y" * 1023 + "\n"); sys.stdout.flush()
    say(op="flood", done=True)

def caps():
    status = {}
    for line in open("/proc/self/status"):
        k, _, v = line.partition(":")
        if k in ("CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb", "NoNewPrivs", "Seccomp"): status[k] = v.strip()
    return status

def nested_userns():
    # A contained child must not be able to create a user namespace (and so regain capabilities in it).
    os.unshare(os.CLONE_NEWUSER); return "unshared"

def fill_tmp(path, chunk, count):
    with open(path, "wb") as f:
        for _ in range(count): f.write(b"x" * chunk); f.flush()
    return "filled"

def stubborn(late_socket, delay):
    # Double fork; the grandchild leaves the session, ignores SIGTERM/SIGHUP, and after a delay tries to
    # reach the host (the host checks that this never arrives once the sandbox is torn down).
    r, w = os.pipe()
    if os.fork() == 0:
        os.setsid()
        if os.fork() == 0:
            signal.signal(signal.SIGTERM, signal.SIG_IGN); signal.signal(signal.SIGHUP, signal.SIG_IGN)
            os.write(w, str(os.getpid()).encode()); os.close(w)
            time.sleep(delay)
            if late_socket:
                try: unix(late_socket, b"LATE-FROM-DESCENDANT")
                except BaseException: pass
            time.sleep(600); os._exit(0)
        os._exit(0)
    os.close(w); os.wait()
    return int(os.read(r, 32).decode())

for raw in sys.stdin:
    try: m = json.loads(raw)
    except Exception: say(error="bad-json"); continue
    op = m.get("op")
    if op == "hello":
        say(op=op, pid=os.getpid(), ns=os.readlink("/proc/self/ns/pid"), cwd=os.getcwd(), home_exists=os.path.exists("/home"), root=sorted(os.listdir("/")))
    elif op == "echo": say(op=op, echo=m.get("v"))
    elif op == "write": say(op=op, path=m["path"], **attempt(lambda: write_file(m["path"], m.get("text", "SFTEST-WRITE"))))
    elif op == "read": say(op=op, path=m["path"], **attempt(lambda: read_file(m["path"])))
    elif op == "env": say(op=op, env=dict(os.environ))
    elif op == "tcp": say(op=op, **attempt(lambda: tcp(m["host"], m["port"])))
    elif op == "udp": say(op=op, **attempt(lambda: udp(m["host"], m["port"])))
    elif op == "unix": say(op=op, **attempt(lambda: unix(m["path"], m.get("payload", "HELLO-UNIX").encode())))
    elif op == "stubborn": say(op=op, pid=stubborn(m.get("late_socket"), m.get("delay", 1.5)))
    elif op == "flood": flood(m["lines"])
    elif op == "longline": sys.stdout.write("z" * m["bytes"]); sys.stdout.flush(); say(op=op, done=True)
    elif op == "alloc": say(op=op, **attempt(lambda: len(bytearray(m["bytes"]))))
    elif op == "burn":
        while True: pass
    elif op == "sleep": time.sleep(m["s"]); say(op=op, done=True)
    elif op == "caps": say(op=op, caps=caps(), userns=attempt(nested_userns))
    elif op == "filltmp": say(op=op, **attempt(lambda: fill_tmp(m["path"], m["chunk"], m["count"])))
    elif op == "unlink": say(op=op, **attempt(lambda: os.unlink(m["path"])))
    elif op == "mountinfo": say(op=op, tmp=[l for l in open("/proc/self/mountinfo") if " /tmp " in l])
    elif op == "limits": say(op=op, limits=open("/proc/self/limits").read())
    elif op == "exit": sys.exit(0)
