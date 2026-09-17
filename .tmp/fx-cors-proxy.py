"""Fixture: the patched tls-proxy's real handle() over plain TCP (no TLS), in
front of a stub backend that answers /meta with NO cors headers. Exercises
the preflight answer and the header injection exactly as the Pi runs them.
Usage: python3 fx-cors-proxy.py  (runs both servers; curl from another shell)
"""
import asyncio
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND_PORT = 18099
PROXY_PORT = 18443
HITS = {"meta": 0, "other": 0}

META_BODY = b'{"server":"stub","wire_versions":["selvage/1"]}'

STUB_RESPONSES = {
    "meta": (
        b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n"
        b"content-length: " + str(len(META_BODY)).encode() + b"\r\n"
        b"connection: close\r\n\r\n" + META_BODY
    ),
    "other": (
        b"HTTP/1.1 404 Not Found\r\ncontent-type: text/plain\r\n"
        b"content-length: 9\r\nconnection: close\r\n\r\nnot here\n"
    ),
}


async def stub_backend(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        head = await reader.readuntil(b"\r\n\r\n")
        line = head.split(b"\r\n", 1)[0].decode("latin-1")
        target = line.split(" ")[1] if len(line.split(" ")) > 1 else "/"
        if target.split("?", 1)[0] == "/meta":
            HITS["meta"] += 1
            writer.write(STUB_RESPONSES["meta"])
        else:
            HITS["other"] += 1
            writer.write(STUB_RESPONSES["other"])
        await writer.drain()
    finally:
        writer.close()


def load_proxy():
    os.environ["TLS_PROXY_BIND"] = "127.0.0.1"
    os.environ["TLS_PROXY_PORT"] = str(PROXY_PORT)
    os.environ["TLS_PROXY_BACKEND_HOST"] = "127.0.0.1"
    os.environ["TLS_PROXY_BACKEND_PORT"] = str(BACKEND_PORT)
    spec = importlib.util.spec_from_file_location("tls_proxy", os.path.join(HERE, "tls-proxy.py"))
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["tls_proxy"] = module
    spec.loader.exec_module(module)
    return module


async def main() -> None:
    proxy = load_proxy()
    backend = await asyncio.start_server(stub_backend, "127.0.0.1", BACKEND_PORT)
    # Plain TCP, but the REAL handle(): TLS is only wrapping on the Pi.
    front = await asyncio.start_server(proxy.handle, "127.0.0.1", PROXY_PORT, limit=proxy.HEAD_LIMIT)
    print(f"fixture up: proxy 127.0.0.1:{PROXY_PORT} -> backend 127.0.0.1:{BACKEND_PORT}", flush=True)
    async with backend, front:
        await asyncio.gather(backend.serve_forever(), front.serve_forever())


if __name__ == "__main__":
    asyncio.run(main())
