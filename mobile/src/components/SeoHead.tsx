import Head from 'expo-router/head';

import { appConfig } from '@/src/config';

type Props = {
  title: string;
  description: string;
  path?: string;
  noIndex?: boolean;
};

export function SeoHead({ title, description, path = '/', noIndex = false }: Props) {
  const normalizedPath = path === '/' ? '' : `/${path.replace(/^\/+|\/+$/gu, '')}`;
  const canonical = `${appConfig.webOrigin}${normalizedPath}`;
  const image = `${appConfig.webOrigin}/aimz-icon-512.png`;
  const robots = noIndex || appConfig.isStaging ? 'noindex,nofollow' : 'index,follow';

  return <Head>
    <title>{title}</title>
    <meta name="description" content={description} />
    <meta name="robots" content={robots} />
    <link rel="canonical" href={canonical} />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="AIMZ Egypt" />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:url" content={canonical} />
    <meta property="og:image" content={image} />
    <meta property="og:image:alt" content="AIMZ Egypt logo" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content={title} />
    <meta name="twitter:description" content={description} />
    <meta name="twitter:image" content={image} />
  </Head>;
}
