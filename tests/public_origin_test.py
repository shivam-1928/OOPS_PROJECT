"""Check explicit HTTPS demo origins without exposing the test server publicly."""
import argparse
import http.client
import re
import subprocess
from pathlib import Path
from urllib.parse import urlencode

parser = argparse.ArgumentParser()
parser.add_argument('--java', default='java')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
origin = 'https://demo.example.com'
server = subprocess.Popen([args.java, '-cp', '.build/classes', 'itsm.web.WebServer', '0',
                           '--public-origin', origin], cwd=root, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, text=True)
try:
    startup = server.stdout.readline()
    port = int(re.search(r'127\.0\.0\.1:(\d+)', startup).group(1))
    def request(host, request_origin=None, path='/landing.html', data=None):
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
        headers = {'Host': host}
        if request_origin is not None:
            headers['Origin'] = request_origin
        if data is not None:
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
        connection.request('POST' if data is not None else 'GET', path,
                           urlencode(data) if data is not None else None, headers)
        response = connection.getresponse()
        result = response.status, {key.lower(): value for key, value in response.getheaders()}, response.read()
        connection.close()
        return result
    assert request('demo.example.com')[0] == 200
    assert b'id="hero-title"' in request('demo.example.com', path='/')[2]
    assert b'id="overview-workspace"' in request('demo.example.com', path='/index.html')[2]
    assert request('attacker.example.com')[0] == 403
    assert request(f'127.0.0.1:{port}')[0] == 200
    credentials = {'username': 'admin', 'password': 'admin123'}
    assert request('demo.example.com', 'https://attacker.example.com', '/api/session', credentials)[0] == 403
    assert request('demo.example.com', 'http://demo.example.com', '/api/session', credentials)[0] == 403
    status, headers, body = request('demo.example.com', origin, '/api/session', credentials)
    assert status == 200, body
    assert '; Secure' in headers['set-cookie']
    assert 'HttpOnly' in str(headers) and 'SameSite=Strict' in str(headers)
    print('PASS: 10 landing/app routing, public-origin, cross-origin and secure-cookie checks.')
finally:
    server.terminate()
    server.wait(timeout=10)
