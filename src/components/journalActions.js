/**
 * Actions shared by screens that show journal entries (나의 하루, 함께):
 * comments, reports, deleting an entry. After a change the current
 * screen's reload() refreshes its data.
 */
import { addComment, deleteComment, deleteEntry, report, toggleReaction, removeEntryFromGroup, SocialError } from '../services/backend/social.js';

const confirmText = {
  entry: '이 기록을 신고할까요? 운영자가 확인하고 조치해요.',
  comment: '이 댓글을 신고할까요? 운영자가 확인하고 조치해요.',
  user: '이 사람을 신고할까요? 운영자가 확인하고 조치해요.',
  group: '이 단체방을 신고할까요? 운영자가 확인하고 조치해요.',
};

async function attempt(ctx, run, done) {
  try {
    await run();
    if (done) ctx.toast(done);
    await ctx.reload();
  } catch (error) {
    ctx.toast(error instanceof SocialError ? error.message : '잠시 후 다시 시도해 주세요.');
  }
}

export const journalActions = {
  report: (ctx, data) => {
    if (!window.confirm(confirmText[data.type] || confirmText.entry)) return;
    attempt(ctx, () => report(data.type, data.id), '신고했어요. 알려주셔서 고마워요.');
  },
  'comment-delete': (ctx, data) => {
    if (!window.confirm('이 댓글을 지울까요?')) return;
    attempt(ctx, () => deleteComment(data.id), '댓글을 지웠어요.');
  },
  'comment-toggle': ({ ui, rerender }, data) => {
    ui.openComments = { ...(ui.openComments || {}), [data.entry]: !ui.openComments?.[data.entry] };
    rerender();
    if (ui.openComments[data.entry]) document.getElementById(`comment-${data.entry}`)?.focus();
  },
  'entry-unpost': (ctx, data) => {
    const entry = ctx.ui.entryIndex?.get(data.id);
    if (!entry || !window.confirm('이 기록을 이 방에서 내릴까요? 다른 곳에 공개된 것은 그대로예요.')) return;
    attempt(ctx, () => removeEntryFromGroup(entry, data.group), '방에서 내렸어요.');
  },
  react: (ctx, data) => attempt(ctx, () => toggleReaction(data.entry, data.emoji, data.mine === '1')),
  'entry-delete': (ctx, data) => {
    const entry = ctx.ui.entryIndex?.get(data.id);
    if (!entry || !window.confirm('이 기록과 사진을 지울까요? 되돌릴 수 없어요.')) return;
    attempt(ctx, () => deleteEntry(entry), '기록을 지웠어요.');
  },
};

export const journalInputs = {
  'comment-draft': ({ ui }, el) => {
    ui.commentDrafts = { ...(ui.commentDrafts || {}), [el.dataset.entry]: el.value };
  },
};

export const journalForms = {
  comment: (ctx, form) => {
    const entryId = form.dataset.entry;
    const body = ctx.ui.commentDrafts?.[entryId] || '';
    attempt(ctx, async () => {
      await addComment(entryId, body);
      ctx.ui.commentDrafts = { ...(ctx.ui.commentDrafts || {}), [entryId]: '' };
    });
  },
};
