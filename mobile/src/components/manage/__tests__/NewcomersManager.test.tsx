import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { NewcomersManager } from '@/src/components/manage/NewcomersManager';
import { api } from '@/src/lib/api';
import type { Team } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, usePathname: () => '/manage' }));
jest.mock('@/src/lib/platformAlert', () => ({ showMessage: jest.fn() }));
jest.mock('@/src/lib/api', () => ({
  api: { newcomers: jest.fn(), newcomer: jest.fn(), updateNewcomer: jest.fn(), addNewcomerNote: jest.fn(), assignNewcomer: jest.fn() },
  ApiError: class extends Error {},
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const teams: Team[] = [];

// Address and medications are left empty on purpose: half a form filled in is
// the normal case, and the grid has to read straight when it is.
const application = {
  id: 'n-1', branch: 'Maadi', full_name: 'Farida Tarek', mobile: '01000000001',
  email: 'farida@example.test', whatsapp_mobile: '01000000002', date_of_birth: '2014-04-02',
  nationality: 'Egyptian', address: '', previous_academy: 'Wadi Degla',
  school_university: 'Maadi STEM', father_name: 'Tarek', father_mobile: '01000000003',
  mother_name: 'Hala', mother_mobile: '01000000004', medical_concerns: 'Asthma',
  medications: '', source: 'public_link', stage: 'new', outcome: null, user_id: null,
  player_id: null, invite_id: null, suggested_team_id: null, consent_version: '1',
  consented_at: '2026-09-01T08:00:00.000Z', last_contacted_at: null, next_follow_up_at: null,
  closed_at: null, redacted_at: null, created_at: '2026-09-01T08:00:00.000Z',
  updated_at: '2026-09-01T08:00:00.000Z', duplicate_likely: false, notes: [],
};

describe('a newcomer application', () => {
  beforeEach(() => {
    jest.mocked(api.newcomers).mockResolvedValue({ items: [application], total: 1, limit: 50, offset: 0 } as never);
    jest.mocked(api.newcomer).mockResolvedValue(application as never);
  });
  afterEach(() => jest.clearAllMocks());

  const open = async () => {
    const screen = await render(<NewcomersManager teams={teams} />, { wrapper });
    await fireEvent.press(await screen.findByRole('button', { name: 'Open application' }));
    await screen.findByText('Farida Tarek');
    return screen;
  };

  /**
   * What an application is opened to do is move it along — stage it, book a
   * follow-up, assign a squad. Twelve rows of what the form already said stood
   * between the name and the first of those controls, so they start folded.
   */
  it('opens on the controls rather than on twelve rows of form answers', async () => {
    const screen = await open();

    expect(screen.getByText('Personal details')).toBeTruthy();
    expect(screen.queryByText('01000000001')).toBeNull();
    // The stage picker is what the screen opens on instead.
    expect(screen.getByText('Pipeline stage')).toBeTruthy();
  });

  it('gives the details up when asked for them', async () => {
    const screen = await open();

    await fireEvent.press(screen.getByRole('button', { name: 'Show personal details' }));

    expect(await screen.findByText('01000000001')).toBeTruthy();
    expect(screen.getByText('farida@example.test')).toBeTruthy();
    expect(screen.getByText('Asthma')).toBeTruthy();
    // Parents read as one line each rather than four separate rows.
    expect(screen.getByText('Tarek · 01000000003')).toBeTruthy();
  });

  /**
   * A blank value used to render as an empty string, which in a two-column
   * grid reads as a broken cell rather than as a question nobody answered.
   */
  it('says nothing was given rather than showing an empty cell', async () => {
    const screen = await open();

    await fireEvent.press(screen.getByRole('button', { name: 'Show personal details' }));

    expect(screen.getByText('Address')).toBeTruthy();
    expect(screen.getByText('Medications')).toBeTruthy();
    expect(await screen.findAllByText('—')).toHaveLength(2);
  });

  // The count is what says how much is behind the heading before opening it.
  it('counts the answers on the heading', async () => {
    const screen = await open();

    expect(screen.getByText('12')).toBeTruthy();
  });
});
