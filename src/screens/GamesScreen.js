import React from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import BlueScreen from '../ui/BlueScreen';
import BlypHeaderFlow from '../components/BlypHeaderFlow';
import GamesContent from '../components/Games/GamesContent';
import { emitTourSelect } from '../tour/tourBus';
import { COLORS } from '../styles/theme';

/**
 * Standalone Games route (Home hub Jump in). Same surface as Chat/Games → Games.
 * Does not revive create-sheet matchmaking.
 */
const GamesScreen = ({ navigation }) => (
  <BlueScreen>
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <BlypHeaderFlow
        tabs={[{ key: 'games', label: 'Games' }]}
        matchHomePadding
        activeKey="games"
        onTabChange={() => {}}
        onMenuPress={() => navigation.goBack()}
      />
      <GamesContent
        navigation={navigation}
        onSelectChatTab={(tab) => {
          try {
            navigation.navigate('Chat');
          } catch {
            /* ignore */
          }
          emitTourSelect({ screen: 'Chat', tab: tab || 'battles' });
        }}
      />
    </View>
  </BlueScreen>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.pageBackground || '#0A0A0C',
  },
});

export default GamesScreen;
