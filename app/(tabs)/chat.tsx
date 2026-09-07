import { RefreshControl, ScrollView, StyleSheet, View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { Body, Display, Small, Tiny } from '@/components/Text';
import { useConversations } from '@/features/chat/queries';
import { useChatInbox } from '@/features/chat/realtime';
import { useMe } from '@/features/tasks/queries';
import { formatEventStamp, initials } from '@/lib/format';
import { color, font, radius } from '@/theme/tokens';

/**
 * The driver's threads.
 *
 * There is no "new message" button, and that is the API's design rather than an
 * omission: `/chat/directory` returns `[]` for a driver, and creating a space is
 * operator-only. A thread exists because dispatch opened it — which arrives here
 * as a `chat.membership.changed` broadcast, or on the next poll.
 *
 * A list rather than a single thread, even though most drivers will only ever
 * have one. The server returns a collection with per-thread unread counts, and
 * collapsing that to "the first one" would silently hide the second operator who
 * messages them.
 */
export default function ChatListScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data: me } = useMe();
  const { data, isLoading, isError, error, refetch, isRefetching } = useConversations();

  // One socket for the whole app, opened here because this is the only feature
  // that uses it. Keeps the thread screen free of subscription lifecycle.
  useChatInbox(me?.id);

  const conversations = data?.data ?? [];

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Display style={styles.title}>Messages</Display>
        <Small style={styles.subtitle}>
          {data?.meta.totalUnread
            ? `${data.meta.totalUnread} unread`
            : 'Dispatch will message you here'}
        </Small>
      </View>

      {isLoading ? (
        <LoadingState label="Loading messages…" />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 20 }]}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => void refetch()}
              tintColor={color.primary}
              colors={[color.primary]}
            />
          }
        >
          {conversations.length === 0 ? (
            <EmptyState
              icon="message-circle"
              title="No messages yet"
              message="Dispatch starts the conversation. Anything they send about a job will appear here."
            />
          ) : (
            <Card style={styles.card}>
              {conversations.map((c, i) => (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.name}${c.unreadCount ? `, ${c.unreadCount} unread` : ''}`}
                  onPress={() => router.push({ pathname: '/chat/[id]', params: { id: c.id } })}
                  style={({ pressed }) => [
                    styles.row,
                    i === conversations.length - 1 ? styles.rowLast : null,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <View style={styles.avatar}>
                    <Body style={styles.avatarText}>{initials(c.name)}</Body>
                  </View>

                  <View style={styles.rowText}>
                    <View style={styles.rowTop}>
                      <Body
                        style={[styles.name, c.unreadCount > 0 ? styles.nameUnread : null]}
                        numberOfLines={1}
                      >
                        {c.name}
                      </Body>
                      {c.lastMessageAt ? (
                        <Tiny
                          style={[styles.when, c.unreadCount > 0 ? styles.whenUnread : null]}
                        >
                          {formatEventStamp(c.lastMessageAt)}
                        </Tiny>
                      ) : null}
                    </View>

                    <Small
                      style={[styles.preview, c.unreadCount > 0 ? styles.previewUnread : null]}
                      numberOfLines={1}
                    >
                      {previewOf(c.lastMessage, me?.id)}
                    </Small>
                  </View>

                  {c.unreadCount > 0 ? (
                    <View style={styles.badge}>
                      <Tiny style={styles.badgeText}>
                        {c.unreadCount > 99 ? '99+' : c.unreadCount}
                      </Tiny>
                    </View>
                  ) : (
                    <Icon name="chevron-right" size={18} color={color.faint} />
                  )}
                </Pressable>
              ))}
            </Card>
          )}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * The preview line.
 *
 * A message with only a file has a null body — the server allows text, a file,
 * or both — so "📎 Photo" stands in rather than an empty row that looks like a
 * bug.
 */
function previewOf(
  last: { senderId: string; body: string | null } | null,
  myId: string | undefined,
): string {
  if (!last) return 'No messages yet';
  const prefix = myId && last.senderId === myId ? 'You: ' : '';
  return `${prefix}${last.body ?? '📎 Attachment'}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgCanvas },
  header: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    backgroundColor: color.surface,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  title: { fontSize: 22 },
  subtitle: { color: color.muted, marginTop: 2 },

  list: { padding: 14, flexGrow: 1 },
  card: { padding: 0, overflow: 'hidden' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: color.line2,
  },
  rowLast: { borderBottomWidth: 0 },
  pressed: { backgroundColor: color.surfaceSoft },

  avatar: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: color.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: font.bold, fontSize: 14, color: color.primary },

  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontFamily: font.semibold, color: color.ink },
  /*
   * Weight and colour both shift on an unread row rather than one or the other.
   * A driver scans this list one-handed in a cab; a single cue that thin is easy
   * to miss, and the badge alone sits at the far edge from the name.
   */
  nameUnread: { fontFamily: font.bold },
  when: { fontSize: 11, color: color.faint },
  whenUnread: { color: color.primary, fontFamily: font.semibold },
  preview: { color: color.muted },
  previewUnread: { color: color.ink, fontFamily: font.medium },

  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: color.onPrimary, fontFamily: font.bold, fontSize: 11 },
});
