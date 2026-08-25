"""생산관제 화면을 캐시 없이 내려주는 정적 서버.

python -m http.server 는 Cache-Control 을 보내지 않는다. 그러면 크롬이 제 판단으로
캐시해서, 같은 주소인데도 창마다 다른 판(版)을 들고 있게 된다. 실측 2026-08-25:
한 창에서는 확대가 되고 다른 창에서는 안 되는 일이 벌어졌고, 원인은 낡은 모듈이었다.

화면 파일은 작고 전부 로컬이라 캐시로 얻을 이득이 없다. 항상 새로 받게 한다.
"""

from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoStoreHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--directory", required=True)
    args = parser.parse_args()
    handler = partial(NoStoreHandler, directory=args.directory)
    with ThreadingHTTPServer((args.host, args.port), handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
