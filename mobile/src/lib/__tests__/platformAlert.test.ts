import { Alert, Platform } from 'react-native';

import { confirmAction, registerDialogHost, showMessage } from '@/src/lib/platformAlert';

describe('platform alerts', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete (globalThis as { alert?: unknown }).alert;
    delete (globalThis as { confirm?: unknown }).confirm;
  });

  it('routes through the in-app dialog when one is mounted', () => {
    const present = jest.fn();
    const unregister = registerDialogHost(present);
    const onConfirm = jest.fn();

    confirmAction('End this match now?', 'Final score will be locked in.', 'End match', onConfirm, { destructive: true });
    showMessage('Roster saved', 'Lineup and minutes are now part of this match.');

    expect(present).toHaveBeenNthCalledWith(1, {
      title: 'End this match now?',
      message: 'Final score will be locked in.',
      confirmLabel: 'End match',
      destructive: true,
      onConfirm,
    });
    expect(present).toHaveBeenNthCalledWith(2, {
      title: 'Roster saved',
      message: 'Lineup and minutes are now part of this match.',
    });
    // The host runs the action itself, so nothing fires at call time.
    expect(onConfirm).not.toHaveBeenCalled();
    unregister();
  });

  it('falls back to the platform dialog when no host is mounted', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const webConfirm = jest.fn(() => true);
    Object.defineProperty(globalThis, 'confirm', { configurable: true, value: webConfirm });
    const onConfirm = jest.fn();

    confirmAction('Start match?', 'The first-half clock will begin immediately.', 'Start match', onConfirm);

    expect(webConfirm).toHaveBeenCalledWith(
      'Start match?\n\nThe first-half clock will begin immediately.',
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not run a cancelled fallback action on web', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    Object.defineProperty(globalThis, 'confirm', { configurable: true, value: jest.fn(() => false) });
    const onConfirm = jest.fn();

    confirmAction('Start match?', 'Begin now.', 'Start match', onConfirm);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('keeps native confirmations and web messages available as the fallback', () => {
    const onConfirm = jest.fn();
    jest.replaceProperty(Platform, 'OS', 'ios');
    const nativeAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    confirmAction('Start match?', 'Begin now.', 'Start match', onConfirm);
    expect(nativeAlert).toHaveBeenCalledWith('Start match?', 'Begin now.', expect.any(Array));

    jest.replaceProperty(Platform, 'OS', 'web');
    const webAlert = jest.fn();
    Object.defineProperty(globalThis, 'alert', { configurable: true, value: webAlert });
    showMessage('Match clock not updated', 'Try again.');
    expect(webAlert).toHaveBeenCalledWith('Match clock not updated\n\nTry again.');
  });

  it('stops routing to a host once it unmounts', () => {
    const present = jest.fn();
    registerDialogHost(present)();

    jest.replaceProperty(Platform, 'OS', 'web');
    const webAlert = jest.fn();
    Object.defineProperty(globalThis, 'alert', { configurable: true, value: webAlert });
    showMessage('Upload failed');

    expect(present).not.toHaveBeenCalled();
    expect(webAlert).toHaveBeenCalledWith('Upload failed');
  });
});
