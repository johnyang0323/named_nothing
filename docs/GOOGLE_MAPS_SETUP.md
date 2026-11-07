# 해외 지역: 구글 지도 연결하기

국내는 지금처럼 카카오맵을 쓰고, **한국 밖**의 동네·현재 위치·지도에서 고른 곳은 구글 지도로 찾아요.
키를 넣기 전에도 앱은 그대로 동작해요(해외 전환 버튼만 보이지 않아요).

## 1. Google Cloud 프로젝트와 결제

1. [Google Cloud Console](https://console.cloud.google.com/)에 구글 계정으로 로그인 → 위쪽 프로젝트 선택 → **새 프로젝트** (이름: `plannish` 등)
2. 왼쪽 메뉴 **결제(Billing)** → 결제 계정 연결(카드 등록). 구글 지도 API는 결제 계정이 있어야 켜져요.
   - 매달 일정 사용량은 무료이고, 넘으면 사용량만큼 과금돼요. 무료 범위와 가격은 자주 바뀌니 [가격표](https://mapsplatform.google.com/pricing/)에서 확인해 주세요.
3. **예산 알림 걸기(권장)**: 결제 → **예산 및 알림** → 예산 만들기(예: 월 1만 원, 50%/90%/100%에서 메일 알림)

## 2. API 켜기

**API 및 서비스 → 라이브러리**에서 아래 세 개를 검색해 각각 **사용**을 눌러요.

- **Maps JavaScript API** (지도 표시)
- **Places API (New)** (장소 검색, 장소 사진) — 이름에 *(New)*가 붙은 것
- **Geocoding API** (지도에서 고른 곳의 동네 이름 — 선택. 꺼져 있으면 "지도에서 고른 곳"으로만 표시돼요)

## 3. API 키 만들고 제한하기 (꼭!)

1. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → API 키**
2. 만든 키를 눌러 **키 제한**을 설정해요.
   - **애플리케이션 제한사항: 웹사이트** → 아래 두 줄 추가
     - `https://johnyang0323.github.io/*`
     - `https://localhost/*` (안드로이드 앱)
   - **API 제한사항: 키 제한** → Maps JavaScript API, Places API (New), Geocoding API 선택
3. 저장. 이렇게 제한한 키는 카카오 JavaScript 키처럼 **공개돼도 괜찮은 키**예요(다른 사이트에서는 거절돼요).
4. (선택) **할당량**: API 및 서비스 → Places API (New) → 할당량에서 하루 요청 수 상한을 낮게 걸어두면 예상 밖 요금을 막을 수 있어요.

## 4. 앱에 넣기

GitHub 저장소 **Settings → Secrets and variables → Actions → Variables** → **New repository variable**

- 이름: `GOOGLE_MAPS_KEY`
- 값: 위에서 만든 API 키

그다음 **Actions → Deploy to GitHub Pages → Run workflow**(안드로이드 앱은 **Android test app → Run workflow**)를 누르면 적용돼요.

## 동작 방식

- 홈의 지도 왼쪽 위 **🌏 해외 / 🇰🇷 국내** 버튼으로 지도를 바꿔요. 동네 이름 검색은 자동으로 나눠요(국내 주소 → 카카오, 해외 → 구글).
- 해외 동네 하나를 찾을 때 장소 검색은 3번만 해요(카페 / 박물관·갤러리·서점·도서관·명소 / 공원·산책로·시장).
- 해외 장소 사진은 구글 지도에 올라온 사진을 보여주고, 찍은 사람 이름을 함께 표시해요. 구글 약관에 따라 기기에 저장하지 않아요.
- 길찾기 버튼은 구글 지도로 열려요.
