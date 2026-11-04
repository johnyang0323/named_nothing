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

**Authentication → URL Configuration**에서 아래 두 곳에 주소를 넣고 저장합니다.

- Site URL: `https://johnyang0323.github.io/named_nothing/`
- Redirect URLs → **Add URL**: `https://johnyang0323.github.io/named_nothing/`

## 4. 이메일 코드 로그인 켜기

앱은 메일 속 링크를 누르는 방식이 아니라 **메일로 받은 6자리 숫자 코드를 입력하는** 방식이에요. 아이폰 홈 화면 앱에서도 로그인이 되게 하기 위해서입니다.

1. **Authentication → Emails → Templates**에서 **Magic Link** 템플릿을 엽니다.
2. 본문(Body)을 아래처럼 바꾸고 저장합니다. `{{ .Token }}` 자리에 숫자 코드가 들어갑니다.

   ```html
   <h2>계획 있는 것처럼 사는 하루</h2>
   <p>로그인 코드: <strong>{{ .Token }}</strong></p>
   <p>앱 화면에 이 숫자를 입력해 주세요. 직접 요청하지 않았다면 이 메일은 무시하셔도 돼요.</p>
   ```

3. **Confirm signup** 템플릿에도 같은 내용을 넣어주세요. 처음 로그인하는 사람은 이 템플릿으로 메일을 받습니다.

> 참고: Supabase 기본 메일 발송은 **프로젝트 멤버(본인) 주소로만, 그리고 시간당 몇 통만** 보낼 수 있어요.
> 본인 테스트에는 충분하지만, 다른 사람도 쓰게 하려면 **Authentication → Emails → SMTP Settings**에서
> 외부 메일 서비스(예: Resend 무료 요금제)를 연결해야 합니다.

## 5. 카카오 로그인 켜기

### 5-1. Kakao Developers 설정 (지도용으로 만든 앱을 그대로 씁니다)

1. **카카오 로그인** 메뉴에서 **활성화 설정**을 **ON**으로 바꿉니다.
2. **Redirect URI**에 아래 주소를 등록합니다. `<프로젝트ID>`는 Supabase Project URL의 앞부분이에요.
   `https://<프로젝트ID>.supabase.co/auth/v1/callback`
3. **카카오 로그인 → 보안**(또는 **앱 → 플랫폼 키 → REST API 키** 상세)에서 **Client Secret**을 만들고, 활성화 상태를 **사용함**으로 바꿉니다.
4. **동의항목**에서 다음을 설정합니다.
   - 닉네임, 프로필 사진: **필수** 또는 **선택 동의**
   - 카카오계정(이메일): 설정할 수 있으면 **선택 동의**로 둡니다. 개인 앱이라 설정할 수 없다면 그대로 두고, 5-2의 *Allow users without an email*을 켜세요.

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
2. 이메일 주소를 입력하고 **코드 받기**를 누른 뒤, 메일로 온 숫자를 입력합니다. "○○ 계정에 오늘을 저장하고 있어요"가 보이면 성공이에요.
3. 홈에서 동네를 찾아 하루를 시작하면, 발견 화면의 그림이 실제 사진으로 바뀌고 사진 아래에 출처가 표시됩니다.
4. 다른 기기에서 같은 계정으로 로그인하면 오늘 기록이 그대로 보입니다.

문제가 생기면 화면에 나온 문구나 브라우저 콘솔(F12)의 오류를 그대로 알려주세요.

## 알아두면 좋은 점

- 기록은 **이 기기에 먼저 저장**되고, 로그인한 상태라면 1~2초 뒤에 계정에도 저장됩니다. 인터넷이 끊겨도 기록은 사라지지 않아요.
- 두 기기에서 같은 날을 동시에 고치면 **나중에 고친 쪽**이 남습니다.
- 처음 로그인하면 이 브라우저에만 있던 **지난 날들의 기록도 계정으로 올라갑니다.**
- 아이폰 **홈 화면 앱에서 카카오 로그인**을 하면 로그인 창이 Safari로 열린 채 앱으로 돌아오지 않을 수 있어요. 그럴 때는 **이메일 코드 로그인**을 써 주세요.
- 사진은 웹 검색 결과(주로 블로그 사진)라서 실제 장소와 다를 수 있어요. 앱에도 항상 출처와 함께 그렇게 표시됩니다.
- 공개 서비스로 운영하려면 개인정보 처리방침을 준비하고, 계정 삭제 기능도 추가해야 해요(아직 없음).
