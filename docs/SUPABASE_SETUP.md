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
4. 함수 이름은 `place-photo`로 정하고 **Deploy**를 누릅니다.
   ⚠️ 배포 후 함수 **Overview**에 나오는 주소의 끝부분(예: `.../functions/v1/hyper-responder`)이 실제 호출 이름이에요. 대시보드가 자동으로 정하기도 하고, 나중에 바꿀 수 없어요.
   이 이름이 `place-photo`가 아니면 GitHub 저장소 **Settings → Secrets and variables → Actions → Variables**에 `PHOTO_FUNCTION` = 그 이름(예: `hyper-responder`)을 추가하고 배포를 다시 실행하세요.
   지금 프로젝트는 `hyper-responder`로 이미 설정돼 있어요.
5. **Edge Functions → Secrets**에 아래 두 값을 추가합니다.
   - `KAKAO_REST_API_KEY` = 카카오 **REST API 키**
   - `ALLOWED_ORIGINS` = `https://johnyang0323.github.io,https://localhost` (뒤의 `https://localhost`는 안드로이드 앱 주소예요)
6. `place-photo` 함수의 **Details**(또는 Settings) 탭에서 **Verify JWT with legacy secret**(또는 *Enforce JWT verification*)을 **끄고** 저장합니다.
   새 방식 키(`sb_publishable_…`)는 JWT 형식이 아니라서, 이 설정이 켜져 있으면 로그인하지 않은 사용자의 사진 요청이 거절돼요.
   대신 함수 코드가 `ALLOWED_ORIGINS`에 등록한 사이트에서 온 요청만 받도록 막고 있어요.
7. **확인:** 새 탭 주소창에 함수 Overview에 나오는 주소를 열어보세요. 지금 프로젝트라면 아래 주소예요.
   `https://pheawjaqtsifkmlsjhea.supabase.co/functions/v1/hyper-responder`

   | 보이는 내용 | 뜻 / 해결 |
   |---|---|
   | `"deployed": true`, `"kakaoRestKeySet": true` | 정상이에요. 앱의 **나의 하루 → 사진 기능 점검**을 눌러보세요. |
   | `"kakaoRestKeySet": false` | Secrets에 `KAKAO_REST_API_KEY`를 추가해 주세요. |
   | `Requested function was not found` | 함수가 없어요. 이름이 정확히 `place-photo`인지, **Deploy**까지 눌렀는지 확인해 주세요. |
   | `Missing authorization header` / `Invalid JWT` | 6번의 Verify JWT를 꺼주세요. |
   | `{"error":"origin not allowed"}` | 예전 버전 함수예요. 3번처럼 최신 코드를 다시 붙여넣고 **Deploy** 해주세요. |

   함수 코드를 고칠 때는 함수의 **Code** 탭에서 내용을 전부 지우고 새 코드를 붙여넣은 뒤 **Deploy**를 누르면 됩니다.
   최신 코드는 사진 후보를 최대 6장까지 돌려줘서, 앱에서 ‹ › 로 넘겨보고 맞는 사진을 고를 수 있어요. 예전 코드도 동작하지만, 사진이 한 장만 나와요.

### 6-0. 사용자 장소 사진 켜기 (기록장 사진을 장소 사진으로)

[`supabase/social.sql`](../supabase/social.sql)을 실행한 뒤(6-4), **SQL Editor → New query**에
[`supabase/place_photos.sql`](../supabase/place_photos.sql) 내용을 붙여넣고 **Run**을 누릅니다.

- 기록장에서 사진을 올리고 **장소 사진으로 함께 보여주기**를 켠 사진이, 그 장소를 보는 다른 사용자에게 닉네임과 함께 가장 먼저 보여요. 소감 글은 보이지 않아요.
- 실행하지 않아도 앱은 그대로 동작해요. 그때는 스위치를 켜도 "장소 사진 공유는 아직 준비 중이에요"라고 안내해요.

사진 함수(`place-photo`)도 새 코드로 다시 배포해 주세요. 이제 장소 이름이 제목에 들어간 글의 사진만 보내고, 맞는 사진이 없으면 앱이 그림과 **카카오맵에서 실제 사진 보기** 버튼을 보여줘요.

## 6-1. 사진 투표 켜기 (엉뚱한 사진 걸러내기)

사진 아래의 **이 사진으로 정하기**와 **아니에요** 버튼은 모든 사용자가 함께 쓰는 투표예요.
- 누군가 "이 사진으로 정하기"를 누르면 다른 사람들에게도 그 사진이 먼저 보여요.
- "아니에요"를 누르면 누른 사람에게서는 바로 사라지고, 순점수가 -2 이하가 되면 모두에게서 사라져요.
- 투표는 검색으로 나온 사진의 순서만 바꾸거나 숨겨요. 투표로 바깥 이미지를 끼워 넣을 수는 없어요.
- 누가 투표했는지는 다른 사람에게 보이지 않아요.

1. **SQL Editor → New query**에 [`supabase/photo_votes.sql`](../supabase/photo_votes.sql) 내용을 전부 붙여넣고 **Run**을 누릅니다. 여러 번 실행해도 괜찮아요.
2. 함수 코드도 최신으로 다시 배포해 주세요(6번의 3단계). 최신 함수는 **제목에 장소 이름이 들어간 블로그 글**의 사진을 먼저 고르고, 쇼핑몰·뉴스 사진, 지나치게 길거나 납작한 이미지, 아주 오래된 글의 사진은 뒤로 미뤄요.

SQL을 실행하기 전에도 앱은 정상 동작해요. 다만 투표가 저장되지 않고, "아니에요"는 내 기기에서만 적용돼요.

## 6-2. 나의 취향을 계정에 저장하기

앱은 고른 곳, 다녀온 곳, 그날의 기분으로 "자주 고르는 장소 종류"를 배워서 추천에 반영해요. 이 취향을 계정에 저장해 두면 다른 기기에서도 이어져요.

1. **SQL Editor → New query**에 [`supabase/prefs.sql`](../supabase/prefs.sql) 내용을 붙여넣고 **Run**을 누릅니다. 여러 번 실행해도 괜찮아요.

SQL을 실행하기 전에도 취향 반영은 동작해요. 다만 이 기기에만 저장돼요.

## 6-3. 공개 준비: 오류 기록, 계정 삭제, 비밀번호 재설정, 약관

### 오류 기록 켜기
1. **SQL Editor → New query**에 [`supabase/client_errors.sql`](../supabase/client_errors.sql) 내용을 붙여넣고 **Run**을 누릅니다.
2. 이후 다른 사람의 기기에서 생긴 오류가 **Table Editor → client_errors**에 쌓여요. 대시보드에서만 볼 수 있어요.
   - 남는 정보: 오류 문구, 화면 이름, 앱 버전, 브라우저 종류
   - 한 줄 기록이나 위치는 남지 않아요.
3. (선택) 90일이 지난 기록을 자동으로 지우려면 **Database → Extensions**에서 `pg_cron`을 켜고, SQL 파일 맨 아래의 주석을 풀어 한 번 실행하세요.

### 계정 삭제 함수 배포
1. **Edge Functions → Deploy a new function → Via Editor**를 엽니다.
2. ⚠️ **Deploy를 누르기 전에** 함수 이름 칸을 `delete-account`로 바꿔 주세요. 사진 함수가 `hyper-responder`가 된 것처럼, 그대로 두면 아무 이름이나 붙어요.
3. [`supabase/functions/delete-account/index.ts`](../supabase/functions/delete-account/index.ts)를 **Copy raw file**로 복사해 붙여넣고 **Deploy**를 누릅니다.
4. 함수의 **Details**에서 **Verify JWT를 끄고** 저장합니다. 로그인 확인은 함수 코드가 직접 해요.
5. **확인:** 앱의 프로필 버튼 → **계정 → 연결 점검 → 계정 삭제 기능 점검**을 누르세요.
   - "✓ 계정 삭제 기능이 준비됐어요"가 나오면 끝이에요.
   - 다른 문구가 나오면 그 안내대로 고치면 돼요. 점검은 로그인 정보 없이 확인만 해서, 계정은 절대 지워지지 않아요.
   - "서비스 키가 없어요"가 나오면 **Project Settings → API Keys**의 `service_role`(secret) 키를 **Edge Functions → Secrets**에 `SERVICE_ROLE_KEY`라는 이름으로 추가하세요. 이 키는 절대 앱이나 채팅에 넣지 마세요.
   - 직접 확인하고 싶다면 새 탭 주소창에 `https://pheawjaqtsifkmlsjhea.supabase.co/functions/v1/delete-account`를 열어 `"serviceKeySet": true`가 보이는지 봐도 돼요.
6. **카카오 연결 끊기 키 넣기 (카카오 로그인을 쓴다면 필수):** Kakao Developers → **앱 → 플랫폼 키(또는 앱 키) → Admin 키**를 복사해 **Edge Functions → Secrets**에 `KAKAO_ADMIN_KEY`로 추가하세요.
   - 카카오 정책상 회원이 탈퇴하면 앱이 카카오 "연결 끊기"를 해야 해요.
   - 이 키가 없으면 계정은 지워져도 카카오 연결이 남아요. 그래서 다음에 카카오로 로그인하면 동의 화면 없이 **새 빈 계정**이 자동으로 만들어지고, 같은 계정에 다시 들어간 것처럼 보여요.
   - Admin 키는 모든 권한을 가진 비밀 키예요. 앱, GitHub, 채팅에는 절대 넣지 말고 Secrets에만 넣으세요.
   - 함수 주소를 새 탭으로 열었을 때 `"kakaoAdminKeySet": true`가 보이면 돼요.
7. **삭제가 실제로 됐는지 확인:** 테스트 계정으로 삭제한 뒤 Supabase **Authentication → Users**에서 그 사용자가 사라졌는지 보세요. 같은 이메일이나 카카오로 다시 들어가면 목록에 **새로 만든 날짜**의 사용자가 생겨야 정상이에요.
8. 주소 끝 이름이 `delete-account`가 아니라면, GitHub **Settings → Secrets and variables → Actions → Variables**에 `DELETE_FUNCTION` = 그 이름을 추가하고 배포를 다시 실행하세요.

### 비밀번호 재설정 메일 보내기 (Gmail로 무료)
Supabase 기본 메일은 본인 주소로만 보낼 수 있어요. 비밀번호 재설정 메일을 다른 사람에게도 보내려면 외부 메일(SMTP)이 필요해요. 도메인이 없다면 Gmail이 가장 간단해요.

1. 보낼 Gmail 계정에서 **2단계 인증**을 켜요.
2. https://myaccount.google.com/apppasswords 에서 **앱 비밀번호**를 만들어요(16자리). 이 값도 다른 곳에 보내지 마세요.
3. Supabase **Authentication → Emails → SMTP Settings**에서 **Enable custom SMTP**를 켜고 입력해요.
   - Sender email: 그 Gmail 주소 · Sender name: `계획 있는 척.`
   - Host: `smtp.gmail.com` · Port: `465`
   - Username: 그 Gmail 주소 · Password: 2번의 앱 비밀번호
4. 이제 템플릿을 고칠 수 있어요. **Authentication → Emails → Templates → Reset Password** 본문을 아래처럼 바꾸고 저장해요. 앱은 링크가 아니라 숫자 코드를 받아요.
   ```html
   <h2>계획 있는 척.</h2>
   <p>비밀번호 재설정 코드: <strong>{{ .Token }}</strong></p>
   <p>앱의 "비밀번호를 잊었어요" 화면에 이 숫자와 새 비밀번호를 입력해 주세요. 직접 요청하지 않았다면 이 메일은 무시하셔도 돼요.</p>
   ```
5. Gmail은 하루 약 500통까지 보낼 수 있어요. 사용자가 많아지면 도메인을 마련해서 Resend 같은 메일 서비스로 바꾸면 돼요.

### 개인정보 처리방침·이용약관 채우기
1. GitHub에서 [`public/privacy.html`](../public/privacy.html)과 [`public/terms.html`](../public/terms.html)을 열고 연필(✎) 버튼으로 편집해요.
2. 노란색으로 표시되는 **[운영자 이름]**, **[연락 이메일]**, **[시행일]**을 채우고 **Commit changes**를 누르면 자동으로 배포돼요.
3. 내용은 앱이 실제로 하는 일에 맞춰 쓴 **초안**이에요. 공개 전에 직접 읽어 보고, 필요하면 전문가 검토를 받으세요.
4. 카카오 비즈 앱이나 Play 스토어에 넣을 주소:
   - 개인정보 처리방침: `https://johnyang0323.github.io/named_nothing/privacy.html`
   - 이용약관: `https://johnyang0323.github.io/named_nothing/terms.html`

## 6-4. 프로필, 사진 소감, 친구·단체방 켜기

1. **SQL Editor → New query**에 [`supabase/social.sql`](../supabase/social.sql) 내용을 전부 붙여넣고 **Run**을 누릅니다. 여러 번 실행해도 괜찮아요.
   - 프로필, 소감, 친구, 차단, 단체방, 댓글, 신고 테이블이 만들어져요.
   - 사진 보관함(Storage bucket) `avatars`(공개)와 `journal`(비공개)도 함께 만들어져요.
   - **누가 무엇을 볼 수 있는지는 데이터베이스가 직접 정해요.** 예를 들어 친구 공개 기록은 친구만, 단체방 기록은 멤버만 볼 수 있어요. 앱을 고쳐도 이 규칙은 뚫리지 않아요.
2. **계정 삭제 함수를 다시 배포**해 주세요. 계정을 지울 때 그 사람이 올린 사진 파일까지 지우도록 바뀌었어요.
   - `delete-account` 함수의 **Code** 탭에 최신 [`index.ts`](../supabase/functions/delete-account/index.ts)를 붙여넣고 **Deploy**를 누르면 돼요.
3. 확인 방법:
   - 앱의 프로필 버튼(오른쪽 위) → **계정**에서 닉네임과 사진을 저장해요.
   - **함께 → 친구**에서 내 이름표(`닉네임#12345`)가 보이면 성공이에요.
   - 신고 내역은 **Table Editor → reports**에서 확인하고, 문제 있는 기록은 **journal_entries**에서 지우면 돼요.

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
