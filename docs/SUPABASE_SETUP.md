# 계정 · 사진 기능 켜기 (Supabase 설정 가이드)

모든 단계는 **웹 브라우저만으로** 할 수 있어요. 설정하기 전까지 앱은 지금처럼 로그인 없이 동작합니다.

> 🔒 **비밀 키 주의**
> 아래 값들은 **Supabase 화면이나 GitHub 설정에 직접** 넣고, 다른 곳(채팅 포함)에는 보내지 마세요.
> - Supabase `service_role` 키 (= secret 키)
> - 카카오 **REST API 키**
> - 카카오 **Client Secret**
>
> 공개해도 되는 값은 Supabase **Project URL**과 **anon(또는 publishable) 키**뿐입니다.

---

## 1. Supabase 프로젝트 만들기

1. https://supabase.com 에 접속해서 **Start your project**를 누르고 GitHub 계정으로 로그인합니다.
2. **New project**를 누르고 아래처럼 입력합니다.
   - Name: `named-nothing` (아무 이름이나 괜찮아요)
   - Database Password: 생성 버튼으로 만든 뒤 따로 적어두세요. 앱에는 쓰이지 않아요.
   - Region: **Northeast Asia (Seoul)**
3. 1~2분 정도 기다리면 프로젝트가 준비됩니다.

## 2. 기록 저장용 테이블 만들기

1. 왼쪽 메뉴에서 **SQL Editor**를 열고 **New query**를 누릅니다.
2. 저장소의 [`supabase/schema.sql`](../supabase/schema.sql) 내용을 전부 복사해서 붙여넣습니다.
3. **Run**을 누르면 `days` 테이블이 생깁니다. 각자 자기 기록만 읽고 쓸 수 있도록 보안 규칙(RLS)도 함께 설정돼요.

## 3. 로그인 후 돌아올 주소 등록하기

**Authentication → URL Configuration**에서 아래 두 곳에 주소를 넣고 저장합니다. 주소 끝의 `/named_nothing/`까지 꼭 넣어야 해요.
이게 빠지면 카카오 로그인이나 메일 링크가 "There isn't a GitHub Pages site here" 404 화면으로 가요.

- Site URL: `https://johnyang0323.github.io/named_nothing/`
- Redirect URLs → **Add URL**: `https://johnyang0323.github.io/named_nothing/`

## 4. 이메일 + 비밀번호 로그인 켜기

앱의 이메일 로그인은 **이메일과 비밀번호** 방식이에요. 메일을 보내지 않기 때문에 무료 요금제의 메일 제한이나 템플릿 제한과 관계없고, 아이폰 홈 화면 앱 안에서도 로그인됩니다.

1. **Authentication → Sign In / Providers → Email**을 엽니다.
2. **Enable Email provider**가 켜져 있는지 확인합니다.
3. **Confirm email**을 **끄고** 저장합니다. 끄지 않으면 가입할 때마다 확인 메일을 보내요. 무료 요금제에서는 본인 주소로만, 시간당 몇 통만 보낼 수 있습니다.
4. 이전에 이메일 코드 방식으로 시도하면서 만들어진 사용자가 있다면 **Authentication → Users**에서 지워주세요. 그 계정에는 비밀번호가 없어서 로그인할 수 없어요.

앱에서는 **나의 하루 → 계정에 저장 → 처음이에요 (가입하기)**를 누르고, 이메일과 비밀번호(8자 이상)를 넣으면 바로 로그인됩니다.

> 참고: 확인 메일을 보내지 않으므로, 아무 이메일 주소로나 가입할 수 있어요. 개인용이나 테스트용으로는 괜찮아요.
> 여러 사람이 쓰는 서비스로 만들 때는 외부 메일(SMTP)을 연결한 뒤 Confirm email을 다시 켜고, 비밀번호 찾기 기능도 추가해야 해요.

## 5. 카카오 로그인 켜기

### 5-1. Kakao Developers 설정 (지도용으로 만든 앱을 그대로 씁니다)

1. **카카오 로그인** 메뉴에서 **활성화 설정**을 **ON**으로 바꿉니다.
2. **Redirect URI**에 아래 주소를 정확히 등록합니다.
   `https://pheawjaqtsifkmlsjhea.supabase.co/auth/v1/callback`
3. **카카오 로그인 → 보안**(또는 **앱 → 플랫폼 키 → REST API 키** 상세)에서 **Client Secret**을 만들고, 활성화 상태를 **사용함**으로 바꿉니다.
4. **동의항목**을 설정합니다. ⚠️ **KOE205 오류가 나는 이유가 바로 이 단계예요.**
   Supabase는 카카오에 **닉네임 · 프로필 사진 · 카카오계정(이메일)** 세 가지를 요청합니다. 세 항목이 **모두** 동의항목에 설정돼 있어야 해요.
   - **닉네임**(profile_nickname): 필수 동의 또는 선택 동의
   - **프로필 사진**(profile_image): 필수 동의 또는 선택 동의
   - **카카오계정(이메일)**(account_email): 선택 동의
     - 이 항목이 "권한 없음"으로 잠겨 있으면 앱을 **비즈 앱**으로 바꿔야 해요.
     - **앱 설정 → 비즈니스**(또는 **앱 → 비즈 앱 전환**)에서 **개인 개발자 비즈 앱 전환**을 하면 사업자 등록 없이 열 수 있어요. 카카오 계정의 본인 인증이 필요할 수 있습니다.
5. KOE205 화면의 **"왜 에러가 발생하나요?"**를 펼치면 빠진 항목 이름(예: `account_email`)이 나와요. 그 항목을 위 4번처럼 설정하면 됩니다.
6. **KOE006**(등록하지 않은 리다이렉트 URI)이 나오면 2번의 주소가 등록되지 않은 거예요.
   새 콘솔에서는 **앱 → 플랫폼 키 → REST API 키** 상세의 **카카오 로그인 리다이렉트 URI**에 넣어야 해요.
   지도용 "JavaScript SDK 도메인" 칸과는 다른 곳이에요. 주소 끝에 `/`를 붙이지 말고, 저장까지 눌러야 반영돼요.

### 5-2. Supabase 설정

1. **Authentication → Sign In / Providers → Kakao**를 열고 **Enable**을 켭니다.
2. 아래 값을 넣고 저장합니다.
   - REST API Key (Client ID): 카카오 **REST API 키**
   - Client Secret: 5-1에서 만든 값
   - **Allow users without an email**: 이 옵션이 보이면 켭니다.

## 6. 장소 사진 기능 켜기

사진은 카카오 이미지 검색을 사용합니다. REST API 키가 브라우저에 노출되지 않도록, Supabase 서버 함수가 대신 검색합니다.

1. **Edge Functions → Deploy a new function → Via Editor**를 엽니다.
2. 에디터에 예시 코드(`withSupabase`, `Hello ${name}` 등)가 들어 있어요. **전부 지웁니다.**
3. 저장소의 [`supabase/functions/place-photo/index.ts`](../supabase/functions/place-photo/index.ts) 내용을 전부 붙여넣습니다.
4. 함수 이름은 `place-photo`로 정합니다. 이름이 정확히 같아야 하고, 예시 이름(예: `hello-world`)이 들어 있다면 바꿔주세요. 이름을 정한 뒤 **Deploy**를 누릅니다.
5. **Edge Functions → Secrets**에 아래 두 값을 추가합니다.
   - `KAKAO_REST_API_KEY` = 카카오 **REST API 키**
   - `ALLOWED_ORIGINS` = `https://johnyang0323.github.io`
6. `place-photo` 함수의 **Details**(또는 Settings) 탭에서 **Verify JWT with legacy secret**(또는 *Enforce JWT verification*)을 **끄고** 저장합니다.
   새 방식 키(`sb_publishable_…`)는 JWT 형식이 아니라서, 이 설정이 켜져 있으면 로그인하지 않은 사용자의 사진 요청이 거절돼요.
   대신 함수 코드가 `ALLOWED_ORIGINS`에 등록한 사이트에서 온 요청만 받도록 막고 있어요.

## 7. 앱에 Supabase 연결하기

1. Supabase에서 **Project Settings → API**(또는 **Data API / API Keys**)를 엽니다.
   - **Project URL**: `https://xxxx.supabase.co`
   - **anon public** 키 (새 프로젝트라면 `sb_publishable_...`로 시작하는 **Publishable key**)
2. GitHub 저장소에서 **Settings → Secrets and variables → Actions → Variables** 탭을 열고 **New repository variable**로 두 개를 추가합니다.
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_ANON_KEY` = anon(또는 publishable) 키
3. **Actions → Deploy to GitHub Pages → Run workflow**를 누릅니다.

(GitHub 변수 대신 두 값을 Claude에게 알려주면 배포 설정에 직접 넣어줄 수도 있어요. 두 값 모두 공개해도 되는 값입니다.)

## 8. 확인하기

1. 사이트의 **나의 하루** 맨 아래에 "계정에 저장 (선택)" 영역이 보이는지 확인합니다.
2. **처음이에요 (가입하기)**를 누르고 이메일과 비밀번호를 넣은 뒤 **가입하고 시작하기**를 누릅니다. "○○ 계정에 오늘을 저장하고 있어요"가 보이면 성공이에요.
3. 홈에서 동네를 찾아 하루를 시작하면, 발견 화면의 그림이 실제 사진으로 바뀌고 사진 아래에 출처가 표시됩니다.
4. 다른 기기에서 같은 계정으로 로그인하면 오늘 기록이 그대로 보입니다.

문제가 생기면 화면에 나온 문구나 브라우저 콘솔(F12)의 오류를 그대로 알려주세요.

## 알아두면 좋은 점

- 기록은 **이 기기에 먼저 저장**되고, 로그인한 상태라면 1~2초 뒤에 계정에도 저장됩니다. 인터넷이 끊겨도 기록은 사라지지 않아요.
- 두 기기에서 같은 날을 동시에 고치면 **나중에 고친 쪽**이 남습니다.
- 처음 로그인하면 이 브라우저에만 있던 **지난 날들의 기록도 계정으로 올라갑니다.**
- 아이폰 **홈 화면 앱에서 카카오 로그인**을 하면 로그인 창이 Safari로 열린 채 앱으로 돌아오지 않을 수 있어요. 그럴 때는 **이메일 + 비밀번호 로그인**을 써 주세요.
- 사진은 웹 검색 결과(주로 블로그 사진)라서 실제 장소와 다를 수 있어요. 앱에도 항상 출처와 함께 그렇게 표시됩니다.
- 공개 서비스로 운영하려면 개인정보 처리방침을 준비하고, 계정 삭제 기능도 추가해야 해요(아직 없음).
