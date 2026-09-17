"""TLS termination for the Selvage demo session server (selvaged).

Stdlib only. Listens on the Pi's tailnet IP (never loopback, never 0.0.0.0)
with the Tailscale-provisioned MagicDNS certificate, and forwards exactly
two paths to the plaintext selvaged on loopback :8080:

  wss://<pi>:8444/session  ->  ws://127.0.0.1:8080/session (upgrade + tunnel)
  https://<pi>:8444/meta   ->  http://127.0.0.1:8080/meta (HTTP relay)

Everything else answers 404: this proxy owns the session surface and nothing
else. The /session tunnel passes through byte-identical — no headers added,
none removed — so the wire the clients see is selvaged's own. The /meta relay
is the one exception: it carries CORS headers (`access-control-allow-origin`,
echoing the request Origin when present, `*` otherwise) so an https page
served off-origin reads the meta document instead of dying on Same-Origin
Policy, and answers OPTIONS preflights itself without bothering the backend.

Run under the selvage-tls-proxy.service user unit, which appends stdout to
tls-proxy.log. That file — not the journal — is the record, same as the
selvaged unit (this Pi's journal keeps no user-unit output).
"""

import asyncio
import os
import ssl
from pathlib import Path

BIND = os.environ.get("TLS_PROXY_BIND", "100.64.0.3")
PORT = int(os.environ.get("TLS_PROXY_PORT", "8444"))
BACKEND_HOST = os.environ.get("TLS_PROXY_BACKEND_HOST", "127.0.0.1")
BACKEND_PORT = int(os.environ.get("TLS_PROXY_BACKEND_PORT", "8080"))
CERT = Path(os.environ.get("TLS_PROXY_CERT", "/home/pi/selvage-web/certs/tailnet.crt"))
KEY = Path(os.environ.get("TLS_PROXY_KEY", "/home/pi/selvage-web/certs/tailnet.key"))

HEAD_LIMIT = 64 * 1024
HANDSHAKE_TIMEOUT_S = 15.0
RELAY_TIMEOUT_S = 30.0
BUFFER = 64 * 1024


def parse_head(head: bytes) -> tuple[str, str, dict[str, str]] | None:
    """Split an HTTP request head into method, target and lowercase headers."""
    try:
        text = head.decode("latin-1")
    except ValueError:
        return None
    lines = text.split("\r\n")
    request, *fields = lines
    parts = request.split(" ")
    if len(parts) != 3:
        return None
    method, target, _version = parts
    headers: dict[str, str] = {}
    for field in fields:
        if field == "":
            continue
        name, sep, value = field.partition(":")
        if not sep:
            return None
        headers[name.strip().lower()] = value.strip()
    return method, target, headers


def origin_target(target: str) -> str:
    """Accept absolute-form targets too; the backend only speaks origin-form."""
    if "://" in target:
        _, _, rest = target.partition("://")
        slash = rest.find("/")
        return rest[slash:] if slash != -1 else "/"
    return target


def route(path: str) -> str | None:
    """The proxy's whole surface: the session socket and the meta read."""
    base = path.split("?", 1)[0]
    if base == "/session":
        return "session"
    if base == "/meta":
        return "meta"
    return None


async def read_head(reader: asyncio.StreamReader) -> tuple[bytes, bytes]:
    """Read through the end of the HTTP head; return (head, already-read rest)."""
    try:
        data = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), HANDSHAKE_TIMEOUT_S)
    except (asyncio.LimitOverrunError, asyncio.IncompleteReadError, TimeoutError):
        raise ConnectionError("unreadable request head")
    at = data.find(b"\r\n\r\n") + 4
    return data[:at], data[at:]


async def pump(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    """Copy one direction until EOF or a long idle gap."""
    try:
        while True:
            chunk = await asyncio.wait_for(reader.read(BUFFER), RELAY_TIMEOUT_S)
            if not chunk:
                return
            writer.write(chunk)
            await writer.drain()
    except (TimeoutError, ConnectionError, BrokenPipeError):
        return


async def answer(
    writer: asyncio.StreamWriter,
    status: str,
    body: str,
    extra: dict[str, str] | None = None,
) -> None:
    payload = body.encode("utf-8")
    head = (
        f"HTTP/1.1 {status}\r\ncontent-type: text/plain; charset=utf-8\r\n"
        f"content-length: {len(payload)}\r\n"
    )
    for name, value in (extra or {}).items():
        head += f"{name}: {value}\r\n"
    writer.write((head + "connection: close\r\n\r\n").encode("latin-1") + payload)
    await writer.drain()


def cors_headers(origin: str | None) -> dict[str, str]:
    """CORS for a /meta answer: the request Origin echoed, `*` without one."""
    return {
        "access-control-allow-origin": origin if origin else "*",
        "vary": "Origin",
    }


async def answer_preflight(writer: asyncio.StreamWriter, origin: str | None) -> None:
    """An OPTIONS preflight for /meta never reaches the backend."""
    head = "HTTP/1.1 204 No Content\r\n"
    extra = {
        **cors_headers(origin),
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
    }
    for name, value in extra.items():
        head += f"{name}: {value}\r\n"
    writer.write((head + "connection: close\r\n\r\n").encode("latin-1"))
    await writer.drain()


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    backend_writer: asyncio.StreamWriter | None = None
    try:
        try:
            head, rest = await read_head(reader)
        except ConnectionError:
            await answer(writer, "400 Bad Request", "unreadable request\n")
            return
        parsed = parse_head(head)
        if parsed is None:
            await answer(writer, "400 Bad Request", "bad request\n")
            return
        method, target, headers = parsed
        origin = headers.get("origin") or None
        kind = route(origin_target(target).split("#", 1)[0])
        if kind is None:
            await answer(writer, "404 Not Found", "this proxy only serves /session and /meta\n")
            return
        if kind == "meta" and method == "OPTIONS":
            await answer_preflight(writer, origin)
            return
        try:
            backend_reader, backend_writer = await asyncio.wait_for(
                asyncio.open_connection(BACKEND_HOST, BACKEND_PORT), HANDSHAKE_TIMEOUT_S
            )
        except (OSError, TimeoutError):
            await answer(
                writer,
                "502 Bad Gateway",
                "session server unreachable\n",
                cors_headers(origin) if kind == "meta" else None,
            )
            return
        backend_writer.write(head + rest)
        await backend_writer.drain()
        try:
            backend_head, backend_rest = await read_head(backend_reader)
        except ConnectionError:
            await answer(
                writer,
                "502 Bad Gateway",
                "session server answered nothing\n",
                cors_headers(origin) if kind == "meta" else None,
            )
            return
        if kind == "meta":
            # The backend knows nothing of CORS; the proxy adds the headers so
            # a page served off-origin reads the document instead of dying on
            # Same-Origin Policy. Header-only: lengths and the body are untouched.
            extra = b"".join(
                f"{name}: {value}\r\n".encode("latin-1")
                for name, value in cors_headers(origin).items()
            )
            backend_head = backend_head[:-2] + extra + b"\r\n"
        writer.write(backend_head + backend_rest)
        await writer.drain()
        if kind == "session" and b" 101 " in backend_head.split(b"\r\n", 1)[0]:
            # The upgrade landed: the socket is a tunnel now, both directions.
            await asyncio.gather(
                pump(reader, backend_writer),
                pump(backend_reader, writer),
            )
        else:
            # Plain HTTP (the /meta read, or the backend's own refusal): the
            # backend closes when done (`connection: close`), relay to EOF.
            await pump(backend_reader, writer)
    except (ConnectionError, BrokenPipeError):
        pass
    except Exception as error:  # one line in the log, never a dropped traceback
        print(f"tls-proxy: request failed: {error!r}", flush=True)
    finally:
        for stream in (backend_writer, writer):
            if stream is not None:
                try:
                    stream.close()
                except Exception:
                    pass


async def main() -> None:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=str(CERT), keyfile=str(KEY))
    server = await asyncio.start_server(handle, BIND, PORT, ssl=ctx, limit=HEAD_LIMIT)
    print(
        f"tls-proxy listening on wss://{BIND}:{PORT}/session "
        f"(meta at https://{BIND}:{PORT}/meta) -> {BACKEND_HOST}:{BACKEND_PORT}",
        flush=True,
    )
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
