import { Tabs } from 'expo-router';
import { Platform, StyleSheet, View, type ColorValue } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useConversations } from '@/features/chat/queries';
import { color, font, radius } from '@/theme/tokens';

/**
 * Five tabs. **Vehicle**, the sixth in the mockup, still has no table, no
 * endpoint and no data behind it — shipping it as a dead tab would teach drivers
 * that parts of the app do not work.
 *
 * **Chat** is live against `/api/chat`. The router-level gate there is `driver`,
 * and every `/:id` route is guarded by membership rather than role, so a driver
 * reaches exactly the threads dispatch put them in.
 */
export default function TabsLayout() {
  /*
   * The badge reads the same server-computed total the Messages screen shows.
   * `meta.totalUnread` is summed backend-side precisely so a nav badge needs no
   * second request, and the query polls under the socket — so the count is right
   * within one poll even when a broadcast was dropped.
   */
  const { data: chat } = useConversations();
  const unread = chat?.meta.totalUnread ?? 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.primary,
        tabBarInactiveTintColor: color.muted,
        tabBarStyle: styles.bar,
        tabBarLabelStyle: styles.label,
        tabBarItemStyle: styles.item,
        // 44pt is the minimum comfortable target, and this is tapped with gloves
        // on in the rain.
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Tasks',
          tabBarIcon: ({ color: tint, focused }) => (
            <TabIcon name="check-square" tint={tint} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          tabBarIcon: ({ color: tint, focused }) => (
            <TabIcon name="map" tint={tint} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          // Capped at 99+: the pill is 18px wide and a courier with 137 unread
          // messages needs to know it is 'a lot', not the exact figure.
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarBadgeStyle: styles.badge,
          tabBarIcon: ({ color: tint, focused }) => (
            <TabIcon name="message-circle" tint={tint} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color: tint, focused }) => (
            <TabIcon name="clock" tint={tint} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ color: tint, focused }) => (
            <TabIcon name="menu" tint={tint} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

/** The mockup's `.tab .pl` — a soft pill behind the icon when the tab is active. */
function TabIcon({
  name,
  tint,
  focused,
}: {
  name: React.ComponentProps<typeof Feather>['name'];
  tint: ColorValue;
  focused: boolean;
}) {
  return (
    <View style={[styles.pill, focused ? styles.pillOn : null]}>
      <Feather name={name} size={20} color={tint} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: color.surface,
    borderTopWidth: 1,
    borderTopColor: color.line,
    height: Platform.OS === 'ios' ? 84 : 68,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 26 : 10,
  },
  item: { paddingVertical: 2 },
  badge: {
    // Brand blue, not alert red: an unread message is information, not a fault.
    backgroundColor: color.primary,
    color: color.onPrimary,
    fontFamily: font.bold,
    fontSize: 10,
    minWidth: 18,
    height: 18,
    lineHeight: 18,
  },
  label: { fontFamily: font.semibold, fontSize: 10, marginTop: 2 },
  pill: {
    width: 48,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillOn: { backgroundColor: color.primarySoft },
});
