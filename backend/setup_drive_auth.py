"""
Google Drive 인증 설정 — 최초 1회 또는 토큰 만료 시 실행
브라우저에서 Google 로그인 후 토큰을 .local/drive-token.json에 저장합니다.
"""
import os
import sys

TOKEN_PATH = os.path.join(os.path.dirname(__file__), '.local', 'drive-token.json')
CLIENT_SECRET_PATH = r'C:\Users\kua\Documents\Playground\sachyosangse\.local\gdrive-oauth-client.json'
SCOPES = ['https://www.googleapis.com/auth/drive']


def setup():
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
    except ImportError:
        print('[오류] google-auth-oauthlib 패키지가 없습니다.')
        print('실행: pip install google-auth-oauthlib')
        sys.exit(1)

    os.makedirs(os.path.dirname(TOKEN_PATH), exist_ok=True)

    creds = None

    # 기존 토큰 로드
    if os.path.exists(TOKEN_PATH):
        try:
            creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
        except Exception:
            creds = None

    # 유효한 토큰이면 그대로 사용
    if creds and creds.valid:
        print('[완료] 유효한 Drive 토큰이 이미 있습니다.')
        print(f'  저장 경로: {TOKEN_PATH}')
        return True

    # 만료된 경우 갱신 시도
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            with open(TOKEN_PATH, 'w', encoding='utf-8') as f:
                f.write(creds.to_json())
            print('[완료] 토큰 갱신 성공.')
            return True
        except Exception as e:
            print(f'[경고] 토큰 갱신 실패 ({e}), 재인증합니다...')

    # 신규 인증 (브라우저 열림)
    print()
    print('브라우저에서 Google 계정으로 로그인하세요.')
    print('(팝업이 자동으로 열립니다)')
    print()

    try:
        flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRET_PATH, SCOPES)
        creds = flow.run_local_server(port=0, open_browser=True)
    except Exception as e:
        print(f'[오류] 인증 실패: {e}')
        sys.exit(1)

    with open(TOKEN_PATH, 'w', encoding='utf-8') as f:
        f.write(creds.to_json())

    print()
    print('[완료] Google Drive 인증 성공!')
    print(f'  저장 경로: {TOKEN_PATH}')
    return True


if __name__ == '__main__':
    setup()
    if sys.stdin.isatty():
        input('\n계속하려면 Enter를 누르세요...')
