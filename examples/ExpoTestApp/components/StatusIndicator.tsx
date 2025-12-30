import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, borderRadius } from '@/constants/theme';

interface StatusIndicatorProps {
  label: string;
  value: string | number | boolean;
  status?: 'success' | 'warning' | 'error' | 'info';
}

export function StatusIndicator({ label, value, status = 'info' }: StatusIndicatorProps) {
  const statusColor = {
    success: colors.success,
    warning: colors.warning,
    error: colors.error,
    info: colors.primary,
  }[status];

  const displayValue = typeof value === 'boolean' 
    ? (value ? 'ON' : 'OFF') 
    : String(value);

  return (
    <View style={styles.container}>
      <View style={[styles.dot, { backgroundColor: statusColor }]} />
      <Text style={styles.label}>{label}:</Text>
      <Text style={[styles.value, { color: statusColor }]}>{displayValue}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.sm,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 14,
    marginRight: spacing.xs,
  },
  value: {
    fontSize: 14,
    fontWeight: '600',
  },
});

