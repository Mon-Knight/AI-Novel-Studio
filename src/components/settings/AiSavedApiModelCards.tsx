import type { SavedApiModelProfile } from '../../types/ai';
import { cloudApiProviderLabel } from '../../services/ai/savedApiModels';
import { SettingsSavedModelCards } from './SettingsSavedModelCards';

interface AiSavedApiModelCardsProps {
  profiles: SavedApiModelProfile[];
  activeId?: string;
  keyBound: (profile: SavedApiModelProfile) => boolean;
  onUse: (profile: SavedApiModelProfile) => void;
  onEdit: (profile: SavedApiModelProfile) => void;
  onDelete: (profile: SavedApiModelProfile) => void;
  onAdd: () => void;
}

export function AiSavedApiModelCards({
  profiles,
  activeId,
  keyBound,
  onUse,
  onEdit,
  onDelete,
  onAdd,
}: AiSavedApiModelCardsProps) {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  return (
    <SettingsSavedModelCards
      listTestId="ai-saved-model-list"
      addTestId="ai-saved-model-add"
      cardTestId="ai-saved-model-card"
      help="已保存的 API 模型以卡片显示，不展示密钥、地址或采样参数。可保存多份并随时切换。"
      empty="还没有保存的 API 模型。添加后会显示为卡片，当前使用的模型会高亮。"
      addLabel="添加模型"
      items={profiles.map((profile) => ({
        id: profile.id,
        label: profile.label,
        badge: cloudApiProviderLabel(profile.provider),
        active: profile.id === activeId,
        keyBound: keyBound(profile),
        lastTestOk: profile.lastTestOk,
      }))}
      onAdd={onAdd}
      onUse={(id) => {
        const profile = byId.get(id);
        if (profile) onUse(profile);
      }}
      onEdit={(id) => {
        const profile = byId.get(id);
        if (profile) onEdit(profile);
      }}
      onDelete={(id) => {
        const profile = byId.get(id);
        if (profile) onDelete(profile);
      }}
    />
  );
}
