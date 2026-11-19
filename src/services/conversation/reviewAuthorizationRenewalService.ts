import { dbCall, isTauri } from '../database/db';
import type { ReviewAuthorization } from '../../types/conversation';
import type {
  PreviewReviewRenewalInput,
  RenewReviewInput,
  ReviewRenewalPreview,
  ReviewAuthorizationResume,
} from '../../types/reviewAuthorizationRenewal';

function requireDesktop(): void {
  if (!isTauri()) throw new Error('审阅重新授权必须由桌面原生服务复验；浏览器不能签发权限。');
}

/** User-operated manual review only. No model call, local permission mirror or automatic signing. */
export const reviewAuthorizationRenewalService = {
  isSupported: isTauri,
  async preview(input: PreviewReviewRenewalInput): Promise<ReviewRenewalPreview> {
    requireDesktop();
    return dbCall<ReviewRenewalPreview>('preview_review_authorization_renewal', { input });
  },
  async renew(input: RenewReviewInput): Promise<ReviewAuthorization> {
    requireDesktop();
    return dbCall<ReviewAuthorization>('renew_review_authorization', { input });
  },
  async getResult(
    input: Pick<RenewReviewInput, 'authorizationId' | 'operationId'>,
  ): Promise<ReviewAuthorization | null> {
    requireDesktop();
    return dbCall<ReviewAuthorization | null>('get_review_authorization_renewal', input);
  },
  async resume(authorizationId: string): Promise<ReviewAuthorizationResume> {
    requireDesktop();
    return dbCall<ReviewAuthorizationResume>('get_review_authorization_resume', {
      authorizationId,
    });
  },
};
