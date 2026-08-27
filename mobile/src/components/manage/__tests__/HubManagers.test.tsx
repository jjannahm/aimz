import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AnnouncementsManager } from '@/src/components/manage/HubManagers';
import { api } from '@/src/lib/api';
import type { Announcement, Team } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/src/components/ChoiceField', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    ChoiceField: ({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: { label: string; value: string }[]; value?: string }) => (
      <View><Text>{label}</Text><Text testID={`choice-value-${label}`}>{value}</Text>{options.map((option) => <Pressable accessibilityLabel={option.label} accessibilityRole="button" key={option.value} onPress={() => onChange(option.value)}><Text>{option.label}</Text></Pressable>)}</View>
    ),
  };
});
jest.mock('@/src/lib/api', () => ({
  api: {
    announcements: jest.fn(),
    createAnnouncement: jest.fn(),
    updateAnnouncement: jest.fn(),
    deleteAnnouncement: jest.fn(),
  },
  ApiError: class extends Error {},
}));

const team = (id: string, name: string): Team => ({
  id, name, is_aimz: true, squad_code: null, age_group: name, season: '2026/27', is_active: true,
  logo_key: null, badge_style: null, logo_url: null, coach: null, assistant_coach: null, competition_id: null,
  competition_group_id: null, created_at: '', updated_at: '',
});

const teams = [team('team-u11', 'U11'), team('team-u13', 'U13')];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false }, mutations: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('AnnouncementsManager', () => {
  beforeEach(() => {
    jest.mocked(api.announcements).mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    jest.mocked(api.createAnnouncement).mockResolvedValue({ id: 'announcement', team_id: 'team-u11' } as Announcement);
  });
  afterEach(() => jest.clearAllMocks());

  it('publishes the exact selected team id', async () => {
    const screen = await render(<AnnouncementsManager teams={teams} />, { wrapper });
    await screen.findByText('Post announcement');
    await waitFor(() => expect(api.announcements).toHaveBeenCalledWith('?limit=100'));

    fireEvent.press(screen.getByRole('button', { name: 'U11' }));
    await waitFor(() => expect(screen.getByTestId('choice-value-Audience').props.children).toBe('team-u11'));
    fireEvent.changeText(screen.getByLabelText('Title'), 'Training update');
    await waitFor(() => expect(screen.getByLabelText('Title').props.value).toBe('Training update'));
    fireEvent.changeText(screen.getByLabelText('Message'), 'Meet at 5pm.');
    await waitFor(() => expect(screen.getByLabelText('Message').props.value).toBe('Meet at 5pm.'));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Publish' }));
      await waitFor(() => expect(api.createAnnouncement).toHaveBeenCalledWith({
        team_id: 'team-u11',
        title: 'Training update',
        body: 'Meet at 5pm.',
        pinned: false,
      }));
    });
    await waitFor(() => expect(screen.getByLabelText('Title').props.value).toBe(''));
  });
});
