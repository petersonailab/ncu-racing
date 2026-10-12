# Local dev server for public/ with HTTP caching disabled, so edits show up on reload.
#   python3 tools/serve.py [port]
import functools, http.server, os, sys

PUBLIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 64  # browsers open ~10 connections at once for the ES modules; the default 5 drops some


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
print(f'NCU Racing: http://localhost:{port}', flush=True)
Server(('', port), functools.partial(NoCache, directory=PUBLIC)).serve_forever()
