import { StyleSheet } from 'react-native';

import EditScreenInfo from '@/components/EditScreenInfo';
import { Text, View } from '@/components/Themed';
const { useSearchParams } = require('expo-router') as any;

export default function TabTwoScreen() {
  const params = useSearchParams();
  const predicted_class = params.predicted_class as string | undefined;
  const confidence = params.confidence as string | undefined;
  const timestamp = params.timestamp as string | undefined;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Diagnosis</Text>

      {predicted_class ? (
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 18, fontWeight: '600' }}>{predicted_class.replace(/_/g, ' ')}</Text>
          <Text style={{ marginTop: 8 }}>Confidence: {confidence ? `${(Number(confidence) * 100).toFixed(1)}%` : '—'}</Text>
          <Text style={{ marginTop: 4, color: '#666' }}>{timestamp}</Text>
        </View>
      ) : (
        <>
          <Text style={styles.title}>Tab Two</Text>
          <View style={styles.separator} lightColor="#eee" darkColor="rgba(255,255,255,0.1)" />
          <EditScreenInfo path="app/(tabs)/two.tsx" />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  separator: {
    marginVertical: 30,
    height: 1,
    width: '80%',
  },
});
