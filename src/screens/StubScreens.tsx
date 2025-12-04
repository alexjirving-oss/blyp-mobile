import React from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity } from 'react-native';
import HeaderContainer from '../components/HeaderContainer';
import BlypLogo from '../components/BlypLogo';

const makeStub = (title: string, message: string) => ({ navigation }: any) => (
  <SafeAreaView style={{ flex: 1, backgroundColor: '#0f172a' }}>
    <HeaderContainer onLayout={() => {}}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 }}>
        <BlypLogo style={{}} useGradientBackground={false} textStyle={{ fontSize: 24 }} />
      </View>
    </HeaderContainer>
    <View style={styles.center}> 
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.msg}>{message}</Text>
      <TouchableOpacity style={styles.btn} onPress={()=>navigation.goBack()}><Text style={styles.btnText}>Go back</Text></TouchableOpacity>
    </View>
  </SafeAreaView>
);

export const WalletStub = makeStub('Wallet', 'Wallet/Earnings is not yet available.');
export const SettingsStub = makeStub('Settings', 'Settings are under construction.');
export const MyVideosStub = makeStub('My Videos', 'Your videos list will appear here.');
export const PastLivesStub = makeStub('Past Live Streams', 'Past live streams are coming soon.');
export const LiveUnavailableStub = makeStub('Live Unavailable', 'Live streaming is not available yet.');

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  msg: { color: '#cbd5e1', textAlign: 'center', marginBottom: 16 },
  btn: { backgroundColor: '#ec4899', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12 },
  btnText: { color: '#fff', fontWeight: '700' },
});

export default WalletStub;
