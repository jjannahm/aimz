declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_API_URL?: string;
    EXPO_PUBLIC_APP_ENV?: 'development' | 'staging' | 'production';
    EXPO_PUBLIC_ENABLE_MEDIA?: string;
    EXPO_PUBLIC_ENABLE_PASSWORD_RESET?: string;
  }
}
