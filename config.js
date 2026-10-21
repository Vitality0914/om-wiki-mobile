/* Om Wiki Mobile 설정. appKey는 Dropbox 앱 「Om Wiki Personal」(Full Dropbox)의 App key(공개 값)다. App secret은 쓰지 않는다(PKCE).
   경로는 내 Dropbox 기준(「오민석」 폴더가 맨 위). */
self.OM_MOBILE_CONFIG = {
  appKey: '9lquvpta1vj9s20',
  // 휴대폰용 묶음(build-mobile.js가 만든다)
  bundle: '/@ Om AI Workspace/@ Om Workspace/HTML 작업공간/앱/Om Wiki Mobile/bundle',
  // PC HTML과 같은 문서 메모 파일을 그대로 쓴다
  memo: '/@ Om AI Workspace/@ Om Workspace/HTML 작업공간/@ 메모 데이터/문서 메모/문서 메모.json'
};
