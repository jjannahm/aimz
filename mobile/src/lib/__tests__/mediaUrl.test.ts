import { appConfig } from '@/src/config';
import { mediaUrl } from '@/src/lib/mediaUrl';

describe('mediaUrl', () => {
  it('resolves the Worker\'s root-relative path against the API host', () => {
    expect(mediaUrl('/api/v1/media/teams/abc/crest.png')).toBe(`${appConfig.apiBaseUrl}/api/v1/media/teams/abc/crest.png`);
  });

  it('passes an absolute URL through, so signed S3 reads still work', () => {
    const signed = 'https://storage.example.test/teams/abc/crest.png?X-Amz-Signature=abc';
    expect(mediaUrl(signed)).toBe(signed);
    expect(mediaUrl('data:image/png;base64,iVBOR')).toBe('data:image/png;base64,iVBOR');
  });

  it('gives nothing back for a team that has no image', () => {
    expect(mediaUrl(null)).toBeUndefined();
    expect(mediaUrl(undefined)).toBeUndefined();
    expect(mediaUrl('')).toBeUndefined();
  });

  it('still joins a path the API returned without its leading slash', () => {
    expect(mediaUrl('api/v1/media/teams/abc/crest.png')).toBe(`${appConfig.apiBaseUrl}/api/v1/media/teams/abc/crest.png`);
  });
});
