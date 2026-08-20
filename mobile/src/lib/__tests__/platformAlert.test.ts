import { Alert, Platform } from 'react-native';

import { confirmAction, showMessage } from '@/src/lib/platformAlert';

describe('platform alerts', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete (globalThis as { alert?: unknown }).alert;
    delete (globalThis as { confirm?: unknown }).confirm;
  });

  it('runs a confirmed action on web', () => {
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

  it('does not run a cancelled action on web', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const webConfirm = jest.fn(() => false);
    Object.defineProperty(globalThis, 'confirm', { configurable: true, value: webConfirm });
    const onConfirm = jest.fn();

    confirmAction('Start match?', 'Begin now.', 'Start match', onConfirm);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('keeps native confirmations and web messages available', () => {
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
});
