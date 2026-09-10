import { Redirect, useLocalSearchParams } from 'expo-router';

export default function JoinLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <Redirect href={{ pathname: '/(auth)/register', params: { code: (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') } }} />;
}
