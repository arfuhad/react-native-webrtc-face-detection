import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { registerGlobals, configureWebRTC } from 'react-native-webrtc';

function TabBarIcon({ name, color }: { name: string; color: string }) {
  const icons: Record<string, string> = {
    camera: '📹',
    connection: '🔗',
    face: '👤',
    videocall: '📞',
  };
  return <Text style={{ fontSize: 24 }}>{icons[name] || '●'}</Text>;
}

export default function RootLayout() {
  useEffect(() => {
    // Register WebRTC globals
    registerGlobals();
    
    // Configure WebRTC with face detection enabled
    configureWebRTC({
      enableFaceDetection: true,
      enableScreenCapture: true,
    });
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: '#00d9ff',
          tabBarInactiveTintColor: '#666',
          tabBarStyle: styles.tabBar,
          tabBarLabelStyle: styles.tabBarLabel,
          headerStyle: styles.header,
          headerTintColor: '#fff',
          headerTitleStyle: styles.headerTitle,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Camera',
            headerTitle: 'Camera Test',
            tabBarIcon: ({ color }) => <TabBarIcon name="camera" color={color} />,
          }}
        />
        <Tabs.Screen
          name="peer-connection"
          options={{
            title: 'P2P',
            headerTitle: 'Peer Connection',
            tabBarIcon: ({ color }) => <TabBarIcon name="connection" color={color} />,
          }}
        />
        <Tabs.Screen
          name="face-detection"
          options={{
            title: 'Face',
            headerTitle: 'Face Detection',
            tabBarIcon: ({ color }) => <TabBarIcon name="face" color={color} />,
          }}
        />
        <Tabs.Screen
          name="video-call"
          options={{
            title: 'Call',
            headerTitle: 'Video Call',
            tabBarIcon: ({ color }) => <TabBarIcon name="videocall" color={color} />,
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  tabBar: {
    backgroundColor: '#16213e',
    borderTopColor: '#0f3460',
    borderTopWidth: 1,
    paddingBottom: 8,
    paddingTop: 8,
    height: 70,
  },
  tabBarLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  header: {
    backgroundColor: '#0f3460',
  },
  headerTitle: {
    fontWeight: 'bold',
    fontSize: 18,
  },
});

