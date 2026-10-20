# Om Wiki Mobile

KAMC 기본 지침 · Om 의학 Wiki를 휴대폰·태블릿에서 여는 홈 화면 앱(PWA)의 겉 화면입니다.

- 이 저장소에는 **의학 내용이 없습니다.** 로그인, 앱 아이콘, Dropbox 연결 코드만 있습니다.
- Wiki 자료와 이미지는 사용자가 Dropbox에 로그인한 뒤, 그 사용자의 Dropbox 앱 폴더(`Apps/Om Wiki Mobile/bundle/`)에서 받아 기기에 저장합니다.
- 문서 메모는 `Apps/Om Wiki Mobile/memo/문서 메모.json`에 저장되고, PC의 `build-mobile.js`가 PC 메모와 합칩니다.

| 파일 | 역할 |
|---|---|
| `index.html`, `boot.js` | 홈 화면 추가 안내, Dropbox 로그인(PKCE), 자료 확인·받기, 설정 |
| `sw.js` | 겉 화면 오프라인 저장, `app/` 요청을 Dropbox 묶음에서 받아 기기에 저장 |
| `dbx.js`, `config.js` | Dropbox API·토큰(IndexedDB), App key |
| `bridge.js`, `mobile.css` | Wiki 화면 안: 화면 제한, 메모 동기화, 휴대폰 화면 다듬기 |

묶음은 PC에서 `HTML 작업공간/1. 의학 HTML/build-mobile.js`로 만듭니다.
