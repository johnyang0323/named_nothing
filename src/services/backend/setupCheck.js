/**
 * "서버 설정 점검": which supabase/*.sql files have been run. Each check reads
 * zero rows from something that file creates, so nothing changes.
 */
import { getSupabase } from './client.js';

// In the order they should be run (docs/SUPABASE_SETUP.md).
export const SQL_FILES = [
  { file: 'schema.sql', what: '하루 기록 저장', table: 'days' },
  { file: 'prefs.sql', what: '취향 저장', table: 'prefs' },
  { file: 'photo_votes.sql', what: '사진 투표', table: 'photo_votes' },
  { file: 'client_errors.sql', what: '오류 기록', table: 'client_errors' },
  { file: 'social.sql', what: '프로필·친구·단체방', table: 'profiles' },
  { file: 'place_photos.sql', what: '사용자 장소 사진', table: 'journal_entries', column: 'share_place_photos' },
  { file: 'social_plus.sql', what: '친구 요청·알림·반응·장소 카드', table: 'notifications' },
  { file: 'together.sql', what: '함께 하루', table: 'together_days' },
  { file: 'multi_share.sql', what: '여러 곳에 함께 공개', table: 'journal_entries', column: 'group_ids' },
];

/** The table or column isn't there (the file wasn't run). */
const missing = (error) => ['PGRST205', 'PGRST204', '42P01', '42703', 'PGRST200'].includes(error?.code) || /does not exist|could not find/i.test(error?.message || '');

export async function checkSetup() {
  const supabase = await getSupabase();
  if (!supabase) return { ok: false, message: 'Supabase가 연결되지 않은 빌드예요.' };
  const results = await Promise.all(
    SQL_FILES.map(async (f) => {
      try {
        const { error } = await supabase.from(f.table).select(f.column || '*').limit(0);
        return { ...f, state: !error ? 'ok' : missing(error) ? 'missing' : 'unknown' };
      } catch {
        return { ...f, state: 'unknown' };
      }
    }),
  );
  // a file's own table exists but an earlier one doesn't: still list it, in order
  const todo = results.filter((r) => r.state === 'missing');
  const unknown = results.filter((r) => r.state === 'unknown');
  if (!todo.length && !unknown.length) return { ok: true, message: `서버 설정이 모두 끝났어요 (SQL ${SQL_FILES.length}개 모두 실행됨).` };
  return {
    ok: false,
    message: todo.length
      ? `아직 실행하지 않은 SQL이 ${todo.length}개 있어요. Supabase → SQL Editor에서 이 순서대로 실행해 주세요: ${todo.map((r) => r.file).join(' → ')}`
      : '일부 항목을 확인하지 못했어요. 잠시 후 다시 눌러보세요.',
    detail: [...todo.map((r) => `${r.file}: ${r.what}`), ...unknown.map((r) => `${r.file}: 확인 못 함`)].join(' · '),
  };
}
