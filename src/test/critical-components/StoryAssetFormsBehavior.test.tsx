import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import StoryAssetForms from '../../pages/StoryAssets/StoryAssetForms';
import type { FactionAsset, LocationAsset } from '../../types/contentTransaction';

const timestamp = '2026-07-28T00:00:00.000Z';
const factions: FactionAsset[] = [
  {
    id: 'faction-a',
    novelId: 'novel-1',
    name: '北境议会',
    description: '',
    goals: '',
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'faction-b',
    novelId: 'novel-1',
    name: '南方商会',
    description: '',
    goals: '',
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];
const locations: LocationAsset[] = [
  {
    id: 'location-a',
    novelId: 'novel-1',
    name: '旧城',
    description: '',
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'location-b',
    novelId: 'novel-1',
    name: '档案库',
    description: '',
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];

it('prepares locations, faction relations and location links with normalized payloads', async () => {
  const onPrepare = vi.fn(async () => undefined);
  const createId = vi.fn((prefix: string) => `${prefix}-fixture`);
  render(
    <StoryAssetForms
      factions={factions}
      locations={locations}
      busy={false}
      createId={createId}
      onPrepare={onPrepare}
    />,
  );
  const form = document.querySelector<HTMLFormElement>('.story-assets-form') as HTMLFormElement;

  fireEvent.click(screen.getByRole('tab', { name: '地点' }));
  const locationInputs = within(form).getAllByRole('textbox');
  fireEvent.change(locationInputs[0], { target: { value: '  地下室  ' } });
  fireEvent.change(locationInputs[1], { target: { value: '  secret  ' } });
  fireEvent.change(within(form).getByRole('combobox'), { target: { value: 'location-a' } });
  fireEvent.change(locationInputs[2], { target: { value: '  隐藏档案  ' } });
  fireEvent.submit(form);
  await waitFor(() => expect(onPrepare).toHaveBeenCalledTimes(1));
  expect(onPrepare).toHaveBeenLastCalledWith([
    expect.objectContaining({
      targetType: 'location',
      payload: {
        name: '地下室',
        kind: 'secret',
        description: '隐藏档案',
        parentLocationId: 'location-a',
      },
    }),
  ]);

  fireEvent.click(screen.getByRole('tab', { name: '势力关系' }));
  let selects = within(form).getAllByRole('combobox');
  fireEvent.change(selects[0], { target: { value: 'faction-a' } });
  fireEvent.change(selects[1], { target: { value: 'faction-b' } });
  let relationInputs = within(form).getAllByRole('textbox');
  fireEvent.change(relationInputs[0], { target: { value: '  ally  ' } });
  fireEvent.change(relationInputs[1], { target: { value: '  临时联盟  ' } });
  fireEvent.submit(form);
  await waitFor(() => expect(onPrepare).toHaveBeenCalledTimes(2));
  expect(onPrepare).toHaveBeenLastCalledWith([
    expect.objectContaining({
      targetType: 'faction_relation',
      payload: expect.objectContaining({
        sourceFactionId: 'faction-a',
        targetFactionId: 'faction-b',
        relationType: 'ally',
      }),
    }),
  ]);

  fireEvent.click(screen.getByRole('tab', { name: '地点连接' }));
  selects = within(form).getAllByRole('combobox');
  fireEvent.change(selects[0], { target: { value: 'location-a' } });
  fireEvent.change(selects[1], { target: { value: 'location-b' } });
  relationInputs = within(form).getAllByRole('textbox');
  fireEvent.change(relationInputs[0], { target: { value: '  tunnel  ' } });
  fireEvent.change(relationInputs[1], { target: { value: '  单向密道  ' } });
  fireEvent.submit(form);
  await waitFor(() => expect(onPrepare).toHaveBeenCalledTimes(3));
  expect(onPrepare).toHaveBeenLastCalledWith([
    expect.objectContaining({
      targetType: 'location_link',
      payload: expect.objectContaining({
        sourceLocationId: 'location-a',
        targetLocationId: 'location-b',
        linkType: 'tunnel',
      }),
    }),
  ]);
});
