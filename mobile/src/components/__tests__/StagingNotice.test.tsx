import { render } from '@testing-library/react-native';

jest.mock('@/src/config', () => ({
  appConfig: { isStaging: true },
}));

import { StagingNotice } from '@/src/components/StagingNotice';

describe('StagingNotice', () => {
  it('warns collaborators to use fictional data', async () => {
    const screen = await render(<StagingNotice />);

    expect(screen.getByText('STAGING PREVIEW')).toBeTruthy();
    expect(screen.getByText(/Fictional data only/)).toBeTruthy();
  });
});
