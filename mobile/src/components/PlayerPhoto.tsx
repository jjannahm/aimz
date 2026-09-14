import React from 'react';
import { Image, Platform, type ImageStyle, type StyleProp } from 'react-native';

import { sessionStore } from '@/src/lib/session';

/** Loads private player photos without putting a bearer token in the URL. */
export function PlayerPhoto({ accessibilityLabel, style, uri }: { accessibilityLabel?: string; style: StyleProp<ImageStyle>; uri: string }) {
  const [webUri, setWebUri] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    const token = sessionStore.get()?.access_token;
    if (!token) return;
    fetch(uri, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then((response) => response.ok ? response.blob() : Promise.reject(new Error('photo unavailable')))
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setWebUri(objectUrl); })
      .catch(() => undefined);
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [uri]);

  if (Platform.OS === 'web' && !webUri) return null;
  const token = sessionStore.get()?.access_token;
  return <Image accessibilityLabel={accessibilityLabel} source={{ uri: webUri ?? uri, ...(Platform.OS === 'web' || !token ? {} : { headers: { Authorization: `Bearer ${token}` } }) }} style={style} />;
}
