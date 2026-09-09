import { fireEvent, render } from '@testing-library/react-native';

import { AppErrorBoundary } from '@/src/components/AppErrorBoundary';
import { sessionStore } from '@/src/lib/session';

jest.mock('@/src/lib/session', () => ({ sessionStore: { clear: jest.fn(async () => undefined) } }));

const props = (message = 'Minified React error #130') => ({
  error: new Error(message),
  retry: jest.fn(async () => undefined),
});

describe('the page shown when a screen throws', () => {
  afterEach(() => jest.clearAllMocks());

  /**
   * The whole point of it: a crash used to leave a bare page, which reads the
   * same as a slow load or a server that is down and cannot be reported.
   */
  it('says what happened, verbatim, instead of showing nothing', async () => {
    const screen = await render(<AppErrorBoundary {...props()} />);

    expect(screen.getByText('This screen stopped working')).toBeTruthy();
    // The message is the only thing somebody reporting this can pass on.
    expect(screen.getByText('Minified React error #130')).toBeTruthy();
  });

  it('offers the error a second chance without a reload', async () => {
    const given = props();
    const screen = await render(<AppErrorBoundary {...given} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(given.retry).toHaveBeenCalled();
    expect(sessionStore.clear).not.toHaveBeenCalled();
  });

  // A token the API will not take is read back on every start, so a crash that
  // survives reloading needs the stored session gone, not another retry.
  it('clears the stored session when the reader resets', async () => {
    const screen = await render(<AppErrorBoundary {...props()} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Reset the app and sign in again' }));
    expect(sessionStore.clear).toHaveBeenCalled();
  });

  it('still says something when the error carries no message', async () => {
    const screen = await render(<AppErrorBoundary error={undefined as never} retry={jest.fn()} />);
    expect(screen.getByText('No message was given.')).toBeTruthy();
  });
});
