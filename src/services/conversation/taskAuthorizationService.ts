import type {
  ApplyTaskAuthorizationInput,
  IssueTaskAuthorizationInput,
  TaskAuthorization,
  TaskAuthorizationReceipt,
} from '../../types/taskAuthorization';
import { dbCall, isTauri } from '../database/db';

function requireDesktop(): void {
  if (!isTauri()) {
    throw new Error('任务级预授权仅由桌面原生服务签发和复验；浏览器不能授予正式写入权限。');
  }
}

/** UI-to-native adapter only; no local permission mirror and no model-controlled signing. */
export const taskAuthorizationService = {
  async issue(input: IssueTaskAuthorizationInput): Promise<TaskAuthorization> {
    requireDesktop();
    return dbCall<TaskAuthorization>('issue_task_authorization', { input });
  },
  async list(conversationId: string): Promise<TaskAuthorization[]> {
    requireDesktop();
    return dbCall<TaskAuthorization[]>('list_task_authorizations', { conversationId });
  },
  async revoke(input: { authorizationId: string; reason?: string }): Promise<TaskAuthorization> {
    requireDesktop();
    return dbCall<TaskAuthorization>('revoke_task_authorization', { input });
  },
  async apply(input: ApplyTaskAuthorizationInput): Promise<TaskAuthorizationReceipt> {
    requireDesktop();
    return dbCall<TaskAuthorizationReceipt>('apply_task_authorization', { input });
  },
  async listReceipts(authorizationId: string): Promise<TaskAuthorizationReceipt[]> {
    requireDesktop();
    return dbCall<TaskAuthorizationReceipt[]>('list_task_authorization_receipts', {
      authorizationId,
    });
  },
};
