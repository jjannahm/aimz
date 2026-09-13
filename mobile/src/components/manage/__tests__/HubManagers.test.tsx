import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AnnouncementsManager } from '@/src/components/manage/HubManagers';
import { api } from '@/src/lib/api';
import type { Announcement, Player, Team } from '@/src/types/api';

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
    announcementCoaches: jest.fn(),
    players: jest.fn(),
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
const squad = [{ id: 'p-1', name: 'Layla Hassan' }, { id: 'p-2', name: 'Nour Adel' }] as Player[];
const coaches = [{ id: 'c-1', name: 'Coach Ahmed', email: 'ahmed@aimz.test' }, { id: 'c-2', name: 'Coach Omar', email: 'omar@aimz.test' }];

const announcement = (over: Partial<Announcement> = {}): Announcement => ({
  id: 'a-1', team_id: null, team: null, audience: 'academy', title: 'Kit collection',
  body: 'Collect on Sunday.', author_id: null, author_name: 'Coach', priority: 'standard', pinned: false,
  player_ids: [], players: [], coach_ids: [], coaches: [], created_at: '', updated_at: '',
  ...over,
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false }, mutations: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('AnnouncementsManager', () => {
  beforeEach(() => {
    jest.mocked(api.announcements).mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    jest.mocked(api.createAnnouncement).mockResolvedValue({ id: 'announcement', team_id: 'team-u11' } as Announcement);
    jest.mocked(api.players).mockResolvedValue({ items: squad, total: squad.length, limit: 200, offset: 0 });
    jest.mocked(api.announcementCoaches).mockResolvedValue({ items: coaches });
  });
  afterEach(() => jest.clearAllMocks());

  it('addresses a squad through Teams, not from the audience list itself', async () => {
    const screen = await render(<AnnouncementsManager teams={teams} />, { wrapper });
    await screen.findByText('Post announcement');
    await waitFor(() => expect(api.announcements).toHaveBeenCalledWith());
    await fireEvent.press(screen.getByRole('button', { name: 'Show post announcement form' }));

    // The first dropdown is the kind of audience, never a squad by name.
    expect(screen.queryByRole('button', { name: 'U11' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Teams' }));
    await waitFor(() => expect(screen.getByTestId('choice-value-Audience').props.children).toBe('team'));

    // The squad comes from the second one, which only appears once it is needed.
    fireEvent.press(screen.getByRole('button', { name: 'U11' }));
    await waitFor(() => expect(screen.getByTestId('choice-value-Team').props.children).toBe('team-u11'));
    fireEvent.changeText(screen.getByLabelText('Title'), 'Training update');
    await waitFor(() => expect(screen.getByLabelText('Title').props.value).toBe('Training update'));
    fireEvent.changeText(screen.getByLabelText('Message'), 'Meet at 5pm.');
    await waitFor(() => expect(screen.getByLabelText('Message').props.value).toBe('Meet at 5pm.'));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Publish' }));
      await waitFor(() => expect(api.createAnnouncement).toHaveBeenCalledWith({
        audience: 'team',
        team_id: 'team-u11',
        // Nobody singled out, which is what "Entire team" means.
        player_ids: [],
        coach_ids: [],
        title: 'Training update',
        body: 'Meet at 5pm.',
        priority: 'standard',
      }));
    });
    await waitFor(() => expect(screen.getByLabelText('Title').props.value).toBe(''));
  });

  it('names players from the chosen squad, and coaches by account', async () => {
    const screen = await render(<AnnouncementsManager teams={teams} />, { wrapper });
    await screen.findByText('Post announcement');
    await fireEvent.press(screen.getByRole('button', { name: 'Show post announcement form' }));

    fireEvent.press(screen.getByRole('button', { name: 'Teams' }));
    await waitFor(() => expect(screen.getByTestId('choice-value-Audience').props.children).toBe('team'));
    fireEvent.press(screen.getByRole('button', { name: 'U11' }));
    // The squad's own players, read from the roster rather than typed in.
    await waitFor(() => expect(api.players).toHaveBeenCalledWith('?team_id=team-u11'));
    fireEvent.press(screen.getByRole('button', { name: 'Specific players' }));
    await waitFor(() => expect(screen.getByTestId('choice-value-Send to').props.children).toBe('some'));

    // Coaches come from the accounts that already exist.
    fireEvent.press(screen.getByRole('button', { name: 'Coaches' }));
    await waitFor(() => expect(api.announcementCoaches).toHaveBeenCalled());
  });

  it('says an urgent notice is pinned rather than asking for both', async () => {
    const screen = await render(<AnnouncementsManager teams={teams} />, { wrapper });
    await screen.findByText('Post announcement');
    await fireEvent.press(screen.getByRole('button', { name: 'Show post announcement form' }));

    // There is one dial, not a dial and a switch.
    fireEvent.press(screen.getByRole('button', { name: 'Urgent' }));
    await waitFor(() => expect(screen.getByText('Urgent notices are pinned to the top and shown in red.')).toBeTruthy());
  });

  it('marks an urgent notice in the list', async () => {
    jest.mocked(api.announcements).mockResolvedValue({
      items: [announcement({ priority: 'urgent', title: 'Training cancelled tonight' })],
      total: 1, limit: 100, offset: 0,
    });
    const screen = await render(<AnnouncementsManager teams={teams} />, { wrapper });
    // The list starts folded, as every Manage section does.
    await fireEvent.press(await screen.findByRole('button', { name: 'Show current announcements' }));
    await waitFor(() => expect(screen.getByText('URGENT')).toBeTruthy());
    expect(screen.getByText('Training cancelled tonight')).toBeTruthy();
  });

  it('says who a notice actually went to', async () => {
    jest.mocked(api.announcements).mockResolvedValue({
      items: [announcement({ audience: 'team', player_ids: ['p-1', 'p-2'], team: teams[0]!, team_id: 'team-u11' })],
      total: 1, limit: 100, offset: 0,
    });
    const screen = await render(<AnnouncementsManager teams={teams} />, { wrapper });
    await fireEvent.press(await screen.findByRole('button', { name: 'Show current announcements' }));
    // Counted rather than listed: the names belong on the notice, not above it.
    await waitFor(() => expect(screen.getByText(/U11 · 2 players/u)).toBeTruthy());
  });

  it('starts folded, and unfolds when a notice is edited', async () => {
    jest.mocked(api.announcements).mockResolvedValue({
      items: [announcement()],
      total: 1, limit: 100, offset: 0,
    } as never);
    const screen = await render(<AnnouncementsManager teams={teams} />, { wrapper });
    await screen.findByText('Post announcement');
    expect(screen.queryByLabelText('Title')).toBeNull();

    await fireEvent.press(await screen.findByRole('button', { name: 'Show current announcements' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Edit' }));

    expect(await screen.findByLabelText('Title')).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('Title').props.value).toBe('Kit collection'));
    expect(screen.getByText('Edit announcement')).toBeTruthy();
  });
});
